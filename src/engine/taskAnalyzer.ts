import type {
  AttachmentPayload,
  LanguageCode,
  PiiSpan,
  TaskAnalysis,
  TaskComplexity,
  TaskInput,
  TaskType,
} from './types';

const MAX_PROMPT_CHARS = 32000;
const MAX_TOTAL_ATTACHMENT_BYTES = 256 * 1024; // 256 KB

const ARABIC_CHAR_REGEX = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/g;

// Unicode-safe boundary helper for Arabic script (JS \b only recognizes ASCII \w)
const AR_PRE = '(?:^|[\\s.,:;!?؟()"\'«»،؛/\\-])';
const AR_POST = '(?=$|[\\s.,:;!?؟()"\'«»،؛/\\-])';

interface PatternSpec {
  type: PiiSpan['type'];
  regex: RegExp;
  label: string;
  /** Optional index of capture group containing just the sensitive value (rather than full key=value match) */
  captureGroup?: number;
  /** Optional validator to prevent false positives on normalized values */
  validate?: (value: string) => boolean;
}

const COMMON_ENGLISH_NON_SECRET_WORDS = new Set([
  'a', 'an', 'the', 'my', 'your', 'our', 'their', 'this', 'that', 'in', 'on', 'at', 'to', 'for', 'of',
  'not', 'no', 'none', 'empty', 'invalid', 'missing', 'stored', 'reset', 'changed', 'here', 'there',
]);

const OAIE_PLACEHOLDER_VALUE_REGEX = /^\[(SECRET|EMAIL|IBAN|CARD|ID|PHONE|IP)_\d+\]$/;

const PII_PATTERNS: PatternSpec[] = [
  {
    type: 'secret_token',
    regex: /-----BEGIN\s+[A-Z0-9\s]*PRIVATE KEY-----[\s\S]*?-----END\s+[A-Z0-9\s]*PRIVATE KEY-----/g,
    label: 'SECRET',
  },
  {
    type: 'secret_token',
    regex: /\bBearer\s+[A-Za-z0-9\-_.~+/]{8,}=*\b|\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{4,}\b|\b(?:sk-[a-zA-Z0-9_-]{12,}|AIza[0-9A-Za-z_-]{20,}|gh[po]_[a-zA-Z0-9]{20,}|glpat-[a-zA-Z0-9_-]{16,}|AKIA[0-9A-Z]{16}|(?:pk|rk)_(?:live|test)_[0-9a-zA-Z]{12,}|xox[baprs]-[a-zA-Z0-9-]{10,})\b/g,
    label: 'SECRET',
  },
  {
    type: 'secret_token',
    // Labeled password/secret assignments in English or Arabic (supporting optional Arabic prefixes و/ف/ب/ل/ك)
    regex: /(?:^|[\s,;؛،({[])(?:password|passwd|pwd|passcode|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key|secret[_-]?key|[وفبلك]?(?:كلمة\s*المرور|الرقم\s*السري|رمز\s*المرور|مفتاح\s*الربط))\s*(?:[:=]|(?:\s+(?:is|هو|هي)\s+))\s*(?:"([^"\n]{2,64})"|'([^'\n]{2,64})'|([^\s"'`,;؛،\n]{3,64}?)(?=$|[\s"'`,;؛،\n]|[.!؟?]+(?:\s|$)))/gi,
    label: 'SECRET',
    validate: (val: string) => {
      if (OAIE_PLACEHOLDER_VALUE_REGEX.test(val)) return false;
      const lower = val.toLowerCase();
      if (COMMON_ENGLISH_NON_SECRET_WORDS.has(lower)) return false;
      return val.length >= 4;
    },
  },
  {
    type: 'email',
    regex: /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g,
    label: 'EMAIL',
  },
  {
    type: 'iban',
    regex: /\b[A-Z]{2}\d{2}(?:[\s-]?[A-Z0-9]){11,30}\b/g,
    label: 'IBAN',
    validate: (val: string) => {
      const normalized = val.replace(/[\s-]/g, '');
      return (
        normalized.length >= 15 &&
        normalized.length <= 34 &&
        /^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(normalized) &&
        /\d{4,}/.test(normalized.slice(4))
      );
    },
  },
  {
    type: 'national_id',
    // Checked BEFORE credit_card so 15-digit Emirates ID (784-YYYY-NNNNNNN-C) is not truncated to a 14-digit card match.
    // Supports Latin and Eastern Arabic numerals.
    regex: /\b(?:[\d\u0660-\u0669]{3}-[\d\u0660-\u0669]{2}-[\d\u0660-\u0669]{4}|784-[\d\u0660-\u0669]{4}-[\d\u0660-\u0669]{7}-[\d\u0660-\u0669]|[23][\d\u0660-\u0669]{13}|[12][\d\u0660-\u0669]{9})\b/g,
    label: 'ID',
  },
  {
    type: 'national_id',
    // Explicitly labeled passport / national ID / iqama / patient & employee IDs (EN + AR, Latin or Eastern Arabic numerals)
    regex: /(?:^|[\s,;؛،({[])(?:passport(?:\s*(?:no\.?|number|#))?|national\s*id|iqama|emirates\s*id|patient\s*id|employee\s*id|[وفبلك]?(?:رقم\s*الهوية|الهوية\s*الوطنية|جواز\s*السفر|رقم\s*الإقامة|رقم\s*المريض|معرف\s*المريض))\s*(?:[:=#]|(?:\s+(?:is|number|no\.?|رقم|هو|هي)\s+))\s*([A-Z0-9\u0660-\u0669-]{3,20})/gi,
    label: 'ID',
    captureGroup: 1,
    validate: (val: string) =>
      !OAIE_PLACEHOLDER_VALUE_REGEX.test(val) && /[\d\u0660-\u0669]/.test(val),
  },
  {
    type: 'credit_card',
    regex: /\b(?:\d[ -]*?){13,16}\b/g,
    label: 'CARD',
    validate: (val: string) => {
      const digitsOnly = val.replace(/\D/g, '');
      return digitsOnly.length >= 13 && digitsOnly.length <= 16;
    },
  },
  {
    type: 'phone',
    // International E.164 (Latin or Eastern Arabic digits), regional 05x/01x mobile, and North American formats
    regex: /(?:(?:\+|00)[0-9\u0660-\u0669]{1,3}[\s.-]?[0-9\u0660-\u0669]{1,4}[\s.-]?[0-9\u0660-\u0669]{3,4}[\s.-]?[0-9\u0660-\u0669]{3,4}|(?:\b|[\s])(?:05[0-9]|01[0125])[0-9\u0660-\u0669]{1}[\s.-]?[0-9\u0660-\u0669]{3,4}[\s.-]?[0-9\u0660-\u0669]{3,4}|(?:\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4})\b/g,
    label: 'PHONE',
  },
  {
    type: 'ip_address',
    regex: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g,
    label: 'IP',
  },
];

const UNSUPPORTED_TASK_PATTERNS = [
  /\b(generate|create|render|draw)\s+(an?\s+)?(image|photo|picture|video|mp4|audio|song|music)\b/i,
  new RegExp(`${AR_PRE}(انشئ|أنشئ|اصنع|ارسم|ولّد)\\s+(صورة|فيديو|موسيقى|صوت)${AR_POST}`),
];

const CODING_PATTERNS = [
  /\b(typescript|javascript|python|rust|sql|react|firebase|firestore|api|algorithm|regex|bug|refactor|function|class|(?<!\b(?:error|status|zip|postal|area|promo|access|country|verification|qr|bar)\s+)code|compile|stack\s*trace|css|html|json\s*schema|docker|kubernetes|debounce|throttle|async|await|webhook|middleware|endpoint|oauth|jwt|schema|migration|unit\s*test|vitest|playwright|flexbox|web\s*app)\b/i,
  /```[\s\S]*```/,
  new RegExp(`${AR_PRE}(برمجة|كود|خوارزمية|دالة|خطأ برمجي|قاعدة بيانات|الخطأ البرمجي)${AR_POST}`),
];

const DEEP_REASONING_PATTERNS = [
  /\b(architect|trade-?off|compare\s+in\s+depth|proof|theorem|security\s+audit|root\s+cause|multi-?step|system\s+design|strategy|analyze\s+the\s+implications)\b/i,
  new RegExp(`${AR_PRE}(تحليل معمق|تصميم معماري|مقارنة شاملة|استراتيجية|تدقيق أمني)${AR_POST}`),
];

const SUMMARIZATION_PATTERNS = [
  /\b(summarize|summary|tl;?dr|key\s+points|bullet\s+points|condense|recap)\b/i,
  new RegExp(`${AR_PRE}(لخص|لخّص|ملخص|اختصر|أهم النقاط)${AR_POST}`),
];

const REWRITE_PATTERNS = [
  /\b(rewrite|proofread|grammar|polish|improve\s+tone|make\s+it\s+concise|rephrase|edit\s+this)\b/i,
  new RegExp(`${AR_PRE}(أعد صياغة|تدقيق لغوي|صحح|صحّح|حسن النص|حسّن النص)${AR_POST}`),
];

const TRANSLATION_PATTERNS = [
  /\b(translate|translation|into\s+arabic|into\s+english|to\s+arabic|to\s+english)\b/i,
  new RegExp(`${AR_PRE}(ترجم|ترجمة|ترجمي|إلى العربية|إلى الإنجليزية)${AR_POST}`),
];

const CLASSIFICATION_PATTERNS = [
  /\b(classify|categorize|extract|parse|sentiment|tag\s+this|json\s+from)\b/i,
  new RegExp(`${AR_PRE}(صنف|صنّف|استخرج|تحليل مشاعر)${AR_POST}`),
];

interface SensitiveKeywordSpec {
  regex: RegExp;
  expectedSpanTypes: PiiSpan['type'][] | null; // null => contextual narrative sensitivity
  tier: 'credential_or_identifier' | 'contextual_narrative';
}

const AR_SENSITIVE_PREFIX = `${AR_PRE}(?:[وفبلك]?ال|[وفبلك])?`;

// Personal, possessive, numeric/currency, or record-disclosure markers indicating real personal data rather than educational discussion
const PERSONAL_DISCLOSURE_MARKERS: RegExp[] = [
  /\b(my|mine|our|his|her|their|i\s+have|i\s+earn|i\s+make|i\s+was\s+diagnosed|review\s+my|check\s+my|audit\s+my|summarize\s+my|employee\s+record|medical\s+record|medical\s+report|health\s+record|patient\s+record|salary\s+sheet|compensation\s+report|compensation\s+sheet|this\s+report|this\s+sheet|this\s+record|attached|below|following)\b/i,
  /\b(?:salary|pay|diagnosis|patient|medical|confidential)\b[^.!؟?\n]{0,24}(?:[:=]|is\s+(?:[$€£¥]|\d|[\u0660-\u0669]|confidential|private))|\b(?:[$€£¥]\s*\d|\d[\d,.]*\s*(?:usd|sar|aed|egp|eur|gbp|ريال|درهم|جنيه))\b[^.!؟?\n]{0,24}\b(?:salary|راتب|راتبي)\b/i,
  new RegExp(
    `${AR_PRE}[وفبلك]?(?:راتب[يهاهكم]|رواتب[نهكما]|تشخيص[يهاهكم]|مريض[يهاهكم]|تقرير[يها]?\\s+الطب[يية]|التقرير\\s+الطبي|ملف[ي]?\\s+المريض|سجل[ي]?\\s+الطبي|الخاصة\\s+بي|خاصتي|بياناتي|تفاصيل\\s+الراتب|رقم\\s+المريض|معرف\\s+المريض|تشخيص\\s+المريض|أعاني\\s+من|لدي\\s+تشخيص|هذا\\s+التقرير|المرفق|أدناه)${AR_POST}`
  ),
  /(?:راتب|تشخيص|مريض|سري|طبية|طبي)[^.!؟?\n]{0,20}(?:[:=]|[\d\u0660-\u0669]{2,}|(?:ريال|درهم|جنيه|دولار))/,
  // Patient / employee IDs written explicitly as disclosure without conceptualization
  /\b(?:my|his|her|their|patient['’]s?)\s+patient\s*id\b/i,
];

const CONCEPTUAL_DISCUSSION_MARKERS: RegExp[] = [
  /\b(explain|what\s+is|what\s+are|how\s+does|how\s+do|how\s+should|how\s+to\s+(?:design|protect|secure|anonymize)|define|definition|architecture|threat\s+model(?:ing)?|data\s+protection|privacy\s+(?:controls?|architecture|design|policy|laws?)|best\s+practices|principles|overview|theory|concepts?|compliance|hipaa|gdpr|mechanisms?|in\s+general|general\s+privacy)\b/i,
  new RegExp(
    `${AR_PRE}[وفبلك]?(?:اشرح|وضّح|وضح|ما\\s+هي|ما\\s+هو|كيف\\s+تعمل|كيف\\s+يعمل|كيف\\s+يتم|حماية\\s+البيانات|أمن\\s+المعلومات|مبادئ|هندسة|مفاهيم|نظرة\\s+عامة|تشريعات|خصوصية\\s+الرواتب|سرية\\s+الرواتب|بشكل\\s+نظري|تشفير|حوكمة)${AR_POST}`
  ),
];

const SENSITIVE_KEYWORD_SPECS: SensitiveKeywordSpec[] = [
  {
    regex: /\b(password|passwd|pwd|passcode|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key|secret)\b|\bbearer\s+[A-Za-z0-9\-_.~+/=]{2,}/gi,
    expectedSpanTypes: ['secret_token'],
    tier: 'credential_or_identifier',
  },
  {
    regex: new RegExp(`${AR_PRE}(?:[وفبلك]?)(كلمة\\s*المرور|الرقم\\s*السري|رمز\\s*المرور|مفتاح\\s*الربط)${AR_POST}`, 'g'),
    expectedSpanTypes: ['secret_token'],
    tier: 'credential_or_identifier',
  },
  {
    regex: /\b(iban|bank\s+account)\b/gi,
    expectedSpanTypes: ['iban', 'credit_card'],
    tier: 'credential_or_identifier',
  },
  {
    regex: new RegExp(`${AR_SENSITIVE_PREFIX}(حساب\\s*بنكي|حساب\\s*البنكي|آيبان)${AR_POST}`, 'g'),
    expectedSpanTypes: ['iban', 'credit_card'],
    tier: 'credential_or_identifier',
  },
  {
    regex: /\b(ssn|social\s+security|passport|national\s+id|iqama|emirates\s+id)\b/gi,
    expectedSpanTypes: ['national_id'],
    tier: 'credential_or_identifier',
  },
  {
    regex: new RegExp(`${AR_PRE}(?:[وفبلك]?)(جواز\\s*سفر|جواز\\s*السفر|رقم\\s*الهوية|الهوية\\s*الوطنية|رقم\\s*الإقامة)${AR_POST}`, 'g'),
    expectedSpanTypes: ['national_id'],
    tier: 'credential_or_identifier',
  },
  // Contextual narrative sensitivity: fail closed when personal/possessive/disclosure cues exist; allow conceptual educational prompts
  {
    regex: /\b(salary|salaries|medical|diagnosis|diagnoses|patient|patients|confidential|payroll)\b/gi,
    expectedSpanTypes: null,
    tier: 'contextual_narrative',
  },
  {
    regex: new RegExp(`${AR_SENSITIVE_PREFIX}(سري|سرية|راتب|رواتب|راتبي|طبي|طبية|تشخيص|تشخيصي|مريض)${AR_POST}`, 'g'),
    expectedSpanTypes: null,
    tier: 'contextual_narrative',
  },
  {
    regex: new RegExp(`${AR_PRE}خصوصية${AR_POST}`, 'g'),
    expectedSpanTypes: null,
    tier: 'contextual_narrative',
  },
];

function detectLanguage(text: string, fallback: LanguageCode): LanguageCode {
  const matches = text.match(ARABIC_CHAR_REGEX);
  if (!matches) return fallback === 'ar' ? 'en' : fallback;
  const ratio = matches.length / Math.max(text.length, 1);
  return ratio >= 0.15 ? 'ar' : 'en';
}

function estimateTokens(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  // Arabic and code typically consume slightly more tokens per character than plain English
  const arabicCount = (trimmed.match(ARABIC_CHAR_REGEX) || []).length;
  const factor = arabicCount > trimmed.length * 0.2 ? 2.5 : 3.8;
  return Math.max(1, Math.ceil(trimmed.length / factor));
}

export function extractPiiSpans(text: string): PiiSpan[] {
  const spans: PiiSpan[] = [];
  const counters: Record<string, number> = {};

  for (const spec of PII_PATTERNS) {
    const regex = new RegExp(spec.regex.source, spec.regex.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      let value = match[0];
      let start = match.index;

      if (typeof spec.captureGroup === 'number') {
        const captured = match[spec.captureGroup];
        if (!captured) continue;
        const innerIdx = match[0].indexOf(captured);
        if (innerIdx < 0) continue;
        value = captured;
        start = match.index + innerIdx;
      } else if (match.length > 1) {
        // Pick first populated capture group when present (used by quoted/unquoted secret patterns)
        const captured = match.slice(1).find((g) => typeof g === 'string' && g.length > 0);
        if (captured) {
          const innerIdx = match[0].indexOf(captured);
          if (innerIdx >= 0) {
            value = captured;
            start = match.index + innerIdx;
          }
        }
      }

      if (spec.validate && !spec.validate(value)) {
        continue;
      }

      const end = start + value.length;
      const overlaps = spans.some((s) => !(end <= s.startIndex || start >= s.endIndex));
      if (overlaps) continue;

      counters[spec.label] = (counters[spec.label] || 0) + 1;
      const placeholder = `[${spec.label}_${counters[spec.label]}]`;
      spans.push({
        type: spec.type,
        original: value,
        placeholder,
        startIndex: start,
        endIndex: end,
      });
    }
  }

  return spans.sort((a, b) => a.startIndex - b.startIndex);
}

export function assessSensitiveKeywordCoverage(
  text: string,
  spans: PiiSpan[]
): {
  hasSensitiveKeywords: boolean;
  redactionUncertain: boolean;
  uncoveredKeywords: string[];
  conceptualDiscussionOnly: boolean;
} {
  let hasCredentialOrIdKeyword = false;
  let hasContextualKeyword = false;
  let redactionUncertain = false;
  const uncoveredKeywords: string[] = [];
  const contextualKeywords: string[] = [];

  for (const spec of SENSITIVE_KEYWORD_SPECS) {
    const rx = new RegExp(spec.regex.source, spec.regex.flags);
    let m: RegExpExecArray | null;
    while ((m = rx.exec(text)) !== null) {
      const kwStart = m.index;
      const kwEnd = kwStart + m[0].length;
      const kwLabel = m[0].trim();

      if (spec.tier === 'credential_or_identifier') {
        hasCredentialOrIdKeyword = true;
        const expected = spec.expectedSpanTypes || [];
        const covered = spans.some(
          (s) =>
            expected.includes(s.type) &&
            s.startIndex >= kwStart - 24 &&
            s.startIndex <= kwEnd + 64
        );
        if (!covered) {
          redactionUncertain = true;
          uncoveredKeywords.push(kwLabel);
        }
        continue;
      }

      hasContextualKeyword = true;
      contextualKeywords.push(kwLabel);
    }
  }

  let conceptualDiscussionOnly = false;

  if (hasContextualKeyword) {
    const hasPersonalDisclosureSignal = PERSONAL_DISCLOSURE_MARKERS.some((rx) => rx.test(text));
    const hasConceptualFraming = CONCEPTUAL_DISCUSSION_MARKERS.some((rx) => rx.test(text));
    const hasNumbersOrCodes = /\b\d{3,}\b|[\u0660-\u0669]{3,}|[A-Z]{1,3}-\d{2,}/.test(text);
    const hasAttachmentsMarker = /\[Attached File:/.test(text);

    // Safe conceptual exception ONLY when zero credential keywords, zero extracted PII spans,
    // zero personal/possessive/numeric/attachment markers, AND explicit educational framing exists.
    const safeConceptualContext =
      !hasCredentialOrIdKeyword &&
      spans.length === 0 &&
      !hasPersonalDisclosureSignal &&
      !hasNumbersOrCodes &&
      !hasAttachmentsMarker &&
      hasConceptualFraming;

    if (safeConceptualContext) {
      conceptualDiscussionOnly = true;
    } else {
      redactionUncertain = true;
      uncoveredKeywords.push(...contextualKeywords);
    }
  }

  const hasSensitiveKeywords =
    hasCredentialOrIdKeyword || (hasContextualKeyword && !conceptualDiscussionOnly);

  return {
    hasSensitiveKeywords,
    redactionUncertain,
    uncoveredKeywords: Array.from(new Set(uncoveredKeywords)),
    conceptualDiscussionOnly,
  };
}

function classifyTaskType(prompt: string, hasPii: boolean, hasAttachments: boolean): {
  taskType: TaskType;
  unsupportedReason?: string;
} {
  if (UNSUPPORTED_TASK_PATTERNS.some((p) => p.test(prompt))) {
    return {
      taskType: 'unsupported',
      unsupportedReason:
        'Media generation (image, video, audio synthesis) is outside ORBIT AI text/code execution capabilities.',
    };
  }
  const hasCodingSignal = CODING_PATTERNS.some((p) => p.test(prompt));
  const hasExplicitTargetTranslation =
    /\b(translate|into\s+arabic|into\s+english|to\s+arabic|to\s+english)\b/i.test(prompt) ||
    new RegExp(`${AR_PRE}(ترجم|ترجمي|إلى العربية|إلى الإنجليزية)${AR_POST}`).test(prompt);

  if (hasExplicitTargetTranslation && !hasCodingSignal) {
    return { taskType: 'translation' };
  }
  if (hasCodingSignal) {
    return { taskType: 'coding_technical' };
  }
  if (TRANSLATION_PATTERNS.some((p) => p.test(prompt))) {
    return { taskType: 'translation' };
  }
  if (SUMMARIZATION_PATTERNS.some((p) => p.test(prompt))) {
    return { taskType: 'summarization' };
  }
  if (REWRITE_PATTERNS.some((p) => p.test(prompt))) {
    return { taskType: 'rewrite_proofread' };
  }
  if (CLASSIFICATION_PATTERNS.some((p) => p.test(prompt))) {
    return { taskType: 'classification_extraction' };
  }
  if (DEEP_REASONING_PATTERNS.some((p) => p.test(prompt))) {
    return { taskType: 'deep_reasoning' };
  }
  if (hasPii && !hasAttachments) {
    return { taskType: 'pii_sensitive_draft' };
  }
  return { taskType: 'simple_qa' };
}

function assessComplexity(
  prompt: string,
  taskType: TaskType,
  inputTokens: number,
  hasAttachments: boolean
): TaskComplexity {
  if (taskType === 'deep_reasoning') return 'expert';
  if (taskType === 'coding_technical' || inputTokens > 900 || hasAttachments) {
    return inputTokens > 1800 ? 'expert' : 'high';
  }
  if (
    taskType === 'summarization' ||
    taskType === 'translation' ||
    inputTokens > 250 ||
    prompt.split(/\n+/).length > 4
  ) {
    return 'medium';
  }
  return 'low';
}

function estimateOutputTokens(complexity: TaskComplexity, taskType: TaskType): number {
  if (taskType === 'classification_extraction') return 180;
  switch (complexity) {
    case 'low':
      return 220;
    case 'medium':
      return 480;
    case 'high':
      return 900;
    case 'expert':
      return 1400;
  }
}

export function formatTaskPayloadWithAttachments(
  prompt: string,
  attachments?: AttachmentPayload[]
): string {
  const trimmedPrompt = typeof prompt === 'string' ? prompt.trim() : '';
  const attachmentText = (attachments || [])
    .map((a) => `\n\n[Attached File: ${a.name} (${a.mimeType})]\n${a.textContent}`)
    .join('');
  return trimmedPrompt + attachmentText;
}

export function analyzeTask(input: TaskInput): TaskAnalysis {
  const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
  const attachments = Array.isArray(input.attachments) ? input.attachments : [];

  if (!prompt && attachments.length === 0) {
    return {
      valid: false,
      validationError: 'Task prompt cannot be empty.',
      taskType: 'unsupported',
      complexity: 'low',
      detectedLanguage: input.language || 'en',
      estimatedInputTokens: 0,
      estimatedOutputTokens: 0,
      payloadBytes: 0,
      hasAttachments: false,
      attachmentTypes: [],
      containsPii: false,
      hasSensitiveKeywords: false,
      redactionUncertain: false,
      piiSpans: [],
      privacySensitivity: 'low',
      requiresDeepReasoning: false,
      requiresLargeContext: false,
      unsupportedReason: 'Empty prompt.',
    };
  }

  if (prompt.length > MAX_PROMPT_CHARS) {
    return {
      valid: false,
      validationError: `Prompt exceeds maximum allowed length of ${MAX_PROMPT_CHARS} characters.`,
      taskType: 'unsupported',
      complexity: 'expert',
      detectedLanguage: input.language || 'en',
      estimatedInputTokens: estimateTokens(prompt),
      estimatedOutputTokens: 0,
      payloadBytes: new TextEncoder().encode(prompt).length,
      hasAttachments: attachments.length > 0,
      attachmentTypes: attachments.map((a) => a.mimeType),
      containsPii: false,
      hasSensitiveKeywords: false,
      redactionUncertain: false,
      piiSpans: [],
      privacySensitivity: 'low',
      requiresDeepReasoning: false,
      requiresLargeContext: true,
      unsupportedReason: 'Input exceeds size boundary.',
    };
  }

  const totalAttachmentBytes = attachments.reduce((sum, a) => sum + (a.sizeBytes || 0), 0);
  if (totalAttachmentBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
    return {
      valid: false,
      validationError: `Total attachment payload exceeds ${MAX_TOTAL_ATTACHMENT_BYTES / 1024} KB limit.`,
      taskType: 'unsupported',
      complexity: 'high',
      detectedLanguage: input.language || 'en',
      estimatedInputTokens: estimateTokens(prompt),
      estimatedOutputTokens: 0,
      payloadBytes: new TextEncoder().encode(prompt).length + totalAttachmentBytes,
      hasAttachments: true,
      attachmentTypes: attachments.map((a) => a.mimeType),
      containsPii: false,
      hasSensitiveKeywords: false,
      redactionUncertain: false,
      piiSpans: [],
      privacySensitivity: 'low',
      requiresDeepReasoning: false,
      requiresLargeContext: true,
      unsupportedReason: 'Attachment payload exceeds limit.',
    };
  }

  const fullText = formatTaskPayloadWithAttachments(prompt, attachments);
  const piiSpans = extractPiiSpans(fullText);
  const keywordCoverage = assessSensitiveKeywordCoverage(fullText, piiSpans);
  const hasSensitiveKeywords = keywordCoverage.hasSensitiveKeywords;
  const redactionUncertain = keywordCoverage.redactionUncertain;
  const conceptualSecurityDiscussion = keywordCoverage.conceptualDiscussionOnly;
  const containsPii = piiSpans.length > 0 || hasSensitiveKeywords;

  const { taskType, unsupportedReason } = classifyTaskType(
    prompt,
    containsPii,
    attachments.length > 0
  );
  const detectedLanguage = detectLanguage(prompt, input.language || 'en');
  const estimatedInputTokens =
    estimateTokens(fullText) + Math.min(input.conversationContextLength || 0, 2000);
  const complexity = assessComplexity(
    prompt,
    taskType,
    estimatedInputTokens,
    attachments.length > 0
  );
  const estimatedOutputTokens = estimateOutputTokens(complexity, taskType);
  const payloadBytes = new TextEncoder().encode(fullText).length;

  let privacySensitivity: TaskAnalysis['privacySensitivity'] = 'low';
  if (
    piiSpans.some(
      (s) =>
        s.type === 'secret_token' ||
        s.type === 'credit_card' ||
        s.type === 'national_id' ||
        s.type === 'iban'
    )
  ) {
    privacySensitivity = 'high';
  } else if (piiSpans.length > 0 || hasSensitiveKeywords) {
    privacySensitivity = 'high';
  } else if (attachments.length > 0 || conceptualSecurityDiscussion) {
    privacySensitivity = 'moderate';
  }

  return {
    valid: true,
    taskType,
    complexity,
    detectedLanguage,
    estimatedInputTokens,
    estimatedOutputTokens,
    payloadBytes,
    hasAttachments: attachments.length > 0,
    attachmentTypes: attachments.map((a) => a.mimeType),
    containsPii,
    hasSensitiveKeywords,
    redactionUncertain,
    conceptualSecurityDiscussion,
    piiSpans,
    privacySensitivity,
    requiresDeepReasoning: complexity === 'expert' || taskType === 'deep_reasoning' || taskType === 'coding_technical',
    requiresLargeContext: estimatedInputTokens > 1500,
    unsupportedReason,
  };
}
