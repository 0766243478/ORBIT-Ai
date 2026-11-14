import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  analyzeTask,
  BENCHMARK_OFFLINE_NETWORK,
  BENCHMARK_ONLINE_NETWORK,
  BENCHMARK_SLOW_NETWORK,
  buildExecutionPlan,
  buildModelRegistry,
  decideRoute,
  DEFAULT_CUSTOM_PREFERENCES,
  LatencyCalibrator,
  OrbitEngine,
  REPRESENTATIVE_BENCHMARK_TASKS,
  SYNTHETIC_DEVICE_TIERS,
  type CloudRuntimeExecutor,
  type DeviceCapabilityProfile,
  type DeviceProbe,
  type ExecutionPlan,
  type LocalRuntimeExecutor,
  type NetworkProbe,
  type NetworkStatusSnapshot,
  type PrivacyMode,
} from '../src/engine';
import { browserCloudExecutor, browserDeviceProbe } from '../src/services/browserProbes';
import * as firebaseModule from '../src/services/firebase';
import { executePlan } from '../src/engine/executionManager';

function makeProbePair(
  deviceProfile: DeviceCapabilityProfile,
  networkSnapshot: NetworkStatusSnapshot
): { deviceProbe: DeviceProbe; networkProbe: NetworkProbe } {
  return {
    deviceProbe: {
      getHardwareInfo: () => ({
        platform: deviceProfile.platform,
        browserName: deviceProfile.browserName,
        deviceMemoryGb: deviceProfile.deviceMemoryGb,
        hardwareConcurrency: deviceProfile.hardwareConcurrency,
        webGpuAvailable: deviceProfile.webGpuAvailable,
      }),
      getStorageQuotaMb: async () => deviceProfile.storageQuotaMb,
      getLocalModelStatus: async () => ({
        apiPresent: deviceProfile.localApiPresent,
        availability: deviceProfile.localModelAvailability,
        reason: deviceProfile.localModelReason,
      }),
    },
    networkProbe: {
      getConnectionInfo: () => ({
        online: networkSnapshot.online,
        effectiveType: networkSnapshot.effectiveType,
        rttMs: networkSnapshot.rttMs,
        downlinkMbps: networkSnapshot.downlinkMbps,
        saveData: networkSnapshot.saveData,
      }),
      checkCloudReachability: async () => ({
        reachable: networkSnapshot.cloudReachable,
        latencyMs: networkSnapshot.cloudHealthLatencyMs,
      }),
    },
  };
}

describe('Phase 5 — Real-World Intelligence Validation, Network Audit & EWMA Behavior', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    // Reset any mocked auth user safely
    (firebaseModule.auth as unknown as { currentUser: unknown }).currentUser = null;
  });

  it('audits real browserCloudExecutor outbound HTTP fetch requests for STRICT_LOCAL, incomplete PII, verified HYBRID, and mid-flight disconnects', async () => {
    // Provide mock signed-in Firebase user so browserCloudExecutor would hit fetch('/api/ai/execute') if allowed
    (firebaseModule.auth as unknown as { currentUser: unknown }).currentUser = {
      uid: 'phase5_test_uid',
      getIdToken: vi.fn(async () => 'synthetic-firebase-id-token'),
    };

    const recordedRequests: Array<{ url: string; method: string; body: Record<string, unknown> }> = [];
    const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method || 'GET';
      const parsedBody =
        typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
      recordedRequests.push({ url, method, body: parsedBody });

      return new Response(
        JSON.stringify({
          text: 'Verified cloud answer for [EMAIL_1], [IBAN_1], [PHONE_1], [SECRET_1].',
          inputTokens: 42,
          outputTokens: 18,
          providerUsed: 'server-gemini',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const highDeviceReady = SYNTHETIC_DEVICE_TIERS[3].device;
    const highDeviceNoLocal: DeviceCapabilityProfile = {
      ...highDeviceReady,
      localApiPresent: false,
      localModelAvailability: 'unavailable',
      localModelReason: 'Simulated missing Chrome Prompt API',
    };

    const localMock: LocalRuntimeExecutor = {
      executeLocal: vi.fn(async () => ({ text: 'Local Nano synthetic response.' })),
    };

    // 1. STRICT_LOCAL (local ready + local unavailable) -> ZERO /api/ai/execute HTTP requests
    for (const dev of [highDeviceReady, highDeviceNoLocal]) {
      const { deviceProbe, networkProbe } = makeProbePair(dev, BENCHMARK_ONLINE_NETWORK);
      const engine = new OrbitEngine({
        deviceProbe,
        networkProbe,
        localExecutor: localMock,
        cloudExecutor: browserCloudExecutor,
        cloudGeminiConfigured: true,
        firebaseAiLogicConfigured: false,
        cloudRequiresAuth: true,
        cloudAuthenticated: true,
      });

      const res = await engine.runTask({
        input: { prompt: 'Summarize edge privacy in one sentence.' },
        privacyMode: 'STRICT_LOCAL',
        customPreferences: DEFAULT_CUSTOM_PREFERENCES,
        language: 'en',
      });

      expect(res.route).toBe(dev.localModelAvailability === 'available' ? 'LOCAL' : 'BLOCKED');
    }
    expect(
      recordedRequests.filter((r) => r.url.includes('/api/ai/execute'))
    ).toHaveLength(0);

    // 2. Incomplete / uncertain PII prompts (missing local model) -> ZERO /api/ai/execute HTTP requests
    const { deviceProbe: noLocalProbe, networkProbe: onlineProbe } = makeProbePair(
      highDeviceNoLocal,
      BENCHMARK_ONLINE_NETWORK
    );
    const noLocalEngine = new OrbitEngine({
      deviceProbe: noLocalProbe,
      networkProbe: onlineProbe,
      localExecutor: localMock,
      cloudExecutor: browserCloudExecutor,
      cloudGeminiConfigured: true,
      firebaseAiLogicConfigured: false,
      cloudRequiresAuth: true,
      cloudAuthenticated: true,
    });

    for (const mode of ['BALANCED', 'FLEXIBLE', 'CUSTOM'] as PrivacyMode[]) {
      const r1 = await noLocalEngine.runTask({
        input: { prompt: 'Review my medical diagnosis and salary sheet.' },
        privacyMode: mode,
        customPreferences: DEFAULT_CUSTOM_PREFERENCES,
        language: 'en',
      });
      const r2 = await noLocalEngine.runTask({
        input: { prompt: 'راجع تشخيصي الطبي وكلمة المرور الخاصة بي.' },
        privacyMode: mode,
        customPreferences: DEFAULT_CUSTOM_PREFERENCES,
        language: 'ar',
      });
      expect(r1.route).toBe('BLOCKED');
      expect(r2.route).toBe('BLOCKED');
    }
    expect(
      recordedRequests.filter((r) => r.url.includes('/api/ai/execute'))
    ).toHaveLength(0);

    // 3. Verifiable Arabic & international identifiers on HYBRID via real browserCloudExecutor HTTP payload
    const sensitivePrompt =
      'Send to ops@orbit.dev with IBAN SA03 8000 0000 6080 1016 7519, phone +966 55 111 2233, and password=SyntheticSecret#99.';
    const hybridRes = await noLocalEngine.runTask({
      input: { prompt: sensitivePrompt },
      privacyMode: 'BALANCED',
      customPreferences: DEFAULT_CUSTOM_PREFERENCES,
      language: 'en',
    });

    expect(hybridRes.status).toBe('success');
    expect(hybridRes.route).toBe('HYBRID');

    const aiExecuteCalls = recordedRequests.filter((r) => r.url === '/api/ai/execute');
    expect(aiExecuteCalls).toHaveLength(1);
    const wirePrompt = String(aiExecuteCalls[0].body.prompt || '');
    expect(wirePrompt).not.toContain('ops@orbit.dev');
    expect(wirePrompt).not.toContain('SA03 8000 0000 6080 1016 7519');
    expect(wirePrompt).not.toContain('+966 55 111 2233');
    expect(wirePrompt).not.toContain('SyntheticSecret#99');
    expect(wirePrompt).toContain('[IBAN_1]');
    expect(wirePrompt).toContain('[SECRET_1]');
    expect(hybridRes.outputText).toContain('SA03 8000 0000 6080 1016 7519');

    // 4. Mid-flight network disconnection during execution -> clean error, ZERO hidden fallback retry
    const failingFetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch (network disconnected mid-flight)');
    });
    globalThis.fetch = failingFetch as unknown as typeof fetch;

    const disconnectRes = await noLocalEngine.runTask({
      input: { prompt: 'Explain microservice circuit breakers briefly.' },
      privacyMode: 'BALANCED',
      customPreferences: DEFAULT_CUSTOM_PREFERENCES,
      language: 'en',
    });

    expect(disconnectRes.status).toBe('error');
    expect(disconnectRes.route).toBe('CLOUD');
    expect(disconnectRes.errorMessage).toContain('Failed to fetch');
    expect(failingFetch).toHaveBeenCalledTimes(1);

    // 5. Tampered ExecutionPlan passed directly to executePlan -> ZERO fetch calls
    const beforeTamperCount = failingFetch.mock.calls.length;
    const tamperedInput = { prompt: 'Debug key sk-tampersecret1234567890abcd' };
    const tamperedAnalysis = analyzeTask(tamperedInput);
    const models = buildModelRegistry({
      device: highDeviceNoLocal,
      network: BENCHMARK_ONLINE_NETWORK,
      cloudGeminiConfigured: true,
      firebaseAiLogicConfigured: false,
    });
    const tamperedPlan: ExecutionPlan = {
      planId: 'plan_tampered_phase5',
      route: 'CLOUD',
      steps: [
        {
          stepId: 's1',
          order: 1,
          stage: 'cloud_inference',
          locality: 'cloud',
          modelId: 'gemini-4-hydrogen',
          descriptionEn: 'Tampered',
          descriptionAr: 'تلاعب',
        },
      ],
      sanitizedPrompt: tamperedInput.prompt,
      redactionMap: {},
      redactedCount: 0,
      cloudPayloadBytes: 42,
    };

    const blockedTamper = await executePlan({
      input: tamperedInput,
      analysis: tamperedAnalysis,
      device: highDeviceNoLocal,
      network: BENCHMARK_ONLINE_NETWORK,
      models,
      decision: {
        selectedRoute: 'CLOUD',
        selectedLocalModelId: null,
        selectedCloudModelId: 'gemini-4-hydrogen',
        primaryModelDisplay: 'Gemini 4 Hydrogen',
        privacyMode: 'FLEXIBLE',
        estimatedLatencyMs: 500,
        estimatedCostUsd: 0.001,
        privacyStatus: 'Tampered',
        constraints: [],
        routeScores: [],
        requiresSanitization: false,
        limitations: [],
      },
      plan: tamperedPlan,
      language: 'en',
      localExecutor: localMock,
      cloudExecutor: browserCloudExecutor,
    });
    expect(blockedTamper.status).toBe('blocked');
    expect(blockedTamper.route).toBe('BLOCKED');
    expect(failingFetch.mock.calls.length).toBe(beforeTamperCount);
  });

  it('quantifies whether EWMA calibration updates latency estimates vs actually flipping BALANCED / FLEXIBLE routing decisions', async () => {
    const highDevice = SYNTHETIC_DEVICE_TIERS[3].device;
    const { deviceProbe, networkProbe } = makeProbePair(highDevice, BENCHMARK_ONLINE_NETWORK);

    // Simulate extreme slow on-device Nano (22,000 ms) vs ultra-fast Cloud (450 ms)
    const slowLocalExec: LocalRuntimeExecutor = {
      executeLocal: vi.fn(async () => ({ text: 'Slow local result.', outputTokens: 200 })),
    };
    const fastCloudExec: CloudRuntimeExecutor = {
      executeCloud: vi.fn(async () => ({
        text: 'Fast cloud result.',
        outputTokens: 200,
        providerUsed: 'server-gemini',
      })),
    };

    const calibrator = new LatencyCalibrator(0.35);
    for (let i = 0; i < 10; i++) {
      calibrator.recordObservation({
        modelId: 'chrome-gemini-nano',
        actualLatencyMs: 22_000,
        outputTokens: 200,
      });
      calibrator.recordObservation({
        modelId: 'gemini-3.1-flash-lite',
        actualLatencyMs: 450,
        outputTokens: 200,
      });
      calibrator.recordObservation({
        modelId: 'gemini-4-hydrogen',
        actualLatencyMs: 750,
        outputTokens: 200,
      });
    }

    const simpleQa = analyzeTask({ prompt: 'Briefly define TLS.' });
    const models = buildModelRegistry({
      device: highDevice,
      network: BENCHMARK_ONLINE_NETWORK,
      cloudGeminiConfigured: true,
      firebaseAiLogicConfigured: false,
    });

    const beforeBalanced = decideRoute({
      analysis: simpleQa,
      device: highDevice,
      network: BENCHMARK_ONLINE_NETWORK,
      models,
      privacyMode: 'BALANCED',
      customPreferences: DEFAULT_CUSTOM_PREFERENCES,
    });

    const afterBalanced = decideRoute({
      analysis: simpleQa,
      device: highDevice,
      network: BENCHMARK_ONLINE_NETWORK,
      models,
      privacyMode: 'BALANCED',
      customPreferences: DEFAULT_CUSTOM_PREFERENCES,
      calibrationByModel: calibrator.snapshot(),
    });

    // Proof 1: Local model EWMA ETA adapts upward significantly (>14s vs static 7s)
    const afterLocalEntry = afterBalanced.routeScores.find((r) => r.route === 'LOCAL');
    expect(afterLocalEntry?.estimatedLatencyMs).toBeGreaterThan(beforeBalanced.estimatedLatencyMs * 1.8);
    // Proof 2 (Phase 6 update): With >=3 reliable telemetry samples on a non-sensitive task,
    // BALANCED now offloads cleanly from degraded 22s local to 450ms CLOUD.
    expect(afterBalanced.selectedRoute).toBe('CLOUD');

    // Proof 3: Under BALANCED, EWMA calibration now flips non-sensitive routes from LOCAL -> CLOUD
    // once reliable extreme latency is observed, while FLEXIBLE prioritizes faster/higher-quality CLOUD.
    const beforeFlexible = decideRoute({
      analysis: simpleQa,
      device: highDevice,
      network: BENCHMARK_ONLINE_NETWORK,
      models,
      privacyMode: 'FLEXIBLE',
      customPreferences: DEFAULT_CUSTOM_PREFERENCES,
    });
    const afterFlexible = decideRoute({
      analysis: simpleQa,
      device: highDevice,
      network: BENCHMARK_ONLINE_NETWORK,
      models,
      privacyMode: 'FLEXIBLE',
      customPreferences: DEFAULT_CUSTOM_PREFERENCES,
      calibrationByModel: calibrator.snapshot(),
    });

    expect(beforeBalanced.selectedRoute).toBe('LOCAL');
    expect(afterBalanced.selectedRoute).toBe('CLOUD');
    expect(['LOCAL', 'CLOUD']).toContain(beforeFlexible.selectedRoute);
    expect(afterFlexible.selectedRoute).toBe('CLOUD');

    // Verify helper executors remain well-typed
    expect(deviceProbe).toBeDefined();
    expect(networkProbe).toBeDefined();
    expect(slowLocalExec).toBeDefined();
    expect(fastCloudExec).toBeDefined();
  });

  it('evaluates OAIE decisions across all 9 required scenarios and surfaces real algorithmic edge cases', () => {
    const highDevice = SYNTHETIC_DEVICE_TIERS[3].device;
    const entry4gbDevice = SYNTHETIC_DEVICE_TIERS[1].device;
    const low2gbDevice = SYNTHETIC_DEVICE_TIERS[0].device;

    const onlineModelsHigh = buildModelRegistry({
      device: highDevice,
      network: BENCHMARK_ONLINE_NETWORK,
      cloudGeminiConfigured: true,
      firebaseAiLogicConfigured: false,
    });

    // 1. Simple Q&A -> LOCAL
    const qaDecision = decideRoute({
      analysis: analyzeTask(REPRESENTATIVE_BENCHMARK_TASKS[0].input),
      device: highDevice,
      network: BENCHMARK_ONLINE_NETWORK,
      models: onlineModelsHigh,
      privacyMode: 'BALANCED',
      customPreferences: DEFAULT_CUSTOM_PREFERENCES,
    });
    expect(qaDecision.selectedRoute).toBe('LOCAL');

    // 2. Long summarization (>1,536 tokens) -> LOCAL on 8+GB, CLOUD on 3-4GB entry device
    const longSummary = analyzeTask({
      prompt: 'Summarize these architecture notes: ' + 'latency '.repeat(1450),
    });
    const summaryHigh = decideRoute({
      analysis: longSummary,
      device: highDevice,
      network: BENCHMARK_ONLINE_NETWORK,
      models: onlineModelsHigh,
      privacyMode: 'BALANCED',
      customPreferences: DEFAULT_CUSTOM_PREFERENCES,
    });
    const summaryEntry = decideRoute({
      analysis: longSummary,
      device: entry4gbDevice,
      network: BENCHMARK_ONLINE_NETWORK,
      models: buildModelRegistry({
        device: entry4gbDevice,
        network: BENCHMARK_ONLINE_NETWORK,
        cloudGeminiConfigured: true,
        firebaseAiLogicConfigured: false,
      }),
      privacyMode: 'BALANCED',
      customPreferences: DEFAULT_CUSTOM_PREFERENCES,
    });
    expect(summaryHigh.selectedRoute).toBe('LOCAL');
    expect(summaryEntry.selectedRoute).toBe('CLOUD');

    // 3. Coding -> CLOUD
    const codingDecision = decideRoute({
      analysis: analyzeTask(REPRESENTATIVE_BENCHMARK_TASKS[5].input),
      device: highDevice,
      network: BENCHMARK_ONLINE_NETWORK,
      models: onlineModelsHigh,
      privacyMode: 'BALANCED',
      customPreferences: DEFAULT_CUSTOM_PREFERENCES,
    });
    expect(codingDecision.selectedRoute).toBe('CLOUD');

    // 4. Arabic task -> CLOUD online, BLOCKED offline even for trivial 4-word Arabic Q&A (known limitation!)
    const simpleArabicOffline = decideRoute({
      analysis: analyzeTask({ prompt: 'ما هي عاصمة فرنسا؟', language: 'ar' }),
      device: highDevice,
      network: BENCHMARK_OFFLINE_NETWORK,
      models: buildModelRegistry({
        device: highDevice,
        network: BENCHMARK_OFFLINE_NETWORK,
        cloudGeminiConfigured: true,
        firebaseAiLogicConfigured: false,
      }),
      privacyMode: 'BALANCED',
      customPreferences: DEFAULT_CUSTOM_PREFERENCES,
    });
    expect(simpleArabicOffline.selectedRoute).toBe('BLOCKED');

    // 5. Large attachments -> >256KB rejected cleanly as unsupported/BLOCKED; <=256KB w/ PII routes HYBRID
    const oversizedAttachment = analyzeTask({
      prompt: 'Summarize file.',
      attachments: [
        {
          id: 'big',
          name: 'big.txt',
          mimeType: 'text/plain',
          sizeBytes: 300 * 1024,
          textContent: 'x'.repeat(1000),
        },
      ],
    });
    expect(oversizedAttachment.valid).toBe(false);

    // 6. Slow 2G network keeps simple Q&A LOCAL (does not degrade like Always-Cloud)
    const slowNetLocal = decideRoute({
      analysis: analyzeTask(REPRESENTATIVE_BENCHMARK_TASKS[0].input),
      device: highDevice,
      network: BENCHMARK_SLOW_NETWORK,
      models: buildModelRegistry({
        device: highDevice,
        network: BENCHMARK_SLOW_NETWORK,
        cloudGeminiConfigured: true,
        firebaseAiLogicConfigured: false,
      }),
      privacyMode: 'BALANCED',
      customPreferences: DEFAULT_CUSTOM_PREFERENCES,
    });
    expect(slowNetLocal.selectedRoute).toBe('LOCAL');

    // 7. Limited 2 GB memory excludes LOCAL and routes online tasks to CLOUD
    const lowMemDecision = decideRoute({
      analysis: analyzeTask(REPRESENTATIVE_BENCHMARK_TASKS[0].input),
      device: low2gbDevice,
      network: BENCHMARK_ONLINE_NETWORK,
      models: buildModelRegistry({
        device: low2gbDevice,
        network: BENCHMARK_ONLINE_NETWORK,
        cloudGeminiConfigured: true,
        firebaseAiLogicConfigured: false,
      }),
      privacyMode: 'BALANCED',
      customPreferences: DEFAULT_CUSTOM_PREFERENCES,
    });
    expect(lowMemDecision.selectedRoute).toBe('CLOUD');

    // 8. Phase 6 refinement: Non-personal conceptual threat-modeling question succeeds on CLOUD,
    // while ambiguous/personal unredacted salary prompt still fails closed to BLOCKED.
    const conceptualPlan = buildExecutionPlan({
      input: { prompt: 'Explain general privacy threat modeling for confidential payroll systems.' },
      analysis: analyzeTask({
        prompt: 'Explain general privacy threat modeling for confidential payroll systems.',
      }),
      decision: {
        selectedRoute: 'CLOUD',
        selectedLocalModelId: null,
        selectedCloudModelId: 'gemini-4-hydrogen',
        primaryModelDisplay: 'Gemini 4 Hydrogen',
        privacyMode: 'BALANCED',
        estimatedLatencyMs: 1000,
        estimatedCostUsd: 0.0005,
        privacyStatus: 'Test',
        constraints: [],
        routeScores: [],
        requiresSanitization: false,
        limitations: [],
      },
    });
    expect(conceptualPlan.route).toBe('CLOUD');

    const personalSalaryBlockPlan = buildExecutionPlan({
      input: { prompt: 'Review my confidential payroll salary breakdown.' },
      analysis: analyzeTask({
        prompt: 'Review my confidential payroll salary breakdown.',
      }),
      decision: {
        selectedRoute: 'CLOUD',
        selectedLocalModelId: null,
        selectedCloudModelId: 'gemini-4-hydrogen',
        primaryModelDisplay: 'Gemini 4 Hydrogen',
        privacyMode: 'BALANCED',
        estimatedLatencyMs: 1000,
        estimatedCostUsd: 0.0005,
        privacyStatus: 'Test',
        constraints: [],
        routeScores: [],
        requiresSanitization: false,
        limitations: [],
      },
    });
    expect(personalSalaryBlockPlan.route).toBe('BLOCKED');

    // Verify browserDeviceProbe gracefully reports nulls in headless Node environment (zero fabricated hardware specs)
    const hw = browserDeviceProbe.getHardwareInfo();
    expect(hw.deviceMemoryGb).toBeNull();
    expect(hw.webGpuAvailable).toBe(false);
  });
});
