# ORBIT AI — Phase 5 Real-World Intelligence Validation Audit

**Status:** Engineering Validation Report (Read-Only Audit of Phase 3/4 + Critical Privacy Hardening Build)  
**Environment Scope:** Containerized Linux Node.js (`v20+`) + Express API server (`http://localhost:3000`); **no local Chromium/Chrome binary installed (`NO_BROWSER_BINARY`) and zero physical Android/iOS/Windows/macOS hardware tested in this environment.**

---

## 1. Source Code Reality Audit (Implemented Capability vs. Constraints)

### 1.1 Which tasks can genuinely run locally?
Inspection of `src/engine/modelRegistry.ts` (`lines 70–93`), `src/engine/decisionEngine.ts` (`lines 98–267`), and `src/services/localInference.ts` confirms that **at most one local runtime exists**: Chrome Desktop's Built-in AI Prompt API (`globalThis.LanguageModel` / legacy `window.ai.languageModel`, backed by Gemini Nano).

When `globalThis.LanguageModel.availability(...) === 'available'` AND `!device.resourceConstrained`, OAIE permits `chrome-gemini-nano` only for:
- `simple_qa`
- `summarization`
- `rewrite_proofread`
- `classification_extraction`
- `pii_sensitive_draft`

Subject to three additional hard disqualifiers (`src/engine/decisionEngine.ts:151–213`):
1. `analysis.estimatedInputTokens <= effectiveMaxLocalTokens` (device-tier capped: `0` on `low_2gb`, `1536` on `entry_3_4gb`, `2048–3072` on `mid_6gb`, `2560–4096` on `high_8gb_plus`).
2. `!analysis.hasAttachments` (`supportsAttachments: false`).
3. `analysis.detectedLanguage !== 'ar'` (`supportsArabicWell: false`).

### 1.2 Which tasks require cloud inference?
The following tasks are unconditionally disqualified from `LOCAL` (`modelRegistry.ts:78–86`, `decisionEngine.ts:130–213`):
- `coding_technical` (hard-excluded from local Nano `supportedTasks`)
- `deep_reasoning` (hard-excluded from local Nano `supportedTasks`)
- `translation` (hard-excluded from local Nano `supportedTasks`)
- **All Arabic prompts (`detectedLanguage === 'ar'`)** — even a trivial 4-word offline question (`"ما هي عاصمة فرنسا؟"`) is disqualified from `LOCAL` (`supportsArabicWell: false`) and resolves to `BLOCKED` offline.
- **All prompts with file attachments (`<= 256 KB`)** (`supportsAttachments: false`).
- **Any task exceeding device-tier local context cap** (e.g., `> 1,536` tokens on a 3–4 GB device).
- **All tasks on `<= 2 GB` RAM or `<= 2` CPU cores or `< 512 MB` storage quota** (`deviceProfiler.ts:38–50`, `modelRegistry.ts:26–27`).

### 1.3 Which tasks support hybrid execution?
ORBIT's `"HYBRID"` route (`src/engine/taskPlanner.ts`, `src/engine/executionManager.ts:266–399`) is **not dual local+cloud neural inference** (neither local drafting nor speculative decoding). It is a deterministic 3-stage privacy pipeline:
1. **`oaie-local-guardian` (TypeScript RegExp redaction, on-device):** Replaces verified PII spans (`email`, `iban`, `credit_card`, `national_id`, `phone`, `ip_address`, `secret_token`) with `[TYPE_N]` placeholders and executes `verifySanitizedPayloadForCloud()`.
2. **`server-gemini` or `firebase-ai-logic` (Cloud LLM inference):** Sends the sanitized prompt to Gemini (`gemini-4-hydrogen` or `gemini-3.1-flash-lite`).
3. **`oaie-local-evaluator` (TypeScript placeholder re-hydration, on-device):** Restores original values into `[TYPE_N]` placeholders locally.

Hybrid is justified in `decisionEngine.ts:533–536` **only** when:
- Sensitive entities exist AND pass fail-closed redaction verification (`canSafelyRedact === true` and `piiSpans.length > 0 && !redactionUncertain`), **or**
- `analysis.hasAttachments` is true (text pre-scoped locally before cloud reasoning).

#### Status of Firebase AI Logic `PREFER_ON_DEVICE` ("Firebase Hybrid")
`src/services/firebaseAI.ts:39–45` exports `getFirebaseHybridModel()` using `InferenceMode.PREFER_ON_DEVICE`, **but source search confirms zero callers anywhere in `src/` or `tests/`** (`grep` found only its definition). When `VITE_ENABLE_FIREBASE_AI_LOGIC=true` or `VITE_CLOUD_BACKEND=firebase-ai-logic`, `browserProbes.ts:218–224` calls only `executeViaFirebaseAiLogicCloud()` with `InferenceMode.ONLY_IN_CLOUD`. By default (`VITE_CLOUD_BACKEND="auto"` with `server.ts` healthy), ORBIT uses Express `POST /api/ai/execute` (`server-gemini`), verified live via `GET /api/health`.

### 1.4 Which browsers and devices support current local inference?
- **Supported in principle:** **Desktop Google Chrome 138+** (or Chromium derivatives with Optimization Guide On-Device Model + Prompt API enabled, WebGPU/sufficient RAM, and 1.7–4 GB free storage quota).
- **Unsupported for local inference today:**
  - **Mozilla Firefox / Apple Safari (macOS & iOS):** No `globalThis.LanguageModel` Prompt API. Also hide `navigator.deviceMemory`.
  - **iOS browsers (Chrome/Edge/Firefox on iOS):** Forced WebKit engine; no Prompt API.
  - **Android Chrome / Android WebView:** Desktop Chrome Prompt API (`globalThis.LanguageModel`) is not generally exposed on standard Android Chrome builds and has no native bridge in this codebase.

### 1.5 Does Android have real native local inference integration?
**No.** There is no `android/` workspace, Capacitor/Cordova plugin, React Native native module, MediaPipe/LiteRT runtime, or Android AICore (`Gemini Nano` native Android SDK) integration anywhere in `package.json` or `src/`. Running on Android uses standard Mobile Web browser APIs only.

### 1.6 Does offline execution work without hidden cloud fallback?
**Yes.** Verified across unit tests and `tests/oaie.phase5.test.ts`:
- When `network.online === false` or `network.cloudReachable === false`, `scoreCloudRoute` and `scoreHybridRoute` immediately return `eligible: false` (`decisionEngine.ts:313–336, 478–501`).
- Offline eligible `LOCAL` English tasks execute exclusively through `localExecutor.executeLocal()`.
- Unsupported/Arabic/coding/2 GB offline tasks return `route: 'BLOCKED'` (`status: 'blocked'`) with zero `fetch('/api/ai/execute')` calls.
- Mid-flight `fetch` disconnects (`TypeError: Failed to fetch`) return `status: 'error'` with zero automatic retries or silent fallbacks (`tests/oaie.phase5.test.ts:203–220`).

### 1.7 Are device resource measurements real or simulated?
- **Real Web APIs used in browsers (`src/services/browserProbes.ts:26–208`):**
  - `navigator.deviceMemory` (chromium-only, coarsened/capped at `<= 8 GB`; `null` in Firefox/Safari/Node)
  - `navigator.hardwareConcurrency`
  - `Boolean(navigator.gpu)` (WebGPU adapter API presence, not VRAM size)
  - `navigator.storage.estimate().quota`
  - `navigator.onLine` and `navigator.connection` (`effectiveType`, `rtt`, `downlink`, `saveData`)
  - `performance.memory.usedJSHeapSize` in `src/services/browserBenchmark.ts:63–70` (non-standard Chrome JS heap only; excludes GPU/out-of-process Nano weights)
- **Cannot be collected by the web app:**
  - Actual OS/system CPU % utilization or core throttling
  - Out-of-process Chrome Optimization Guide / Nano native RAM/VRAM RSS
  - Device battery drain / thermal throttling state
  - Actual Gemini billing ledger charges (all USD values in `costEstimator.ts` come from static per-1k token constants)
  - Streaming **Time to First Token (TTFT)** (both `localInference.ts:250` `session.prompt()` and `server/security.ts:394` `ai.models.generateContent()` are non-streaming unary calls)
- **Simulated in CI/Node tests:** `SYNTHETIC_DEVICE_TIERS` (`low_2gb`, `entry_3_4gb`, `mid_6gb`, `high_8gb_plus`) in `src/engine/benchmarkCorpus.ts` and mocked `DeviceProbe`/`fetch` doubles.

---

## 2. Verification Summary (What Actually Ran vs. Mocked)

| Verification Layer | Command / Mechanism | Result | Real vs. Mocked |
| :--- | :--- | :--- | :--- |
| Full Vitest suite (`tests/*.test.ts`) | `npm test` | Passed (including privacy, execution, Phase 5, server security) | Deterministic Node engine + mocked Chrome Prompt API + mocked `fetch`/certs |
| Baseline OAIE harness | `npx tsx tests/oaie.benchmark.baseline.ts` | `8/8` TaskType Match, `7/8` Route Match | Deterministic engine timings (`p50`/`p95` µs) on synthetic hardware profiles |
| Live Express health check | `GET http://localhost:3000/api/health` | HTTP 200 `{ ok: true, geminiConfigured: true, authRequired: true }` | **Real local Node/Express process** |
| Real Chrome Prompt API / Mobile run | `runBrowserBenchmarkSuite()` in UI | Not executed in container (`NO_BROWSER_BINARY`) | Requires physical Chrome 138+ desktop & mobile hardware |

---

## 3. EWMA Calibration Intelligence Audit (`tests/oaie.phase5.test.ts`)

We tested `LatencyCalibrator(0.35)` with **10 extreme observations** (`chrome-gemini-nano = 22,000 ms`, `gemini-3.1-flash-lite = 450 ms`, `gemini-4-hydrogen = 750 ms`) on a simple Q&A (`"Briefly define TLS."`, `8+ GB` online profile):

| Privacy Mode | State | Selected Route | Predicted Latency | Route Scores | Did EWMA Flip Decision? |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `BALANCED` | Uncalibrated | `LOCAL` | `7,015 ms` | LOCAL `100`, CLOUD `82` | — |
| `BALANCED` | After 10× EWMA (`22s` vs `0.45s`) | **`LOCAL`** | **`22,811 ms`** (`+225%`) | LOCAL `97`, CLOUD `84` | **No — locked by privacy/local bias** |
| `FLEXIBLE` | Uncalibrated | `LOCAL` (tie `89 == 89`) | `7,015 ms` | LOCAL `89`, CLOUD `89` | — |
| `FLEXIBLE` | After 10× EWMA (`22s` vs `0.45s`) | **`CLOUD`** | **`933 ms`** | LOCAL `84`, **CLOUD `92`** | **Yes — flips tie to Cloud** |

**Engineering conclusion:**
- Under `FLEXIBLE` mode (symmetric privacy alignment `80` vs `80`, `localSuitabilityBonus = 0`), EWMA calibration **genuinely flips slow local routes to faster cloud routes** (`89 == 89` tie → `84 vs 92`).
- Under default **`BALANCED` mode**, EWMA primarily adapts **displayed ETAs** (`7,015 ms → 22,811 ms`), NOT routing choices, because `privacyAlignment` (`98 vs 60` × `0.30/0.25` ≈ `+14.4` weighted pts) + `localSuitabilityBonus` (`+8`) overwhelm the `15%` latency weight and the `latencyScore` floor of `45` (`decisionEngine.ts:225`).
- In addition, `pickBestCloudModel()` (`decisionEngine.ts:59–96`) never reads EWMA calibration or `2G`/`saveData` conditions when selecting between `gemini-4-hydrogen` and `gemini-3.1-flash-lite`.

---

## 4. Documented Algorithm Weaknesses & Inferior Route Cases

1. **EWMA Route Lock-in Under `BALANCED`:** As proven above, even when local inference runs 38× slower (`22.8s` vs `0.6s`), `BALANCED` continues picking `LOCAL` (`97` vs `84`).
2. **Offline Arabic Complete Failure:** A harmless 4-word offline Arabic prompt (`"ما هي عاصمة فرنسا؟"`) is `BLOCKED` (`supportsArabicWell: false`), even when desktop Chrome Gemini Nano is downloaded and idle, whereas attempting local draft with an explicit quality warning would serve users offline.
3. **Rule `bench_07_pii_hybrid` Disagreement & Sensitivity False Positives:**
   - Because `chrome-gemini-nano` is available on synthetic `high_8gb_plus`, `decideRoute` routes `bench_07_pii_hybrid` (`LOCAL = 100`, `HYBRID = 90`) to **`LOCAL`** rather than `HYBRID`, leaving `Route Match = 7/8`. From a privacy standpoint `LOCAL` is strictly safer, though latency/quality trade-offs exist.
   - Because Phase 4 fail-closed privacy protection intentionally blocks unredacted sensitive keywords (`"medical"`, `"salary"`, `"confidential"`), non-personal educational questions like `"Explain general privacy threat modeling for confidential payroll systems."` are **`BLOCKED`** whenever no local model is present (`tests/oaie.phase5.test.ts:500–521`).
4. **No Streaming Support (Zero TTFT Visibility):** Neither local nor cloud executors stream tokens, hiding perceived responsiveness differences between fast local cold/warm bursts and cloud SSE chunks.
5. **Static Cloud Model Selection & Cost Table:** `pickBestCloudModel()` ignores live EWMA speeds and `saveData` signals when picking between `gemini-3.1-flash-lite` and `gemini-4-hydrogen`, and `LatencyCalibrator` is volatile in-memory / telemetry-seeded without cross-tab/cross-device hardware-normalized keys.

---

## 5. Security & Privacy Verification Highlights

Tested in `tests/oaie.phase5.test.ts` (`lines 77–279`) and `tests/oaie.privacy.test.ts` with a live mock signed-in user spying on `globalThis.fetch('/api/ai/execute')`:
- **`STRICT_LOCAL`:** Zero `/api/ai/execute` HTTP calls whether Nano is ready (`LOCAL`) or unavailable (`BLOCKED`).
- **Incomplete / Missing Redaction (`BALANCED`, `FLEXIBLE`, `CUSTOM`):** Zero HTTP calls when prompts contain sensitive English/Arabic keywords (`"medical diagnosis"`, `"salary"`, `"تشخيصي الطبي"`, `"كلمة المرور"`) without extractable PII spans.
- **Verified International / Arabic Hybrid Wire Payload:** IBAN (`SA03 8000 0000 6080 1016 7519`), Saudi E.164 phone (`+966 55 111 2233`), email (`ops@orbit.dev`), and `password=...` are replaced with `[EMAIL_1]`, `[IBAN_1]`, `[PHONE_1]`, `[SECRET_1]` before `fetch('/api/ai/execute')` body serialization, with zero raw values on the wire, and re-hydrated locally post-response.
- **Plan Tampering Defense:** Passing a tampered raw `CLOUD` `ExecutionPlan` directly into `executePlan()` is blocked at `verifySanitizedPayloadForCloud()` with zero `fetch()` calls.

**Remaining privacy risks:**
- Conceptual non-PII prompts containing trigger nouns (`"confidential"`, `"salary"`, `"medical"`) fail closed to `BLOCKED` on non-Nano browsers (usability false positive).
- Novel unstructured secrets or names without standard formats/labels (e.g., an unlabeled street address or free-form narrative secret without keywords) still rely on user selecting `STRICT_LOCAL` because regex cannot achieve 100% recall on arbitrary prose.

---

## 6. Three Highest-Priority Engineering Improvements

1. **Implement Streaming (`promptStreaming()` + SSE `/api/ai/execute`) & Uncap Latency Score in `BALANCED`:** Add true token streaming on both local Chrome Nano and Express Gemini routes so TTFT is measurable and perceived latency drops; remove the `45`-point floor on `latencyScore` so persistently slow local runs (`>15s`) gracefully yield to Cloud when latency degrades UX.
2. **Distinguish Personal Secrets vs. Educational Concepts (Named-Entity + Possessive/Structured Context Classifier):** Prevent educational questions (`"confidential payroll threat modeling"`) from hitting fail-closed `BLOCKED` on Firefox/Safari/Mobile while keeping fail-closed enforcement on possessive/identifying records (`"my salary"`, `"patient record"`, tokens, IBANs, IDs).
3. **Add Native/Cross-Platform Local Fallback (`WebLLM` / Android AICore Bridge or Opt-in Offline Arabic Best-Effort Mode):** Integrate WebGPU WebLLM (or Android native wrapper) for Firefox/Edge/Android where Chrome Prompt API is absent, and permit optional offline Arabic drafting with an explicit accuracy caveat instead of hard-blocking offline users.
