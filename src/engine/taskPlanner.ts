import { sanitizeTextForCloud, verifySanitizedPayloadForCloud } from './privacyGuardian';
import { formatTaskPayloadWithAttachments } from './taskAnalyzer';
import type {
  ExecutionPlan,
  ExecutionStep,
  RoutingDecision,
  TaskAnalysis,
  TaskInput,
} from './types';

function createId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function buildExecutionPlan(params: {
  input: TaskInput;
  analysis: TaskAnalysis;
  decision: RoutingDecision;
}): ExecutionPlan {
  const { input, analysis, decision } = params;
  const planId = createId('plan');
  const fullPrompt = formatTaskPayloadWithAttachments(input.prompt, input.attachments);

  if (decision.selectedRoute === 'BLOCKED') {
    return {
      planId,
      route: 'BLOCKED',
      steps: [],
      redactionMap: {},
      redactedCount: 0,
      cloudPayloadBytes: 0,
    };
  }

  if (decision.selectedRoute === 'LOCAL') {
    const modelId = decision.selectedLocalModelId || 'chrome-gemini-nano';
    const steps: ExecutionStep[] = [
      {
        stepId: createId('step'),
        order: 1,
        stage: 'local_inference',
        locality: 'local',
        modelId,
        descriptionEn: 'Run prompt inference directly on-device via Chrome Prompt API.',
        descriptionAr: 'تنفيذ الاستدلال مباشرة على الجهاز عبر واجهة Chrome Prompt API.',
      },
    ];

    return {
      planId,
      route: 'LOCAL',
      steps,
      redactionMap: {},
      redactedCount: 0,
      cloudPayloadBytes: 0,
    };
  }

  if (decision.selectedRoute === 'CLOUD') {
    const cloudSafety = verifySanitizedPayloadForCloud({
      sanitizedText: fullPrompt,
      redactionMap: {},
      analysis,
      requireRedaction: false,
    });
    if (!cloudSafety.safe) {
      return {
        planId,
        route: 'BLOCKED',
        steps: [],
        redactionMap: {},
        redactedCount: 0,
        cloudPayloadBytes: 0,
      };
    }

    const modelId = decision.selectedCloudModelId || 'gemini-4-hydrogen';
    const steps: ExecutionStep[] = [
      {
        stepId: createId('step'),
        order: 1,
        stage: 'cloud_inference',
        locality: 'cloud',
        modelId,
        descriptionEn: 'Execute task using cloud Gemini model.',
        descriptionAr: 'تنفيذ المهمة باستخدام نموذج Gemini السحابي.',
      },
    ];

    return {
      planId,
      route: 'CLOUD',
      steps,
      sanitizedPrompt: fullPrompt,
      redactionMap: {},
      redactedCount: 0,
      cloudPayloadBytes: new TextEncoder().encode(fullPrompt).length,
    };
  }

  // HYBRID decomposition:
  // Step 1: Local analysis + deterministic PII sanitization
  // Step 2: Cloud inference on sanitized/scoped payload
  // Step 3: Local placeholder re-hydration & response evaluation
  const { sanitizedText, redactionMap, redactedCount } = sanitizeTextForCloud(
    fullPrompt,
    analysis
  );

  const requireRedaction = Boolean(analysis.containsPii || analysis.hasSensitiveKeywords);
  const hybridSafety = verifySanitizedPayloadForCloud({
    sanitizedText,
    redactionMap,
    analysis,
    requireRedaction,
  });

  if (!hybridSafety.safe) {
    return {
      planId,
      route: 'BLOCKED',
      steps: [],
      redactionMap: {},
      redactedCount: 0,
      cloudPayloadBytes: 0,
    };
  }

  const cloudModelId = decision.selectedCloudModelId || 'gemini-4-hydrogen';
  const localGuardModelId = decision.selectedLocalModelId || 'oaie-local-guardian';

  const steps: ExecutionStep[] = [
    {
      stepId: createId('step'),
      order: 1,
      stage: 'local_analyze_and_sanitize',
      locality: 'local',
      modelId: localGuardModelId,
      descriptionEn:
        redactedCount > 0
          ? `Locally classified task (${analysis.taskType}) and redacted ${redactedCount} sensitive entities before cloud dispatch.`
          : `Locally analyzed task (${analysis.taskType}) and prepared scoped payload for cloud reasoning.`,
      descriptionAr:
        redactedCount > 0
          ? `تم تحليل المهمة محلياً وتنقيح ${redactedCount} من العناصر الحساسة قبل الإرسال للسحابة.`
          : 'تم تحليل المهمة محلياً وتجهيز حمولة محددة للمعالجة السحابية.',
    },
    {
      stepId: createId('step'),
      order: 2,
      stage: 'cloud_inference',
      locality: 'cloud',
      modelId: cloudModelId,
      descriptionEn: 'Process sanitized reasoning payload via cloud Gemini model.',
      descriptionAr: 'معالجة الحمولة المنقّحة عبر نموذج Gemini السحابي.',
    },
    {
      stepId: createId('step'),
      order: 3,
      stage: 'local_rehydrate_and_evaluate',
      locality: 'local',
      modelId: 'oaie-local-evaluator',
      descriptionEn:
        redactedCount > 0
          ? 'Re-hydrate local placeholders and verify response integrity on device.'
          : 'Evaluate cloud response quality and latency on device.',
      descriptionAr:
        redactedCount > 0
          ? 'إعادة ربط العناصر المحجوبة محلياً والتحقق من سلامة الاستجابة على الجهاز.'
          : 'تقييم جودة الاستجابة وزمن الاستجابة محلياً على الجهاز.',
    },
  ];

  return {
    planId,
    route: 'HYBRID',
    steps,
    sanitizedPrompt: sanitizedText,
    redactionMap,
    redactedCount,
    cloudPayloadBytes: new TextEncoder().encode(sanitizedText).length,
  };
}
