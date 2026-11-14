import type {
  DecisionExplanation,
  DeviceCapabilityProfile,
  ExecutionPlan,
  NetworkStatusSnapshot,
  RoutingDecision,
  TaskAnalysis,
} from './types';

export function buildDecisionExplanation(params: {
  analysis: TaskAnalysis;
  device: DeviceCapabilityProfile;
  network: NetworkStatusSnapshot;
  decision: RoutingDecision;
  plan: ExecutionPlan;
}): DecisionExplanation {
  const { analysis, device, network, decision, plan } = params;

  const failedConstraintsEn = decision.constraints
    .filter((c) => !c.passed)
    .map((c) => c.summaryEn);
  const failedConstraintsAr = decision.constraints
    .filter((c) => !c.passed)
    .map((c) => c.summaryAr);

  const exp = decision.explainability;
  const rejectedScores = decision.routeScores.filter((s) => s.route !== decision.selectedRoute);
  const alternativesSummaryEn =
    exp?.rejectedAlternatives.length
      ? exp.rejectedAlternatives
          .map((alt) => `${alt.route}: ${alt.reasonEn}`)
          .join(' | ')
      : rejectedScores.length > 0
        ? rejectedScores
            .map((s) => `${s.route}: excluded (${s.disqualificationReason || 'constraint'})`)
            .join(' | ')
        : 'All candidate routes evaluated and ranked deterministically.';

  const alternativesSummaryAr =
    exp?.rejectedAlternatives.length
      ? exp.rejectedAlternatives
          .map((alt) => `${alt.route}: ${alt.reasonAr}`)
          .join(' | ')
      : rejectedScores.length > 0
        ? rejectedScores
            .map((s) => `${s.route}: مستبعد (${s.disqualificationReason || 'قيد سياسي/تشغيلي'})`)
            .join(' | ')
        : 'تم تقييم وترتيب جميع المسارات المتاحة بشكل حتمي.';

  const provenanceSuffixEn = exp
    ? ` Confidence: ${exp.confidence.level} (${exp.confidence.basisEn}). Measurements: hw=${exp.measurements.hardwareSpecs}, local=${exp.measurements.localRuntime}, net=${exp.measurements.networkTelemetry}, calibration=${exp.measurements.latencyCalibration}.`
    : '';
  const provenanceSuffixAr = exp
    ? ` مستوى الثقة: ${exp.confidence.level}. القياسات: أجهزة=${exp.measurements.hardwareSpecs}، محلي=${exp.measurements.localRuntime}، شبكة=${exp.measurements.networkTelemetry}، معايرة=${exp.measurements.latencyCalibration}.`
    : '';

  if (decision.selectedRoute === 'BLOCKED') {
    const reasonEn =
      exp?.mainReasonsEn[0] ||
      failedConstraintsEn[0] ||
      'No execution route satisfied active privacy, network, and model availability constraints.';
    const reasonAr =
      exp?.mainReasonsAr[0] ||
      failedConstraintsAr[0] ||
      'لم يستوفِ أي مسار تشغيل قيود الخصوصية والشبكة وتوفر النماذج الحالية.';

    return {
      headlineEn: 'Execution blocked to uphold policy constraints',
      headlineAr: 'تم إيقاف التنفيذ التزاماً بقيود الخصوصية والتشغيل',
      rationaleEn: `${reasonEn}${provenanceSuffixEn}`,
      rationaleAr: `${reasonAr}${provenanceSuffixAr}`,
      privacyGuaranteeEn: 'Zero data transmitted to cloud models.',
      privacyGuaranteeAr: 'لم يتم إرسال أي بيانات إلى النماذج السحابية.',
      alternativesSummaryEn,
      alternativesSummaryAr,
      limitationsEn: Array.from(new Set([...decision.limitations, ...(exp?.networkLimitationsEn || [])])),
      limitationsAr: Array.from(
        new Set([...(decision.limitationsAr || failedConstraintsAr), ...(exp?.networkLimitationsAr || [])])
      ),
    };
  }

  if (decision.selectedRoute === 'LOCAL') {
    const primaryReasonEn =
      exp?.mainReasonsEn.join(' ') ||
      `Task classified as ${analysis.taskType} (${analysis.complexity} complexity). Local on-device inference is available and scored highest under ${decision.privacyMode} mode.`;
    const primaryReasonAr =
      exp?.mainReasonsAr.join(' ') ||
      `تم تصنيف المهمة كـ ${analysis.taskType} (تعقيد ${analysis.complexity}). الاستدلال المحلي على الجهاز متاح وحقق أعلى تقييم ضمن وضع ${decision.privacyMode}.`;

    return {
      headlineEn: `Executed on-device via ${decision.primaryModelDisplay}`,
      headlineAr: `تم التنفيذ محلياً على الجهاز عبر ${decision.primaryModelDisplayAr || decision.primaryModelDisplay}`,
      rationaleEn: `${primaryReasonEn}${provenanceSuffixEn}`,
      rationaleAr: `${primaryReasonAr}${provenanceSuffixAr}`,
      privacyGuaranteeEn: '100% on-device execution; prompt never left your browser.',
      privacyGuaranteeAr: 'تنفيذ محلي بالكامل؛ لم تغادر بياناتك متصفحك مطلقاً.',
      alternativesSummaryEn,
      alternativesSummaryAr,
      limitationsEn: Array.from(new Set([...decision.limitations, ...(exp?.networkLimitationsEn || [])])),
      limitationsAr: Array.from(
        new Set([...(decision.limitationsAr || failedConstraintsAr), ...(exp?.networkLimitationsAr || [])])
      ),
    };
  }

  if (decision.selectedRoute === 'HYBRID') {
    return {
      headlineEn: `Hybrid execution: local privacy guard + ${decision.selectedCloudModelId}`,
      headlineAr: `تنفيذ هجين: حماية خصوصية محلية + ${decision.selectedCloudModelId}`,
      rationaleEn:
        plan.redactedCount > 0
          ? `Detected ${plan.redactedCount} sensitive entities locally. OAIE redacted sensitive spans on-device, delegated sanitized reasoning to ${decision.selectedCloudModelId}, and re-hydrated placeholders locally.${provenanceSuffixEn}`
          : `Task (${analysis.taskType}, ${analysis.complexity}) was decomposed locally and delegated as a scoped reasoning request to ${decision.selectedCloudModelId}.${provenanceSuffixEn}`,
      rationaleAr:
        plan.redactedCount > 0
          ? `تم رصد ${plan.redactedCount} من العناصر الحساسة محلياً. قام المحرك بتنقيحها على الجهاز، وإرسال النص المنقّح إلى ${decision.selectedCloudModelId}، ثم إعادة الربط محلياً.${provenanceSuffixAr}`
          : `تم تحليل المهمة محلياً وتوجيه الجزء المطلوب للمعالجة السحابية عبر ${decision.selectedCloudModelId}.${provenanceSuffixAr}`,
      privacyGuaranteeEn:
        plan.redactedCount > 0
          ? `${plan.redactedCount} sensitive tokens redacted locally before cloud dispatch.`
          : 'Scoped payload sent to cloud; full local analysis stayed on device.',
      privacyGuaranteeAr:
        plan.redactedCount > 0
          ? `تم حجب ${plan.redactedCount} رمزاً حساساً محلياً قبل الإرسال للسحابة.`
          : 'تم إرسال الحمولة اللازمة فقط للسحابة مع بقاء التحليل الأولي على الجهاز.',
      alternativesSummaryEn,
      alternativesSummaryAr,
      limitationsEn: [
        ...decision.limitations,
        ...(exp?.networkLimitationsEn || []),
        ...(device.localModelAvailability !== 'available'
          ? ['Local Chrome Prompt API unavailable; Step 1 & Step 3 ran deterministically in TypeScript on-device.']
          : []),
      ],
      limitationsAr: [
        ...(decision.limitationsAr || failedConstraintsAr),
        ...(exp?.networkLimitationsAr || []),
        ...(device.localModelAvailability !== 'available'
          ? ['نموذج المتصفح المحلي غير متاح؛ نُفّذت خطوتا التنقيح والتقييم محلياً على الجهاز عبر محرك OAIE.']
          : []),
      ],
    };
  }

  // CLOUD
  const cloudReasonsEn =
    exp?.mainReasonsEn.join(' ') ||
    `Task (${analysis.taskType}, ${analysis.complexity}) required cloud model capability or context (${analysis.estimatedInputTokens} input tokens).`;
  const cloudReasonsAr =
    exp?.mainReasonsAr.join(' ') ||
    `تطلّبت المهمة (${analysis.taskType}) قدرات النموذج السحابي أو سعة السياق.`;

  return {
    headlineEn: `Executed in cloud via ${decision.selectedCloudModelId}`,
    headlineAr: `تم التنفيذ سحابياً عبر ${decision.selectedCloudModelId}`,
    rationaleEn: `${cloudReasonsEn} Local model status: ${device.localModelAvailability}. Network is ${network.online ? 'online' : 'offline'}.${provenanceSuffixEn}`,
    rationaleAr: `${cloudReasonsAr} حالة النموذج المحلي: ${device.localModelAvailability}.${provenanceSuffixAr}`,
    privacyGuaranteeEn: analysis.conceptualSecurityDiscussion
      ? `Permitted under ${decision.privacyMode} policy; educational/conceptual framing verified with zero personal disclosures.`
      : `Permitted under ${decision.privacyMode} policy; no high-risk PII redaction triggered.`,
    privacyGuaranteeAr: `مسموح به ضمن سياسة ${decision.privacyMode} دون رصد بيانات حساسة تتطلب حجباً.`,
    alternativesSummaryEn,
    alternativesSummaryAr,
    limitationsEn: Array.from(new Set([...decision.limitations, ...(exp?.networkLimitationsEn || [])])),
    limitationsAr: Array.from(
      new Set([...(decision.limitationsAr || failedConstraintsAr), ...(exp?.networkLimitationsAr || [])])
    ),
  };
}
