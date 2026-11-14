import type {
  DeviceCapabilityProfile,
  NetworkStatusSnapshot,
  PrivacyMode,
  TaskComplexity,
  TaskInput,
  TaskType,
} from './types';

export interface BenchmarkTaskSpec {
  id: string;
  labelEn: string;
  labelAr: string;
  category: string;
  expectedTaskType: TaskType;
  expectedMinComplexity: TaskComplexity;
  expectedRouteWhenLocalReadyBalanced: 'LOCAL' | 'CLOUD' | 'HYBRID';
  input: TaskInput;
  privacyMode: PrivacyMode;
}

export const REPRESENTATIVE_BENCHMARK_TASKS: BenchmarkTaskSpec[] = [
  {
    id: 'bench_01_simple_qa',
    labelEn: 'Simple Q&A (HTTP vs HTTPS)',
    labelAr: 'سؤال بسيط (HTTP مقابل HTTPS)',
    category: 'simple_qa',
    expectedTaskType: 'simple_qa',
    expectedMinComplexity: 'low',
    expectedRouteWhenLocalReadyBalanced: 'LOCAL',
    privacyMode: 'BALANCED',
    input: {
      prompt: 'Briefly explain the practical difference between HTTP and HTTPS in three sentences.',
    },
  },
  {
    id: 'bench_02_summarization',
    labelEn: 'Technical Summarization',
    labelAr: 'تلخيص تقني',
    category: 'summarization',
    expectedTaskType: 'summarization',
    expectedMinComplexity: 'medium',
    expectedRouteWhenLocalReadyBalanced: 'LOCAL',
    privacyMode: 'BALANCED',
    input: {
      prompt:
        'Summarize the main trade-offs between running small on-device language models and cloud LLMs in four concise bullet points.',
    },
  },
  {
    id: 'bench_03_rewrite',
    labelEn: 'Proofread & Rewrite',
    labelAr: 'تحرير وتحسين صياغة',
    category: 'rewrite_proofread',
    expectedTaskType: 'rewrite_proofread',
    expectedMinComplexity: 'low',
    expectedRouteWhenLocalReadyBalanced: 'LOCAL',
    privacyMode: 'BALANCED',
    input: {
      prompt:
        'Rewrite and polish this status update so it sounds clear and professional: We fixed the login crash yesterday and deploy happens soon.',
    },
  },
  {
    id: 'bench_04_extraction',
    labelEn: 'Structured Extraction',
    labelAr: 'استخراج مهيكل',
    category: 'classification_extraction',
    expectedTaskType: 'classification_extraction',
    expectedMinComplexity: 'low',
    expectedRouteWhenLocalReadyBalanced: 'LOCAL',
    privacyMode: 'BALANCED',
    input: {
      prompt:
        'Extract the error code, service name, and severity from this log line as JSON: AUTH-401 token-service expired signature.',
    },
  },
  {
    id: 'bench_05_arabic_translation',
    labelEn: 'Arabic -> English Translation',
    labelAr: 'ترجمة عربي -> إنجليزي',
    category: 'translation_ar',
    expectedTaskType: 'translation',
    expectedMinComplexity: 'medium',
    expectedRouteWhenLocalReadyBalanced: 'CLOUD',
    privacyMode: 'BALANCED',
    input: {
      prompt:
        'ترجم هذه الجملة إلى الإنجليزية: يعمل محرك الذكاء التكيفي على موازنة الخصوصية والسرعة.',
      language: 'ar',
    },
  },
  {
    id: 'bench_06_coding',
    labelEn: 'TypeScript Coding Task',
    labelAr: 'مهمة برمجة TypeScript',
    category: 'coding_technical',
    expectedTaskType: 'coding_technical',
    expectedMinComplexity: 'high',
    expectedRouteWhenLocalReadyBalanced: 'CLOUD',
    privacyMode: 'BALANCED',
    input: {
      prompt:
        'Write a clean TypeScript exponential backoff retry helper with jitter and AbortSignal support.',
    },
  },
  {
    id: 'bench_07_pii_hybrid',
    labelEn: 'PII-Bearing Incident Draft (Hybrid)',
    labelAr: 'مسودة تحتوي بيانات حساسة (هجين)',
    category: 'hybrid_pii',
    expectedTaskType: 'pii_sensitive_draft',
    expectedMinComplexity: 'low',
    expectedRouteWhenLocalReadyBalanced: 'HYBRID',
    privacyMode: 'BALANCED',
    input: {
      prompt:
        'Draft a short incident notice to ops.lead@orbit.dev regarding host 192.168.10.42 and remind the team to rotate token sk-test1234567890abcdef.',
    },
  },
  {
    id: 'bench_08_deep_reasoning_hybrid',
    labelEn: 'Deep Reasoning + Sensitive Attachment',
    labelAr: 'تحليل معماري + مرفق حساس',
    category: 'hybrid_reasoning_attachment',
    expectedTaskType: 'deep_reasoning',
    expectedMinComplexity: 'expert',
    expectedRouteWhenLocalReadyBalanced: 'HYBRID',
    privacyMode: 'BALANCED',
    input: {
      prompt:
        'Architect a zero-trust audit workflow comparing edge vs cloud trade-offs using the attached clinic log.',
      attachments: [
        {
          id: 'bench_att_1',
          name: 'audit_sample.txt',
          mimeType: 'text/plain',
          sizeBytes: 98,
          textContent: 'patient_ssn=123-45-6789\nreviewer=dr.sara@clinic.org\nstatus=flagged',
        },
      ],
    },
  },
];

export interface SyntheticDeviceTier {
  id: 'low_2gb' | 'entry_3_4gb' | 'mid_6gb' | 'high_8gb_plus';
  label: string;
  device: DeviceCapabilityProfile;
}

export const SYNTHETIC_DEVICE_TIERS: SyntheticDeviceTier[] = [
  {
    id: 'low_2gb',
    label: 'Low-end (2 GB RAM, 2 cores, 450 MB quota, no WebGPU)',
    device: {
      platform: 'mobile-web',
      browserName: 'Chrome (Simulated Profile)',
      deviceMemoryGb: 2,
      hardwareConcurrency: 2,
      webGpuAvailable: false,
      storageQuotaMb: 450,
      localApiPresent: true,
      localModelAvailability: 'available',
      localModelReason: 'Simulated API ready on constrained 2 GB device profile.',
      resourceConstrained: true,
      constraintReasons: [
        'Low reported device memory (2 GB).',
        'Limited CPU concurrency (2 cores).',
        'Low available browser storage quota (450 MB).',
      ],
      deviceTier: 'low_2gb',
      recommendedMaxLocalTokens: 0,
      allowWarmSessionCache: false,
    },
  },
  {
    id: 'entry_3_4gb',
    label: 'Entry-level (4 GB RAM, 4 cores, 6000 MB quota, WebGPU)',
    device: {
      platform: 'web',
      browserName: 'Chrome (Simulated Profile)',
      deviceMemoryGb: 4,
      hardwareConcurrency: 4,
      webGpuAvailable: true,
      storageQuotaMb: 6000,
      localApiPresent: true,
      localModelAvailability: 'available',
      localModelReason: 'Simulated API ready on 4 GB entry profile.',
      resourceConstrained: false,
      constraintReasons: [],
      deviceTier: 'entry_3_4gb',
      recommendedMaxLocalTokens: 1536,
      allowWarmSessionCache: false,
    },
  },
  {
    id: 'mid_6gb',
    label: 'Mid-range (6 GB RAM, 6 cores, 24000 MB quota, WebGPU)',
    device: {
      platform: 'web',
      browserName: 'Chrome (Simulated Profile)',
      deviceMemoryGb: 6,
      hardwareConcurrency: 6,
      webGpuAvailable: true,
      storageQuotaMb: 24000,
      localApiPresent: true,
      localModelAvailability: 'available',
      localModelReason: 'Simulated API ready on 6 GB mid-range profile.',
      resourceConstrained: false,
      constraintReasons: [],
      deviceTier: 'mid_6gb',
      recommendedMaxLocalTokens: 3072,
      allowWarmSessionCache: true,
    },
  },
  {
    id: 'high_8gb_plus',
    label: 'High-end (16 GB RAM, 8 cores, 80000 MB quota, WebGPU)',
    device: {
      platform: 'web',
      browserName: 'Chrome (Simulated Profile)',
      deviceMemoryGb: 16,
      hardwareConcurrency: 8,
      webGpuAvailable: true,
      storageQuotaMb: 80000,
      localApiPresent: true,
      localModelAvailability: 'available',
      localModelReason: 'Simulated API ready on 16 GB flagship profile.',
      resourceConstrained: false,
      constraintReasons: [],
      deviceTier: 'high_8gb_plus',
      recommendedMaxLocalTokens: 4096,
      allowWarmSessionCache: true,
    },
  },
];

export const BENCHMARK_ONLINE_NETWORK: NetworkStatusSnapshot = {
  online: true,
  effectiveType: '4g',
  rttMs: 45,
  downlinkMbps: 30,
  saveData: false,
  cloudReachable: true,
  cloudHealthLatencyMs: 55,
};

export const BENCHMARK_SLOW_NETWORK: NetworkStatusSnapshot = {
  online: true,
  effectiveType: '2g',
  rttMs: 650,
  downlinkMbps: 0.4,
  saveData: true,
  cloudReachable: true,
  cloudHealthLatencyMs: 700,
};

export const BENCHMARK_OFFLINE_NETWORK: NetworkStatusSnapshot = {
  online: false,
  effectiveType: 'unknown',
  rttMs: null,
  downlinkMbps: null,
  saveData: false,
  cloudReachable: false,
  cloudHealthLatencyMs: null,
};
