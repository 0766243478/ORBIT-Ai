# ORBIT AI — Technical Architecture & Specification

## 1. Product Vision & Core Principle

> "One intelligent assistant. Every device. Every situation. Always the right execution strategy."

ORBIT AI is powered by the **ORBIT Adaptive Intelligence Engine (OAIE)**, a modular, deterministic TypeScript routing, planning, execution, and transparency engine that evaluates every prompt against device capabilities, network state, model readiness, cost, and strict user privacy constraints before choosing **LOCAL**, **CLOUD**, **HYBRID**, or **BLOCKED**.

---

## 2. OAIE Modular Pipeline (11 Modules)

Located in `src/engine/`:

1. **Task Analyzer (`taskAnalyzer.ts`)**: Validates inputs, classifies task type (`simple_qa`, `summarization`, `rewrite_proofread`, `classification_extraction`, `coding_technical`, `deep_reasoning`, `translation`, `pii_sensitive_draft`, `unsupported`), estimates complexity, token count, payload bytes, language (`en` / `ar`), and detects PII/secret spans across combined prompt + attachment payloads.
2. **Device Capability Profiler (`deviceProfiler.ts`)**: Probes browser hardware (`navigator.deviceMemory`, `navigator.hardwareConcurrency`), WebGPU availability (`navigator.gpu`), storage estimate, and real Chrome Prompt API availability (`LanguageModel.availability()`).
3. **Network Monitor (`networkMonitor.ts`)**: Probes `navigator.onLine`, Network Information API (`effectiveType`, `rtt`, `downlink`, `saveData`), and real cloud backend reachability (`/api/health` JSON check or configured Firebase AI Logic mode).
4. **Privacy Guardian (`privacyGuardian.ts`)**: Enforces hard privacy gates before scoring (`STRICT_LOCAL`, `BALANCED`, `FLEXIBLE`, `CUSTOM`) and executes deterministic local PII redaction (`[EMAIL_1]`, `[PHONE_1]`, `[SECRET_1]`) + local post-response re-hydration for hybrid execution.
5. **Cost Estimator (`costEstimator.ts`)**: Computes token-based USD cost estimates across local ($0.0000) and cloud Gemini models and enforces `maxEstimatedCostUsd` budgets.
6. **Model Registry (`modelRegistry.ts`)**: Tracks real model capabilities, context windows, latency baselines, auth readiness, and enforces a single non-conflicting cloud backend (`gemini-server-api` OR `firebase-ai-logic`).
7. **Decision Engine (`decisionEngine.ts`)**: Two-phase deterministic router:
   - Phase A: Hard constraints gate (offline, `STRICT_LOCAL` lock, missing local model, unauthenticated cloud backend, device memory pressure, attachment restrictions, payload size, cost cap, unsupported tasks).
   - Phase B: Weighted multi-criteria scoring across `LOCAL`, `HYBRID`, and `CLOUD` with bilingual (`en`/`ar`) labels.
8. **Task Planner (`taskPlanner.ts`)**: Builds explicit multi-step `ExecutionPlan` objects (including 3-step Hybrid decomposition: local analysis & sanitization -> scoped cloud reasoning -> local re-hydration & evaluation).
9. **Execution Manager (`executionManager.ts`)**: Orchestrates real local execution (Chrome Prompt API) and authenticated cloud execution (`/api/ai/execute` or Firebase AI Logic `GoogleAIBackend`), strictly forbidding silent cloud fallback in `STRICT_LOCAL` mode.
10. **Result Evaluator (`resultEvaluator.ts`)**: Evaluates output completeness, measured latency vs estimate delta, actual token usage, and cloud PII leakage checks.
11. **Decision Explanation System (`decisionExplainer.ts`)**: Generates transparent bilingual (`en` and `ar`) rationales, constraint evaluations, score comparisons, and honest limitation disclosures.

---

## 3. Supported Local Inference Platforms & Limitations

### Web (Browser Runtime)
- **Supported**: Desktop Google Chrome **138+** (or Chrome Canary/Dev) with Chrome Built-in AI Prompt API (`globalThis.LanguageModel`) enabled and Gemini Nano weights downloaded (~1.7–4 GB; Chrome enforces ~22 GB free disk space).
- **Unsupported on Web**: Apple Safari, Mozilla Firefox, all iOS browsers (WebKit restriction), standard mobile browsers without Prompt API, and headless/container Chromium instances — `probeChromeLocalModel()` reports `'unavailable'` honestly and **never** simulates local inference with a cloud request.

### Android & React Native / Expo Readiness
- **Android Native**: Requires **Android 14+ (API 34+)** on AICore-supported devices (e.g., Pixel 8/9/10, Galaxy S24/S25) using `com.google.firebase:firebase-ai` (`InferenceMode.PREFER_ON_DEVICE` / `ONLY_ON_DEVICE`) backed by ML Kit GenAI / AICore.
- **Expo / React Native**: **Expo Go is NOT supported** for on-device inference because it lacks native AICore/ML Kit bindings. Supporting on-device inference requires a custom development build (`expo-dev-client`) with a native Kotlin/Swift Config Plugin.
- **iOS Native**: Future iOS support targets CoreML / Apple Foundation Models via the same `DeviceProbe` and `LocalRuntimeExecutor` interfaces in `src/engine/` (which contain zero DOM dependencies).

---

## 4. Cloud Execution Path, Security & Spark Hosting Compatibility

- **Single Active Cloud Path (No Conflicting Routes)**:
  - **Full-Stack / AI Studio Mode (`server-gemini`)**: Express (`server.ts` + `server/security.ts`) handles `POST /api/ai/execute` via `@google/genai` with `GEMINI_API_KEY` kept strictly server-side. Every request requires:
    1. A valid Firebase Auth RS256 ID token (`Authorization: Bearer <token>`, `email_verified: true`).
    2. Firebase App Check JWT verification (`X-Firebase-AppCheck` against `https://firebaseappcheck.googleapis.com/v1/jwks`) when enforced or supplied.
    3. Strict JSON validation (`prompt` <= 48,000 chars, explicit allowlisted `modelId`: `gemini-4-hydrogen` or `gemini-3.1-flash-lite`) and sliding-window per-UID/IP rate limiting (`429`).
  - **Static Firebase Hosting Mode (`firebase-ai-logic`, Spark-Compatible)**: Because Firebase Hosting's static CDN (`dist/`) does not run Express `server.ts`, `probeServerHealth()` checks `Content-Type: application/json` on `/api/health` so SPA HTML rewrites are never misidentified as a live Express API. For Spark static Hosting without Blaze Cloud Run/Functions, set `VITE_CLOUD_BACKEND=firebase-ai-logic` (or `VITE_ENABLE_FIREBASE_AI_LOGIC=true`) and enable **Firebase AI Logic** + **App Check** in the Firebase Console.
- **Firebase App Check Provider Selection**:
  - Configurable via `VITE_FIREBASE_APP_CHECK_PROVIDER` (`v3` for `ReCaptchaV3Provider` or `enterprise` for `ReCaptchaEnterpriseProvider`) paired with `VITE_FIREBASE_APP_CHECK_SITE_KEY` or `firebase-applet-config.json`'s `recaptchaSiteKey`.
