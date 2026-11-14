import { describe, expect, it, vi } from 'vitest';
import {
  analyzeTask,
  buildExecutionPlan,
  buildModelRegistry,
  DEFAULT_CUSTOM_PREFERENCES,
  executePlan,
  OrbitEngine,
  type CloudRuntimeExecutor,
  type DeviceCapabilityProfile,
  type DeviceProbe,
  type ExecutionPlan,
  type LocalRuntimeExecutor,
  type NetworkProbe,
  type NetworkStatusSnapshot,
  type PrivacyMode,
  type RoutingDecision,
} from '../src/engine';

function makeDeviceProbe(localAvailable: boolean): DeviceProbe {
  return {
    getHardwareInfo: () => ({
      platform: 'node-test',
      browserName: 'Vitest',
      deviceMemoryGb: 8,
      hardwareConcurrency: 8,
      webGpuAvailable: true,
    }),
    getStorageQuotaMb: async () => 25000,
    getLocalModelStatus: async () => ({
      apiPresent: localAvailable,
      availability: localAvailable ? 'available' : 'unavailable',
      reason: localAvailable ? 'Ready' : 'Prompt API unavailable',
    }),
  };
}

function makeNetworkProbe(online = true): NetworkProbe {
  return {
    getConnectionInfo: () => ({
      online,
      effectiveType: online ? '4g' : 'unknown',
      rttMs: online ? 40 : null,
      downlinkMbps: online ? 30 : null,
      saveData: false,
    }),
    checkCloudReachability: async () => ({
      reachable: online,
      latencyMs: online ? 45 : null,
    }),
  };
}

describe('OAIE Critical Privacy Enforcement & Fail-Closed Adversarial Suite', () => {
  const cloudCapableModes: PrivacyMode[] = ['BALANCED', 'FLEXIBLE', 'CUSTOM'];

  it('detects and redacts synthetic passwords, IBANs, regional phones, national IDs, API keys, and JWTs before cloud dispatch across BALANCED, FLEXIBLE, and CUSTOM', async () => {
    const secrets = [
      'SA03 8000 0000 6080 1016 7519',
      'SyntheticPass#2026',
      '050 123 4567',
      '+971 50 998 1122',
      '1098765432',
      '784-1992-1234567-1',
      'sk-synthetic1234567890abcdef',
      'eyJhbGciOiJIUzI1NiJ9.syntheticpayload12.sig9988',
      'ops.audit@example.org',
    ];

    const prompt =
      'Audit transfer for ops.audit@example.org using IBAN SA03 8000 0000 6080 1016 7519, ' +
      'Saudi ID 1098765432, Emirates ID 784-1992-1234567-1, local mobile 050 123 4567, ' +
      'UAE phone +971 50 998 1122, password=SyntheticPass#2026, key sk-synthetic1234567890abcdef, ' +
      'and Authorization Bearer eyJhbGciOiJIUzI1NiJ9.syntheticpayload12.sig9988.';

    for (const mode of cloudCapableModes) {
      const capturedPayloads: string[] = [];
      const cloudExec: CloudRuntimeExecutor = {
        executeCloud: vi.fn(async ({ prompt: outboundPrompt }) => {
          capturedPayloads.push(outboundPrompt);
          return {
            text: 'Reviewed [EMAIL_1] with [IBAN_1], [ID_1], [ID_2], [PHONE_1], [PHONE_2], [SECRET_1], [SECRET_2], [SECRET_3].',
            providerUsed: 'server-gemini',
          };
        }),
      };

      const engine = new OrbitEngine({
        deviceProbe: makeDeviceProbe(false),
        networkProbe: makeNetworkProbe(true),
        localExecutor: { executeLocal: vi.fn(async () => ({ text: 'Unused' })) },
        cloudExecutor: cloudExec,
        cloudGeminiConfigured: true,
        firebaseAiLogicConfigured: false,
      });

      const result = await engine.runTask({
        input: { prompt },
        privacyMode: mode,
        // Deliberately attempt disabling redactPiiBeforeCloud in CUSTOM mode; fail-closed policy must still protect PII
        customPreferences: {
          ...DEFAULT_CUSTOM_PREFERENCES,
          redactPiiBeforeCloud: false,
        },
        language: 'en',
      });

      expect(result.status).toBe('success');
      expect(result.route).toBe('HYBRID');
      expect(cloudExec.executeCloud).toHaveBeenCalledTimes(1);
      expect(capturedPayloads).toHaveLength(1);

      const actualPayload = capturedPayloads[0];
      for (const secret of secrets) {
        expect(actualPayload).not.toContain(secret);
      }
      expect(actualPayload).toContain('[IBAN_1]');
      expect(actualPayload).toContain('[EMAIL_1]');
      expect(actualPayload).toContain('[SECRET_1]');
      expect(actualPayload).toContain('[ID_1]');
      expect(actualPayload).toContain('[PHONE_1]');
      expect(result.evaluation.piiLeakageDetected).toBe(false);
    }
  });

  it('sanitizes mixed Arabic/English sensitive prompts accurately and never leaks original tokens to cloud', async () => {
    const rawSecrets = ['+966 55 987 6543', '2098765432', 'ArPass!2026', 'sara.ali@clinic.org'];
    const prompt =
      'أرسل إشعاراً إلى sara.ali@clinic.org على الرقم +966 55 987 6543 مع رقم الإقامة: 2098765432 وكلمة المرور: ArPass!2026.';

    const capturedPayloads: string[] = [];
    const cloudExec: CloudRuntimeExecutor = {
      executeCloud: vi.fn(async ({ prompt: outboundPrompt }) => {
        capturedPayloads.push(outboundPrompt);
        return {
          text: 'تم تجهيز المسودة لـ [EMAIL_1] والرقم [PHONE_1].',
          providerUsed: 'server-gemini',
        };
      }),
    };

    const engine = new OrbitEngine({
      deviceProbe: makeDeviceProbe(false),
      networkProbe: makeNetworkProbe(true),
      localExecutor: { executeLocal: vi.fn(async () => ({ text: 'Unused' })) },
      cloudExecutor: cloudExec,
      cloudGeminiConfigured: true,
      firebaseAiLogicConfigured: false,
    });

    const result = await engine.runTask({
      input: { prompt, language: 'ar' },
      privacyMode: 'FLEXIBLE',
      customPreferences: DEFAULT_CUSTOM_PREFERENCES,
      language: 'ar',
    });

    expect(result.status).toBe('success');
    expect(result.route).toBe('HYBRID');
    expect(capturedPayloads).toHaveLength(1);
    for (const secret of rawSecrets) {
      expect(capturedPayloads[0]).not.toContain(secret);
    }
    expect(result.outputText).toContain('sara.ali@clinic.org');
    expect(result.outputText).toContain('+966 55 987 6543');
  });

  it('fails closed with zero cloud calls across BALANCED, FLEXIBLE, and CUSTOM when sensitive keywords lack verified complete redaction', async () => {
    const adversarialUnredactedPrompts = [
      // Unbounded medical/salary context with zero spans
      'Summarize my medical diagnosis and salary compensation report.',
      // Mixed: email is extractable, but password prose & confidential medical terms are unredacted (incomplete redaction)
      'Email ops@orbit.dev my medical diagnosis and my password is the name of my first pet.',
      // Structured keyword without extractable IBAN/passport span
      'Verify my IBAN and passport details described in text: Saudi account forty two.',
      // Short/malformed Bearer credential
      'Send request with Authorization: Bearer ab12 to endpoint.',
      // Arabic sensitive context without extractable structured spans
      'راجع هذا التقرير الطبي والتشخيص السري مع تفاصيل الراتب وكلمة المرور الخاصة بي.',
    ];

    for (const mode of cloudCapableModes) {
      for (const prompt of adversarialUnredactedPrompts) {
        const cloudExec: CloudRuntimeExecutor = {
          executeCloud: vi.fn(async () => ({
            text: 'MUST NEVER BE CALLED',
            providerUsed: 'server-gemini',
          })),
        };

        const engine = new OrbitEngine({
          deviceProbe: makeDeviceProbe(false),
          networkProbe: makeNetworkProbe(true),
          localExecutor: { executeLocal: vi.fn(async () => ({ text: 'Unused' })) },
          cloudExecutor: cloudExec,
          cloudGeminiConfigured: true,
          firebaseAiLogicConfigured: false,
        });

        const result = await engine.runTask({
          input: { prompt },
          privacyMode: mode,
          customPreferences: DEFAULT_CUSTOM_PREFERENCES,
          language: 'en',
        });

        expect(result.status).toBe('blocked');
        expect(result.route).toBe('BLOCKED');
        expect(result.outputText).toBe('');
        expect(cloudExec.executeCloud).not.toHaveBeenCalled();
      }
    }
  });

  it('allows on-device LOCAL execution for sensitive prompts when local model is available, with zero cloud calls, including STRICT_LOCAL', async () => {
    const localExec: LocalRuntimeExecutor = {
      executeLocal: vi.fn(async () => ({ text: 'Processed safely on-device.' })),
    };
    const cloudExec: CloudRuntimeExecutor = {
      executeCloud: vi.fn(async () => ({ text: 'Forbidden cloud call', providerUsed: 'server-gemini' })),
    };

    const sensitivePrompt = 'Summarize my confidential medical diagnosis and salary details.';

    for (const mode of ['BALANCED', 'STRICT_LOCAL'] as PrivacyMode[]) {
      const engine = new OrbitEngine({
        deviceProbe: makeDeviceProbe(true),
        networkProbe: makeNetworkProbe(true),
        localExecutor: localExec,
        cloudExecutor: cloudExec,
        cloudGeminiConfigured: true,
        firebaseAiLogicConfigured: false,
      });

      const result = await engine.runTask({
        input: { prompt: sensitivePrompt },
        privacyMode: mode,
        customPreferences: DEFAULT_CUSTOM_PREFERENCES,
        language: 'en',
      });

      expect(result.status).toBe('success');
      expect(result.route).toBe('LOCAL');
      expect(cloudExec.executeCloud).not.toHaveBeenCalled();
    }

    // STRICT_LOCAL blocks without calling cloud when local is unavailable
    const strictBlockedEngine = new OrbitEngine({
      deviceProbe: makeDeviceProbe(false),
      networkProbe: makeNetworkProbe(true),
      localExecutor: localExec,
      cloudExecutor: cloudExec,
      cloudGeminiConfigured: true,
      firebaseAiLogicConfigured: false,
    });
    const blockedRes = await strictBlockedEngine.runTask({
      input: { prompt: sensitivePrompt },
      privacyMode: 'STRICT_LOCAL',
      customPreferences: DEFAULT_CUSTOM_PREFERENCES,
      language: 'en',
    });
    expect(blockedRes.status).toBe('blocked');
    expect(blockedRes.route).toBe('BLOCKED');
    expect(cloudExec.executeCloud).not.toHaveBeenCalled();
  });

  it('blocks tampered/direct buildExecutionPlan and executePlan calls attempting unredacted CLOUD, incomplete HYBRID, or STRICT_LOCAL cloud bypass', async () => {
    const device: DeviceCapabilityProfile = {
      platform: 'node-test',
      browserName: 'Vitest',
      deviceMemoryGb: 8,
      hardwareConcurrency: 8,
      webGpuAvailable: true,
      storageQuotaMb: 25000,
      localApiPresent: false,
      localModelAvailability: 'unavailable',
      localModelReason: 'Unavailable',
      resourceConstrained: false,
      constraintReasons: [],
    };
    const network: NetworkStatusSnapshot = {
      online: true,
      effectiveType: '4g',
      rttMs: 40,
      downlinkMbps: 30,
      saveData: false,
      cloudReachable: true,
      cloudHealthLatencyMs: 45,
    };
    const models = buildModelRegistry({
      device,
      network,
      cloudGeminiConfigured: true,
      firebaseAiLogicConfigured: false,
    });

    const leakInput = { prompt: 'Debug using key sk-forgedbypass1234567890abcdef and medical diagnosis.' };
    const analysis = analyzeTask(leakInput);

    // 1. Force a forged CLOUD decision into buildExecutionPlan -> must fail closed to BLOCKED
    const forgedCloudDecision: RoutingDecision = {
      selectedRoute: 'CLOUD',
      selectedLocalModelId: null,
      selectedCloudModelId: 'gemini-4-hydrogen',
      primaryModelDisplay: 'Gemini 4 Hydrogen',
      privacyMode: 'FLEXIBLE',
      estimatedLatencyMs: 1000,
      estimatedCostUsd: 0.001,
      privacyStatus: 'Forged',
      constraints: [],
      routeScores: [],
      requiresSanitization: false,
      limitations: [],
    };
    const safePlan = buildExecutionPlan({
      input: leakInput,
      analysis,
      decision: forgedCloudDecision,
    });
    expect(safePlan.route).toBe('BLOCKED');
    expect(safePlan.cloudPayloadBytes).toBe(0);

    // 2. Force a forged HYBRID ExecutionPlan directly into executePlan with leaked secret inside sanitizedPrompt
    const cloudExec: CloudRuntimeExecutor = {
      executeCloud: vi.fn(async () => ({ text: 'Should never execute', providerUsed: 'server-gemini' })),
    };
    const forgedHybridPlan: ExecutionPlan = {
      planId: 'plan_forged',
      route: 'HYBRID',
      steps: [
        {
          stepId: 's1',
          order: 1,
          stage: 'local_analyze_and_sanitize',
          locality: 'local',
          modelId: 'oaie-local-guardian',
          descriptionEn: 'Forged prep',
          descriptionAr: 'تجهيز',
        },
        {
          stepId: 's2',
          order: 2,
          stage: 'cloud_inference',
          locality: 'cloud',
          modelId: 'gemini-4-hydrogen',
          descriptionEn: 'Forged cloud',
          descriptionAr: 'سحابة',
        },
        {
          stepId: 's3',
          order: 3,
          stage: 'local_rehydrate_and_evaluate',
          locality: 'local',
          modelId: 'oaie-local-evaluator',
          descriptionEn: 'Forged eval',
          descriptionAr: 'تقييم',
        },
      ],
      sanitizedPrompt: 'Leaked raw secret sk-forgedbypass1234567890abcdef without redaction',
      redactionMap: { '[SECRET_1]': 'sk-forgedbypass1234567890abcdef' },
      redactedCount: 1,
      cloudPayloadBytes: 64,
    };

    const forgedHybridRes = await executePlan({
      input: leakInput,
      analysis,
      device,
      network,
      models,
      decision: { ...forgedCloudDecision, selectedRoute: 'HYBRID' },
      plan: forgedHybridPlan,
      language: 'en',
      localExecutor: { executeLocal: vi.fn(async () => ({ text: 'Unused' })) },
      cloudExecutor: cloudExec,
    });
    expect(forgedHybridRes.status).toBe('blocked');
    expect(forgedHybridRes.route).toBe('BLOCKED');
    expect(cloudExec.executeCloud).not.toHaveBeenCalled();

    // 3. Force a STRICT_LOCAL decision with a forged CLOUD plan directly into executePlan
    const cleanInput = { prompt: 'Define HTTP briefly.' };
    const cleanAnalysis = analyzeTask(cleanInput);
    const strictCloudRes = await executePlan({
      input: cleanInput,
      analysis: cleanAnalysis,
      device,
      network,
      models,
      decision: { ...forgedCloudDecision, privacyMode: 'STRICT_LOCAL' },
      plan: {
        planId: 'plan_forged_strict',
        route: 'CLOUD',
        steps: [
          {
            stepId: 's1',
            order: 1,
            stage: 'cloud_inference',
            locality: 'cloud',
            modelId: 'gemini-4-hydrogen',
            descriptionEn: 'Forged cloud',
            descriptionAr: 'سحابة',
          },
        ],
        sanitizedPrompt: cleanInput.prompt,
        redactionMap: {},
        redactedCount: 0,
        cloudPayloadBytes: 20,
      },
      language: 'en',
      localExecutor: { executeLocal: vi.fn(async () => ({ text: 'Unused' })) },
      cloudExecutor: cloudExec,
    });
    expect(strictCloudRes.status).toBe('blocked');
    expect(strictCloudRes.route).toBe('BLOCKED');
    expect(cloudExec.executeCloud).not.toHaveBeenCalled();
  });
});
