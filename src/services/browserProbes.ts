import {
  OrbitEngine,
  type CloudRuntimeExecutor,
  type DeviceProbe,
  type LocalRuntimeExecutor,
  type NetworkProbe,
} from '../engine';
import { auth, getAppCheckTokenSafe } from './firebase';
import {
  executeViaFirebaseAiLogicCloud,
  getPreferredCloudBackendMode,
  isFirebaseAiLogicConfigured,
} from './firebaseAI';
import { executeChromeLocalPrompt, probeChromeLocalModel } from './localInference';

function detectBrowserName(): string {
  if (typeof navigator === 'undefined') return 'Unknown';
  const ua = navigator.userAgent;
  if (ua.includes('Edg/')) return 'Microsoft Edge';
  if (ua.includes('Chrome/')) return 'Google Chrome';
  if (ua.includes('Firefox/')) return 'Mozilla Firefox';
  if (ua.includes('Safari/') && !ua.includes('Chrome/')) return 'Apple Safari';
  return 'Web Browser';
}

export const browserDeviceProbe: DeviceProbe = {
  getHardwareInfo() {
    if (typeof navigator === 'undefined') {
      return {
        platform: 'web',
        browserName: 'Unknown',
        deviceMemoryGb: null,
        hardwareConcurrency: null,
        webGpuAvailable: false,
      };
    }

    const nav = navigator as Navigator & {
      deviceMemory?: number;
      gpu?: unknown;
    };

    const isMobile =
      typeof window !== 'undefined' &&
      /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

    return {
      platform: isMobile ? 'mobile-web' : 'web',
      browserName: detectBrowserName(),
      deviceMemoryGb: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null,
      hardwareConcurrency:
        typeof navigator.hardwareConcurrency === 'number'
          ? navigator.hardwareConcurrency
          : null,
      webGpuAvailable: Boolean(nav.gpu),
    };
  },

  async getStorageQuotaMb() {
    if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
      return null;
    }
    try {
      const est = await navigator.storage.estimate();
      if (typeof est.quota === 'number') {
        return Math.round(est.quota / (1024 * 1024));
      }
      return null;
    } catch {
      return null;
    }
  },

  async getLocalModelStatus() {
    return probeChromeLocalModel();
  },
};

export interface ServerHealthSnapshot {
  ok: boolean;
  geminiConfigured: boolean;
  authRequired: boolean;
  appCheckEnforced: boolean;
  latencyMs: number | null;
  activeCloudBackend: 'server-gemini' | 'firebase-ai-logic' | 'none';
}

let lastHealthCache: { at: number; data: ServerHealthSnapshot } | null = null;

export async function probeServerHealth(force = false): Promise<ServerHealthSnapshot> {
  const now = Date.now();
  if (!force && lastHealthCache && now - lastHealthCache.at < 8000) {
    return lastHealthCache.data;
  }

  const preferredMode = getPreferredCloudBackendMode();
  const firebaseAiEnabled = isFirebaseAiLogicConfigured();

  if (preferredMode === 'firebase-ai-logic') {
    const data: ServerHealthSnapshot = {
      ok: false,
      geminiConfigured: false,
      authRequired: false,
      appCheckEnforced: false,
      latencyMs: null,
      activeCloudBackend: firebaseAiEnabled ? 'firebase-ai-logic' : 'none',
    };
    lastHealthCache = { at: now, data };
    return data;
  }

  const start = performance.now();
  try {
    const res = await fetch('/api/health', { method: 'GET' });
    const latencyMs = Math.round(performance.now() - start);
    const contentType = res.headers.get('content-type') || '';

    // Static Firebase Hosting rewrites unknown routes to index.html (text/html).
    // Verify JSON response so static SPA hosting does not masquerade as Express backend.
    if (!res.ok || !contentType.includes('application/json')) {
      const data: ServerHealthSnapshot = {
        ok: false,
        geminiConfigured: false,
        authRequired: false,
        appCheckEnforced: false,
        latencyMs,
        activeCloudBackend:
          preferredMode === 'auto' && firebaseAiEnabled ? 'firebase-ai-logic' : 'none',
      };
      lastHealthCache = { at: now, data };
      return data;
    }

    const json = (await res.json()) as {
      ok?: boolean;
      geminiConfigured?: boolean;
      authRequired?: boolean;
      appCheckEnforced?: boolean;
    };
    const serverReady = Boolean(json.ok) && Boolean(json.geminiConfigured);
    const data: ServerHealthSnapshot = {
      ok: Boolean(json.ok),
      geminiConfigured: Boolean(json.geminiConfigured),
      authRequired: json.authRequired !== false,
      appCheckEnforced: Boolean(json.appCheckEnforced),
      latencyMs,
      activeCloudBackend: serverReady
        ? 'server-gemini'
        : preferredMode === 'auto' && firebaseAiEnabled
          ? 'firebase-ai-logic'
          : 'none',
    };
    lastHealthCache = { at: now, data };
    return data;
  } catch {
    return {
      ok: false,
      geminiConfigured: false,
      authRequired: false,
      appCheckEnforced: false,
      latencyMs: null,
      activeCloudBackend:
        preferredMode === 'auto' && firebaseAiEnabled ? 'firebase-ai-logic' : 'none',
    };
  }
}

export const browserNetworkProbe: NetworkProbe = {
  getConnectionInfo() {
    if (typeof navigator === 'undefined') {
      return {
        online: true,
        effectiveType: 'unknown',
        rttMs: null,
        downlinkMbps: null,
        saveData: false,
      };
    }

    const nav = navigator as Navigator & {
      connection?: {
        effectiveType?: '4g' | '3g' | '2g' | 'slow-2g';
        rtt?: number;
        downlink?: number;
        saveData?: boolean;
      };
    };

    const conn = nav.connection;
    return {
      online: navigator.onLine,
      effectiveType: conn?.effectiveType || 'unknown',
      rttMs: typeof conn?.rtt === 'number' ? conn.rtt : null,
      downlinkMbps: typeof conn?.downlink === 'number' ? conn.downlink : null,
      saveData: Boolean(conn?.saveData),
    };
  },

  async checkCloudReachability() {
    const health = await probeServerHealth();
    return {
      reachable:
        health.activeCloudBackend === 'server-gemini' ||
        health.activeCloudBackend === 'firebase-ai-logic',
      latencyMs: health.latencyMs,
    };
  },
};

export const browserLocalExecutor: LocalRuntimeExecutor = {
  async executeLocal(params) {
    return executeChromeLocalPrompt(params);
  },
};

export const browserCloudExecutor: CloudRuntimeExecutor = {
  async executeCloud(params) {
    if (params.provider === 'firebase-ai-logic') {
      return executeViaFirebaseAiLogicCloud({
        prompt: params.prompt,
        modelId: params.modelId,
        systemInstruction: params.systemInstruction,
      });
    }

    const currentUser = auth.currentUser;
    if (!currentUser) {
      throw new Error(
        'Sign in with Google is required before sending requests to /api/ai/execute.'
      );
    }

    const idToken = await currentUser.getIdToken();
    const appCheckToken = await getAppCheckTokenSafe();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    };
    if (appCheckToken) {
      headers['X-Firebase-AppCheck'] = appCheckToken;
    }

    const res = await fetch('/api/ai/execute', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        prompt: params.prompt,
        modelId: params.modelId,
        systemInstruction: params.systemInstruction,
      }),
    });

    const data = (await res.json()) as {
      text?: string;
      error?: string;
      inputTokens?: number;
      outputTokens?: number;
      providerUsed?: string;
    };

    if (!res.ok) {
      throw new Error(data.error || `Cloud inference failed (${res.status}).`);
    }

    return {
      text: data.text || '',
      inputTokens: data.inputTokens,
      outputTokens: data.outputTokens,
      providerUsed: data.providerUsed || 'server-gemini',
    };
  },
};

export async function createBrowserOrbitEngine(): Promise<{
  engine: OrbitEngine;
  health: ServerHealthSnapshot;
}> {
  const health = await probeServerHealth(true);
  const useServerGemini = health.activeCloudBackend === 'server-gemini';
  const useFirebaseAi = health.activeCloudBackend === 'firebase-ai-logic';

  const engine = new OrbitEngine({
    deviceProbe: browserDeviceProbe,
    networkProbe: browserNetworkProbe,
    localExecutor: browserLocalExecutor,
    cloudExecutor: browserCloudExecutor,
    cloudGeminiConfigured: useServerGemini,
    firebaseAiLogicConfigured: useFirebaseAi,
    cloudRequiresAuth: useServerGemini ? health.authRequired : false,
    cloudAuthenticated: Boolean(auth.currentUser),
  });
  return { engine, health };
}
