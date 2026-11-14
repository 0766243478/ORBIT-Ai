import {
  assessTelemetryReliability,
  estimateModelCost,
  estimateModelLatencyMs,
  type CalibratedModelStats,
} from './costEstimator';
import { classifyDeviceTier } from './deviceProfiler';
import { evaluatePrivacyPolicy } from './privacyGuardian';
import type {
  ConstraintEvaluation,
  CustomPrivacyPreferences,
  DecisionExplainabilityMetadata,
  DeviceCapabilityProfile,
  DeviceTier,
  ExecutionRoute,
  MeasurementProvenance,
  ModelDescriptor,
  NetworkStatusSnapshot,
  PrivacyMode,
  RejectedAlternativeSummary,
  RouteScoreBreakdown,
  RoutingDecision,
  TaskAnalysis,
} from './types';

function resolveDeviceTierInfo(device: DeviceCapabilityProfile): {
  tier: DeviceTier;
  maxLocalTokens: number;
} {
  if (device.deviceTier && typeof device.recommendedMaxLocalTokens === 'number') {
    return {
      tier: device.deviceTier,
      maxLocalTokens: device.recommendedMaxLocalTokens,
    };
  }
  const assessed = classifyDeviceTier(
    device.deviceMemoryGb,
    device.hardwareConcurrency,
    device.webGpuAvailable,
    device.storageQuotaMb
  );
  return {
    tier: assessed.deviceTier,
    maxLocalTokens: assessed.recommendedMaxLocalTokens,
  };
}

function computeTierHeadroomScore(device: DeviceCapabilityProfile, tier: DeviceTier): number {
  if (device.resourceConstrained || tier === 'low_2gb') return 20;
  const gpuPenalty = device.webGpuAvailable ? 0 : 12;
  switch (tier) {
    case 'entry_3_4gb':
      return Math.max(35, 62 - gpuPenalty);
    case 'mid_6gb':
      return Math.max(55, 82 - gpuPenalty);
    case 'high_8gb_plus':
      return Math.max(70, 95 - gpuPenalty);
    default:
      return Math.max(50, 76 - gpuPenalty);
  }
}

interface CloudModelSelectionResult {
  selected: ModelDescriptor | null;
  selectionReasonsEn: string[];
  selectionReasonsAr: string[];
}

export function pickBestCloudModel(
  models: ModelDescriptor[],
  analysis: TaskAnalysis,
  preferLowCost: boolean,
  network?: NetworkStatusSnapshot,
  privacyMode: PrivacyMode = 'BALANCED',
  budgetLimitUsd: number | null = null,
  calibrationByModel?: Record<string, CalibratedModelStats>
): CloudModelSelectionResult {
  const selectionReasonsEn: string[] = [];
  const selectionReasonsAr: string[] = [];

  const availableCloud = models.filter(
    (m) =>
      m.executionLocality === 'cloud' &&
      m.available &&
      m.supportedTasks.includes(analysis.taskType) &&
      analysis.estimatedInputTokens <= m.maxContextTokens
  );

  if (availableCloud.length === 0) {
    return { selected: null, selectionReasonsEn, selectionReasonsAr };
  }

  if (availableCloud.length === 1) {
    const sole = availableCloud[0];
    selectionReasonsEn.push(
      `Selected ${sole.id} because it is the sole available cloud model supporting ${analysis.taskType} (${analysis.estimatedInputTokens} input tokens).`
    );
    selectionReasonsAr.push(
      `تم اختيار ${sole.id} لأنه النموذج السحابي الوحيد المتاح الداعم لمهمة ${analysis.taskType}.`
    );
    return { selected: sole, selectionReasonsEn, selectionReasonsAr };
  }

  // Respect budget constraints where possible without masking hard budget errors
  const withinBudgetCandidates = availableCloud.filter(
    (m) =>
      estimateModelCost({
        model: m,
        inputTokens: analysis.estimatedInputTokens,
        outputTokens: analysis.estimatedOutputTokens,
        budgetLimitUsd,
      }).withinBudget
  );
  const pool = withinBudgetCandidates.length > 0 ? withinBudgetCandidates : availableCloud;

  const isComplexOrReasoning =
    analysis.requiresDeepReasoning ||
    analysis.complexity === 'high' ||
    analysis.complexity === 'expert' ||
    analysis.taskType === 'coding_technical' ||
    analysis.hasAttachments ||
    (analysis.detectedLanguage === 'ar' && analysis.complexity !== 'low');

  const slowOrMeteredNetwork = Boolean(
    network &&
      (network.saveData ||
        network.effectiveType === '2g' ||
        network.effectiveType === 'slow-2g' ||
        (network.rttMs !== null && network.rttMs >= 300))
  );

  const qualityWeight = isComplexOrReasoning
    ? 0.50
    : privacyMode === 'FLEXIBLE'
      ? 0.42
      : 0.25;
  const costWeight = slowOrMeteredNetwork
    ? 0.22
    : preferLowCost || privacyMode === 'CUSTOM'
      ? 0.20
      : 0.08;
  const latencyWeight = slowOrMeteredNetwork ? 0.28 : 0.22;

  const scored = pool.map((m) => {
    const cal = calibrationByModel?.[m.id];
    const latencyMs = estimateModelLatencyMs(
      m,
      analysis.estimatedOutputTokens,
      network?.rttMs ?? null,
      cal
    );
    const latencyNorm = Math.max(0, Math.min(100, Math.round(100 - latencyMs / 180)));

    const cost = estimateModelCost({
      model: m,
      inputTokens: analysis.estimatedInputTokens,
      outputTokens: analysis.estimatedOutputTokens,
      budgetLimitUsd,
    });
    const costNorm = Math.max(30, Math.min(100, Math.round(100 - cost.estimatedCostUsd * 120_000)));

    const totalOutcomes = (cal?.successCount ?? cal?.samples ?? 0) + (cal?.errorCount ?? 0);
    const failureRate = totalOutcomes >= 2 ? cal?.failureRate ?? 0 : 0;
    const failurePenalty = Math.round(failureRate * 55);

    const networkEconomyBonus =
      slowOrMeteredNetwork && m.id === 'gemini-3.1-flash-lite' && analysis.complexity !== 'expert'
        ? 16
        : 0;

    const totalUtility =
      m.qualityScore * qualityWeight +
      latencyNorm * latencyWeight +
      costNorm * costWeight +
      networkEconomyBonus -
      failurePenalty;

    return {
      model: m,
      totalUtility,
      latencyMs,
      failureRate,
      costUsd: cost.estimatedCostUsd,
    };
  });

  scored.sort((a, b) => b.totalUtility - a.totalUtility);
  const winner = scored[0];
  const runnerUp = scored[1];

  if (runnerUp && runnerUp.failureRate > 0.2 && winner.failureRate < runnerUp.failureRate) {
    selectionReasonsEn.push(
      `Preferred ${winner.model.id} over ${runnerUp.model.id} due to elevated error rate (${Math.round(runnerUp.failureRate * 100)}%) on ${runnerUp.model.id}.`
    );
    selectionReasonsAr.push(
      `تم تفضيل ${winner.model.id} على ${runnerUp.model.id} بسبب ارتفاع معدل الأخطاء في الأخير (${Math.round(runnerUp.failureRate * 100)}%).`
    );
  } else if (slowOrMeteredNetwork && winner.model.id === 'gemini-3.1-flash-lite') {
    selectionReasonsEn.push(
      `Selected compact model ${winner.model.id} for slow/metered network resilience (effective=${network?.effectiveType}, rtt=${network?.rttMs ?? 'n/a'} ms, saveData=${Boolean(network?.saveData)}).`
    );
    selectionReasonsAr.push(
      `تم اختيار النموذج الأخف ${winner.model.id} للتكيف مع الشبكة البطيئة أو وضع توفير البيانات.`
    );
  } else if (isComplexOrReasoning && winner.model.id === 'gemini-4-hydrogen') {
    selectionReasonsEn.push(
      `Selected high-capability model ${winner.model.id} (${winner.model.qualityScore}/100 quality) for ${analysis.complexity} ${analysis.taskType} despite higher latency/cost than flash-lite.`
    );
    selectionReasonsAr.push(
      `تم اختيار النموذج عالي القدرة ${winner.model.id} لمتطلبات الجودة والتعقيد (${analysis.complexity}) رغم زمن الاستجابة الأعلى.`
    );
  } else {
    selectionReasonsEn.push(
      `Selected cloud model ${winner.model.id} (est ${winner.latencyMs} ms, quality ${winner.model.qualityScore}/100, est $${winner.costUsd.toFixed(6)}).`
    );
    selectionReasonsAr.push(
      `تم اختيار النموذج السحابي ${winner.model.id} (زمن مقدّر ${winner.latencyMs} مللي ثانية، جودة ${winner.model.qualityScore}/100).`
    );
  }

  return { selected: winner.model, selectionReasonsEn, selectionReasonsAr };
}

function scoreLocalRoute(params: {
  localModel: ModelDescriptor | undefined;
  analysis: TaskAnalysis;
  device: DeviceCapabilityProfile;
  preferLocal: boolean;
  balancedOffloadActive: boolean;
  telemetryReliable: boolean;
  calibrated?: CalibratedModelStats;
}): RouteScoreBreakdown {
  const {
    localModel,
    analysis,
    device,
    preferLocal,
    balancedOffloadActive,
    telemetryReliable,
    calibrated,
  } = params;
  const { tier, maxLocalTokens } = resolveDeviceTierInfo(device);

  if (!localModel || !localModel.available) {
    return {
      route: 'LOCAL',
      eligible: false,
      totalScore: 0,
      modelId: localModel?.id || null,
      estimatedLatencyMs: 0,
      estimatedCostUsd: 0,
      factors: {
        privacyAlignment: 100,
        capabilityFit: 0,
        latencyScore: 0,
        costScore: 100,
        deviceHeadroom: 0,
        networkReliability: 100,
      },
      disqualificationReason:
        localModel?.availabilityReason || 'No local on-device model available.',
      disqualificationReasonAr: 'النموذج المحلي على الجهاز غير متاح حالياً في هذا المتصفح.',
    };
  }

  if (!localModel.supportedTasks.includes(analysis.taskType)) {
    return {
      route: 'LOCAL',
      eligible: false,
      totalScore: 0,
      modelId: localModel.id,
      estimatedLatencyMs: 0,
      estimatedCostUsd: 0,
      factors: {
        privacyAlignment: 100,
        capabilityFit: 10,
        latencyScore: 0,
        costScore: 100,
        deviceHeadroom: device.resourceConstrained ? 20 : 85,
        networkReliability: 100,
      },
      disqualificationReason: `Task type "${analysis.taskType}" exceeds on-device model capabilities.`,
      disqualificationReasonAr: `نوع المهمة (${analysis.taskType}) يتجاوز قدرات النموذج المحلي على الجهاز.`,
    };
  }

  const effectiveMaxLocalTokens = Math.min(
    localModel.maxContextTokens,
    maxLocalTokens || localModel.maxContextTokens
  );
  if (analysis.estimatedInputTokens > effectiveMaxLocalTokens) {
    return {
      route: 'LOCAL',
      eligible: false,
      totalScore: 0,
      modelId: localModel.id,
      estimatedLatencyMs: 0,
      estimatedCostUsd: 0,
      factors: {
        privacyAlignment: 100,
        capabilityFit: 0,
        latencyScore: 0,
        costScore: 100,
        deviceHeadroom: computeTierHeadroomScore(device, tier),
        networkReliability: 100,
      },
      disqualificationReason: `Input (${analysis.estimatedInputTokens} tokens) exceeds ${tier} device local token cap (${effectiveMaxLocalTokens}).`,
      disqualificationReasonAr: `حجم الإدخال (${analysis.estimatedInputTokens} رمزاً) يتجاوز الحد المحلي لفئة الجهاز (${effectiveMaxLocalTokens}).`,
    };
  }

  if (analysis.hasAttachments && !localModel.supportsAttachments) {
    return {
      route: 'LOCAL',
      eligible: false,
      totalScore: 0,
      modelId: localModel.id,
      estimatedLatencyMs: 0,
      estimatedCostUsd: 0,
      factors: {
        privacyAlignment: 100,
        capabilityFit: 20,
        latencyScore: 0,
        costScore: 100,
        deviceHeadroom: 70,
        networkReliability: 100,
      },
      disqualificationReason:
        'Attached documents require extended context not suited for compact local inference.',
      disqualificationReasonAr: 'المستندات المرفقة تتطلب سياقاً ممتداً لا يناسب الاستدلال المحلي المدمج.',
    };
  }

  if (analysis.detectedLanguage === 'ar' && !localModel.supportsArabicWell) {
    return {
      route: 'LOCAL',
      eligible: false,
      totalScore: 0,
      modelId: localModel.id,
      estimatedLatencyMs: 0,
      estimatedCostUsd: 0,
      factors: {
        privacyAlignment: 100,
        capabilityFit: 35,
        latencyScore: 0,
        costScore: 100,
        deviceHeadroom: 80,
        networkReliability: 100,
      },
      disqualificationReason: 'Arabic generation quality on compact local Nano weights is limited.',
      disqualificationReasonAr: 'جودة التوليد باللغة العربية على أوزان Nano المحلية المدمجة محدودة.',
    };
  }

  const estimatedLatencyMs = estimateModelLatencyMs(
    localModel,
    analysis.estimatedOutputTokens,
    null,
    calibrated
  );

  const hasSensitiveSignal = analysis.containsPii || analysis.hasSensitiveKeywords;

  // Distinguish actual privacy sensitivity from mere local performance preference:
  // - Sensitive inputs ALWAYS retain max privacy alignment (100).
  // - When reliable latency telemetry flags severe local degradation on non-sensitive inputs,
  //   privacyPreference relaxes from 98 -> 84 and yields performance bonus so fast Cloud wins.
  // - When telemetry is sparse/noisy, retain stability bias (floor 20) to prevent flapping.
  const privacyAlignment = hasSensitiveSignal
    ? 100
    : balancedOffloadActive
      ? 84
      : preferLocal
        ? 98
        : 80;

  const capabilityFit =
    analysis.complexity === 'low' ? 92 : analysis.complexity === 'medium' ? 82 : 52;

  const rawLatencyScore = Math.max(0, Math.min(100, Math.round(100 - estimatedLatencyMs / 220)));
  const latencyScore =
    balancedOffloadActive || !preferLocal
      ? rawLatencyScore
      : telemetryReliable
        ? Math.max(10, rawLatencyScore)
        : Math.max(25, rawLatencyScore);

  const costScore = 100;
  const deviceHeadroom = computeTierHeadroomScore(device, tier);
  const networkReliability = 100;

  const localSuitabilityBonus =
    preferLocal &&
    !balancedOffloadActive &&
    tier !== 'low_2gb' &&
    (analysis.complexity === 'low' ||
      (analysis.complexity === 'medium' && tier !== 'entry_3_4gb'))
      ? 8
      : 0;

  const privacyWeight = balancedOffloadActive ? 0.25 : 0.30;
  const latencyWeight = balancedOffloadActive ? 0.20 : 0.15;

  const totalScore = Math.min(
    100,
    Math.round(
      privacyAlignment * privacyWeight +
        capabilityFit * 0.25 +
        latencyScore * latencyWeight +
        costScore * 0.15 +
        deviceHeadroom * 0.1 +
        networkReliability * 0.05 +
        localSuitabilityBonus
    )
  );

  return {
    route: 'LOCAL',
    eligible: true,
    totalScore,
    modelId: localModel.id,
    estimatedLatencyMs,
    estimatedCostUsd: 0,
    factors: {
      privacyAlignment,
      capabilityFit,
      latencyScore,
      costScore,
      deviceHeadroom,
      networkReliability,
    },
  };
}

function scoreCloudRoute(params: {
  cloudModel: ModelDescriptor | null;
  analysis: TaskAnalysis;
  network: NetworkStatusSnapshot;
  cloudPermitted: boolean;
  privacyDisqualification?: string;
  privacyDisqualificationAr?: string;
  budgetLimitUsd: number | null;
  preferLocal: boolean;
  balancedOffloadActive: boolean;
  calibrated?: CalibratedModelStats;
}): RouteScoreBreakdown {
  const {
    cloudModel,
    analysis,
    network,
    cloudPermitted,
    privacyDisqualification,
    privacyDisqualificationAr,
    budgetLimitUsd,
    preferLocal,
    balancedOffloadActive,
    calibrated,
  } = params;

  if (!cloudPermitted) {
    return {
      route: 'CLOUD',
      eligible: false,
      totalScore: 0,
      modelId: cloudModel?.id || null,
      estimatedLatencyMs: 0,
      estimatedCostUsd: 0,
      factors: {
        privacyAlignment: 0,
        capabilityFit: 0,
        latencyScore: 0,
        costScore: 0,
        deviceHeadroom: 100,
        networkReliability: network.online ? 80 : 0,
      },
      disqualificationReason: privacyDisqualification || 'Excluded by privacy policy.',
      disqualificationReasonAr: privacyDisqualificationAr || 'مستبعد وفق سياسة الخصوصية.',
    };
  }

  if (!network.online || !network.cloudReachable) {
    return {
      route: 'CLOUD',
      eligible: false,
      totalScore: 0,
      modelId: cloudModel?.id || null,
      estimatedLatencyMs: 0,
      estimatedCostUsd: 0,
      factors: {
        privacyAlignment: 60,
        capabilityFit: 0,
        latencyScore: 0,
        costScore: 0,
        deviceHeadroom: 100,
        networkReliability: 0,
      },
      disqualificationReason: !network.online
        ? 'Device is offline.'
        : 'Cloud inference service is currently unreachable.',
      disqualificationReasonAr: !network.online
        ? 'الجهاز غير متصل بالإنترنت.'
        : 'خدمة الاستدلال السحابي غير متاحة حالياً.',
    };
  }

  if (!cloudModel || !cloudModel.available) {
    return {
      route: 'CLOUD',
      eligible: false,
      totalScore: 0,
      modelId: null,
      estimatedLatencyMs: 0,
      estimatedCostUsd: 0,
      factors: {
        privacyAlignment: 60,
        capabilityFit: 0,
        latencyScore: 0,
        costScore: 0,
        deviceHeadroom: 100,
        networkReliability: 80,
      },
      disqualificationReason:
        cloudModel?.availabilityReason || 'No capable cloud model is currently available.',
      disqualificationReasonAr: cloudModel?.availabilityReason?.includes('Sign in')
        ? 'يتطلب التنفيذ السحابي تسجيل الدخول بحساب Google.'
        : 'لا يتوفر نموذج سحابي قادر على التنفيذ حالياً.',
    };
  }

  const cost = estimateModelCost({
    model: cloudModel,
    inputTokens: analysis.estimatedInputTokens,
    outputTokens: analysis.estimatedOutputTokens,
    budgetLimitUsd,
  });

  if (!cost.withinBudget) {
    return {
      route: 'CLOUD',
      eligible: false,
      totalScore: 0,
      modelId: cloudModel.id,
      estimatedLatencyMs: 0,
      estimatedCostUsd: cost.estimatedCostUsd,
      factors: {
        privacyAlignment: 60,
        capabilityFit: cloudModel.qualityScore,
        latencyScore: 70,
        costScore: 0,
        deviceHeadroom: 100,
        networkReliability: 80,
      },
      disqualificationReason: `Estimated cost ($${cost.estimatedCostUsd.toFixed(5)}) exceeds custom cap ($${budgetLimitUsd?.toFixed(4)}).`,
      disqualificationReasonAr: `التكلفة المقدّرة ($${cost.estimatedCostUsd.toFixed(5)}) تتجاوز الحد المخصص ($${budgetLimitUsd?.toFixed(4)}).`,
    };
  }

  const estimatedLatencyMs = estimateModelLatencyMs(
    cloudModel,
    analysis.estimatedOutputTokens,
    network.rttMs,
    calibrated
  );

  const privacyAlignment = analysis.containsPii
    ? 20
    : balancedOffloadActive
      ? 74
      : preferLocal
        ? 60
        : 80;
  const capabilityFit = cloudModel.qualityScore;
  const latencyScore = Math.max(25, Math.min(100, Math.round(100 - estimatedLatencyMs / 160)));
  const costScore = Math.max(40, Math.min(100, Math.round(100 - cost.estimatedCostUsd * 2000)));
  const deviceHeadroom = 98;
  const networkReliability =
    network.effectiveType === '2g' || network.effectiveType === 'slow-2g'
      ? 45
      : network.saveData
        ? 60
        : 92;

  const totalScore = Math.round(
    privacyAlignment * 0.25 +
      capabilityFit * 0.3 +
      latencyScore * 0.15 +
      costScore * 0.1 +
      deviceHeadroom * 0.1 +
      networkReliability * 0.1
  );

  return {
    route: 'CLOUD',
    eligible: true,
    totalScore,
    modelId: cloudModel.id,
    estimatedLatencyMs,
    estimatedCostUsd: cost.estimatedCostUsd,
    factors: {
      privacyAlignment,
      capabilityFit,
      latencyScore,
      costScore,
      deviceHeadroom,
      networkReliability,
    },
  };
}

function scoreHybridRoute(params: {
  localModel: ModelDescriptor | undefined;
  cloudModel: ModelDescriptor | null;
  analysis: TaskAnalysis;
  network: NetworkStatusSnapshot;
  hybridPermitted: boolean;
  requiresRedaction: boolean;
  budgetLimitUsd: number | null;
  calibrated?: CalibratedModelStats;
}): RouteScoreBreakdown {
  const {
    localModel,
    cloudModel,
    analysis,
    network,
    hybridPermitted,
    requiresRedaction,
    budgetLimitUsd,
    calibrated,
  } = params;

  if (!hybridPermitted) {
    return {
      route: 'HYBRID',
      eligible: false,
      totalScore: 0,
      modelId: cloudModel?.id || null,
      estimatedLatencyMs: 0,
      estimatedCostUsd: 0,
      factors: {
        privacyAlignment: 0,
        capabilityFit: 0,
        latencyScore: 0,
        costScore: 0,
        deviceHeadroom: 80,
        networkReliability: 0,
      },
      disqualificationReason: 'Hybrid cloud delegation is disabled by active privacy policy.',
      disqualificationReasonAr: 'التفويض السحابي الهجين معطّل بموجب سياسة الخصوصية النشطة.',
    };
  }

  if (!network.online || !network.cloudReachable || !cloudModel || !cloudModel.available) {
    return {
      route: 'HYBRID',
      eligible: false,
      totalScore: 0,
      modelId: cloudModel?.id || null,
      estimatedLatencyMs: 0,
      estimatedCostUsd: 0,
      factors: {
        privacyAlignment: 80,
        capabilityFit: 0,
        latencyScore: 0,
        costScore: 0,
        deviceHeadroom: 80,
        networkReliability: 0,
      },
      disqualificationReason:
        cloudModel && !cloudModel.available
          ? cloudModel.availabilityReason
          : 'Hybrid execution requires cloud reachability for the reasoning stage.',
      disqualificationReasonAr: cloudModel?.availabilityReason?.includes('Sign in')
        ? 'يتطلب المسار الهجين تسجيل الدخول بحساب Google للمرحلة السحابية.'
        : 'يتطلب التنفيذ الهجين الاتصال بالخدمة السحابية لمرحلة الاستدلال.',
    };
  }

  const hasSensitiveSignal = analysis.containsPii || analysis.hasSensitiveKeywords;
  const canSafelyRedact =
    !hasSensitiveSignal || (analysis.piiSpans.length > 0 && !analysis.redactionUncertain);

  if (!canSafelyRedact) {
    return {
      route: 'HYBRID',
      eligible: false,
      totalScore: 0,
      modelId: cloudModel.id,
      estimatedLatencyMs: 0,
      estimatedCostUsd: 0,
      factors: {
        privacyAlignment: 0,
        capabilityFit: cloudModel.qualityScore,
        latencyScore: 0,
        costScore: 0,
        deviceHeadroom: 80,
        networkReliability: 85,
      },
      disqualificationReason:
        'Sensitive context detected without complete verifiable redaction; Hybrid cloud dispatch blocked.',
      disqualificationReasonAr:
        'تم رصد سياق حساس دون تغطية تنقيح مكتملة؛ تم حظر المسار الهجين.',
    };
  }

  const hybridJustified =
    (hasSensitiveSignal && requiresRedaction && canSafelyRedact) ||
    analysis.hasAttachments;

  if (!hybridJustified) {
    return {
      route: 'HYBRID',
      eligible: false,
      totalScore: 0,
      modelId: cloudModel.id,
      estimatedLatencyMs: 0,
      estimatedCostUsd: 0,
      factors: {
        privacyAlignment: 75,
        capabilityFit: cloudModel.qualityScore,
        latencyScore: 60,
        costScore: 70,
        deviceHeadroom: 85,
        networkReliability: 85,
      },
      disqualificationReason: 'Task does not require local sanitization or multi-stage decomposition.',
      disqualificationReasonAr: 'لا تتطلب المهمة تنقيحاً محلياً أو تفكيكاً متعدد المراحل.',
    };
  }

  const cost = estimateModelCost({
    model: cloudModel,
    inputTokens: analysis.estimatedInputTokens,
    outputTokens: analysis.estimatedOutputTokens,
    budgetLimitUsd,
  });

  if (!cost.withinBudget) {
    return {
      route: 'HYBRID',
      eligible: false,
      totalScore: 0,
      modelId: cloudModel.id,
      estimatedLatencyMs: 0,
      estimatedCostUsd: cost.estimatedCostUsd,
      factors: {
        privacyAlignment: 85,
        capabilityFit: cloudModel.qualityScore,
        latencyScore: 60,
        costScore: 0,
        deviceHeadroom: 85,
        networkReliability: 85,
      },
      disqualificationReason: `Estimated hybrid cloud cost ($${cost.estimatedCostUsd.toFixed(5)}) exceeds budget cap.`,
      disqualificationReasonAr: `التكلفة السحابية المقدّرة للمسار الهجين ($${cost.estimatedCostUsd.toFixed(5)}) تتجاوز حد الميزانية.`,
    };
  }

  const localPrepOverheadMs = localModel?.available ? 25 : 15;
  const estimatedLatencyMs =
    estimateModelLatencyMs(cloudModel, analysis.estimatedOutputTokens, network.rttMs, calibrated) +
    localPrepOverheadMs;

  const privacyAlignment = analysis.containsPii ? 92 : 85;
  const capabilityFit = cloudModel.qualityScore;
  const latencyScore = Math.max(20, Math.min(95, Math.round(95 - estimatedLatencyMs / 170)));
  const costScore = Math.max(45, Math.min(100, Math.round(100 - cost.estimatedCostUsd * 2000)));
  const deviceHeadroom = 90;
  const networkReliability = network.saveData ? 62 : 90;

  const totalScore = Math.round(
    privacyAlignment * 0.3 +
      capabilityFit * 0.28 +
      latencyScore * 0.14 +
      costScore * 0.1 +
      deviceHeadroom * 0.08 +
      networkReliability * 0.1
  );

  return {
    route: 'HYBRID',
    eligible: true,
    totalScore,
    modelId: cloudModel.id,
    estimatedLatencyMs,
    estimatedCostUsd: cost.estimatedCostUsd,
    factors: {
      privacyAlignment,
      capabilityFit,
      latencyScore,
      costScore,
      deviceHeadroom,
      networkReliability,
    },
  };
}

function resolveMeasurementProvenance(params: {
  device: DeviceCapabilityProfile;
  network: NetworkStatusSnapshot;
  models: ModelDescriptor[];
  calibrationByModel?: Record<string, CalibratedModelStats>;
}): DecisionExplainabilityMetadata['measurements'] {
  const { device, network, models, calibrationByModel } = params;
  const isSimulatedHost =
    device.platform === 'node-test' ||
    device.browserName.toLowerCase().includes('simulated') ||
    device.browserName === 'Vitest';

  const hardwareSpecs: MeasurementProvenance = isSimulatedHost
    ? 'simulated'
    : device.deviceMemoryGb !== null && device.hardwareConcurrency !== null
      ? 'measured'
      : device.hardwareConcurrency !== null || device.storageQuotaMb !== null
        ? 'partial'
        : 'unavailable';

  const localRuntime: MeasurementProvenance = isSimulatedHost
    ? 'simulated'
    : device.localApiPresent
      ? 'measured'
      : 'unavailable';

  const networkTelemetry: MeasurementProvenance = isSimulatedHost
    ? 'simulated'
    : !network.online
      ? 'measured'
      : network.rttMs !== null || network.effectiveType !== 'unknown'
        ? 'measured'
        : 'partial';

  const calEntries = Object.values(calibrationByModel || {});
  const totalSamples = calEntries.reduce((sum, s) => sum + s.samples, 0);
  const hasSyntheticSource = calEntries.some((s) => s.measurementSource === 'synthetic_or_mock');

  const latencyCalibration: MeasurementProvenance =
    totalSamples === 0
      ? 'unavailable'
      : hasSyntheticSource || isSimulatedHost
        ? 'simulated'
        : totalSamples >= 3
          ? 'measured'
          : 'partial';

  const details: string[] = [
    `hardware=${hardwareSpecs} (mem=${device.deviceMemoryGb ?? 'hidden'}GB, cores=${device.hardwareConcurrency ?? 'hidden'}, webgpu=${device.webGpuAvailable})`,
    `localRuntime=${localRuntime} (availability=${device.localModelAvailability})`,
    `network=${networkTelemetry} (online=${network.online}, type=${network.effectiveType}, rtt=${network.rttMs ?? 'n/a'}ms, saveData=${network.saveData})`,
    `latencyCalibration=${latencyCalibration} (totalSamples=${totalSamples})`,
    `cloudBackendConfigured=${models.some((m) => m.executionLocality === 'cloud' && m.available)}`,
  ];

  return {
    hardwareSpecs,
    localRuntime,
    networkTelemetry,
    latencyCalibration,
    details,
  };
}

function buildDecisionExplainability(params: {
  selectedRoute: ExecutionRoute;
  selectedModel: ModelDescriptor | null;
  privacyMode: PrivacyMode;
  analysis: TaskAnalysis;
  device: DeviceCapabilityProfile;
  network: NetworkStatusSnapshot;
  models: ModelDescriptor[];
  routeScores: RouteScoreBreakdown[];
  constraints: ConstraintEvaluation[];
  cloudSelectionReasonsEn: string[];
  cloudSelectionReasonsAr: string[];
  mainReasonsEn: string[];
  mainReasonsAr: string[];
  calibrationByModel?: Record<string, CalibratedModelStats>;
}): DecisionExplainabilityMetadata {
  const {
    selectedRoute,
    selectedModel,
    analysis,
    device,
    network,
    models,
    routeScores,
    constraints,
    cloudSelectionReasonsEn,
    cloudSelectionReasonsAr,
    mainReasonsEn,
    mainReasonsAr,
    calibrationByModel,
  } = params;

  const rejectedAlternatives: RejectedAlternativeSummary[] = routeScores
    .filter((s) => s.route !== selectedRoute)
    .map((s) => ({
      route: s.route,
      modelId: s.modelId,
      score: s.totalScore,
      eligible: s.eligible,
      reasonEn: s.eligible
        ? `Ranked below ${selectedRoute} (${s.totalScore} pts, est ${s.estimatedLatencyMs} ms).`
        : s.disqualificationReason || 'Excluded by active constraint.',
      reasonAr: s.eligible
        ? `حصل على تقييم أقل من ${selectedRoute} (${s.totalScore} نقطة، زمن مقدّر ${s.estimatedLatencyMs} مللي ثانية).`
        : s.disqualificationReasonAr || s.disqualificationReason || 'مستبعد وفق قيد نشط.',
    }));

  const privacyRestrictionsEn = constraints
    .filter((c) => c.id.includes('strict') || c.id.includes('pii') || c.id.includes('privacy') || c.id.includes('custom') || c.id.includes('unredacted'))
    .map((c) => c.summaryEn);
  const privacyRestrictionsAr = constraints
    .filter((c) => c.id.includes('strict') || c.id.includes('pii') || c.id.includes('privacy') || c.id.includes('custom') || c.id.includes('unredacted'))
    .map((c) => c.summaryAr);

  const networkLimitationsEn: string[] = [];
  const networkLimitationsAr: string[] = [];
  if (!network.online) {
    networkLimitationsEn.push('Device is offline; all cloud/hybrid egress is unavailable.');
    networkLimitationsAr.push('الجهاز غير متصل بالإنترنت؛ جميع المسارات السحابية معطّلة.');
  } else if (!network.cloudReachable) {
    networkLimitationsEn.push('Cloud endpoint health check failed.');
    networkLimitationsAr.push('تعذر الوصول إلى نقطة النهاية السحابية.');
  } else {
    if (network.effectiveType === '2g' || network.effectiveType === 'slow-2g') {
      networkLimitationsEn.push(`Slow cellular connection detected (${network.effectiveType}, RTT ${network.rttMs ?? 'n/a'} ms).`);
      networkLimitationsAr.push(`اتصال بطيء (${network.effectiveType}).`);
    }
    if (network.saveData) {
      networkLimitationsEn.push('Browser Save-Data preference is active.');
      networkLimitationsAr.push('وضع توفير البيانات نشط في المتصفح.');
    }
    if (network.effectiveType === 'unknown' && network.rttMs === null) {
      networkLimitationsEn.push('NetworkInformation RTT/bandwidth metrics unavailable in this browser.');
      networkLimitationsAr.push('قياسات زمن الرحلة وعرض النطاق غير متوفرة في هذا المتصفح.');
    }
  }

  const measurements = resolveMeasurementProvenance({
    device,
    network,
    models,
    calibrationByModel,
  });

  const targetModelStats = selectedModel ? calibrationByModel?.[selectedModel.id] : undefined;
  const targetReliability = assessTelemetryReliability(targetModelStats);
  const unreliableSignals: string[] = [];
  if (device.deviceMemoryGb === null) unreliableSignals.push('navigator.deviceMemory unavailable');
  if (network.online && network.effectiveType === 'unknown') {
    unreliableSignals.push('navigator.connection metrics unavailable');
  }
  if (!targetReliability.reliable && selectedRoute !== 'BLOCKED') {
    unreliableSignals.push(targetReliability.reason);
  }
  if (targetReliability.failureRate > 0.2) {
    unreliableSignals.push(
      `Observed error rate ${(targetReliability.failureRate * 100).toFixed(0)}% on ${selectedModel?.id}`
    );
  }

  const sortedEligible = routeScores.filter((s) => s.eligible).sort((a, b) => b.totalScore - a.totalScore);
  const margin =
    sortedEligible.length >= 2
      ? sortedEligible[0].totalScore - sortedEligible[1].totalScore
      : sortedEligible.length === 1
        ? 100
        : 100;

  let confidenceLevel: 'high' | 'medium' | 'low' = 'high';
  let basisEn = `Deterministic rule and multi-factor score clear (+${margin} pt margin).`;
  let basisAr = `القرار واضح وفق القيود والترتيب النقطي (فارق +${margin} نقطة).`;

  if (selectedRoute === 'BLOCKED') {
    confidenceLevel = 'high';
    basisEn = 'Hard constraint or fail-closed privacy gate deterministically blocked execution.';
    basisAr = 'تم الحظر بشكل حتمي عبر بوابة الخصوصية أو قيد التشغيل.';
  } else if (targetReliability.failureRate > 0.25 || (margin <= 4 && unreliableSignals.length >= 2)) {
    confidenceLevel = 'low';
    basisEn = `Low telemetry certainty (${unreliableSignals.join('; ')}) with narrow score margin (+${margin} pts).`;
    basisAr = `ثقة منخفضة في القياسات مع هامش نقاط ضيق (+${margin}).`;
  } else if (margin < 10 || !targetReliability.reliable || hardwareMissing(device)) {
    confidenceLevel = 'medium';
    basisEn = `Moderate certainty: margin=${margin} pts, calibration samples=${targetReliability.samples}.`;
    basisAr = `ثقة متوسطة: فارق النقاط ${margin}، وعدد عينات المعايرة ${targetReliability.samples}.`;
  }

  const finalReasonsEn = [...mainReasonsEn];
  const finalReasonsAr = [...mainReasonsAr];
  if (selectedRoute === 'CLOUD' || selectedRoute === 'HYBRID') {
    finalReasonsEn.push(...cloudSelectionReasonsEn);
    finalReasonsAr.push(...cloudSelectionReasonsAr);
  }
  if (analysis.conceptualSecurityDiscussion) {
    finalReasonsEn.push(
      'Conceptual/educational framing detected with zero personal disclosures or credential values.'
    );
    finalReasonsAr.push(
      'تم تصنيف النص كاستفسار مفاهيمي/تعليمي خالٍ من الإفصاح الشخصي أو المفاتيح الحساسة.'
    );
  }

  return {
    selectedRoute,
    selectedModelId: selectedModel?.id || null,
    selectedProvider: selectedModel?.provider || null,
    mainReasonsEn: finalReasonsEn,
    mainReasonsAr: finalReasonsAr,
    rejectedAlternatives,
    privacyRestrictionsEn,
    privacyRestrictionsAr,
    networkLimitationsEn,
    networkLimitationsAr,
    confidence: {
      level: confidenceLevel,
      basisEn,
      basisAr,
      telemetrySamples: targetReliability.samples,
      unreliableSignals,
    },
    measurements,
  };
}

function hardwareMissing(device: DeviceCapabilityProfile): boolean {
  return device.deviceMemoryGb === null || device.hardwareConcurrency === null;
}

export function decideRoute(params: {
  analysis: TaskAnalysis;
  device: DeviceCapabilityProfile;
  network: NetworkStatusSnapshot;
  models: ModelDescriptor[];
  privacyMode: PrivacyMode;
  customPreferences: CustomPrivacyPreferences;
  calibrationByModel?: Record<string, CalibratedModelStats>;
}): RoutingDecision {
  const {
    analysis,
    device,
    network,
    models,
    privacyMode,
    customPreferences,
    calibrationByModel,
  } = params;
  const constraints: ConstraintEvaluation[] = [];
  const limitations: string[] = [];
  const limitationsAr: string[] = [];
  const mainReasonsEn: string[] = [];
  const mainReasonsAr: string[] = [];

  const localModel = models.find((m) => m.executionLocality === 'local');
  const preferLowCost = privacyMode === 'BALANCED' && analysis.complexity === 'low';
  const budgetLimitUsd = privacyMode === 'CUSTOM' ? customPreferences.maxEstimatedCostUsd : null;

  const cloudSelection = pickBestCloudModel(
    models,
    analysis,
    preferLowCost,
    network,
    privacyMode,
    budgetLimitUsd,
    calibrationByModel
  );
  const cloudModel = cloudSelection.selected;
  const rawCloudCandidate = models.find((m) => m.executionLocality === 'cloud') || null;

  // Hard constraint 1: Invalid or unsupported task
  if (!analysis.valid || analysis.taskType === 'unsupported') {
    constraints.push({
      id: 'task-validity',
      passed: false,
      severity: 'hard_block',
      affectedRoutes: ['LOCAL', 'CLOUD', 'HYBRID'],
      summaryEn:
        analysis.validationError ||
        analysis.unsupportedReason ||
        'Task type is unsupported by ORBIT AI.',
      summaryAr:
        analysis.validationError || 'نوع المهمة غير مدعوم حالياً في نظام ORBIT AI.',
    });
    mainReasonsEn.push(constraints[0].summaryEn);
    mainReasonsAr.push(constraints[0].summaryAr);

    return {
      selectedRoute: 'BLOCKED',
      selectedLocalModelId: null,
      selectedCloudModelId: null,
      primaryModelDisplay: 'None (Blocked)',
      primaryModelDisplayAr: 'لا يوجد (محظور)',
      privacyMode,
      estimatedLatencyMs: 0,
      estimatedCostUsd: 0,
      privacyStatus: 'Blocked (Unsupported or Invalid Input)',
      privacyStatusAr: 'محظور (مدخل غير صالح أو نوع مهمة غير مدعوم)',
      constraints,
      routeScores: [],
      requiresSanitization: false,
      limitations: [
        analysis.validationError || analysis.unsupportedReason || 'Unsupported task type.',
      ],
      limitationsAr: [
        analysis.validationError || 'نوع المهمة غير مدعوم حالياً في نظام ORBIT AI.',
      ],
      explainability: buildDecisionExplainability({
        selectedRoute: 'BLOCKED',
        selectedModel: null,
        privacyMode,
        analysis,
        device,
        network,
        models,
        routeScores: [],
        constraints,
        cloudSelectionReasonsEn: [],
        cloudSelectionReasonsAr: [],
        mainReasonsEn,
        mainReasonsAr,
        calibrationByModel,
      }),
    };
  }

  // Hard constraint 2: Device resource pressure advisory/constraint
  if (device.resourceConstrained) {
    constraints.push({
      id: 'device-resource-pressure',
      passed: false,
      severity: 'route_exclusion',
      affectedRoutes: ['LOCAL'],
      summaryEn: `Device resources are constrained: ${device.constraintReasons.join(' ')}`,
      summaryAr: 'موارد الجهاز محدودة حالياً؛ تم استبعاد التشغيل المحلي الكامل.',
    });
    limitations.push(...device.constraintReasons);
    limitationsAr.push('موارد الجهاز محدودة حالياً؛ تم استبعاد التشغيل المحلي الكامل.');
  }

  // Hard constraint 3: Local model availability
  if (!localModel || !localModel.available) {
    constraints.push({
      id: 'local-model-unavailable',
      passed: false,
      severity: 'route_exclusion',
      affectedRoutes: ['LOCAL'],
      summaryEn: localModel?.availabilityReason || device.localModelReason,
      summaryAr: 'النموذج المحلي على الجهاز غير متاح حالياً في هذا المتصفح.',
    });
    limitations.push(localModel?.availabilityReason || device.localModelReason);
    limitationsAr.push('النموذج المحلي على الجهاز غير متاح حالياً في هذا المتصفح.');
  }

  // Hard constraint 4: Network offline / cloud unreachable / auth required
  if (!network.online || !network.cloudReachable) {
    constraints.push({
      id: 'network-cloud-unavailable',
      passed: false,
      severity: 'route_exclusion',
      affectedRoutes: ['CLOUD', 'HYBRID'],
      summaryEn: !network.online
        ? 'Network is offline; Cloud and Hybrid routes cannot execute.'
        : 'Cloud endpoint is unreachable; Cloud and Hybrid routes are excluded.',
      summaryAr: !network.online
        ? 'الجهاز غير متصل بالإنترنت؛ تم استبعاد المسار السحابي والهجين.'
        : 'تعذر الوصول إلى نقطة النهاية السحابية؛ تم استبعاد المسار السحابي والهجين.',
    });
    limitations.push(
      !network.online ? 'Offline network state.' : 'Cloud service unreachable.'
    );
    limitationsAr.push(
      !network.online
        ? 'الجهاز غير متصل بالإنترنت.'
        : 'تعذر الوصول إلى نقطة النهاية السحابية.'
    );
  } else if (
    rawCloudCandidate &&
    !rawCloudCandidate.available &&
    rawCloudCandidate.availabilityReason.includes('Sign in')
  ) {
    constraints.push({
      id: 'cloud-auth-required',
      passed: false,
      severity: 'route_exclusion',
      affectedRoutes: ['CLOUD', 'HYBRID'],
      summaryEn: rawCloudCandidate.availabilityReason,
      summaryAr: 'يتطلب التنفيذ السحابي تسجيل الدخول بحساب Google لتوثيق الطلبات.',
    });
    limitations.push(rawCloudCandidate.availabilityReason);
    limitationsAr.push('يتطلب التنفيذ السحابي تسجيل الدخول بحساب Google لتوثيق الطلبات.');
  }

  // Phase A: Privacy policy gates BEFORE scoring
  const privacyOutcome = evaluatePrivacyPolicy({
    mode: privacyMode,
    customPrefs: customPreferences,
    analysis,
    localAvailable: Boolean(localModel?.available),
  });
  constraints.push(...privacyOutcome.constraints);

  const cloudPrivacyConstraint = privacyOutcome.constraints.find((c) =>
    c.affectedRoutes.includes('CLOUD')
  );

  // Evaluate telemetry reliability & principled BALANCED performance-vs-privacy boundary
  const localCalibrated = localModel ? calibrationByModel?.[localModel.id] : undefined;
  const resolvedCloudCandidate = cloudModel || rawCloudCandidate;
  const cloudCalibrated = resolvedCloudCandidate
    ? calibrationByModel?.[resolvedCloudCandidate.id]
    : undefined;

  const localTelemetry = assessTelemetryReliability(localCalibrated);
  const cloudTelemetry = assessTelemetryReliability(cloudCalibrated);

  const estLocalLatencyMs = localModel
    ? estimateModelLatencyMs(localModel, analysis.estimatedOutputTokens, null, localCalibrated)
    : 0;
  const estCloudLatencyMs = resolvedCloudCandidate
    ? estimateModelLatencyMs(
        resolvedCloudCandidate,
        analysis.estimatedOutputTokens,
        network.rttMs,
        cloudCalibrated
      )
    : 0;

  const hasSensitiveSignal = analysis.containsPii || analysis.hasSensitiveKeywords;
  const slowOrOfflineNetwork =
    !network.online ||
    !network.cloudReachable ||
    network.effectiveType === '2g' ||
    network.effectiveType === 'slow-2g';

  const localSeverelySlow =
    Boolean(localModel?.available) &&
    estLocalLatencyMs >= 10_000 &&
    estCloudLatencyMs > 0 &&
    estLocalLatencyMs >= estCloudLatencyMs * 4;

  const balancedOffloadActive =
    privacyMode === 'BALANCED' &&
    !hasSensitiveSignal &&
    privacyOutcome.cloudPermitted &&
    !slowOrOfflineNetwork &&
    Boolean(resolvedCloudCandidate?.available) &&
    localTelemetry.reliable &&
    localSeverelySlow &&
    cloudTelemetry.failureRate <= 0.25;

  if (
    localModel?.available &&
    privacyMode === 'BALANCED' &&
    (localSeverelySlow || (!hasSensitiveSignal && localTelemetry.samples > 0 && !localTelemetry.reliable))
  ) {
    const lockedToLocalByPrivacy =
      hasSensitiveSignal &&
      (!privacyOutcome.cloudPermitted || analysis.redactionUncertain) &&
      (!privacyOutcome.hybridPermitted || analysis.redactionUncertain || analysis.piiSpans.length === 0);
    if (lockedToLocalByPrivacy && localSeverelySlow) {
      constraints.push({
        id: 'privacy-overrides-performance',
        passed: true,
        severity: 'advisory',
        affectedRoutes: ['LOCAL'],
        summaryEn: `Privacy intentionally overrides performance: task carries unredacted sensitive content, so on-device execution (${estLocalLatencyMs} ms) is preserved over faster cloud (${estCloudLatencyMs} ms).`,
        summaryAr: `تُقدَّم الخصوصية عمداً على الأداء: تحتوي المهمة محتوى حساساً غير منقح لذا يُحفظ التنفيذ المحلي (${estLocalLatencyMs} مللي ثانية) رغم سرعة السحابة.`,
      });
    } else if (!hasSensitiveSignal && !localTelemetry.reliable && (localSeverelySlow || localTelemetry.highVariance)) {
      constraints.push({
        id: 'insufficient-telemetry-stability',
        passed: true,
        severity: 'advisory',
        affectedRoutes: ['LOCAL'],
        summaryEn: `Holding LOCAL stability under BALANCED: ${localTelemetry.reason}`,
        summaryAr: `تم الإبقاء على المسار المحلي للاستقرار: عينات المعايرة غير كافية أو متذبذبة (${localTelemetry.samples} عينة).`,
      });
    } else if (balancedOffloadActive) {
      constraints.push({
        id: 'balanced-performance-offload',
        passed: true,
        severity: 'advisory',
        affectedRoutes: ['CLOUD'],
        summaryEn: `BALANCED performance offload: reliable local telemetry (${estLocalLatencyMs} ms across ${localTelemetry.samples} samples) is ≥4× slower than cloud (${estCloudLatencyMs} ms) on a non-sensitive task.`,
        summaryAr: `تحويل الأداء المتوازن: القياسات المحلية الموثوقة (${estLocalLatencyMs} مللي ثانية) أبطأ بـ 4 أضعاف أو أكثر من السحابة لمهمة غير حساسة.`,
      });
    }
  }

  // Phase B: Score each route
  const localScore = scoreLocalRoute({
    localModel,
    analysis,
    device,
    preferLocal: privacyOutcome.preferLocal,
    balancedOffloadActive,
    telemetryReliable: localTelemetry.reliable,
    calibrated: localCalibrated,
  });

  const cloudScore = scoreCloudRoute({
    cloudModel: resolvedCloudCandidate,
    analysis,
    network,
    cloudPermitted: privacyOutcome.cloudPermitted,
    privacyDisqualification: cloudPrivacyConstraint?.summaryEn,
    privacyDisqualificationAr: cloudPrivacyConstraint?.summaryAr,
    budgetLimitUsd,
    preferLocal: privacyOutcome.preferLocal,
    balancedOffloadActive,
    calibrated: cloudCalibrated,
  });

  const hybridScore = scoreHybridRoute({
    localModel,
    cloudModel: resolvedCloudCandidate,
    analysis,
    network,
    hybridPermitted: privacyOutcome.hybridPermitted,
    requiresRedaction: privacyOutcome.requiresRedactionForCloud,
    budgetLimitUsd,
    calibrated: cloudCalibrated,
  });

  const routeScores = [localScore, hybridScore, cloudScore];
  const eligibleRoutes = routeScores
    .filter((r) => r.eligible)
    .sort((a, b) => b.totalScore - a.totalScore);

  if (eligibleRoutes.length === 0) {
    mainReasonsEn.push(
      constraints.find((c) => !c.passed)?.summaryEn ||
        'No route satisfied privacy, availability, and network constraints.'
    );
    mainReasonsAr.push(
      constraints.find((c) => !c.passed)?.summaryAr ||
        'لم يستوفِ أي مسار قيود الخصوصية وتوفر النماذج والشبكة.'
    );

    return {
      selectedRoute: 'BLOCKED',
      selectedLocalModelId: null,
      selectedCloudModelId: null,
      primaryModelDisplay: 'None (Blocked)',
      primaryModelDisplayAr: 'لا يوجد (محظور)',
      privacyMode,
      estimatedLatencyMs: 0,
      estimatedCostUsd: 0,
      privacyStatus: privacyOutcome.privacyStatusLabel,
      privacyStatusAr: privacyOutcome.privacyStatusLabelAr,
      constraints,
      routeScores,
      requiresSanitization: false,
      limitations: Array.from(new Set(limitations)),
      limitationsAr: Array.from(new Set(limitationsAr)),
      explainability: buildDecisionExplainability({
        selectedRoute: 'BLOCKED',
        selectedModel: null,
        privacyMode,
        analysis,
        device,
        network,
        models,
        routeScores,
        constraints,
        cloudSelectionReasonsEn: [],
        cloudSelectionReasonsAr: [],
        mainReasonsEn,
        mainReasonsAr,
        calibrationByModel,
      }),
    };
  }

  const winner = eligibleRoutes[0];
  const selectedRoute: ExecutionRoute = winner.route;
  const selectedModelObj =
    selectedRoute === 'LOCAL' ? localModel || null : cloudModel || resolvedCloudCandidate;

  if (selectedRoute === 'LOCAL') {
    if (hasSensitiveSignal) {
      mainReasonsEn.push(
        `Privacy boundary kept sensitive task (${analysis.taskType}) strictly on-device.`
      );
      mainReasonsAr.push(
        `حافظت سياسة الخصوصية على إبقاء المهمة الحساسة على الجهاز بالكامل.`
      );
    } else if (slowOrOfflineNetwork) {
      mainReasonsEn.push(
        `Network state (${network.online ? network.effectiveType : 'offline'}) favors offline-resilient on-device inference.`
      );
      mainReasonsAr.push(
        `حالة الشبكة (${network.online ? network.effectiveType : 'غير متصل'}) ترجّح التنفيذ المحلي المقاوم لانقطاع الاتصال.`
      );
    } else {
      mainReasonsEn.push(
        `Selected LOCAL (${winner.totalScore} pts) for zero-egress execution (${analysis.taskType}, est ${winner.estimatedLatencyMs} ms).`
      );
      mainReasonsAr.push(
        `تم اختيار المسار المحلي (${winner.totalScore} نقطة) للتنفيذ على الجهاز دون تكلفة سحابية.`
      );
    }
  } else if (selectedRoute === 'HYBRID') {
    mainReasonsEn.push(
      `Selected HYBRID (${winner.totalScore} pts): local deterministic PII guard + ${cloudModel?.id} reasoning.`
    );
    mainReasonsAr.push(
      `تم اختيار المسار الهجين (${winner.totalScore} نقطة): تنقيح محلي موثّق للبيانات مع استدلال عبر ${cloudModel?.id}.`
    );
  } else {
    mainReasonsEn.push(
      balancedOffloadActive
        ? `Selected CLOUD (${winner.totalScore} pts) after reliable telemetry confirmed slow local inference on a non-sensitive task.`
        : `Selected CLOUD (${winner.totalScore} pts) for ${analysis.taskType} (${analysis.complexity} complexity).`
    );
    mainReasonsAr.push(
      balancedOffloadActive
        ? `تم اختيار المسار السحابي (${winner.totalScore} نقطة) بعد ثبوت بطء التنفيذ المحلي لمهمة غير حساسة.`
        : `تم اختيار المسار السحابي (${winner.totalScore} نقطة) لملاءمة قدرات النموذج لمتطلبات المهمة.`
    );
  }

  return {
    selectedRoute,
    selectedLocalModelId: selectedRoute === 'LOCAL' ? localModel?.id || null : null,
    selectedCloudModelId:
      selectedRoute === 'CLOUD' || selectedRoute === 'HYBRID' ? cloudModel?.id || null : null,
    primaryModelDisplay:
      selectedRoute === 'LOCAL'
        ? localModel?.displayName || 'chrome-gemini-nano'
        : selectedRoute === 'HYBRID'
          ? `Local Guard + ${cloudModel?.displayName || 'Gemini Cloud'}`
          : cloudModel?.displayName || 'Gemini Cloud',
    primaryModelDisplayAr:
      selectedRoute === 'LOCAL'
        ? 'Gemini Nano (على الجهاز)'
        : selectedRoute === 'HYBRID'
          ? `حارس محلي + ${cloudModel?.id || 'Gemini Cloud'}`
          : cloudModel?.id || 'Gemini السحابي',
    privacyMode,
    estimatedLatencyMs: winner.estimatedLatencyMs,
    estimatedCostUsd: winner.estimatedCostUsd,
    privacyStatus: privacyOutcome.privacyStatusLabel,
    privacyStatusAr: privacyOutcome.privacyStatusLabelAr,
    constraints,
    routeScores,
    requiresSanitization: selectedRoute === 'HYBRID' && analysis.containsPii,
    limitations: Array.from(new Set(limitations)),
    limitationsAr: Array.from(new Set(limitationsAr)),
    explainability: buildDecisionExplainability({
      selectedRoute,
      selectedModel: selectedModelObj,
      privacyMode,
      analysis,
      device,
      network,
      models,
      routeScores,
      constraints,
      cloudSelectionReasonsEn: cloudSelection.selectionReasonsEn,
      cloudSelectionReasonsAr: cloudSelection.selectionReasonsAr,
      mainReasonsEn,
      mainReasonsAr,
      calibrationByModel,
    }),
  };
}
