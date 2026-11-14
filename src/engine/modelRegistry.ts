import type {
  DeviceCapabilityProfile,
  ModelDescriptor,
  NetworkStatusSnapshot,
} from './types';

export interface RegistryOptions {
  device: DeviceCapabilityProfile;
  network: NetworkStatusSnapshot;
  cloudGeminiConfigured: boolean;
  firebaseAiLogicConfigured: boolean;
  cloudRequiresAuth?: boolean;
  cloudAuthenticated?: boolean;
}

export function buildModelRegistry(options: RegistryOptions): ModelDescriptor[] {
  const {
    device,
    network,
    cloudGeminiConfigured,
    firebaseAiLogicConfigured,
    cloudRequiresAuth = false,
    cloudAuthenticated = true,
  } = options;

  const localAvailable =
    device.localModelAvailability === 'available' && !device.resourceConstrained;

  const localReason =
    device.localModelAvailability === 'available'
      ? device.resourceConstrained
        ? `Device constrained: ${device.constraintReasons.join(' ')}`
        : 'Chrome Prompt API on-device Gemini Nano is ready.'
      : device.localModelReason;

  // Enforce a single non-conflicting cloud backend:
  // 1. Express /api/ai/execute when reachable
  // 2. Firebase AI Logic only when Express is unavailable and Firebase AI Logic is explicitly enabled
  const activeCloudProvider: 'gemini-server-api' | 'firebase-ai-logic' | null =
    cloudGeminiConfigured
      ? 'gemini-server-api'
      : firebaseAiLogicConfigured
        ? 'firebase-ai-logic'
        : null;

  const serverAuthBlocked =
    activeCloudProvider === 'gemini-server-api' &&
    cloudRequiresAuth &&
    !cloudAuthenticated;

  const cloudOnline = network.online && (network.cloudReachable || activeCloudProvider === 'firebase-ai-logic');
  const cloudBackendConfigured = activeCloudProvider !== null;
  const cloudReady = cloudOnline && cloudBackendConfigured && !serverAuthBlocked;

  const cloudReason = !network.online
    ? 'Device is offline.'
    : !cloudBackendConfigured
      ? 'No active cloud backend: Express /api/ai/execute is unreachable and Firebase AI Logic is not enabled.'
      : !cloudOnline
        ? 'Cloud inference endpoint is unreachable.'
        : serverAuthBlocked
          ? 'Sign in with Google to authenticate Cloud Gemini requests.'
          : activeCloudProvider === 'firebase-ai-logic'
            ? 'Ready via Firebase AI Logic (GoogleAIBackend).'
            : 'Ready via authenticated server Gemini endpoint.';

  const resolvedProvider = activeCloudProvider || 'gemini-server-api';

  const models: ModelDescriptor[] = [
    {
      id: 'chrome-gemini-nano',
      displayName: 'Gemini Nano (On-Device)',
      provider: 'chrome-prompt-api',
      executionLocality: 'local',
      available: localAvailable,
      availabilityReason: localReason,
      maxContextTokens: 4096,
      supportedTasks: [
        'simple_qa',
        'summarization',
        'rewrite_proofread',
        'classification_extraction',
        'pii_sensitive_draft',
      ],
      supportsArabicWell: false,
      supportsAttachments: false,
      estimatedLatencyMsBase: 140,
      estimatedTokensPerSec: 32,
      costPer1kInputTokensUsd: 0,
      costPer1kOutputTokensUsd: 0,
      qualityScore: 68,
      privacyRating: 100,
    },
    {
      id: 'gemini-4-hydrogen',
      displayName: 'Gemini 4 Hydrogen (Cloud)',
      provider: resolvedProvider,
      executionLocality: 'cloud',
      available: cloudReady,
      availabilityReason: cloudReason,
      maxContextTokens: 128000,
      supportedTasks: [
        'simple_qa',
        'summarization',
        'rewrite_proofread',
        'classification_extraction',
        'coding_technical',
        'deep_reasoning',
        'translation',
        'pii_sensitive_draft',
      ],
      supportsArabicWell: true,
      supportsAttachments: true,
      estimatedLatencyMsBase: 380,
      estimatedTokensPerSec: 75,
      costPer1kInputTokensUsd: 0.00015,
      costPer1kOutputTokensUsd: 0.0006,
      qualityScore: 95,
      privacyRating: 58,
    },
    {
      id: 'gemini-3.1-flash-lite',
      displayName: 'Gemini 3.1 Flash Lite (Cloud)',
      provider: resolvedProvider,
      executionLocality: 'cloud',
      available: cloudReady,
      availabilityReason: cloudReason,
      maxContextTokens: 64000,
      supportedTasks: [
        'simple_qa',
        'summarization',
        'rewrite_proofread',
        'classification_extraction',
        'translation',
        'pii_sensitive_draft',
      ],
      supportsArabicWell: true,
      supportsAttachments: true,
      estimatedLatencyMsBase: 260,
      estimatedTokensPerSec: 110,
      costPer1kInputTokensUsd: 0.000075,
      costPer1kOutputTokensUsd: 0.0003,
      qualityScore: 84,
      privacyRating: 60,
    },
  ];

  return models;
}
