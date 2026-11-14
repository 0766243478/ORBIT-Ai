import { describe, expect, it, vi } from 'vitest';
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
  pickBestCloudModel,
  REPRESENTATIVE_BENCHMARK_TASKS,
  SYNTHETIC_DEVICE_TIERS,
  type CloudRuntimeExecutor,
  type DeviceCapabilityProfile,
  type DeviceProbe,
  type LocalRuntimeExecutor,
  type NetworkProbe,
  type NetworkStatusSnapshot,
  type PrivacyMode,
} from '../src/engine';

function makeProbePair(
  device: DeviceCapabilityProfile,
  network: NetworkStatusSnapshot
): { deviceProbe: DeviceProbe; networkProbe: NetworkProbe } {
  return {
    deviceProbe: {
      getHardwareInfo: () => ({
        platform: device.platform,
        browserName: device.browserName,
        deviceMemoryGb: device.deviceMemoryGb,
        hardwareConcurrency: device.hardwareConcurrency,
        webGpuAvailable: device.webGpuAvailable,
      }),
      getStorageQuotaMb: async () => device.storageQuotaMb,
      getLocalModelStatus: async () => ({
        apiPresent: device.localApiPresent,
        availability: device.localModelAvailability,
        reason: device.localModelReason,
      }),
    },
    networkProbe: {
      getConnectionInfo: () => ({
        online: network.online,
        effectiveType: network.effectiveType,
        rttMs: network.rttMs,
        downlinkMbps: network.downlinkMbps,
        saveData: network.saveData,
      }),
      checkCloudReachability: async () => ({
        reachable: network.cloudReachable,
        latencyMs: network.cloudHealthLatencyMs,
      }),
    },
  };
}

describe('Phase 6 — Adaptive Routing, Context-Aware Privacy, Network-Aware Cloud Model & Explainability', () => {
  const highDevice = SYNTHETIC_DEVICE_TIERS[3].device;
  const highDeviceNoLocal: DeviceCapabilityProfile = {
    ...highDevice,
    localApiPresent: false,
    localModelAvailability: 'unavailable',
    localModelReason: 'Simulated missing Chrome Prompt API',
  };

  describe('1. Principled BALANCED Routing Policy', () => {
    it('offloads non-sensitive task to CLOUD in BALANCED when >=3 reliable samples show local=22s vs cloud=450ms', () => {
      const cal = new LatencyCalibrator(0.35);
      for (let i = 0; i < 6; i++) {
        cal.recordObservation({
          modelId: 'chrome-gemini-nano',
          actualLatencyMs: 22_000,
          outputTokens: 200,
          measurementSource: 'synthetic_or_mock',
        });
        cal.recordObservation({
          modelId: 'gemini-3.1-flash-lite',
          actualLatencyMs: 450,
          outputTokens: 200,
          measurementSource: 'synthetic_or_mock',
        });
      }

      const analysis = analyzeTask({ prompt: 'Briefly explain TLS handshakes.' });
      const models = buildModelRegistry({
        device: highDevice,
        network: BENCHMARK_ONLINE_NETWORK,
        cloudGeminiConfigured: true,
        firebaseAiLogicConfigured: false,
      });

      const decision = decideRoute({
        analysis,
        device: highDevice,
        network: BENCHMARK_ONLINE_NETWORK,
        models,
        privacyMode: 'BALANCED',
        customPreferences: DEFAULT_CUSTOM_PREFERENCES,
        calibrationByModel: cal.snapshot(),
      });

      expect(decision.selectedRoute).toBe('CLOUD');
      expect(decision.constraints.some((c) => c.id === 'balanced-performance-offload')).toBe(true);
      expect(decision.explainability?.rejectedAlternatives.some((a) => a.route === 'LOCAL')).toBe(true);
    });

    it('preserves LOCAL when privacy sensitivity is present despite 22s vs 450ms latency, and explains why privacy overrode performance', () => {
      const cal = new LatencyCalibrator(0.35);
      for (let i = 0; i < 6; i++) {
        cal.recordObservation({
          modelId: 'chrome-gemini-nano',
          actualLatencyMs: 22_000,
          outputTokens: 200,
        });
        cal.recordObservation({
          modelId: 'gemini-3.1-flash-lite',
          actualLatencyMs: 450,
          outputTokens: 200,
        });
      }

      const sensitive = analyzeTask({
        prompt: 'Summarize my confidential medical diagnosis and salary sheet.',
      });
      const models = buildModelRegistry({
        device: highDevice,
        network: BENCHMARK_ONLINE_NETWORK,
        cloudGeminiConfigured: true,
        firebaseAiLogicConfigured: false,
      });

      const decision = decideRoute({
        analysis: sensitive,
        device: highDevice,
        network: BENCHMARK_ONLINE_NETWORK,
        models,
        privacyMode: 'BALANCED',
        customPreferences: DEFAULT_CUSTOM_PREFERENCES,
        calibrationByModel: cal.snapshot(),
      });

      expect(decision.selectedRoute).toBe('LOCAL');
      expect(decision.constraints.some((c) => c.id === 'privacy-overrides-performance')).toBe(true);

      // STRICT_LOCAL must also stay LOCAL (or BLOCKED if local unavailable) with zero cloud permitted
      const strictDecision = decideRoute({
        analysis: analyzeTask({ prompt: 'Briefly explain TLS handshakes.' }),
        device: highDevice,
        network: BENCHMARK_ONLINE_NETWORK,
        models,
        privacyMode: 'STRICT_LOCAL',
        customPreferences: DEFAULT_CUSTOM_PREFERENCES,
        calibrationByModel: cal.snapshot(),
      });
      expect(strictDecision.selectedRoute).toBe('LOCAL');
    });

    it('refuses to switch BALANCED routes on insufficient (<3 samples) or high-variance noisy measurements', () => {
      // Case A: Insufficient telemetry (2 samples = 22s)
      const sparseCal = new LatencyCalibrator(0.35);
      sparseCal.recordObservation({ modelId: 'chrome-gemini-nano', actualLatencyMs: 22_000, outputTokens: 200 });
      sparseCal.recordObservation({ modelId: 'chrome-gemini-nano', actualLatencyMs: 22_000, outputTokens: 200 });

      const analysis = analyzeTask({ prompt: 'Briefly explain TLS handshakes.' });
      const models = buildModelRegistry({
        device: highDevice,
        network: BENCHMARK_ONLINE_NETWORK,
        cloudGeminiConfigured: true,
        firebaseAiLogicConfigured: false,
      });

      const sparseDecision = decideRoute({
        analysis,
        device: highDevice,
        network: BENCHMARK_ONLINE_NETWORK,
        models,
        privacyMode: 'BALANCED',
        customPreferences: DEFAULT_CUSTOM_PREFERENCES,
        calibrationByModel: sparseCal.snapshot(),
      });
      expect(sparseDecision.selectedRoute).toBe('LOCAL');
      expect(sparseDecision.constraints.some((c) => c.id === 'insufficient-telemetry-stability')).toBe(true);

      // Case B: High-variance noisy spikes [400ms, 35000ms, 500ms, 34000ms]
      const noisyCal = new LatencyCalibrator(0.35);
      for (const ms of [400, 35_000, 500, 34_000]) {
        noisyCal.recordObservation({ modelId: 'chrome-gemini-nano', actualLatencyMs: ms, outputTokens: 200 });
      }
      const noisyDecision = decideRoute({
        analysis,
        device: highDevice,
        network: BENCHMARK_ONLINE_NETWORK,
        models,
        privacyMode: 'BALANCED',
        customPreferences: DEFAULT_CUSTOM_PREFERENCES,
        calibrationByModel: noisyCal.snapshot(),
      });
      expect(noisyDecision.selectedRoute).toBe('LOCAL');
      expect(noisyDecision.constraints.some((c) => c.id === 'insufficient-telemetry-stability')).toBe(true);
    });

    it('holds LOCAL on slow-2g or offline networks and preserves deterministic repeatability across invocations', () => {
      const cal = new LatencyCalibrator(0.35);
      for (let i = 0; i < 6; i++) {
        cal.recordObservation({ modelId: 'chrome-gemini-nano', actualLatencyMs: 14_000, outputTokens: 200 });
        cal.recordObservation({ modelId: 'gemini-3.1-flash-lite', actualLatencyMs: 450, outputTokens: 200 });
      }

      const analysis = analyzeTask({ prompt: 'Define DNS caching briefly.' });

      for (const net of [BENCHMARK_SLOW_NETWORK, BENCHMARK_OFFLINE_NETWORK]) {
        const models = buildModelRegistry({
          device: highDevice,
          network: net,
          cloudGeminiConfigured: true,
          firebaseAiLogicConfigured: false,
        });
        const decision = decideRoute({
          analysis,
          device: highDevice,
          network: net,
          models,
          privacyMode: 'BALANCED',
          customPreferences: DEFAULT_CUSTOM_PREFERENCES,
          calibrationByModel: cal.snapshot(),
        });
        expect(decision.selectedRoute).toBe('LOCAL');
      }

      // Repeated decision consistency (10 identical calls)
      const modelsOnline = buildModelRegistry({
        device: highDevice,
        network: BENCHMARK_ONLINE_NETWORK,
        cloudGeminiConfigured: true,
        firebaseAiLogicConfigured: false,
      });
      const baseline = decideRoute({
        analysis,
        device: highDevice,
        network: BENCHMARK_ONLINE_NETWORK,
        models: modelsOnline,
        privacyMode: 'BALANCED',
        customPreferences: DEFAULT_CUSTOM_PREFERENCES,
        calibrationByModel: cal.snapshot(),
      });
      for (let i = 0; i < 10; i++) {
        const next = decideRoute({
          analysis,
          device: highDevice,
          network: BENCHMARK_ONLINE_NETWORK,
          models: modelsOnline,
          privacyMode: 'BALANCED',
          customPreferences: DEFAULT_CUSTOM_PREFERENCES,
          calibrationByModel: cal.snapshot(),
        });
        expect(next.selectedRoute).toBe(baseline.selectedRoute);
        expect(next.selectedCloudModelId).toBe(baseline.selectedCloudModelId);
        expect(next.routeScores).toEqual(baseline.routeScores);
      }
    });

    it('never leaks sensitive prompts across any privacy mode even with 22s local telemetry', async () => {
      const modes: PrivacyMode[] = ['STRICT_LOCAL', 'BALANCED', 'FLEXIBLE', 'CUSTOM'];
      for (const mode of modes) {
        const cloudExec: CloudRuntimeExecutor = {
          executeCloud: vi.fn(async () => ({
            text: 'MUST NOT EXECUTE UNREDACTED',
            providerUsed: 'server-gemini',
          })),
        };
        const localExec: LocalRuntimeExecutor = {
          executeLocal: vi.fn(async () => ({ text: 'Local OK', outputTokens: 50 })),
        };
        const { deviceProbe, networkProbe } = makeProbePair(highDeviceNoLocal, BENCHMARK_ONLINE_NETWORK);
        const engine = new OrbitEngine({
          deviceProbe,
          networkProbe,
          localExecutor: localExec,
          cloudExecutor: cloudExec,
          cloudGeminiConfigured: true,
          firebaseAiLogicConfigured: false,
        });

        const res = await engine.runTask({
          input: { prompt: 'My salary is 14,500 SAR and my medical diagnosis is urgent.' },
          privacyMode: mode,
          customPreferences: DEFAULT_CUSTOM_PREFERENCES,
          language: 'en',
        });
        expect(res.route).toBe('BLOCKED');
        expect(cloudExec.executeCloud).not.toHaveBeenCalled();
      }
    });
  });

  describe('2. Context-Aware Privacy Classification (English, Arabic & Eastern Arabic Numerals)', () => {
    it('allows educational and conceptual discussions cleanly to CLOUD without false-positive blocks', async () => {
      const conceptualPrompts: Array<{ prompt: string; lang: 'en' | 'ar' }> = [
        { prompt: 'Explain confidential payroll architecture.', lang: 'en' },
        { prompt: 'How does medical data protection work?', lang: 'en' },
        { prompt: 'What is salary privacy?', lang: 'en' },
        { prompt: 'Explain general privacy threat modeling for confidential payroll systems.', lang: 'en' },
        { prompt: 'اشرح كيف تعمل حماية البيانات الطبية وخصوصية الرواتب نظرياً.', lang: 'ar' },
        { prompt: 'ما هي مبادئ أمن المعلومات وتشفير السجلات السرية؟', lang: 'ar' },
      ];

      for (const item of conceptualPrompts) {
        const analysis = analyzeTask({ prompt: item.prompt, language: item.lang });
        expect(analysis.containsPii).toBe(false);
        expect(analysis.hasSensitiveKeywords).toBe(false);
        expect(analysis.conceptualSecurityDiscussion).toBe(true);

        const models = buildModelRegistry({
          device: highDeviceNoLocal,
          network: BENCHMARK_ONLINE_NETWORK,
          cloudGeminiConfigured: true,
          firebaseAiLogicConfigured: false,
        });
        const decision = decideRoute({
          analysis,
          device: highDeviceNoLocal,
          network: BENCHMARK_ONLINE_NETWORK,
          models,
          privacyMode: 'BALANCED',
          customPreferences: DEFAULT_CUSTOM_PREFERENCES,
        });
        expect(decision.selectedRoute).toBe('CLOUD');
        const plan = buildExecutionPlan({
          input: { prompt: item.prompt, language: item.lang },
          analysis,
          decision,
        });
        expect(plan.route).toBe('CLOUD');
      }
    });

    it('strictly blocks or redacts actual personal disclosures in English, Arabic, and Eastern Arabic numerals', async () => {
      // Unredacted personal disclosures -> MUST fail closed (BLOCKED when local unavailable)
      const personalDisclosures = [
        'My salary is 12,000 SAR per month.',
        'My salary is confidential.',
        'My patient ID is stored on the private sheet below.',
        'Review this confidential medical diagnosis and salary compensation report.',
        'راتبي هو ٨٥٠٠ ريال ورقم المريض الخاص بي ٩٩١٨٢.',
        'تشخيصي الطبي في هذا التقرير السري مع تفاصيل الراتب.',
      ];

      for (const prompt of personalDisclosures) {
        const analysis = analyzeTask({ prompt });
        expect(analysis.containsPii).toBe(true);
        const models = buildModelRegistry({
          device: highDeviceNoLocal,
          network: BENCHMARK_ONLINE_NETWORK,
          cloudGeminiConfigured: true,
          firebaseAiLogicConfigured: false,
        });
        const decision = decideRoute({
          analysis,
          device: highDeviceNoLocal,
          network: BENCHMARK_ONLINE_NETWORK,
          models,
          privacyMode: 'FLEXIBLE',
          customPreferences: DEFAULT_CUSTOM_PREFERENCES,
        });
        expect(decision.selectedRoute).toBe('BLOCKED');
      }

      // Structured Eastern Arabic national ID + secret token -> extracts spans & redacts in HYBRID
      const structuredArabicPrompt =
        'أرسل إشعار الهوية الوطنية: ٢٩٢٠١٠١١٢٣٤٥٦٧ مع كلمة المرور: TestAr#2026 إلى team@orbit.dev';
      const cloudCaptures: string[] = [];
      const { deviceProbe, networkProbe } = makeProbePair(highDeviceNoLocal, BENCHMARK_ONLINE_NETWORK);
      const engine = new OrbitEngine({
        deviceProbe,
        networkProbe,
        localExecutor: { executeLocal: vi.fn(async () => ({ text: 'Unused' })) },
        cloudExecutor: {
          executeCloud: vi.fn(async ({ prompt }) => {
            cloudCaptures.push(prompt);
            return { text: 'تمت المعالجة لـ [EMAIL_1] والهوية [ID_1].', providerUsed: 'server-gemini' };
          }),
        },
        cloudGeminiConfigured: true,
        firebaseAiLogicConfigured: false,
      });

      const hybridRes = await engine.runTask({
        input: { prompt: structuredArabicPrompt, language: 'ar' },
        privacyMode: 'BALANCED',
        customPreferences: DEFAULT_CUSTOM_PREFERENCES,
        language: 'ar',
      });
      expect(hybridRes.status).toBe('success');
      expect(hybridRes.route).toBe('HYBRID');
      expect(cloudCaptures[0]).not.toContain('٢٩٢٠١٠١١٢٣٤٥٦٧');
      expect(cloudCaptures[0]).not.toContain('TestAr#2026');
      expect(cloudCaptures[0]).not.toContain('team@orbit.dev');
      expect(hybridRes.outputText).toContain('٢٩٢٠١٠١١٢٣٤٥٦٧');
    });
  });

  describe('3. Network-Aware & Failure-Aware Cloud Model Selection', () => {
    it('selects different cloud models across fast 4G vs slow 2G/Save-Data networks and elevated failure rates', () => {
      const arabicTranslation = analyzeTask(REPRESENTATIVE_BENCHMARK_TASKS[4].input);
      const codingTask = analyzeTask(REPRESENTATIVE_BENCHMARK_TASKS[5].input);

      // Fast 4G: Arabic medium translation selects high-quality gemini-4-hydrogen
      const fastModels = buildModelRegistry({
        device: highDeviceNoLocal,
        network: BENCHMARK_ONLINE_NETWORK,
        cloudGeminiConfigured: true,
        firebaseAiLogicConfigured: false,
      });
      const on4g = pickBestCloudModel(
        fastModels,
        arabicTranslation,
        false,
        BENCHMARK_ONLINE_NETWORK,
        'BALANCED'
      );
      expect(on4g.selected?.id).toBe('gemini-4-hydrogen');

      // Slow 2G + Save-Data: switches to compact economical gemini-3.1-flash-lite
      const slowModels = buildModelRegistry({
        device: highDeviceNoLocal,
        network: BENCHMARK_SLOW_NETWORK,
        cloudGeminiConfigured: true,
        firebaseAiLogicConfigured: false,
      });
      const on2g = pickBestCloudModel(
        slowModels,
        arabicTranslation,
        false,
        BENCHMARK_SLOW_NETWORK,
        'BALANCED'
      );
      expect(on2g.selected?.id).toBe('gemini-3.1-flash-lite');

      // Coding task requires gemini-4-hydrogen capability -> NEVER downgrades just for latency/2G
      const codingOn2g = pickBestCloudModel(
        slowModels,
        codingTask,
        true,
        BENCHMARK_SLOW_NETWORK,
        'BALANCED'
      );
      expect(codingOn2g.selected?.id).toBe('gemini-4-hydrogen');

      // High failure rate (3 errors, 1 success = 75% failure) on gemini-4-hydrogen demotes it on dual-supported summarization
      const summaryTask = analyzeTask(REPRESENTATIVE_BENCHMARK_TASKS[1].input);
      const failureCal = new LatencyCalibrator(0.35);
      failureCal.recordObservation({ modelId: 'gemini-4-hydrogen', actualLatencyMs: 600, outputTokens: 400 });
      failureCal.recordFailure({ modelId: 'gemini-4-hydrogen' });
      failureCal.recordFailure({ modelId: 'gemini-4-hydrogen' });
      failureCal.recordFailure({ modelId: 'gemini-4-hydrogen' });

      const reliabilitySwitch = pickBestCloudModel(
        fastModels,
        summaryTask,
        false,
        BENCHMARK_ONLINE_NETWORK,
        'FLEXIBLE',
        null,
        failureCal.snapshot()
      );
      expect(reliabilitySwitch.selected?.id).toBe('gemini-3.1-flash-lite');
    });
  });

  describe('4. Decision Explainability & Measurement Provenance', () => {
    it('exposes structured explainability with truthful simulated vs unavailable hardware/calibration provenance', () => {
      const analysis = analyzeTask({ prompt: 'Summarize edge routing concepts.' });
      const models = buildModelRegistry({
        device: highDevice,
        network: BENCHMARK_ONLINE_NETWORK,
        cloudGeminiConfigured: true,
        firebaseAiLogicConfigured: false,
      });

      const decision = decideRoute({
        analysis,
        device: highDevice,
        network: BENCHMARK_ONLINE_NETWORK,
        models,
        privacyMode: 'BALANCED',
        customPreferences: DEFAULT_CUSTOM_PREFERENCES,
      });

      expect(decision.explainability).toBeDefined();
      expect(decision.explainability?.selectedRoute).toBe('LOCAL');
      expect(decision.explainability?.selectedModelId).toBe('chrome-gemini-nano');
      expect(decision.explainability?.selectedProvider).toBe('chrome-prompt-api');
      expect(decision.explainability?.mainReasonsEn.length).toBeGreaterThan(0);
      expect(decision.explainability?.rejectedAlternatives).toHaveLength(2);
      expect(decision.explainability?.measurements.hardwareSpecs).toBe('simulated');
      expect(decision.explainability?.measurements.latencyCalibration).toBe('unavailable');

      // Browser with hidden deviceMemory & unknown connection -> honestly lowers telemetry certainty and records unavailable signals
      const privacyBrowserDevice: DeviceCapabilityProfile = {
        platform: 'web',
        browserName: 'Apple Safari',
        deviceMemoryGb: null,
        hardwareConcurrency: null,
        webGpuAvailable: false,
        storageQuotaMb: null,
        localApiPresent: false,
        localModelAvailability: 'unavailable',
        localModelReason: 'Safari lacks Prompt API',
        resourceConstrained: false,
        constraintReasons: [],
      };
      const unknownNet: NetworkStatusSnapshot = {
        online: true,
        effectiveType: 'unknown',
        rttMs: null,
        downlinkMbps: null,
        saveData: false,
        cloudReachable: true,
        cloudHealthLatencyMs: 60,
      };
      const safariModels = buildModelRegistry({
        device: privacyBrowserDevice,
        network: unknownNet,
        cloudGeminiConfigured: true,
        firebaseAiLogicConfigured: false,
      });
      const safariDecision = decideRoute({
        analysis,
        device: privacyBrowserDevice,
        network: unknownNet,
        models: safariModels,
        privacyMode: 'BALANCED',
        customPreferences: DEFAULT_CUSTOM_PREFERENCES,
      });

      expect(safariDecision.explainability?.selectedRoute).toBe('CLOUD');
      expect(safariDecision.explainability?.measurements.hardwareSpecs).toBe('unavailable');
      expect(safariDecision.explainability?.measurements.localRuntime).toBe('unavailable');
      expect(safariDecision.explainability?.measurements.networkTelemetry).toBe('partial');
      expect(safariDecision.explainability?.confidence.unreliableSignals).toContain(
        'navigator.deviceMemory unavailable'
      );
    });
  });
});
