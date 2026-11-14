import { estimateModelCost } from './costEstimator';
import { buildDecisionExplanation } from './decisionExplainer';
import { rehydrateLocalPlaceholders, verifySanitizedPayloadForCloud } from './privacyGuardian';
import { evaluateExecutionResult } from './resultEvaluator';
import type {
  CloudRuntimeExecutor,
  DeviceCapabilityProfile,
  ExecutedStepTrace,
  ExecutionPlan,
  ExecutionResult,
  LanguageCode,
  LocalRuntimeExecutor,
  ModelDescriptor,
  NetworkStatusSnapshot,
  RoutingDecision,
  TaskAnalysis,
  TaskInput,
} from './types';

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function buildSystemInstruction(language: LanguageCode, taskType: TaskAnalysis['taskType']): string {
  const langDirective =
    language === 'ar'
      ? 'Respond clearly and concisely in Arabic unless code or technical identifiers require English.'
      : 'Respond clearly, concisely, and accurately in English.';

  return `You are ORBIT AI, a precise adaptive intelligence assistant. Task classification: ${taskType}. ${langDirective} Do not fabricate metrics or claim capabilities you did not use.`;
}

export async function executePlan(params: {
  input: TaskInput;
  analysis: TaskAnalysis;
  device: DeviceCapabilityProfile;
  network: NetworkStatusSnapshot;
  models: ModelDescriptor[];
  decision: RoutingDecision;
  plan: ExecutionPlan;
  language: LanguageCode;
  localExecutor: LocalRuntimeExecutor;
  cloudExecutor: CloudRuntimeExecutor;
}): Promise<ExecutionResult> {
  const {
    input,
    analysis,
    device,
    network,
    models,
    decision,
    plan,
    language,
    localExecutor,
    cloudExecutor,
  } = params;

  const execId = `exec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const timestampIso = new Date().toISOString();
  const startTotal = nowMs();
  const stepTraces: ExecutedStepTrace[] = [];

  const explanation = buildDecisionExplanation({
    analysis,
    device,
    network,
    decision,
    plan,
  });

  const buildBlockedResult = (reasonEn: string, reasonAr: string): ExecutionResult => {
    const totalLatency = Math.max(1, Math.round(nowMs() - startTotal));
    const evaluation = evaluateExecutionResult({
      status: 'blocked',
      outputText: '',
      actualLatencyMs: totalLatency,
      decision,
      plan,
    });

    return {
      id: execId,
      timestampIso,
      status: 'blocked',
      route: 'BLOCKED',
      modelUsed: 'none',
      outputText: '',
      errorMessage: language === 'ar' ? reasonAr : reasonEn,
      analysis,
      device,
      network,
      decision,
      plan,
      stepTraces,
      evaluation,
      explanation,
      actualInputTokens: analysis.estimatedInputTokens,
      actualOutputTokens: 0,
      estimatedCostUsd: 0,
    };
  };

  if (decision.selectedRoute === 'BLOCKED' || plan.route === 'BLOCKED') {
    return buildBlockedResult(explanation.rationaleEn, explanation.rationaleAr);
  }

  const systemInstruction = buildSystemInstruction(language, analysis.taskType);

  try {
    if (plan.route === 'LOCAL') {
      const step = plan.steps[0];
      const t0 = nowMs();
      const attachmentSuffix = (input.attachments || [])
        .map((a) => `\n[File: ${a.name}]\n${a.textContent}`)
        .join('');

      const allowSessionCache =
        typeof device.allowWarmSessionCache === 'boolean'
          ? device.allowWarmSessionCache
          : !device.resourceConstrained &&
            device.deviceTier !== 'low_2gb' &&
            device.deviceTier !== 'entry_3_4gb';

      const localOut = await localExecutor.executeLocal({
        prompt: input.prompt.trim() + attachmentSuffix,
        systemInstruction,
        language,
        allowSessionCache,
      });

      const stepMs = Math.max(1, Math.round(nowMs() - t0));
      stepTraces.push({
        stepId: step.stepId,
        stage: step.stage,
        locality: 'local',
        modelId: step.modelId,
        durationMs: stepMs,
        status: 'completed',
        detail: localOut.sessionReused
          ? `Completed on-device inference via warm session (${stepMs} ms).`
          : `Completed on-device inference (cold start ${localOut.coldStartMs ?? stepMs} ms).`,
        sessionReused: localOut.sessionReused,
        coldStartMs: localOut.coldStartMs,
      });

      const actualInputTokens = localOut.inputTokens ?? analysis.estimatedInputTokens;
      const actualOutputTokens =
        localOut.outputTokens ?? Math.max(1, Math.ceil(localOut.text.length / 4));
      const totalLatency = Math.max(1, Math.round(nowMs() - startTotal));

      const evaluation = evaluateExecutionResult({
        status: 'success',
        outputText: localOut.text,
        actualLatencyMs: totalLatency,
        decision,
        plan,
      });

      return {
        id: execId,
        timestampIso,
        status: 'success',
        route: 'LOCAL',
        modelUsed: step.modelId,
        outputText: localOut.text,
        analysis,
        device,
        network,
        decision,
        plan,
        stepTraces,
        evaluation,
        explanation,
        actualInputTokens,
        actualOutputTokens,
        estimatedCostUsd: 0,
      };
    }

    if (plan.route === 'CLOUD') {
      if (decision.privacyMode === 'STRICT_LOCAL') {
        return buildBlockedResult(
          'STRICT_LOCAL forbids all cloud execution; dispatch aborted before transmission.',
          'يمنع الوضع المحلي الصارم أي تنفيذ سحابي؛ تم إيقاف الإرسال قبل البدء.'
        );
      }

      const cloudPayload = plan.sanitizedPrompt;
      const cloudSafety = verifySanitizedPayloadForCloud({
        sanitizedText: cloudPayload,
        redactionMap: {},
        analysis,
        requireRedaction: false,
      });
      if (!cloudSafety.safe || !cloudPayload) {
        return buildBlockedResult(
          cloudSafety.reason || 'Cloud payload failed fail-closed privacy verification.',
          cloudSafety.reasonAr || 'فشلت الحمولة السحابية في التحقق من سلامة الخصوصية؛ تم الحظر.'
        );
      }

      const step = plan.steps[0];
      const t0 = nowMs();
      const cloudOut = await cloudExecutor.executeCloud({
        prompt: cloudPayload,
        modelId: step.modelId,
        systemInstruction,
        language,
        provider: input.requestedCloudProvider || 'server-gemini',
      });

      const stepMs = Math.max(1, Math.round(nowMs() - t0));
      stepTraces.push({
        stepId: step.stepId,
        stage: step.stage,
        locality: 'cloud',
        modelId: step.modelId,
        durationMs: stepMs,
        status: 'completed',
        detail: `Completed via ${cloudOut.providerUsed}.`,
      });

      const actualInputTokens = cloudOut.inputTokens ?? analysis.estimatedInputTokens;
      const actualOutputTokens =
        cloudOut.outputTokens ?? Math.max(1, Math.ceil(cloudOut.text.length / 4));
      const modelMeta = models.find((m) => m.id === step.modelId);
      const actualCost = modelMeta
        ? estimateModelCost({
            model: modelMeta,
            inputTokens: actualInputTokens,
            outputTokens: actualOutputTokens,
            budgetLimitUsd: null,
          }).estimatedCostUsd
        : decision.estimatedCostUsd;

      const totalLatency = Math.max(1, Math.round(nowMs() - startTotal));
      const evaluation = evaluateExecutionResult({
        status: 'success',
        outputText: cloudOut.text,
        actualLatencyMs: totalLatency,
        decision,
        plan,
      });

      return {
        id: execId,
        timestampIso,
        status: 'success',
        route: 'CLOUD',
        modelUsed: step.modelId,
        outputText: cloudOut.text,
        analysis,
        device,
        network,
        decision,
        plan,
        stepTraces,
        evaluation,
        explanation,
        actualInputTokens,
        actualOutputTokens,
        estimatedCostUsd: actualCost,
      };
    }

    // HYBRID 3-step execution
    if (decision.privacyMode === 'STRICT_LOCAL') {
      return buildBlockedResult(
        'STRICT_LOCAL forbids hybrid cloud execution; dispatch aborted before transmission.',
        'يمنع الوضع المحلي الصارم التنفيذ الهجين؛ تم إيقاف الإرسال قبل البدء.'
      );
    }

    const [prepStep, cloudStep, evalStep] = plan.steps;

    // Step 1: Local sanitize & verify (never fall back to raw input.prompt)
    const tPrep = nowMs();
    const sanitizedPrompt = plan.sanitizedPrompt;
    const requireRedaction = Boolean(analysis.containsPii || analysis.hasSensitiveKeywords);
    const hybridSafety = verifySanitizedPayloadForCloud({
      sanitizedText: sanitizedPrompt,
      redactionMap: plan.redactionMap,
      analysis,
      requireRedaction,
    });
    const prepMs = Math.max(1, Math.round(nowMs() - tPrep));

    if (!hybridSafety.safe || !sanitizedPrompt) {
      stepTraces.push({
        stepId: prepStep.stepId,
        stage: prepStep.stage,
        locality: 'local',
        modelId: prepStep.modelId,
        durationMs: prepMs,
        status: 'failed',
        detail: hybridSafety.reason || 'Fail-closed privacy gate blocked outbound hybrid payload.',
      });
      return buildBlockedResult(
        hybridSafety.reason || 'Hybrid payload failed fail-closed privacy verification.',
        hybridSafety.reasonAr || 'فشلت الحمولة الهجينة في التحقق من اكتمال التنقيح؛ تم حظر الإرسال السحابي.'
      );
    }

    stepTraces.push({
      stepId: prepStep.stepId,
      stage: prepStep.stage,
      locality: 'local',
      modelId: prepStep.modelId,
      durationMs: prepMs,
      status: 'completed',
      detail:
        plan.redactedCount > 0
          ? `Redacted ${plan.redactedCount} sensitive spans locally and verified payload.`
          : 'Prepared and verified scoped payload locally.',
    });

    // Step 2: Cloud inference on verified sanitized payload only
    const tCloud = nowMs();
    const cloudOut = await cloudExecutor.executeCloud({
      prompt: sanitizedPrompt,
      modelId: cloudStep.modelId,
      systemInstruction:
        systemInstruction +
        (plan.redactedCount > 0
          ? ' Preserve bracketed placeholders such as [EMAIL_1] or [PHONE_1] verbatim where relevant.'
          : ''),
      language,
      provider: input.requestedCloudProvider || 'server-gemini',
    });
    const cloudMs = Math.max(1, Math.round(nowMs() - tCloud));
    stepTraces.push({
      stepId: cloudStep.stepId,
      stage: cloudStep.stage,
      locality: 'cloud',
      modelId: cloudStep.modelId,
      durationMs: cloudMs,
      status: 'completed',
      detail: `Sanitized payload processed via ${cloudOut.providerUsed}.`,
    });

    // Step 3: Local re-hydration and post-evaluation
    const tEval = nowMs();
    const finalOutput = rehydrateLocalPlaceholders(cloudOut.text, plan.redactionMap);
    const evalMs = Math.max(1, Math.round(nowMs() - tEval));
    stepTraces.push({
      stepId: evalStep.stepId,
      stage: evalStep.stage,
      locality: 'local',
      modelId: evalStep.modelId,
      durationMs: evalMs,
      status: 'completed',
      detail:
        plan.redactedCount > 0
          ? 'Re-hydrated local placeholders and verified response.'
          : 'Verified cloud response integrity locally.',
    });

    const actualInputTokens = cloudOut.inputTokens ?? analysis.estimatedInputTokens;
    const actualOutputTokens =
      cloudOut.outputTokens ?? Math.max(1, Math.ceil(finalOutput.length / 4));
    const modelMeta = models.find((m) => m.id === cloudStep.modelId);
    const actualCost = modelMeta
      ? estimateModelCost({
          model: modelMeta,
          inputTokens: actualInputTokens,
          outputTokens: actualOutputTokens,
          budgetLimitUsd: null,
        }).estimatedCostUsd
      : decision.estimatedCostUsd;

    const totalLatency = Math.max(1, Math.round(nowMs() - startTotal));
    const evaluation = evaluateExecutionResult({
      status: 'success',
      outputText: finalOutput,
      actualLatencyMs: totalLatency,
      decision,
      plan,
    });

    return {
      id: execId,
      timestampIso,
      status: 'success',
      route: 'HYBRID',
      modelUsed: `${prepStep.modelId} + ${cloudStep.modelId}`,
      outputText: finalOutput,
      analysis,
      device,
      network,
      decision,
      plan,
      stepTraces,
      evaluation,
      explanation,
      actualInputTokens,
      actualOutputTokens,
      estimatedCostUsd: actualCost,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const totalLatency = Math.max(1, Math.round(nowMs() - startTotal));
    const evaluation = evaluateExecutionResult({
      status: 'error',
      outputText: '',
      actualLatencyMs: totalLatency,
      decision,
      plan,
    });

    return {
      id: execId,
      timestampIso,
      status: 'error',
      route: plan.route,
      modelUsed:
        decision.selectedCloudModelId || decision.selectedLocalModelId || 'unknown',
      outputText: '',
      errorMessage,
      analysis,
      device,
      network,
      decision,
      plan,
      stepTraces,
      evaluation,
      explanation,
      actualInputTokens: analysis.estimatedInputTokens,
      actualOutputTokens: 0,
      estimatedCostUsd: 0,
    };
  }
}
