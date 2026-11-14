import { assessSensitiveKeywordCoverage, extractPiiSpans } from './taskAnalyzer';
import type {
  ConstraintEvaluation,
  CustomPrivacyPreferences,
  PiiSpan,
  PrivacyMode,
  TaskAnalysis,
} from './types';

export const DEFAULT_CUSTOM_PREFERENCES: CustomPrivacyPreferences = {
  allowCloudFallback: true,
  redactPiiBeforeCloud: true,
  maxCloudPayloadKb: 64,
  maxEstimatedCostUsd: 0.05,
  preferLocalForSimpleTasks: true,
  blockAttachmentsInCloud: false,
};

export interface PrivacyPolicyOutcome {
  cloudPermitted: boolean;
  hybridPermitted: boolean;
  requiresRedactionForCloud: boolean;
  preferLocal: boolean;
  constraints: ConstraintEvaluation[];
  privacyStatusLabel: string;
  privacyStatusLabelAr: string;
}

export function evaluatePrivacyPolicy(params: {
  mode: PrivacyMode;
  customPrefs: CustomPrivacyPreferences;
  analysis: TaskAnalysis;
  localAvailable: boolean;
}): PrivacyPolicyOutcome {
  const { mode, customPrefs, analysis, localAvailable } = params;
  const constraints: ConstraintEvaluation[] = [];

  if (mode === 'STRICT_LOCAL') {
    constraints.push({
      id: 'strict-local-no-cloud',
      passed: localAvailable,
      severity: localAvailable ? 'route_exclusion' : 'hard_block',
      affectedRoutes: ['CLOUD', 'HYBRID'],
      summaryEn: localAvailable
        ? 'Strict Local policy blocks all cloud transmission; task stays entirely on device.'
        : 'Strict Local policy blocks cloud fallback, and no local model is available in this runtime.',
      summaryAr: localAvailable
        ? 'تمنع سياسة الوضع المحلي الصارم أي إرسال للسحابة؛ تبقى المهمة بالكامل على الجهاز.'
        : 'تمنع سياسة الوضع المحلي الصارم الانتقال للسحابة، ولا يتوفر نموذج محلي في بيئة التشغيل الحالية.',
    });

    return {
      cloudPermitted: false,
      hybridPermitted: false,
      requiresRedactionForCloud: true,
      preferLocal: true,
      constraints,
      privacyStatusLabel: localAvailable ? 'Strict Local (On-Device Only)' : 'Blocked by Strict Local',
      privacyStatusLabelAr: localAvailable ? 'محلي صارم (على الجهاز فقط)' : 'محظور بواسطة الوضع المحلي الصارم',
    };
  }

  const hasSensitiveSignal = analysis.containsPii || analysis.hasSensitiveKeywords;
  const hasCompleteVerifiableRedaction =
    analysis.piiSpans.length > 0 && !analysis.redactionUncertain;

  // Fail closed across BALANCED, FLEXIBLE, and CUSTOM:
  // If sensitive signals/keywords exist without complete, verifiable span redaction,
  // both CLOUD and HYBRID are strictly prohibited.
  if (hasSensitiveSignal && !hasCompleteVerifiableRedaction) {
    constraints.push({
      id: 'unredacted-sensitive-cloud-blocked',
      passed: localAvailable,
      severity: localAvailable ? 'route_exclusion' : 'hard_block',
      affectedRoutes: ['CLOUD', 'HYBRID'],
      summaryEn:
        'Sensitive keywords or context detected without complete verifiable redaction; cloud and hybrid transmission blocked (fail-closed).',
      summaryAr:
        'تم رصد كلمات أو سياق حساس دون إمكانية التحقق من تنقيحه بالكامل؛ تم حظر الإرسال السحابي والهجين لحماية البيانات.',
    });
  } else if (hasSensitiveSignal) {
    constraints.push({
      id: 'pii-redaction-required',
      passed: true,
      severity: 'route_exclusion',
      affectedRoutes: ['CLOUD'],
      summaryEn:
        'Sensitive entities detected; direct unredacted Cloud routing is blocked across all modes in favor of Local or verified Hybrid redaction.',
      summaryAr:
        'تم رصد بيانات حساسة؛ يُحظر الإرسال السحابي المباشر في جميع الأوضاع لصالح المعالجة المحلية أو التنقيح الهجين الموثّق.',
    });
  }

  if (mode === 'CUSTOM') {
    const payloadKb = analysis.payloadBytes / 1024;
    const payloadTooLargeForCloud = payloadKb > customPrefs.maxCloudPayloadKb;
    const attachmentsBlocked =
      customPrefs.blockAttachmentsInCloud && analysis.hasAttachments;
    const cloudBlockedByCustom =
      !customPrefs.allowCloudFallback || payloadTooLargeForCloud || attachmentsBlocked;

    if (!customPrefs.allowCloudFallback) {
      constraints.push({
        id: 'custom-no-cloud-fallback',
        passed: localAvailable,
        severity: localAvailable ? 'route_exclusion' : 'hard_block',
        affectedRoutes: ['CLOUD', 'HYBRID'],
        summaryEn: 'Custom policy disables cloud fallback.',
        summaryAr: 'تعطّل السياسة المخصصة التحويل إلى السحابة.',
      });
    }

    if (payloadTooLargeForCloud) {
      constraints.push({
        id: 'custom-payload-limit',
        passed: false,
        severity: 'route_exclusion',
        affectedRoutes: ['CLOUD'],
        summaryEn: `Payload (${payloadKb.toFixed(1)} KB) exceeds custom cloud limit (${customPrefs.maxCloudPayloadKb} KB).`,
        summaryAr: `حجم الحمولة (${payloadKb.toFixed(1)} كيلوبايت) يتجاوز الحد السحابي المخصص (${customPrefs.maxCloudPayloadKb} كيلوبايت).`,
      });
    }

    if (attachmentsBlocked) {
      constraints.push({
        id: 'custom-attachment-block',
        passed: false,
        severity: 'route_exclusion',
        affectedRoutes: ['CLOUD', 'HYBRID'],
        summaryEn: 'Custom policy prohibits sending file attachments to cloud models.',
        summaryAr: 'تمنع السياسة المخصصة إرسال المرفقات إلى النماذج السحابية.',
      });
    }

    const canRunHybrid = !cloudBlockedByCustom && (!hasSensitiveSignal || hasCompleteVerifiableRedaction);

    return {
      cloudPermitted: !cloudBlockedByCustom && !hasSensitiveSignal,
      hybridPermitted: canRunHybrid,
      requiresRedactionForCloud: customPrefs.redactPiiBeforeCloud || hasSensitiveSignal,
      preferLocal: customPrefs.preferLocalForSimpleTasks,
      constraints,
      privacyStatusLabel:
        hasSensitiveSignal && !hasCompleteVerifiableRedaction
          ? 'Custom (Fail-Closed Privacy Block)'
          : hasSensitiveSignal
            ? 'Custom (Verified PII Redaction Enforced)'
            : cloudBlockedByCustom
              ? 'Custom (Cloud Restricted)'
              : 'Custom Policy Applied',
      privacyStatusLabelAr:
        hasSensitiveSignal && !hasCompleteVerifiableRedaction
          ? 'مخصّص (حظر سحابي لحماية البيانات الحساسة)'
          : hasSensitiveSignal
            ? 'مخصّص (تنقيح محلي موثّق مفروض)'
            : cloudBlockedByCustom
              ? 'مخصّص (تقييد سحابي)'
              : 'سياسة مخصصة مفعّلة',
    };
  }

  if (mode === 'BALANCED') {
    const canRunHybrid = !hasSensitiveSignal || hasCompleteVerifiableRedaction;
    return {
      cloudPermitted: !hasSensitiveSignal,
      hybridPermitted: canRunHybrid,
      requiresRedactionForCloud: true,
      preferLocal: true,
      constraints,
      privacyStatusLabel:
        hasSensitiveSignal && !hasCompleteVerifiableRedaction
          ? 'Balanced (Fail-Closed Privacy Block)'
          : hasSensitiveSignal
            ? 'Balanced (PII Guard Active)'
            : 'Balanced (Local Preferred)',
      privacyStatusLabelAr:
        hasSensitiveSignal && !hasCompleteVerifiableRedaction
          ? 'متوازن (حظر سحابي لحماية البيانات الحساسة)'
          : hasSensitiveSignal
            ? 'متوازن (حماية البيانات الحساسة مفعّلة)'
            : 'متوازن (تفضيل المحلي)',
    };
  }

  // FLEXIBLE mode: still strictly enforces fail-closed PII protection before any Cloud/Hybrid transmission
  const canRunHybrid = !hasSensitiveSignal || hasCompleteVerifiableRedaction;
  return {
    cloudPermitted: !hasSensitiveSignal,
    hybridPermitted: canRunHybrid,
    requiresRedactionForCloud: true,
    preferLocal: false,
    constraints,
    privacyStatusLabel:
      hasSensitiveSignal && !hasCompleteVerifiableRedaction
        ? 'Flexible (Fail-Closed Privacy Block)'
        : hasSensitiveSignal
          ? 'Flexible (Verified PII Sanitization Enforced)'
          : 'Flexible (Best Capable Route)',
    privacyStatusLabelAr:
      hasSensitiveSignal && !hasCompleteVerifiableRedaction
        ? 'مرن (حظر سحابي لحماية البيانات الحساسة)'
        : hasSensitiveSignal
          ? 'مرن (تنقيح محلي موثّق مفروض)'
          : 'مرن (أفضل مسار متاح)',
  };
}

/**
 * Deterministic local PII sanitizer for Hybrid execution.
 * Replaces sensitive spans locally before any cloud payload leaves the device,
 * and returns a reversible map for local post-response re-hydration.
 */
export function sanitizeTextForCloud(text: string, analysis: TaskAnalysis): {
  sanitizedText: string;
  redactionMap: Record<string, string>;
  redactedCount: number;
} {
  if (!analysis.piiSpans.length) {
    return {
      sanitizedText: text,
      redactionMap: {},
      redactedCount: 0,
    };
  }

  let sanitized = '';
  let cursor = 0;
  const redactionMap: Record<string, string> = {};
  const appliedSpans = new Set<string>();

  for (const span of analysis.piiSpans) {
    if (
      span.startIndex >= cursor &&
      span.endIndex <= text.length &&
      text.slice(span.startIndex, span.endIndex) === span.original
    ) {
      sanitized += text.slice(cursor, span.startIndex) + span.placeholder;
      redactionMap[span.placeholder] = span.original;
      appliedSpans.add(span.placeholder);
      cursor = span.endIndex;
    }
  }

  sanitized += text.slice(cursor);

  // Secondary deterministic pass: ensure any exact occurrence is replaced
  for (const span of analysis.piiSpans) {
    if (!appliedSpans.has(span.placeholder) && sanitized.includes(span.original)) {
      sanitized = sanitized.split(span.original).join(span.placeholder);
      redactionMap[span.placeholder] = span.original;
      appliedSpans.add(span.placeholder);
    }
  }

  // Tertiary sweep: ensure duplicate occurrences matching any mapped original are also scrubbed
  for (const [placeholder, original] of Object.entries(redactionMap)) {
    if (sanitized.includes(original)) {
      sanitized = sanitized.split(original).join(placeholder);
    }
  }

  return {
    sanitizedText: sanitized,
    redactionMap,
    redactedCount: Object.keys(redactionMap).length,
  };
}

function extractPlaceholderSpans(sanitizedText: string): PiiSpan[] {
  const placeholderTypes: Record<string, PiiSpan['type']> = {
    SECRET: 'secret_token',
    EMAIL: 'email',
    IBAN: 'iban',
    CARD: 'credit_card',
    ID: 'national_id',
    PHONE: 'phone',
    IP: 'ip_address',
  };
  const spans: PiiSpan[] = [];
  const rx = /\[(SECRET|EMAIL|IBAN|CARD|ID|PHONE|IP)_\d+\]/g;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(sanitizedText)) !== null) {
    const type = placeholderTypes[m[1]];
    if (!type) continue;
    spans.push({
      type,
      original: m[0],
      placeholder: m[0],
      startIndex: m.index,
      endIndex: m.index + m[0].length,
    });
  }
  return spans;
}

/**
 * Fail-closed verification gate executed during planning AND immediately before Cloud dispatch.
 * Guarantees sensitive information cannot reach Cloud or Hybrid executors without verified complete redaction.
 */
export function verifySanitizedPayloadForCloud(params: {
  sanitizedText: string | undefined;
  redactionMap: Record<string, string>;
  analysis: TaskAnalysis;
  requireRedaction: boolean;
}): { safe: boolean; reason?: string; reasonAr?: string } {
  const { sanitizedText, redactionMap, analysis, requireRedaction } = params;

  if (!sanitizedText || !sanitizedText.trim()) {
    return {
      safe: false,
      reason: 'Outbound cloud payload is empty or undefined; blocked by privacy fail-closed gate.',
      reasonAr: 'حمولة الإرسال السحابي فارغة أو غير محددة؛ تم الحظر لحماية الخصوصية.',
    };
  }

  const sensitiveInput = analysis.containsPii || analysis.hasSensitiveKeywords;
  if (sensitiveInput && !requireRedaction) {
    return {
      safe: false,
      reason: 'Direct unredacted Cloud routing blocked because sensitive input was detected.',
      reasonAr: 'تم حظر الإرسال السحابي المباشر بسبب رصد مدخلات حساسة تتطلب تنقيحاً.',
    };
  }

  if (requireRedaction && sensitiveInput) {
    if (analysis.redactionUncertain) {
      return {
        safe: false,
        reason:
          'Sensitive keywords detected with incomplete or uncertain redaction coverage; cloud execution blocked.',
        reasonAr:
          'تم رصد كلمات حساسة مع تغطية تنقيح غير مكتملة؛ تم حظر التنفيذ السحابي.',
      };
    }

    const entries = Object.entries(redactionMap);
    if (entries.length === 0) {
      return {
        safe: false,
        reason:
          'Sensitive input produced zero verified redactions; failing closed without cloud transmission.',
        reasonAr:
          'لم ينتج عن المدخلات الحساسة أي تنقيح موثّق؛ تم إيقاف الإرسال السحابي.',
      };
    }

    const lowerSanitized = sanitizedText.toLowerCase();
    for (const [placeholder, original] of entries) {
      if (!sanitizedText.includes(placeholder)) {
        return {
          safe: false,
          reason: `Sanitized payload missing expected redaction placeholder ${placeholder}.`,
          reasonAr: `النص المنقّح يفتقد رمز الحجب المتوقع ${placeholder}.`,
        };
      }
      if (sanitizedText.includes(original)) {
        return {
          safe: false,
          reason: 'Original sensitive value persisted in sanitized payload; cloud dispatch blocked.',
          reasonAr: 'لا تزال قيمة حساسة أصلية موجودة في الحمولة؛ تم حظر الإرسال السحابي.',
        };
      }
      if (original.length >= 5 && lowerSanitized.includes(original.toLowerCase())) {
        return {
          safe: false,
          reason: 'Case-insensitive match of original sensitive value found in sanitized payload.',
          reasonAr: 'تم رصد تطابق لقيمة حساسة أصلية في الحمولة؛ تم حظر الإرسال السحابي.',
        };
      }
    }
  }

  // Independent re-scan of exact outbound string before transmission
  const residualSpans = extractPiiSpans(sanitizedText);
  if (residualSpans.length > 0) {
    return {
      safe: false,
      reason: `Outbound payload still contains ${residualSpans.length} unredacted PII pattern(s); cloud dispatch blocked.`,
      reasonAr: 'الحمولة الصادرة لا تزال تحتوي على أنماط بيانات حساسة غير منقّحة؛ تم الحظر.',
    };
  }

  const outboundKeywordCheck = assessSensitiveKeywordCoverage(
    sanitizedText,
    requireRedaction ? extractPlaceholderSpans(sanitizedText) : []
  );

  if (requireRedaction ? outboundKeywordCheck.redactionUncertain : outboundKeywordCheck.hasSensitiveKeywords) {
    return {
      safe: false,
      reason:
        'Outbound payload contains uncovered sensitive context keywords; failing closed without cloud dispatch.',
      reasonAr:
        'الحمولة الصادرة تحتوي على كلمات سياقية حساسة غير مغطاة بالتنقيح؛ تم حظر الإرسال السحابي.',
    };
  }

  return { safe: true };
}

/**
 * Re-hydrates placeholders locally after cloud response returns, if the assistant
 * referenced the placeholders directly in its draft.
 */
export function rehydrateLocalPlaceholders(
  cloudText: string,
  redactionMap: Record<string, string>
): string {
  let output = cloudText;
  for (const [placeholder, original] of Object.entries(redactionMap)) {
    if (output.includes(placeholder)) {
      output = output.split(placeholder).join(original);
    }
  }
  return output;
}
