/**
 * Core domain types for the ORBIT Adaptive Intelligence Engine (OAIE).
 * Designed to be runtime-agnostic (Web, Node tests, future React Native / Android / iOS).
 */

export type LanguageCode = 'en' | 'ar';

export type ExecutionRoute = 'LOCAL' | 'CLOUD' | 'HYBRID' | 'BLOCKED';

export type PrivacyMode = 'STRICT_LOCAL' | 'BALANCED' | 'FLEXIBLE' | 'CUSTOM';

export type TaskType =
  | 'simple_qa'
  | 'summarization'
  | 'rewrite_proofread'
  | 'classification_extraction'
  | 'coding_technical'
  | 'deep_reasoning'
  | 'translation'
  | 'pii_sensitive_draft'
  | 'unsupported';

export type TaskComplexity = 'low' | 'medium' | 'high' | 'expert';

export type LocalAvailabilityState =
  | 'available'
  | 'downloadable'
  | 'downloading'
  | 'unavailable';

export interface AttachmentPayload {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  textContent: string;
}

export interface TaskInput {
  prompt: string;
  language?: LanguageCode;
  attachments?: AttachmentPayload[];
  conversationContextLength?: number;
  requestedCloudProvider?: 'server-gemini' | 'firebase-ai-logic';
}

export interface PiiSpan {
  type: 'email' | 'phone' | 'secret_token' | 'credit_card' | 'national_id' | 'iban' | 'ip_address';
  original: string;
  placeholder: string;
  startIndex: number;
  endIndex: number;
}

export interface TaskAnalysis {
  valid: boolean;
  validationError?: string;
  taskType: TaskType;
  complexity: TaskComplexity;
  detectedLanguage: LanguageCode;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  payloadBytes: number;
  hasAttachments: boolean;
  attachmentTypes: string[];
  containsPii: boolean;
  hasSensitiveKeywords: boolean;
  redactionUncertain: boolean;
  conceptualSecurityDiscussion?: boolean;
  piiSpans: PiiSpan[];
  privacySensitivity: 'low' | 'moderate' | 'high';
  requiresDeepReasoning: boolean;
  requiresLargeContext: boolean;
  unsupportedReason?: string;
}

export type DeviceTier =
  | 'low_2gb'
  | 'entry_3_4gb'
  | 'mid_6gb'
  | 'high_8gb_plus'
  | 'unknown';

export interface DeviceCapabilityProfile {
  platform: 'web' | 'mobile-web' | 'node-test' | 'android' | 'ios';
  browserName: string;
  deviceMemoryGb: number | null;
  hardwareConcurrency: number | null;
  webGpuAvailable: boolean;
  storageQuotaMb: number | null;
  localApiPresent: boolean;
  localModelAvailability: LocalAvailabilityState;
  localModelReason: string;
  resourceConstrained: boolean;
  constraintReasons: string[];
  deviceTier?: DeviceTier;
  recommendedMaxLocalTokens?: number;
  allowWarmSessionCache?: boolean;
}

export interface NetworkStatusSnapshot {
  online: boolean;
  effectiveType: '4g' | '3g' | '2g' | 'slow-2g' | 'unknown';
  rttMs: number | null;
  downlinkMbps: number | null;
  saveData: boolean;
  cloudReachable: boolean;
  cloudHealthLatencyMs: number | null;
}

export interface CustomPrivacyPreferences {
  allowCloudFallback: boolean;
  redactPiiBeforeCloud: boolean;
  maxCloudPayloadKb: number;
  maxEstimatedCostUsd: number;
  preferLocalForSimpleTasks: boolean;
  blockAttachmentsInCloud: boolean;
}

export interface ModelDescriptor {
  id: string;
  displayName: string;
  provider: 'chrome-prompt-api' | 'gemini-server-api' | 'firebase-ai-logic';
  executionLocality: 'local' | 'cloud';
  available: boolean;
  availabilityReason: string;
  maxContextTokens: number;
  supportedTasks: TaskType[];
  supportsArabicWell: boolean;
  supportsAttachments: boolean;
  estimatedLatencyMsBase: number;
  estimatedTokensPerSec: number;
  costPer1kInputTokensUsd: number;
  costPer1kOutputTokensUsd: number;
  qualityScore: number; // 0..100
  privacyRating: number; // 0..100
}

export interface CostEstimate {
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  withinBudget: boolean;
  budgetLimitUsd: number | null;
}

export interface ConstraintEvaluation {
  id: string;
  passed: boolean;
  severity: 'hard_block' | 'route_exclusion' | 'advisory';
  affectedRoutes: ExecutionRoute[];
  summaryEn: string;
  summaryAr: string;
}

export interface RouteScoreBreakdown {
  route: Exclude<ExecutionRoute, 'BLOCKED'>;
  eligible: boolean;
  totalScore: number;
  modelId: string | null;
  estimatedLatencyMs: number;
  estimatedCostUsd: number;
  factors: {
    privacyAlignment: number;
    capabilityFit: number;
    latencyScore: number;
    costScore: number;
    deviceHeadroom: number;
    networkReliability: number;
  };
  disqualificationReason?: string;
  disqualificationReasonAr?: string;
}

export type MeasurementProvenance = 'measured' | 'partial' | 'simulated' | 'unavailable';

export interface DecisionConfidenceAssessment {
  level: 'high' | 'medium' | 'low';
  basisEn: string;
  basisAr: string;
  telemetrySamples: number;
  unreliableSignals: string[];
}

export interface RejectedAlternativeSummary {
  route: Exclude<ExecutionRoute, 'BLOCKED'>;
  modelId: string | null;
  score: number;
  eligible: boolean;
  reasonEn: string;
  reasonAr: string;
}

export interface DecisionExplainabilityMetadata {
  selectedRoute: ExecutionRoute;
  selectedModelId: string | null;
  selectedProvider: ModelDescriptor['provider'] | null;
  mainReasonsEn: string[];
  mainReasonsAr: string[];
  rejectedAlternatives: RejectedAlternativeSummary[];
  privacyRestrictionsEn: string[];
  privacyRestrictionsAr: string[];
  networkLimitationsEn: string[];
  networkLimitationsAr: string[];
  confidence: DecisionConfidenceAssessment;
  measurements: {
    hardwareSpecs: MeasurementProvenance;
    localRuntime: MeasurementProvenance;
    networkTelemetry: MeasurementProvenance;
    latencyCalibration: MeasurementProvenance;
    details: string[];
  };
}

export interface RoutingDecision {
  selectedRoute: ExecutionRoute;
  selectedLocalModelId: string | null;
  selectedCloudModelId: string | null;
  primaryModelDisplay: string;
  primaryModelDisplayAr?: string;
  privacyMode: PrivacyMode;
  estimatedLatencyMs: number;
  estimatedCostUsd: number;
  privacyStatus: string;
  privacyStatusAr?: string;
  constraints: ConstraintEvaluation[];
  routeScores: RouteScoreBreakdown[];
  requiresSanitization: boolean;
  limitations: string[];
  limitationsAr?: string[];
  explainability?: DecisionExplainabilityMetadata;
}

export interface ExecutionStep {
  stepId: string;
  order: number;
  stage: 'local_analyze_and_sanitize' | 'local_inference' | 'cloud_inference' | 'local_rehydrate_and_evaluate';
  locality: 'local' | 'cloud';
  modelId: string;
  descriptionEn: string;
  descriptionAr: string;
}

export interface ExecutionPlan {
  planId: string;
  route: ExecutionRoute;
  steps: ExecutionStep[];
  sanitizedPrompt?: string;
  redactionMap: Record<string, string>;
  redactedCount: number;
  cloudPayloadBytes: number;
}

export interface ExecutedStepTrace {
  stepId: string;
  stage: ExecutionStep['stage'];
  locality: 'local' | 'cloud';
  modelId: string;
  durationMs: number;
  status: 'completed' | 'failed' | 'skipped';
  detail: string;
  sessionReused?: boolean;
  coldStartMs?: number;
}

export interface DecisionExplanation {
  headlineEn: string;
  headlineAr: string;
  rationaleEn: string;
  rationaleAr: string;
  privacyGuaranteeEn: string;
  privacyGuaranteeAr: string;
  alternativesSummaryEn: string;
  alternativesSummaryAr: string;
  limitationsEn: string[];
  limitationsAr: string[];
}

export interface EvaluationReport {
  status: 'success' | 'blocked' | 'error';
  nonEmptyOutput: boolean;
  actualLatencyMs: number;
  latencyDeltaMs: number;
  piiLeakageDetected: boolean;
  warnings: string[];
}

export interface ExecutionResult {
  id: string;
  timestampIso: string;
  status: 'success' | 'blocked' | 'error';
  route: ExecutionRoute;
  modelUsed: string;
  outputText: string;
  errorMessage?: string;
  analysis: TaskAnalysis;
  device: DeviceCapabilityProfile;
  network: NetworkStatusSnapshot;
  decision: RoutingDecision;
  plan: ExecutionPlan;
  stepTraces: ExecutedStepTrace[];
  evaluation: EvaluationReport;
  explanation: DecisionExplanation;
  actualInputTokens: number;
  actualOutputTokens: number;
  estimatedCostUsd: number;
}

export interface EngineContext {
  privacyMode: PrivacyMode;
  customPreferences: CustomPrivacyPreferences;
  language: LanguageCode;
}

export interface LocalRuntimeExecutor {
  executeLocal(params: {
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
  }>;
}

export interface CloudRuntimeExecutor {
  executeCloud(params: {
    prompt: string;
    modelId: string;
    systemInstruction: string;
    language: LanguageCode;
    provider: 'server-gemini' | 'firebase-ai-logic';
  }): Promise<{ text: string; inputTokens?: number; outputTokens?: number; providerUsed: string }>;
}

export interface TelemetryRecord {
  id: string;
  timestampIso: string;
  taskType: TaskType;
  route: ExecutionRoute;
  modelUsed: string;
  privacyMode: PrivacyMode;
  estimatedLatencyMs: number;
  actualLatencyMs: number;
  estimatedCostUsd: number;
  inputTokens: number;
  outputTokens: number;
  status: 'success' | 'blocked' | 'error';
}
