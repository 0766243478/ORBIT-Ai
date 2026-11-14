import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode } from 'firebase/ai';
import { app } from './firebase';

let aiInstance: ReturnType<typeof getAI> | null = null;

const envMeta =
  typeof import.meta !== 'undefined'
    ? (import.meta.env as Record<string, string | undefined> | undefined)
    : undefined;

/**
 * Firebase AI Logic (GoogleAIBackend) requires the Firebase AI Logic API
 * to be explicitly enabled in the Firebase Console for the target project.
 * It is used only when configured for static Firebase Hosting deployments
 * (where Express /api/ai/execute is not hosted) or when explicitly selected.
 */
export function isFirebaseAiLogicConfigured(): boolean {
  return (
    envMeta?.VITE_ENABLE_FIREBASE_AI_LOGIC === 'true' ||
    envMeta?.VITE_CLOUD_BACKEND === 'firebase-ai-logic'
  );
}

export function getPreferredCloudBackendMode(): 'auto' | 'server-gemini' | 'firebase-ai-logic' {
  const mode = (envMeta?.VITE_CLOUD_BACKEND || 'auto').trim().toLowerCase();
  if (mode === 'server-gemini' || mode === 'firebase-ai-logic') {
    return mode;
  }
  return 'auto';
}

export function getFirebaseAiClient() {
  if (!aiInstance) {
    aiInstance = getAI(app, { backend: new GoogleAIBackend() });
  }
  return aiInstance;
}

export function getFirebaseHybridModel(modelName = 'gemini-3.1-flash-lite') {
  const ai = getFirebaseAiClient();
  return getGenerativeModel(ai, {
    mode: InferenceMode.PREFER_ON_DEVICE,
    inCloudParams: { model: modelName },
  });
}

export async function executeViaFirebaseAiLogicCloud(params: {
  prompt: string;
  modelId: string;
  systemInstruction: string;
}): Promise<{ text: string; providerUsed: string }> {
  const ai = getFirebaseAiClient();
  const targetModel = envMeta?.VITE_FIREBASE_AI_MODEL?.trim() || params.modelId;
  const model = getGenerativeModel(ai, {
    mode: InferenceMode.ONLY_IN_CLOUD,
    inCloudParams: {
      model: targetModel,
      systemInstruction: params.systemInstruction,
    },
  });
  const result = await model.generateContent(params.prompt);
  return {
    text: result.response.text(),
    providerUsed: 'firebase-ai-logic',
  };
}
