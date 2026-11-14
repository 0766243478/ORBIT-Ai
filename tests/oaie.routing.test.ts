import { describe, expect, it } from 'vitest';
import {
  analyzeTask,
  buildExecutionPlan,
  buildModelRegistry,
  decideRoute,
  DEFAULT_CUSTOM_PREFERENCES,
  type CustomPrivacyPreferences,
  type DeviceCapabilityProfile,
  type NetworkStatusSnapshot,
} from '../src/engine';

function makeDevice(overrides: Partial<DeviceCapabilityProfile> = {}): DeviceCapabilityProfile {
  return {
    platform: 'web',
    browserName: 'Chrome',
    deviceMemoryGb: 8,
    hardwareConcurrency: 8,
    webGpuAvailable: true,
    storageQuotaMb: 20480,
    localApiPresent: true,
    localModelAvailability: 'available',
    localModelReason: 'Chrome Prompt API on-device Gemini Nano is ready.',
    resourceConstrained: false,
    constraintReasons: [],
    ...overrides,
  };
}

function makeNetwork(overrides: Partial<NetworkStatusSnapshot> = {}): NetworkStatusSnapshot {
  return {
    online: true,
    effectiveType: '4g',
    rttMs: 45,
    downlinkMbps: 25,
    saveData: false,
    cloudReachable: true,
    cloudHealthLatencyMs: 60,
    ...overrides,
  };
}

describe('OAIE Routing & Planning Engine', () => {
  it('routes simple Q&A to LOCAL when local model is available under BALANCED', () => {
    const analysis = analyzeTask({ prompt: 'Summarize the difference between HTTP and HTTPS.' });
    const device = makeDevice({ localModelAvailability: 'available' });
    const network = makeNetwork();
    const models = buildModelRegistry({
      device,
      network,
      cloudGeminiConfigured: true,
      firebaseAiLogicConfigured: false,
    });

    const decision = decideRoute({
      analysis,
      device,
      network,
      models,
      privacyMode: 'BALANCED',
      customPreferences: DEFAULT_CUSTOM_PREFERENCES,
    });

    expect(decision.selectedRoute).toBe('LOCAL');
    expect(decision.selectedLocalModelId).toBe('chrome-gemini-nano');
    expect(decision.estimatedCostUsd).toBe(0);
  });

  it('routes complex coding / architecture tasks to CLOUD under FLEXIBLE', () => {
    const analysis = analyzeTask({
      prompt: 'Design a distributed TypeScript microservices architecture with Kubernetes failover and SQL partitioning.',
    });
    const device = makeDevice({ localModelAvailability: 'available' });
    const network = makeNetwork();
    const models = buildModelRegistry({
      device,
      network,
      cloudGeminiConfigured: true,
      firebaseAiLogicConfigured: false,
    });

    const decision = decideRoute({
      analysis,
      device,
      network,
      models,
      privacyMode: 'FLEXIBLE',
      customPreferences: DEFAULT_CUSTOM_PREFERENCES,
    });

    expect(decision.selectedRoute).toBe('CLOUD');
    expect(decision.selectedCloudModelId).toBe('gemini-4-hydrogen');
  });

  it('plans HYBRID execution with local PII redaction when coding prompt contains sensitive data', () => {
    const input = {
      prompt: 'Refactor this TypeScript auth function for user alice@example.com using API key sk-1234567890abcdef12345.',
    };
    const analysis = analyzeTask(input);
    const device = makeDevice({ localModelAvailability: 'unavailable', localApiPresent: false });
    const network = makeNetwork();
    const models = buildModelRegistry({
      device,
      network,
      cloudGeminiConfigured: true,
      firebaseAiLogicConfigured: false,
    });

    const decision = decideRoute({
      analysis,
      device,
      network,
      models,
      privacyMode: 'BALANCED',
      customPreferences: DEFAULT_CUSTOM_PREFERENCES,
    });

    expect(analysis.containsPii).toBe(true);
    expect(decision.selectedRoute).toBe('HYBRID');

    const plan = buildExecutionPlan({ input, analysis, decision });
    expect(plan.route).toBe('HYBRID');
    expect(plan.steps).toHaveLength(3);
    expect(plan.redactedCount).toBe(2);
    expect(plan.sanitizedPrompt).not.toContain('alice@example.com');
    expect(plan.sanitizedPrompt).not.toContain('sk-1234567890abcdef12345');
    expect(plan.sanitizedPrompt).toContain('[EMAIL_1]');
    expect(plan.sanitizedPrompt).toContain('[SECRET_1]');
  });

  it('handles offline state: uses LOCAL when available, BLOCKED when local unavailable', () => {
    const analysis = analyzeTask({ prompt: 'Explain photosynthesis briefly.' });
    const network = makeNetwork({ online: false, cloudReachable: false });

    const localReadyDevice = makeDevice({ localModelAvailability: 'available' });
    const modelsWithLocal = buildModelRegistry({
      device: localReadyDevice,
      network,
      cloudGeminiConfigured: true,
      firebaseAiLogicConfigured: false,
    });

    const offlineLocalDecision = decideRoute({
      analysis,
      device: localReadyDevice,
      network,
      models: modelsWithLocal,
      privacyMode: 'BALANCED',
      customPreferences: DEFAULT_CUSTOM_PREFERENCES,
    });
    expect(offlineLocalDecision.selectedRoute).toBe('LOCAL');

    const noLocalDevice = makeDevice({ localModelAvailability: 'unavailable', localApiPresent: false });
    const modelsWithoutLocal = buildModelRegistry({
      device: noLocalDevice,
      network,
      cloudGeminiConfigured: true,
      firebaseAiLogicConfigured: false,
    });

    const offlineBlockedDecision = decideRoute({
      analysis,
      device: noLocalDevice,
      network,
      models: modelsWithoutLocal,
      privacyMode: 'BALANCED',
      customPreferences: DEFAULT_CUSTOM_PREFERENCES,
    });
    expect(offlineBlockedDecision.selectedRoute).toBe('BLOCKED');
  });

  it('enforces STRICT_LOCAL privacy: never falls back to cloud when local is unavailable', () => {
    const analysis = analyzeTask({ prompt: 'Hello, what is the capital of France?' });
    const device = makeDevice({
      localApiPresent: false,
      localModelAvailability: 'unavailable',
      localModelReason: 'Prompt API not exposed in Firefox.',
    });
    const network = makeNetwork();
    const models = buildModelRegistry({
      device,
      network,
      cloudGeminiConfigured: true,
      firebaseAiLogicConfigured: false,
    });

    const decision = decideRoute({
      analysis,
      device,
      network,
      models,
      privacyMode: 'STRICT_LOCAL',
      customPreferences: DEFAULT_CUSTOM_PREFERENCES,
    });

    expect(decision.selectedRoute).toBe('BLOCKED');
    expect(decision.selectedCloudModelId).toBeNull();
    const cloudScore = decision.routeScores.find((r) => r.route === 'CLOUD');
    expect(cloudScore?.eligible).toBe(false);
  });

  it('excludes LOCAL when device has resource constraints (<= 2GB memory)', () => {
    const analysis = analyzeTask({ prompt: 'Summarize agile methodology.' });
    const device = makeDevice({
      deviceMemoryGb: 2,
      resourceConstrained: true,
      constraintReasons: ['Low reported device memory (2 GB).'],
    });
    const network = makeNetwork();
    const models = buildModelRegistry({
      device,
      network,
      cloudGeminiConfigured: true,
      firebaseAiLogicConfigured: false,
    });

    const decision = decideRoute({
      analysis,
      device,
      network,
      models,
      privacyMode: 'BALANCED',
      customPreferences: DEFAULT_CUSTOM_PREFERENCES,
    });

    expect(decision.selectedRoute).toBe('CLOUD');
    const localScore = decision.routeScores.find((r) => r.route === 'LOCAL');
    expect(localScore?.eligible).toBe(false);
  });

  it('blocks unsupported task types (image/video synthesis)', () => {
    const analysis = analyzeTask({ prompt: 'Generate an image of a futuristic city.' });
    const device = makeDevice();
    const network = makeNetwork();
    const models = buildModelRegistry({
      device,
      network,
      cloudGeminiConfigured: true,
      firebaseAiLogicConfigured: false,
    });

    const decision = decideRoute({
      analysis,
      device,
      network,
      models,
      privacyMode: 'FLEXIBLE',
      customPreferences: DEFAULT_CUSTOM_PREFERENCES,
    });

    expect(analysis.taskType).toBe('unsupported');
    expect(decision.selectedRoute).toBe('BLOCKED');
  });

  it('rejects invalid inputs (empty prompt and oversized prompt)', () => {
    const emptyAnalysis = analyzeTask({ prompt: '   ' });
    expect(emptyAnalysis.valid).toBe(false);

    const hugePrompt = 'a'.repeat(33000);
    const hugeAnalysis = analyzeTask({ prompt: hugePrompt });
    expect(hugeAnalysis.valid).toBe(false);

    const device = makeDevice();
    const network = makeNetwork();
    const models = buildModelRegistry({
      device,
      network,
      cloudGeminiConfigured: true,
      firebaseAiLogicConfigured: false,
    });

    const decision = decideRoute({
      analysis: emptyAnalysis,
      device,
      network,
      models,
      privacyMode: 'FLEXIBLE',
      customPreferences: DEFAULT_CUSTOM_PREFERENCES,
    });

    expect(decision.selectedRoute).toBe('BLOCKED');
  });

  it('overrides cloud routing scores when CUSTOM privacy rules block attachments or cap cost', () => {
    const input = {
      prompt: 'Analyze this attached architecture file.',
      attachments: [
        {
          id: 'att_1',
          name: 'spec.md',
          mimeType: 'text/markdown',
          sizeBytes: 2048,
          textContent: '# System Spec\nDetails here...',
        },
      ],
    };
    const analysis = analyzeTask(input);
    const device = makeDevice({ localModelAvailability: 'unavailable' });
    const network = makeNetwork();
    const models = buildModelRegistry({
      device,
      network,
      cloudGeminiConfigured: true,
      firebaseAiLogicConfigured: false,
    });

    const customPrefs: CustomPrivacyPreferences = {
      ...DEFAULT_CUSTOM_PREFERENCES,
      blockAttachmentsInCloud: true,
    };

    const decision = decideRoute({
      analysis,
      device,
      network,
      models,
      privacyMode: 'CUSTOM',
      customPreferences: customPrefs,
    });

    expect(decision.selectedRoute).toBe('BLOCKED');

    // Also test cost cap override ($0.000001 cap)
    const zeroCostPrefs: CustomPrivacyPreferences = {
      ...DEFAULT_CUSTOM_PREFERENCES,
      maxEstimatedCostUsd: 0.000001,
    };
    const costCapped = decideRoute({
      analysis: analyzeTask({ prompt: 'Explain quantum error correction in detail.' }),
      device,
      network,
      models,
      privacyMode: 'CUSTOM',
      customPreferences: zeroCostPrefs,
    });
    expect(costCapped.selectedRoute).toBe('BLOCKED');
  });
});
