# Phase 6 — Context-Aware Privacy Classification

## 1. Objective
In Phase 5, prompts discussing privacy concepts in the abstract (for example, `"Explain general privacy threat modeling for confidential payroll systems."`) matched static bag-of-words sensitive keyword regexes (`confidential`, `payroll`, `salary`, `medical`) and triggered `redactionUncertain = true`, causing false-positive `BLOCKED` / `LOCAL` outcomes when no personal disclosure existed.

Phase 6 refines `src/engine/taskAnalyzer.ts` to separate **actual personal/credential disclosures** from **conceptual security/privacy education** while preserving fail-closed behavior whenever uncertainty remains.

## 2. Two-Tier Classification Architecture (`src/engine/taskAnalyzer.ts`)

### Tier 1 — `credential_or_identifier` (Always Strict Fail-Closed)
Keywords in this tier (English & Arabic):
- `password`, `passwd`, `pwd`, `passcode`, `api_key`, `access_token`, `refresh_token`, `client_secret`, `private_key`, `secret`, `bearer ...`, `كلمة المرور`, `الرقم السري`, `رمز المرور`, `مفتاح الربط`
- `iban`, `bank account`, `حساب بنكي`, `آيبان`
- `ssn`, `social security`, `passport`, `national id`, `iqama`, `emirates id`, `جواز السفر`, `رقم الهوية`, `الهوية الوطنية`, `رقم الإقامة`

**Rule**: These keywords NEVER qualify for the conceptual discussion exception. Every match MUST be covered by a nearby extracted `PiiSpan` of matching type; otherwise `redactionUncertain = true` forces `CLOUD` & `HYBRID` blocking (`fail-closed`).

### Tier 2 — `contextual_narrative` (Context-Sensitive)
Contextual keywords (`salary`, `salaries`, `medical`, `diagnosis`, `diagnoses`, `patient`, `patients`, `confidential`, `payroll` and Arabic `سري/سرية`, `راتب/رواتب/راتبي`, `طبي/طبية`, `تشخيص/تشخيصي`, `مريض`, `خصوصية`):

1. **Expanded Identifier & Eastern Arabic Numeral Extraction (`extractPiiSpans`)**:
   - `national_id` now extracts both ASCII digits and Eastern Arabic numerals (`\u0660-\u0669`) including 14-digit national IDs (`٢٩٢٠١٠١١٢٣٤٥٦٧`), 10-digit Iqama/SSN, and labeled `patient id` / `employee id` / `رقم المريض` / `معرف المريض`.
   - Boundary helpers `AR_PRE` and `AR_POST` explicitly include Arabic punctuation (`؟`, `،`, `؛`, `«`, `»`) so sentence-final Arabic tokens (e.g., `السرية؟`) match reliably.
2. **Personal Disclosure Markers (`PERSONAL_DISCLOSURE_MARKERS`)**:
   - Detects first/third-person possessives (`my`, `mine`, `our`, `his`, `her`, `i earn`, `review my`), record references (`medical record`, `salary sheet`, `patient record`, `this report`), inline values/currencies (`14,500 SAR`, `$8500`, `٨٥٠٠ ريال`), and Arabic possessive/record forms (`راتبي`, `تشخيصي`, `مريضي`, `رقم المريض`, `التقرير الطبي`, `هذا التقرير`).
3. **Conceptual Exception Gate (`conceptualDiscussionOnly`)**:
   A prompt with Tier-2 keywords clears `hasSensitiveKeywords = false` and `conceptualSecurityDiscussion = true` **only when ALL 6 guards pass simultaneously**:
   1. Zero Tier-1 `credential_or_identifier` keywords (`!hasCredentialOrIdKeyword`).
   2. Zero extracted `PiiSpan` instances (`spans.length === 0`).
   3. Zero `PERSONAL_DISCLOSURE_MARKERS` matches (`!hasPersonalDisclosureSignal`).
   4. Zero 3+ digit sequences or alphanumeric ID codes (`!/\b\d{3,}\b|[\u0660-\u0669]{3,}|[A-Z]{1,3}-\d{2,}/.test(text)`).
   5. Zero file attachment markers (`!/\[Attached File:/.test(text)`).
   6. Explicit conceptual/educational framing present (`CONCEPTUAL_DISCUSSION_MARKERS`, e.g., `explain`, `how does`, `what is`, `architecture`, `threat modeling`, `data protection`, `privacy controls`, `اشرح`, `ما هي`, `كيف تعمل`, `حماية البيانات`, `أمن المعلومات`, `مبادئ`).

If ANY of those 6 checks fails, OAIE sets `redactionUncertain = true` and `hasSensitiveKeywords = true`, failing closed (`LOCAL` if on-device Nano is available, or `BLOCKED` if Cloud/Hybrid would be required).

## 3. Verified Classification & Dispatch Results (`tests/oaie.phase6.test.ts` Section 2)

| Prompt | Category | `containsPii` | `hasSensitiveKeywords` | `conceptualSecurityDiscussion` | Route (No Local, `BALANCED`) |
|---|---|---|---|---|---|
| `"Explain confidential payroll architecture."` | Conceptual (EN) | `false` | `false` | `true` | `CLOUD` |
| `"How does medical data protection work?"` | Conceptual (EN) | `false` | `false` | `true` | `CLOUD` |
| `"What is salary privacy?"` | Conceptual (EN) | `false` | `false` | `true` | `CLOUD` |
| `"Explain general privacy threat modeling for confidential payroll systems."` | Conceptual (EN) | `false` | `false` | `true` | `CLOUD` |
| `"اشرح كيف تعمل حماية البيانات الطبية وخصوصية الرواتب نظرياً."` | Conceptual (AR) | `false` | `false` | `true` | `CLOUD` |
| `"ما هي مبادئ أمن المعلومات وتشفير السجلات السرية؟"` | Conceptual (AR) | `false` | `false` | `true` | `CLOUD` |
| `"My salary is 14,500 SAR and payroll ID is EMP-442."` | Personal Disclosure (EN) | `true` | `true` | `false` | `BLOCKED` (0 cloud calls) |
| `"My patient ID is 883921 and diagnosis is hypertension."` | Personal Disclosure (EN) | `true` | `true` | `false` | `BLOCKED` (0 cloud calls) |
| `"راتبي هو ٨٥٠٠ ريال ورقم المريض الخاص بي ٩٩١٨٢."` | Personal Disclosure (AR + Eastern Arabic) | `true` | `true` | `false` | `BLOCKED` (0 cloud calls) |
| `"أرسل الهوية الوطنية: ٢٩٢٠١٠١١٢٣٤٥٦٧ مع كلمة المرور: TestAr#2026 إلى team@orbit.dev"` | Redactable PII + Secret (AR + Eastern Arabic) | `true` | `true` | `false` | `HYBRID` (`[ID_1]`, `[SECRET_1]`, `[EMAIL_1]` verified) |

## 4. Known Boundaries
- Still regex/rule-based (no semantic NLP classifier). Novel paraphrases of personal data lacking numbers or possessive pronouns (e.g., `"John Doe's annual compensation package details"`) still fall back conservatively to fail-closed when contextual words appear without conceptual markers, whereas unflagged domain nouns (e.g., `"home address"`) without format regexes remain outside deterministic extraction.
