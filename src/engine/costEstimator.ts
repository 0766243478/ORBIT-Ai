import type { CostEstimate, ModelDescriptor, TelemetryRecord } from './types';

export interface CalibratedModelStats {
  samples: number;
  ewmaLatencyMs: number;
  ewmaTokensPerSec: number;
  successCount?: number;
  errorCount?: number;
  failureRate?: number;
  ewmaDeviationMs?: number;
  measurementSource?: 'live_session' | 'telemetry_history' | 'synthetic_or_mock';
}

export interface TelemetryReliabilityAssessment {
  reliable: boolean;
  samples: number;
  failureRate: number;
  highVariance: boolean;
  reason: string;
}

export function assessTelemetryReliability(
  stats?: CalibratedModelStats
): TelemetryReliabilityAssessment {
  if (!stats || stats.samples === 0) {
    return {
      reliable: false,
      samples: 0,
      failureRate: 0,
      highVariance: false,
      reason: 'No historical latency observations recorded for this model.',
    };
  }

  const totalOutcomes = (stats.successCount ?? stats.samples) + (stats.errorCount ?? 0);
  const failureRate =
    typeof stats.failureRate === 'number'
      ? stats.failureRate
      : totalOutcomes > 0
        ? (stats.errorCount ?? 0) / totalOutcomes
        : 0;

  if (stats.samples < 3) {
    return {
      reliable: false,
      samples: stats.samples,
      failureRate,
      highVariance: false,
      reason: `Insufficient latency sample count (${stats.samples}/3 minimum before altering BALANCED preference).`,
    };
  }

  const deviation = stats.ewmaDeviationMs ?? 0;
  const highVariance = deviation > Math.max(stats.ewmaLatencyMs * 0.65, 500);
  if (highVariance) {
    return {
      reliable: false,
      samples: stats.samples,
      failureRate,
      highVariance: true,
      reason: `Observed latency variance (${Math.round(deviation)} ms MAD) is too noisy to trigger an automatic route switch.`,
    };
  }

  return {
    reliable: true,
    samples: stats.samples,
    failureRate,
    highVariance: false,
    reason: `Reliable telemetry across ${stats.samples} samples (failure rate ${(failureRate * 100).toFixed(0)}%).`,
  };
}

/**
 * Lightweight EWMA performance calibrator that adapts latency predictions,
 * variance estimates, and per-model failure rates from observed executions.
 */
export class LatencyCalibrator {
  private readonly stats = new Map<string, CalibratedModelStats>();
  private readonly alpha: number;

  constructor(alpha = 0.35) {
    this.alpha = alpha;
  }

  recordObservation(params: {
    modelId: string;
    actualLatencyMs: number;
    outputTokens: number;
    measurementSource?: CalibratedModelStats['measurementSource'];
  }): void {
    const { modelId, actualLatencyMs, outputTokens, measurementSource } = params;
    if (!modelId || modelId === 'none' || !Number.isFinite(actualLatencyMs) || actualLatencyMs <= 0) {
      return;
    }

    const boundedLatency = Math.max(5, Math.min(actualLatencyMs, 60_000));
    const observedTps =
      outputTokens > 0
        ? Math.max(5, Math.min((outputTokens / boundedLatency) * 1000, 400))
        : 40;

    const prev = this.stats.get(modelId);
    if (!prev) {
      this.stats.set(modelId, {
        samples: 1,
        ewmaLatencyMs: Math.round(boundedLatency),
        ewmaTokensPerSec: Math.round(observedTps * 10) / 10,
        successCount: 1,
        errorCount: 0,
        failureRate: 0,
        ewmaDeviationMs: 0,
        measurementSource: measurementSource || 'live_session',
      });
      return;
    }

    const absError = Math.abs(boundedLatency - prev.ewmaLatencyMs);
    const nextDeviation =
      prev.samples === 1
        ? absError * 0.5
        : this.alpha * absError + (1 - this.alpha) * (prev.ewmaDeviationMs ?? 0);

    const nextLatency =
      prev.samples === 0
        ? boundedLatency
        : this.alpha * boundedLatency + (1 - this.alpha) * prev.ewmaLatencyMs;
    const nextTps =
      prev.samples === 0
        ? observedTps
        : this.alpha * observedTps + (1 - this.alpha) * prev.ewmaTokensPerSec;

    const successCount = (prev.successCount ?? prev.samples) + 1;
    const errorCount = prev.errorCount ?? 0;

    this.stats.set(modelId, {
      samples: prev.samples + 1,
      ewmaLatencyMs: Math.round(nextLatency),
      ewmaTokensPerSec: Math.round(nextTps * 10) / 10,
      successCount,
      errorCount,
      failureRate: Number((errorCount / Math.max(successCount + errorCount, 1)).toFixed(3)),
      ewmaDeviationMs: Math.round(nextDeviation),
      measurementSource: measurementSource || prev.measurementSource || 'live_session',
    });
  }

  recordFailure(params: {
    modelId: string;
    measurementSource?: CalibratedModelStats['measurementSource'];
  }): void {
    const { modelId, measurementSource } = params;
    if (!modelId || modelId === 'none' || modelId === 'unknown') {
      return;
    }

    const prev = this.stats.get(modelId);
    if (!prev) {
      this.stats.set(modelId, {
        samples: 0,
        ewmaLatencyMs: 0,
        ewmaTokensPerSec: 0,
        successCount: 0,
        errorCount: 1,
        failureRate: 1,
        ewmaDeviationMs: 0,
        measurementSource: measurementSource || 'live_session',
      });
      return;
    }

    const successCount = prev.successCount ?? prev.samples;
    const errorCount = (prev.errorCount ?? 0) + 1;
    this.stats.set(modelId, {
      ...prev,
      successCount,
      errorCount,
      failureRate: Number((errorCount / Math.max(successCount + errorCount, 1)).toFixed(3)),
      measurementSource: measurementSource || prev.measurementSource || 'live_session',
    });
  }

  seedFromTelemetry(records: TelemetryRecord[]): void {
    // Seed oldest -> newest so EWMA gives proper weight to recent runs
    const ordered = [...records].reverse();
    for (const r of ordered) {
      const primaryModel = r.modelUsed.includes(' + ')
        ? r.modelUsed.split(' + ').pop() || r.modelUsed
        : r.modelUsed;
      if (r.status === 'success') {
        this.recordObservation({
          modelId: primaryModel,
          actualLatencyMs: r.actualLatencyMs,
          outputTokens: r.outputTokens,
          measurementSource: 'telemetry_history',
        });
      } else if (r.status === 'error') {
        this.recordFailure({
          modelId: primaryModel,
          measurementSource: 'telemetry_history',
        });
      }
    }
  }

  getStats(modelId: string): CalibratedModelStats | undefined {
    return this.stats.get(modelId);
  }

  snapshot(): Record<string, CalibratedModelStats> {
    const out: Record<string, CalibratedModelStats> = {};
    for (const [k, v] of this.stats.entries()) {
      out[k] = { ...v };
    }
    return out;
  }
}

export function estimateModelCost(params: {
  model: ModelDescriptor;
  inputTokens: number;
  outputTokens: number;
  budgetLimitUsd: number | null;
}): CostEstimate {
  const { model, inputTokens, outputTokens, budgetLimitUsd } = params;

  if (model.executionLocality === 'local') {
    return {
      modelId: model.id,
      inputTokens,
      outputTokens,
      estimatedCostUsd: 0,
      withinBudget: true,
      budgetLimitUsd,
    };
  }

  const inputCost = (inputTokens / 1000) * model.costPer1kInputTokensUsd;
  const outputCost = (outputTokens / 1000) * model.costPer1kOutputTokensUsd;
  const total = Number((inputCost + outputCost).toFixed(6));

  return {
    modelId: model.id,
    inputTokens,
    outputTokens,
    estimatedCostUsd: total,
    withinBudget: budgetLimitUsd === null ? true : total <= budgetLimitUsd,
    budgetLimitUsd,
  };
}

export function estimateModelLatencyMs(
  model: ModelDescriptor,
  outputTokens: number,
  networkRttMs: number | null,
  calibrated?: CalibratedModelStats
): number {
  const effectiveTps =
    calibrated && calibrated.samples > 0
      ? Math.max(calibrated.ewmaTokensPerSec, 5)
      : Math.max(model.estimatedTokensPerSec, 1);

  const generationMs = (outputTokens / effectiveTps) * 1000;
  const networkOverhead =
    model.executionLocality === 'cloud' ? Math.max(networkRttMs || 80, 30) * 1.5 : 0;
  const staticEstimate = model.estimatedLatencyMsBase + generationMs + networkOverhead;

  if (!calibrated || calibrated.samples === 0) {
    return Math.round(staticEstimate);
  }

  // Blend static token-scaled model with observed EWMA latency (caps adaptive weight at 65%)
  const adaptiveWeight = Math.min(0.65, 0.25 + calibrated.samples * 0.1);
  return Math.round(
    adaptiveWeight * calibrated.ewmaLatencyMs + (1 - adaptiveWeight) * staticEstimate
  );
}
