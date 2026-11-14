import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_CUSTOM_PREFERENCES,
  OrbitEngine,
  type CloudRuntimeExecutor,
  type DeviceProbe,
  type LocalRuntimeExecutor,
  type NetworkProbe,
} from '../src/engine';

function makeDeviceProbe(available: boolean): DeviceProbe {
  return {
    getHardwareInfo: () => ({
      platform: 'node-test',
      browserName: 'Vitest',
      deviceMemoryGb: 16,
      hardwareConcurrency: 8,
      webGpuAvailable: true,
    }),
    getStorageQuotaMb: async () => 40960,
    getLocalModelStatus: async () => ({
      apiPresent: available,
      availability: available ? 'available' : 'unavailable',
      reason: available ? 'Ready' : 'Prompt API unavailable',
    }),
  };
}

function makeNetworkProbe(online: boolean): NetworkProbe {
  return {
    getConnectionInfo: () => ({
      online,
      effectiveType: online ? '4g' : 'unknown',
      rttMs: online ? 35 : null,
      downlinkMbps: online ? 40 : null,
      saveData: false,
    }),
    checkCloudReachability: async () => ({
      reachable: online,
      latencyMs: online ? 50 : null,
    }),
  };
}

describe('OAIE Execution Manager & End-to-End Pipeline', () => {
  it('executes LOCAL route strictly on localExecutor without calling cloudExecutor', async () => {
    const localExec: LocalRuntimeExecutor = {
      executeLocal: vi.fn(async () => ({ text: 'Local response answer.' })),
    };
    const cloudExec: CloudRuntimeExecutor = {
      executeCloud: vi.fn(async () => ({
        text: 'Cloud response',
        providerUsed: 'server-gemini',
      })),
    };

    const engine = new OrbitEngine({
      deviceProbe: makeDeviceProbe(true),
      networkProbe: makeNetworkProbe(true),
      localExecutor: localExec,
      cloudExecutor: cloudExec,
      cloudGeminiConfigured: true,
      firebaseAiLogicConfigured: false,
    });

    const result = await engine.runTask({
      input: { prompt: 'Briefly define TLS.' },
      privacyMode: 'BALANCED',
      customPreferences: DEFAULT_CUSTOM_PREFERENCES,
      language: 'en',
    });

    expect(result.status).toBe('success');
    expect(result.route).toBe('LOCAL');
    expect(result.outputText).toBe('Local response answer.');
    expect(result.estimatedCostUsd).toBe(0);
    expect(localExec.executeLocal).toHaveBeenCalledTimes(1);
    expect(cloudExec.executeCloud).not.toHaveBeenCalled();
  });

  it('executes CLOUD route on cloudExecutor without invoking localExecutor when local is unavailable', async () => {
    const localExec: LocalRuntimeExecutor = {
      executeLocal: vi.fn(async () => ({ text: 'Unused' })),
    };
    const cloudExec: CloudRuntimeExecutor = {
      executeCloud: vi.fn(async ({ modelId }) => ({
        text: `Cloud answer from ${modelId}`,
        inputTokens: 18,
        outputTokens: 12,
        providerUsed: 'server-gemini',
      })),
    };

    const engine = new OrbitEngine({
      deviceProbe: makeDeviceProbe(false),
      networkProbe: makeNetworkProbe(true),
      localExecutor: localExec,
      cloudExecutor: cloudExec,
      cloudGeminiConfigured: true,
      firebaseAiLogicConfigured: false,
      cloudRequiresAuth: true,
      cloudAuthenticated: true,
    });

    const result = await engine.runTask({
      input: { prompt: 'Design a clean TypeScript backoff retry utility.' },
      privacyMode: 'FLEXIBLE',
      customPreferences: DEFAULT_CUSTOM_PREFERENCES,
      language: 'en',
    });

    expect(result.status).toBe('success');
    expect(result.route).toBe('CLOUD');
    expect(result.modelUsed).toBe('gemini-4-hydrogen');
    expect(result.outputText).toContain('gemini-4-hydrogen');
    expect(cloudExec.executeCloud).toHaveBeenCalledTimes(1);
    expect(localExec.executeLocal).not.toHaveBeenCalled();
  });

  it('executes HYBRID route with mixed prompt + attachment PII: strips ALL PII before cloud call and re-hydrates locally', async () => {
    const localExec: LocalRuntimeExecutor = {
      executeLocal: vi.fn(async () => ({ text: 'Unused' })),
    };
    let receivedCloudPrompt = '';
    const cloudExec: CloudRuntimeExecutor = {
      executeCloud: vi.fn(async ({ prompt }) => {
        receivedCloudPrompt = prompt;
        return {
          text: 'Draft reply for [EMAIL_1] and backup contact [EMAIL_2] using key [SECRET_1].',
          providerUsed: 'server-gemini',
        };
      }),
    };

    const engine = new OrbitEngine({
      deviceProbe: makeDeviceProbe(false),
      networkProbe: makeNetworkProbe(true),
      localExecutor: localExec,
      cloudExecutor: cloudExec,
      cloudGeminiConfigured: true,
      firebaseAiLogicConfigured: false,
    });

    const result = await engine.runTask({
      input: {
        prompt: 'Audit this onboarding email for jane.doe@corp.io and attached config.',
        attachments: [
          {
            id: 'att_1',
            name: 'secrets.txt',
            mimeType: 'text/plain',
            sizeBytes: 120,
            textContent: 'admin=ops.lead@corp.io\napiKey=sk-secret9988776655443322',
          },
        ],
      },
      privacyMode: 'BALANCED',
      customPreferences: DEFAULT_CUSTOM_PREFERENCES,
      language: 'en',
    });

    expect(result.status).toBe('success');
    expect(result.route).toBe('HYBRID');
    expect(result.plan.redactedCount).toBe(3);
    expect(receivedCloudPrompt).not.toContain('jane.doe@corp.io');
    expect(receivedCloudPrompt).not.toContain('ops.lead@corp.io');
    expect(receivedCloudPrompt).not.toContain('sk-secret9988776655443322');
    expect(receivedCloudPrompt).toContain('[EMAIL_1]');
    expect(receivedCloudPrompt).toContain('[EMAIL_2]');
    expect(receivedCloudPrompt).toContain('[SECRET_1]');
    expect(result.outputText).toContain('jane.doe@corp.io');
    expect(result.outputText).toContain('ops.lead@corp.io');
    expect(result.outputText).toContain('sk-secret9988776655443322');
    expect(result.evaluation.piiLeakageDetected).toBe(false);
    expect(result.stepTraces).toHaveLength(3);
  });

  it('executes LOCAL offline when local model is ready, and blocks offline when local is unavailable', async () => {
    const localExec: LocalRuntimeExecutor = {
      executeLocal: vi.fn(async () => ({ text: 'Offline local execution succeeded.' })),
    };
    const cloudExec: CloudRuntimeExecutor = {
      executeCloud: vi.fn(async () => ({
        text: 'Should not execute offline',
        providerUsed: 'server-gemini',
      })),
    };

    const offlineLocalEngine = new OrbitEngine({
      deviceProbe: makeDeviceProbe(true),
      networkProbe: makeNetworkProbe(false),
      localExecutor: localExec,
      cloudExecutor: cloudExec,
      cloudGeminiConfigured: true,
      firebaseAiLogicConfigured: false,
    });

    const localOfflineResult = await offlineLocalEngine.runTask({
      input: { prompt: 'Summarize edge caching in two sentences.' },
      privacyMode: 'BALANCED',
      customPreferences: DEFAULT_CUSTOM_PREFERENCES,
      language: 'en',
    });

    expect(localOfflineResult.status).toBe('success');
    expect(localOfflineResult.route).toBe('LOCAL');
    expect(localOfflineResult.outputText).toBe('Offline local execution succeeded.');
    expect(cloudExec.executeCloud).not.toHaveBeenCalled();

    const offlineNoLocalEngine = new OrbitEngine({
      deviceProbe: makeDeviceProbe(false),
      networkProbe: makeNetworkProbe(false),
      localExecutor: localExec,
      cloudExecutor: cloudExec,
      cloudGeminiConfigured: true,
      firebaseAiLogicConfigured: false,
    });

    const blockedOfflineResult = await offlineNoLocalEngine.runTask({
      input: { prompt: 'Summarize edge caching.' },
      privacyMode: 'BALANCED',
      customPreferences: DEFAULT_CUSTOM_PREFERENCES,
      language: 'en',
    });

    expect(blockedOfflineResult.status).toBe('blocked');
    expect(blockedOfflineResult.route).toBe('BLOCKED');
    expect(cloudExec.executeCloud).not.toHaveBeenCalled();
  });

  it('enforces STRICT_LOCAL: executes locally when available and blocks when unavailable without cloud fallback', async () => {
    const localExec: LocalRuntimeExecutor = {
      executeLocal: vi.fn(async () => ({ text: 'Private local draft.' })),
    };
    const cloudExec: CloudRuntimeExecutor = {
      executeCloud: vi.fn(async () => ({
        text: 'Should not happen',
        providerUsed: 'server-gemini',
      })),
    };

    const strictReadyEngine = new OrbitEngine({
      deviceProbe: makeDeviceProbe(true),
      networkProbe: makeNetworkProbe(true),
      localExecutor: localExec,
      cloudExecutor: cloudExec,
      cloudGeminiConfigured: true,
      firebaseAiLogicConfigured: false,
    });

    const allowedResult = await strictReadyEngine.runTask({
      input: { prompt: 'Summarize my private notes.' },
      privacyMode: 'STRICT_LOCAL',
      customPreferences: DEFAULT_CUSTOM_PREFERENCES,
      language: 'en',
    });
    expect(allowedResult.status).toBe('success');
    expect(allowedResult.route).toBe('LOCAL');
    expect(cloudExec.executeCloud).not.toHaveBeenCalled();

    const strictUnavailableEngine = new OrbitEngine({
      deviceProbe: makeDeviceProbe(false),
      networkProbe: makeNetworkProbe(true),
      localExecutor: localExec,
      cloudExecutor: cloudExec,
      cloudGeminiConfigured: true,
      firebaseAiLogicConfigured: false,
    });

    const blockedResult = await strictUnavailableEngine.runTask({
      input: { prompt: 'Summarize my private notes.' },
      privacyMode: 'STRICT_LOCAL',
      customPreferences: DEFAULT_CUSTOM_PREFERENCES,
      language: 'en',
    });

    expect(blockedResult.status).toBe('blocked');
    expect(blockedResult.route).toBe('BLOCKED');
    expect(cloudExec.executeCloud).not.toHaveBeenCalled();
    expect(localExec.executeLocal).toHaveBeenCalledTimes(1);
  });

  it('blocks Cloud execution cleanly when server requires auth and user is signed out', async () => {
    const localExec: LocalRuntimeExecutor = {
      executeLocal: vi.fn(async () => ({ text: 'Unused' })),
    };
    const cloudExec: CloudRuntimeExecutor = {
      executeCloud: vi.fn(async () => ({
        text: 'Should not run unauthenticated',
        providerUsed: 'server-gemini',
      })),
    };

    const engine = new OrbitEngine({
      deviceProbe: makeDeviceProbe(false),
      networkProbe: makeNetworkProbe(true),
      localExecutor: localExec,
      cloudExecutor: cloudExec,
      cloudGeminiConfigured: true,
      firebaseAiLogicConfigured: false,
      cloudRequiresAuth: true,
      cloudAuthenticated: false,
    });

    const result = await engine.runTask({
      input: { prompt: 'Write a SQL query.' },
      privacyMode: 'FLEXIBLE',
      customPreferences: DEFAULT_CUSTOM_PREFERENCES,
      language: 'en',
    });

    expect(result.status).toBe('blocked');
    expect(result.route).toBe('BLOCKED');
    expect(cloudExec.executeCloud).not.toHaveBeenCalled();
  });

  it('propagates cloud failure transparently without pretending local success', async () => {
    const localExec: LocalRuntimeExecutor = {
      executeLocal: vi.fn(async () => ({ text: 'Local' })),
    };
    const cloudExec: CloudRuntimeExecutor = {
      executeCloud: vi.fn(async () => {
        throw new Error('503 Cloud Gemini upstream timeout');
      }),
    };

    const engine = new OrbitEngine({
      deviceProbe: makeDeviceProbe(false),
      networkProbe: makeNetworkProbe(true),
      localExecutor: localExec,
      cloudExecutor: cloudExec,
      cloudGeminiConfigured: true,
      firebaseAiLogicConfigured: false,
    });

    const result = await engine.runTask({
      input: { prompt: 'Design a scalable distributed queue in Rust.' },
      privacyMode: 'FLEXIBLE',
      customPreferences: DEFAULT_CUSTOM_PREFERENCES,
      language: 'en',
    });

    expect(result.status).toBe('error');
    expect(result.route).toBe('CLOUD');
    expect(result.errorMessage).toContain('503 Cloud Gemini upstream timeout');
    expect(result.outputText).toBe('');
  });
});
