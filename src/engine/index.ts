import { LatencyCalibrator, type CalibratedModelStats } from './costEstimator';
import { decideRoute } from './decisionEngine';
import { profileDeviceCapabilities, type DeviceProbe } from './deviceProfiler';
import { executePlan } from './executionManager';
import { buildModelRegistry } from './modelRegistry';
import { monitorNetworkStatus, type NetworkProbe } from './networkMonitor';
import { DEFAULT_CUSTOM_PREFERENCES } from './privacyGuardian';
import { analyzeTask } from './taskAnalyzer';
import { buildExecutionPlan } from './taskPlanner';
import type {
  CloudRuntimeExecutor,
  CustomPrivacyPreferences,
  DeviceCapabilityProfile,
  ExecutionResult,
  LanguageCode,
  LocalRuntimeExecutor,
  ModelDescriptor,
  NetworkStatusSnapshot,
  PrivacyMode,
  RoutingDecision,
  TaskInput,
  TelemetryRecord,
} from './types';

export * from './types';
export * from './taskAnalyzer';
export * from './deviceProfiler';
export * from './networkMonitor';
export * from './privacyGuardian';
export * from './costEstimator';
export * from './modelRegistry';
export * from './decisionEngine';
export * from './taskPlanner';
export * from './resultEvaluator';
export * from './decisionExplainer';
export * from './executionManager';
export * from './benchmarkCorpus';

export interface OrbitEngineConfig {
  deviceProbe: DeviceProbe;
  networkProbe: NetworkProbe;
  localExecutor: LocalRuntimeExecutor;
  cloudExecutor: CloudRuntimeExecutor;
  cloudGeminiConfigured: boolean;
  firebaseAiLogicConfigured: boolean;
  cloudRequiresAuth?: boolean;
  cloudAuthenticated?: boolean;
}

export class OrbitEngine {
  private readonly config: OrbitEngineConfig;
  private readonly calibrator = new LatencyCalibrator();

  constructor(config: OrbitEngineConfig) {
    this.config = config;
  }

  seedTelemetry(records: TelemetryRecord[]): void {
    this.calibrator.seedFromTelemetry(records);
  }

  getCalibrationSnapshot(): Record<string, CalibratedModelStats> {
    return this.calibrator.snapshot();
  }

  async inspectEnvironment(): Promise<{
    device: DeviceCapabilityProfile;
    network: NetworkStatusSnapshot;
    models: ModelDescriptor[];
  }> {
    const [device, network] = await Promise.all([
      profileDeviceCapabilities(this.config.deviceProbe),
      monitorNetworkStatus(this.config.networkProbe),
    ]);

    const models = buildModelRegistry({
      device,
      network,
      cloudGeminiConfigured: this.config.cloudGeminiConfigured,
      firebaseAiLogicConfigured: this.config.firebaseAiLogicConfigured,
      cloudRequiresAuth: this.config.cloudRequiresAuth,
      cloudAuthenticated: this.config.cloudAuthenticated,
    });

    return { device, network, models };
  }

  async simulateDecision(params: {
    input: TaskInput;
    privacyMode: PrivacyMode;
    customPreferences?: CustomPrivacyPreferences;
  }): Promise<{
    decision: RoutingDecision;
    device: DeviceCapabilityProfile;
    network: NetworkStatusSnapshot;
    models: ModelDescriptor[];
  }> {
    const analysis = analyzeTask(params.input);
    const { device, network, models } = await this.inspectEnvironment();
    const decision = decideRoute({
      analysis,
      device,
      network,
      models,
      privacyMode: params.privacyMode,
      customPreferences: params.customPreferences || DEFAULT_CUSTOM_PREFERENCES,
      calibrationByModel: this.calibrator.snapshot(),
    });

    return { decision, device, network, models };
  }

  async runTask(params: {
    input: TaskInput;
    privacyMode: PrivacyMode;
    customPreferences?: CustomPrivacyPreferences;
    language: LanguageCode;
  }): Promise<ExecutionResult> {
    const analysis = analyzeTask(params.input);
    const { device, network, models } = await this.inspectEnvironment();
    const decision = decideRoute({
      analysis,
      device,
      network,
      models,
      privacyMode: params.privacyMode,
      customPreferences: params.customPreferences || DEFAULT_CUSTOM_PREFERENCES,
      calibrationByModel: this.calibrator.snapshot(),
    });

    const activeCloudProvider =
      models.find((m) => m.id === decision.selectedCloudModelId)?.provider === 'firebase-ai-logic'
        ? 'firebase-ai-logic'
        : 'server-gemini';

    const plan = buildExecutionPlan({
      input: params.input,
      analysis,
      decision,
    });

    const result = await executePlan({
      input: {
        ...params.input,
        requestedCloudProvider: params.input.requestedCloudProvider || activeCloudProvider,
      },
      analysis,
      device,
      network,
      models,
      decision,
      plan,
      language: params.language,
      localExecutor: this.config.localExecutor,
      cloudExecutor: this.config.cloudExecutor,
    });

    const observedModel =
      result.route === 'LOCAL'
        ? decision.selectedLocalModelId
        : decision.selectedCloudModelId;

    if (observedModel) {
      if (result.status === 'success') {
        this.calibrator.recordObservation({
          modelId: observedModel,
          actualLatencyMs: result.evaluation.actualLatencyMs,
          outputTokens: result.actualOutputTokens,
          measurementSource:
            device.platform === 'node-test' ? 'synthetic_or_mock' : 'live_session',
        });
      } else if (result.status === 'error') {
        this.calibrator.recordFailure({
          modelId: observedModel,
          measurementSource:
            device.platform === 'node-test' ? 'synthetic_or_mock' : 'live_session',
        });
      }
    }

    return result;
  }
}
