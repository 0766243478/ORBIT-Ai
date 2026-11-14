import {
  DEFAULT_CUSTOM_PREFERENCES,
  OrbitEngine,
  REPRESENTATIVE_BENCHMARK_TASKS,
  type BenchmarkTaskSpec,
  type DeviceCapabilityProfile,
  type ExecutionRoute,
  type LanguageCode,
  type NetworkStatusSnapshot,
} from '../engine';
import {
  browserCloudExecutor,
  browserDeviceProbe,
  browserLocalExecutor,
  browserNetworkProbe,
  probeServerHealth,
} from './browserProbes';
import { auth } from './firebase';

export type BrowserBenchmarkScope = 'local_only' | 'full_comparison';

export interface BrowserBenchmarkRow {
  taskId: string;
  label: string;
  intendedMode: 'LOCAL' | 'CLOUD' | 'HYBRID' | 'ADAPTIVE';
  actualRoute: ExecutionRoute;
  modelUsed: string;
  status: 'success' | 'blocked' | 'error';
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  redactedCount: number;
  outputChars: number;
  heapDeltaKb: number | null;
  sessionReused?: boolean;
  errorMessage?: string;
}

export interface BrowserBenchmarkSuiteReport {
  executedAtIso: string;
  scope: BrowserBenchmarkScope;
  environment: {
    userAgent: string;
    device: DeviceCapabilityProfile;
    network: NetworkStatusSnapshot;
    activeCloudBackend: string;
    signedIn: boolean;
  };
  rows: BrowserBenchmarkRow[];
  summary: {
    totalRuns: number;
    successCount: number;
    blockedCount: number;
    errorCount: number;
    meanLatencyMs: number;
    totalCostUsd: number;
    localColdStartMs: number | null;
    localWarmMeanMs: number | null;
  };
}

function readJsHeapKb(): number | null {
  if (typeof performance === 'undefined') return null;
  const perfWithMem = performance as Performance & {
    memory?: { usedJSHeapSize?: number };
  };
  const bytes = perfWithMem.memory?.usedJSHeapSize;
  return typeof bytes === 'number' ? Math.round(bytes / 1024) : null;
}

export async function runBrowserBenchmarkSuite(params: {
  scope: BrowserBenchmarkScope;
  language: LanguageCode;
  onProgress?: (completed: number, total: number, currentTask: BenchmarkTaskSpec) => void;
  signal?: AbortSignal;
}): Promise<BrowserBenchmarkSuiteReport> {
  const { scope, language, onProgress, signal } = params;
  const health = await probeServerHealth(true);

  const engine = new OrbitEngine({
    deviceProbe: browserDeviceProbe,
    networkProbe: browserNetworkProbe,
    localExecutor: browserLocalExecutor,
    cloudExecutor: browserCloudExecutor,
    cloudGeminiConfigured: health.activeCloudBackend === 'server-gemini',
    firebaseAiLogicConfigured: health.activeCloudBackend === 'firebase-ai-logic',
    cloudRequiresAuth:
      health.activeCloudBackend === 'server-gemini' ? health.authRequired : false,
    cloudAuthenticated: Boolean(auth.currentUser),
  });

  const envSnapshot = await engine.inspectEnvironment();
  const tasks =
    scope === 'local_only'
      ? REPRESENTATIVE_BENCHMARK_TASKS.filter(
          (t) => t.expectedRouteWhenLocalReadyBalanced === 'LOCAL'
        )
      : REPRESENTATIVE_BENCHMARK_TASKS;

  const rows: BrowserBenchmarkRow[] = [];
  const coldLocalLatencies: number[] = [];
  const warmLocalLatencies: number[] = [];

  for (let i = 0; i < tasks.length; i++) {
    if (signal?.aborted) break;
    const spec = tasks[i];
    onProgress?.(i, tasks.length, spec);

    const heapBefore = readJsHeapKb();
    const res = await engine.runTask({
      input: spec.input,
      privacyMode: scope === 'local_only' ? 'STRICT_LOCAL' : spec.privacyMode,
      customPreferences: DEFAULT_CUSTOM_PREFERENCES,
      language,
    });
    const heapAfter = readJsHeapKb();

    const localTrace = res.stepTraces.find((s) => s.stage === 'local_inference');
    if (res.route === 'LOCAL' && res.status === 'success') {
      if (localTrace?.sessionReused) {
        warmLocalLatencies.push(res.evaluation.actualLatencyMs);
      } else {
        coldLocalLatencies.push(res.evaluation.actualLatencyMs);
      }
    }

    rows.push({
      taskId: spec.id,
      label: language === 'ar' ? spec.labelAr : spec.labelEn,
      intendedMode:
        scope === 'local_only' ? 'LOCAL' : spec.expectedRouteWhenLocalReadyBalanced,
      actualRoute: res.route,
      modelUsed: res.modelUsed,
      status: res.status,
      latencyMs: res.evaluation.actualLatencyMs,
      inputTokens: res.actualInputTokens,
      outputTokens: res.actualOutputTokens,
      estimatedCostUsd: res.estimatedCostUsd,
      redactedCount: res.plan.redactedCount,
      outputChars: res.outputText.length,
      heapDeltaKb:
        heapBefore !== null && heapAfter !== null ? heapAfter - heapBefore : null,
      sessionReused: localTrace?.sessionReused,
      errorMessage: res.errorMessage,
    });
  }

  onProgress?.(tasks.length, tasks.length, tasks[tasks.length - 1]);

  const successRows = rows.filter((r) => r.status === 'success');
  const meanLatencyMs =
    successRows.length > 0
      ? Math.round(
          successRows.reduce((s, r) => s + r.latencyMs, 0) / successRows.length
        )
      : 0;

  return {
    executedAtIso: new Date().toISOString(),
    scope,
    environment: {
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
      device: envSnapshot.device,
      network: envSnapshot.network,
      activeCloudBackend: health.activeCloudBackend,
      signedIn: Boolean(auth.currentUser),
    },
    rows,
    summary: {
      totalRuns: rows.length,
      successCount: successRows.length,
      blockedCount: rows.filter((r) => r.status === 'blocked').length,
      errorCount: rows.filter((r) => r.status === 'error').length,
      meanLatencyMs,
      totalCostUsd: Number(
        rows.reduce((s, r) => s + r.estimatedCostUsd, 0).toFixed(6)
      ),
      localColdStartMs:
        coldLocalLatencies.length > 0 ? coldLocalLatencies[0] : null,
      localWarmMeanMs:
        warmLocalLatencies.length > 0
          ? Math.round(
              warmLocalLatencies.reduce((s, v) => s + v, 0) /
                warmLocalLatencies.length
            )
          : coldLocalLatencies.length > 1
            ? Math.round(
                coldLocalLatencies.slice(1).reduce((s, v) => s + v, 0) /
                  (coldLocalLatencies.length - 1)
              )
            : null,
    },
  };
}
