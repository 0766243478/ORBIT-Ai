import type { LanguageCode, LocalAvailabilityState } from '../engine/types';

interface ChromeLanguageModelSession {
  prompt(input: string): Promise<string>;
  destroy?: () => void;
}

interface ChromeLanguageModelGlobal {
  availability?: (options?: unknown) => Promise<LocalAvailabilityState>;
  create?: (options?: {
    initialPrompts?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
    monitor?: (m: {
      addEventListener: (event: string, cb: (e: { loaded: number }) => void) => void;
    }) => void;
  }) => Promise<ChromeLanguageModelSession>;
}

function getChromeLanguageModelApi(): ChromeLanguageModelGlobal | null {
  if (typeof globalThis === 'undefined') return null;
  const g = globalThis as unknown as {
    LanguageModel?: ChromeLanguageModelGlobal;
    ai?: { languageModel?: ChromeLanguageModelGlobal };
  };
  if (g.LanguageModel && typeof g.LanguageModel.availability === 'function') {
    return g.LanguageModel;
  }
  if (g.ai?.languageModel) {
    return g.ai.languageModel;
  }
  return null;
}

export async function probeChromeLocalModel(): Promise<{
  apiPresent: boolean;
  availability: LocalAvailabilityState;
  reason: string;
}> {
  const api = getChromeLanguageModelApi();
  if (!api) {
    return {
      apiPresent: false,
      availability: 'unavailable',
      reason:
        'Chrome Built-in Prompt API (globalThis.LanguageModel) is not exposed in this browser.',
    };
  }

  try {
    if (typeof api.availability === 'function') {
      const status = await api.availability({
        expectedInputs: [{ type: 'text', languages: ['en'] }],
        expectedOutputs: [{ type: 'text', languages: ['en'] }],
      });

      if (status === 'available') {
        return {
          apiPresent: true,
          availability: 'available',
          reason: 'On-device Gemini Nano weights are downloaded and ready.',
        };
      }
      if (status === 'downloadable') {
        return {
          apiPresent: true,
          availability: 'downloadable',
          reason:
            'Chrome Prompt API is present; Gemini Nano weights are downloadable (~1.7–4 GB).',
        };
      }
      if (status === 'downloading') {
        return {
          apiPresent: true,
          availability: 'downloading',
          reason: 'On-device Gemini Nano model download is currently in progress.',
        };
      }
      return {
        apiPresent: true,
        availability: 'unavailable',
        reason:
          'Chrome Prompt API is present, but on-device model reported unavailable (hardware/storage requirements unmet or flags disabled).',
      };
    }

    return {
      apiPresent: true,
      availability: 'unavailable',
      reason: 'Legacy window.ai.languageModel found without standard availability() probe.',
    };
  } catch (err) {
    return {
      apiPresent: true,
      availability: 'unavailable',
      reason: `Local model probe failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export async function triggerLocalModelDownload(
  onProgress: (loadedFraction: number) => void
): Promise<{ success: boolean; message: string }> {
  const api = getChromeLanguageModelApi();
  if (!api || typeof api.create !== 'function') {
    return {
      success: false,
      message: 'Chrome Prompt API is unavailable in this browser.',
    };
  }

  try {
    const session = await api.create({
      monitor(m) {
        m.addEventListener('downloadprogress', (e) => {
          if (typeof e?.loaded === 'number') {
            onProgress(e.loaded);
          }
        });
      },
    });
    session.destroy?.();
    return {
      success: true,
      message: 'On-device Gemini Nano model downloaded and ready.',
    };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

interface WarmSessionEntry {
  session: ChromeLanguageModelSession;
  systemKey: string;
  createdAtMs: number;
  lastUsedAtMs: number;
  reuseCount: number;
}

const WARM_SESSION_TTL_MS = 120_000;
let warmSessionEntry: WarmSessionEntry | null = null;
let warmIdleTimer: ReturnType<typeof setTimeout> | null = null;

function clearWarmIdleTimer(): void {
  if (warmIdleTimer !== null) {
    clearTimeout(warmIdleTimer);
    warmIdleTimer = null;
  }
}

export function releaseWarmLocalSession(): void {
  clearWarmIdleTimer();
  if (warmSessionEntry) {
    try {
      warmSessionEntry.session.destroy?.();
    } catch {
      // Ignore already-destroyed Chrome session errors
    }
    warmSessionEntry = null;
  }
}

export function getLocalSessionStats(): {
  hasWarmSession: boolean;
  reuseCount: number;
  ageMs: number | null;
} {
  if (!warmSessionEntry) {
    return { hasWarmSession: false, reuseCount: 0, ageMs: null };
  }
  return {
    hasWarmSession: true,
    reuseCount: warmSessionEntry.reuseCount,
    ageMs: Math.max(0, Date.now() - warmSessionEntry.createdAtMs),
  };
}

function scheduleWarmSessionEviction(): void {
  clearWarmIdleTimer();
  warmIdleTimer = setTimeout(() => {
    releaseWarmLocalSession();
  }, WARM_SESSION_TTL_MS);
}

export async function executeChromeLocalPrompt(params: {
  prompt: string;
  systemInstruction: string;
  language: LanguageCode;
  allowSessionCache?: boolean;
}): Promise<{
  text: string;
  inputTokens?: number;
  outputTokens?: number;
  sessionReused?: boolean;
  coldStartMs?: number;
  warmPromptMs?: number;
}> {
  const api = getChromeLanguageModelApi();
  if (!api || typeof api.create !== 'function') {
    throw new Error('On-device Chrome Prompt API is unavailable in this browser.');
  }

  const probe = await probeChromeLocalModel();
  if (probe.availability !== 'available') {
    throw new Error(`Local model is not ready (${probe.availability}): ${probe.reason}`);
  }

  const allowCache = params.allowSessionCache !== false;
  if (!allowCache) {
    releaseWarmLocalSession();
  }

  const nowFn = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const nowWall = Date.now();
  const isWarmHit =
    allowCache &&
    warmSessionEntry !== null &&
    warmSessionEntry.systemKey === params.systemInstruction &&
    nowWall - warmSessionEntry.lastUsedAtMs < WARM_SESSION_TTL_MS;

  let session: ChromeLanguageModelSession;
  let coldStartMs: number | undefined;
  let sessionReused = false;

  if (isWarmHit && warmSessionEntry) {
    session = warmSessionEntry.session;
    sessionReused = true;
  } else {
    releaseWarmLocalSession();
    const tCreate = nowFn();
    session = await api.create({
      initialPrompts: [{ role: 'system', content: params.systemInstruction }],
    });
    coldStartMs = Math.max(1, Math.round(nowFn() - tCreate));

    if (allowCache) {
      warmSessionEntry = {
        session,
        systemKey: params.systemInstruction,
        createdAtMs: nowWall,
        lastUsedAtMs: nowWall,
        reuseCount: 0,
      };
    }
  }

  const runPrompt = async (activeSession: ChromeLanguageModelSession) => {
    const tPrompt = nowFn();
    const text = await activeSession.prompt(params.prompt);
    const warmPromptMs = Math.max(1, Math.round(nowFn() - tPrompt));
    return { text, warmPromptMs };
  };

  try {
    let text: string;
    let warmPromptMs: number;

    try {
      const res = await runPrompt(session);
      text = res.text;
      warmPromptMs = res.warmPromptMs;
    } catch (err) {
      // If a cached session became detached/invalid, transparently recreate once
      if (!sessionReused) throw err;
      releaseWarmLocalSession();
      sessionReused = false;
      const tRecreate = nowFn();
      const freshSession = await api.create({
        initialPrompts: [{ role: 'system', content: params.systemInstruction }],
      });
      coldStartMs = Math.max(1, Math.round(nowFn() - tRecreate));
      if (allowCache) {
        warmSessionEntry = {
          session: freshSession,
          systemKey: params.systemInstruction,
          createdAtMs: Date.now(),
          lastUsedAtMs: Date.now(),
          reuseCount: 0,
        };
      }
      session = freshSession;
      const retryRes = await runPrompt(freshSession);
      text = retryRes.text;
      warmPromptMs = retryRes.warmPromptMs;
    }

    if (allowCache && warmSessionEntry && warmSessionEntry.session === session) {
      warmSessionEntry.lastUsedAtMs = Date.now();
      if (sessionReused) {
        warmSessionEntry.reuseCount += 1;
      }
      scheduleWarmSessionEviction();
    } else {
      session.destroy?.();
    }

    return {
      text,
      inputTokens: Math.ceil(params.prompt.length / 4),
      outputTokens: Math.ceil(text.length / 4),
      sessionReused,
      coldStartMs,
      warmPromptMs,
    };
  } catch (err) {
    if (!allowCache) {
      try {
        session.destroy?.();
      } catch {
        // Ignore cleanup errors
      }
    } else {
      releaseWarmLocalSession();
    }
    throw err;
  }
}
