import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  analyzeTask,
  BENCHMARK_ONLINE_NETWORK,
  buildModelRegistry,
  classifyDeviceTier,
  decideRoute,
  DEFAULT_CUSTOM_PREFERENCES,
  LatencyCalibrator,
  OrbitEngine,
  SYNTHETIC_DEVICE_TIERS,
  type CloudRuntimeExecutor,
  type DeviceProbe,
  type LocalRuntimeExecutor,
  type NetworkProbe,
} from '../src/engine';
import {
  executeChromeLocalPrompt,
  getLocalSessionStats,
  releaseWarmLocalSession,
} from '../src/services/localInference';

describe('Phase 3 OAIE Upgrades: Device Tiers, Session Reuse, Calibration & Arabic/PII Fixes', () => {
  afterEach(() => {
    releaseWarmLocalSession();
    delete (globalThis as Record<string, unknown>).LanguageModel;
  });

  it('classifies 2GB, 3-4GB, 6GB, and 8+GB profiles distinctly and gates entry context size', () => {
    const t2 = classifyDeviceTier(2, 2, false, 450);
    const t4 = classifyDeviceTier(4, 4, true, 6000);
    const t6 = classifyDeviceTier(6, 6, true, 24000);
    const t16 = classifyDeviceTier(16, 8, true, 80000);

    expect(t2.deviceTier).toBe('low_2gb');
    expect(t2.allowWarmSessionCache).toBe(false);
    expect(t4.deviceTier).toBe('entry_3_4gb');
    expect(t4.recommendedMaxLocalTokens).toBe(1536);
    expect(t4.allowWarmSessionCache).toBe(false);
    expect(t6.deviceTier).toBe('mid_6gb');
    expect(t6.recommendedMaxLocalTokens).toBe(3072);
    expect(t6.allowWarmSessionCache).toBe(true);
    expect(t16.deviceTier).toBe('high_8gb_plus');
    expect(t16.recommendedMaxLocalTokens).toBe(4096);

    // A 2,000-token summarization prompt exceeds entry 4GB cap (1,536 tokens) so it offloads to CLOUD,
    // while mid 6GB (3,072 cap) keeps it LOCAL.
    const longSummary = analyzeTask({
      prompt: 'Summarize these notes: ' + 'detail '.repeat(1450),
    });
    expect(longSummary.estimatedInputTokens).toBeGreaterThan(1536);
    expect(longSummary.estimatedInputTokens).toBeLessThan(3072);

    const entryDevice = SYNTHETIC_DEVICE_TIERS[1].device;
    const midDevice = SYNTHETIC_DEVICE_TIERS[2].device;

    const entryDecision = decideRoute({
      analysis: longSummary,
      device: entryDevice,
      network: BENCHMARK_ONLINE_NETWORK,
      models: buildModelRegistry({
        device: entryDevice,
        network: BENCHMARK_ONLINE_NETWORK,
        cloudGeminiConfigured: true,
        firebaseAiLogicConfigured: false,
      }),
      privacyMode: 'BALANCED',
      customPreferences: DEFAULT_CUSTOM_PREFERENCES,
    });
    expect(entryDecision.selectedRoute).toBe('CLOUD');

    const midDecision = decideRoute({
      analysis: longSummary,
      device: midDevice,
      network: BENCHMARK_ONLINE_NETWORK,
      models: buildModelRegistry({
        device: midDevice,
        network: BENCHMARK_ONLINE_NETWORK,
        cloudGeminiConfigured: true,
        firebaseAiLogicConfigured: false,
      }),
      privacyMode: 'BALANCED',
      customPreferences: DEFAULT_CUSTOM_PREFERENCES,
    });
    expect(midDecision.selectedRoute).toBe('LOCAL');
  });

  it('reuses warm LanguageModel session on 6GB/8+GB profiles and destroys immediately when allowSessionCache=false', async () => {
    const destroyMock = vi.fn();
    const promptMock = vi.fn(async (p: string) => `Reply to: ${p}`);
    const createMock = vi.fn(async () => ({
      prompt: promptMock,
      destroy: destroyMock,
    }));

    (globalThis as Record<string, unknown>).LanguageModel = {
      availability: vi.fn(async () => 'available'),
      create: createMock,
    };

    // High-RAM: cold create once, then warm reuse
    const r1 = await executeChromeLocalPrompt({
      prompt: 'First turn',
      systemInstruction: 'System A',
      language: 'en',
      allowSessionCache: true,
    });
    expect(r1.sessionReused).toBe(false);
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(destroyMock).toHaveBeenCalledTimes(0);

    const r2 = await executeChromeLocalPrompt({
      prompt: 'Second turn',
      systemInstruction: 'System A',
      language: 'en',
      allowSessionCache: true,
    });
    expect(r2.sessionReused).toBe(true);
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(getLocalSessionStats().reuseCount).toBe(1);

    // Entry 3-4GB: allowSessionCache=false releases session immediately to protect RAM
    const r3 = await executeChromeLocalPrompt({
      prompt: 'Entry tier turn',
      systemInstruction: 'System A',
      language: 'en',
      allowSessionCache: false,
    });
    expect(r3.sessionReused).toBe(false);
    expect(destroyMock).toHaveBeenCalledTimes(2); // evicted old warm + destroyed entry session
    expect(getLocalSessionStats().hasWarmSession).toBe(false);
  });

  it('fixes Arabic Unicode boundary classification, coding detection, and Bearer JWT / intl phone PII detection', () => {
    const arTrans = analyzeTask({
      prompt: 'ترجم هذه الجملة إلى الإنجليزية: يعمل محرك الذكاء التكيفي بمرونة.',
      language: 'ar',
    });
    expect(arTrans.taskType).toBe('translation');

    const arCodingWithTranslationWord = analyzeTask({
      prompt: 'أصلح هذا الخطأ البرمجي في كود React عند ترجمة الواجهة.',
      language: 'ar',
    });
    expect(arCodingWithTranslationWord.taskType).toBe('coding_technical');

    const nlCode = analyzeTask({
      prompt: 'How do I debounce search input updates cleanly in my web app?',
    });
    expect(nlCode.taskType).toBe('coding_technical');

    const pii = analyzeTask({
      prompt: 'Call +971 50 123 4567 with Authorization Bearer eyJhbGciOiJIUzI1NiJ9.payload12345.sig9988',
    });
    expect(pii.containsPii).toBe(true);
    expect(pii.piiSpans.some((s) => s.type === 'phone')).toBe(true);
    expect(pii.piiSpans.some((s) => s.type === 'secret_token')).toBe(true);
  });

  it('adapts latency predictions monotonically via EWMA LatencyCalibrator inside OrbitEngine', async () => {
    const calibrator = new LatencyCalibrator(0.5);
    calibrator.recordObservation({
      modelId: 'chrome-gemini-nano',
      actualLatencyMs: 950,
      outputTokens: 200,
    });
    const stats = calibrator.getStats('chrome-gemini-nano');
    expect(stats?.samples).toBe(1);
    expect(stats?.ewmaLatencyMs).toBe(950);

    const deviceProbe: DeviceProbe = {
      getHardwareInfo: () => ({
        platform: 'web',
        browserName: 'Chrome',
        deviceMemoryGb: 8,
        hardwareConcurrency: 8,
        webGpuAvailable: true,
      }),
      getStorageQuotaMb: async () => 30000,
      getLocalModelStatus: async () => ({
        apiPresent: true,
        availability: 'available',
        reason: 'Ready',
      }),
    };
    const networkProbe: NetworkProbe = {
      getConnectionInfo: () => ({
        online: true,
        effectiveType: '4g',
        rttMs: 40,
        downlinkMbps: 50,
        saveData: false,
      }),
      checkCloudReachability: async () => ({ reachable: true, latencyMs: 45 }),
    };
    const localExec: LocalRuntimeExecutor = {
      executeLocal: vi.fn(async () => ({
        text: 'Fast warm local output.',
        outputTokens: 220,
        sessionReused: true,
      })),
    };
    const cloudExec: CloudRuntimeExecutor = {
      executeCloud: vi.fn(async () => ({ text: 'Unused', providerUsed: 'server-gemini' })),
    };

    const engine = new OrbitEngine({
      deviceProbe,
      networkProbe,
      localExecutor: localExec,
      cloudExecutor: cloudExec,
      cloudGeminiConfigured: true,
      firebaseAiLogicConfigured: false,
    });

    const beforeSim = await engine.simulateDecision({
      input: { prompt: 'Define TLS briefly.' },
      privacyMode: 'BALANCED',
    });
    const staticEstimate = beforeSim.decision.estimatedLatencyMs;

    await engine.runTask({
      input: { prompt: 'Define TLS briefly.' },
      privacyMode: 'BALANCED',
      language: 'en',
    });

    const afterSim = await engine.simulateDecision({
      input: { prompt: 'Define TLS briefly.' },
      privacyMode: 'BALANCED',
    });
    expect(engine.getCalibrationSnapshot()['chrome-gemini-nano']?.samples).toBe(1);
    expect(afterSim.decision.estimatedLatencyMs).toBeLessThan(staticEstimate);
  });
});
