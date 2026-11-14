import type { EvaluationReport, ExecutionPlan, RoutingDecision } from './types';

export function evaluateExecutionResult(params: {
  status: 'success' | 'blocked' | 'error';
  outputText: string;
  actualLatencyMs: number;
  decision: RoutingDecision;
  plan: ExecutionPlan;
}): EvaluationReport {
  const { status, outputText, actualLatencyMs, decision, plan } = params;
  const warnings: string[] = [];
  const nonEmptyOutput = outputText.trim().length > 0;

  if (status === 'success' && !nonEmptyOutput) {
    warnings.push('Model returned an empty response payload.');
  }

  // Verify that in HYBRID redaction mode, original sensitive values were NOT included in sanitized cloud payload
  let piiLeakageDetected = false;
  if (
    plan.route === 'HYBRID' &&
    plan.sanitizedPrompt &&
    Object.values(plan.redactionMap).length > 0
  ) {
    for (const original of Object.values(plan.redactionMap)) {
      if (plan.sanitizedPrompt.includes(original)) {
        piiLeakageDetected = true;
        warnings.push('Sanitized cloud payload still contained an unredacted sensitive string.');
        break;
      }
    }
  }

  const latencyDeltaMs = Math.round(actualLatencyMs - decision.estimatedLatencyMs);
  if (status === 'success' && decision.estimatedLatencyMs > 0 && actualLatencyMs > decision.estimatedLatencyMs * 2.5) {
    warnings.push(
      `Measured latency (${actualLatencyMs} ms) exceeded estimate (${decision.estimatedLatencyMs} ms).`
    );
  }

  return {
    status,
    nonEmptyOutput,
    actualLatencyMs: Math.round(actualLatencyMs),
    latencyDeltaMs,
    piiLeakageDetected,
    warnings,
  };
}
