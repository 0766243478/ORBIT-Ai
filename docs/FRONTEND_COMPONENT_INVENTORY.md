# ORBIT AI — Frontend Component & Service Inventory

> **Scope**: Complete file-level inventory of `index.html`, `src/**`, and client-side integrations. Every status and limitation is verified directly from source inspection.

---

## 1. Entry & Application Shell

| File | Responsibility | Status | Key Observations / Dependencies |
|---|---|---|---|
| `index.html` | Document shell, meta/OG tags, Google Fonts (`Plus Jakarta Sans`, `IBM Plex Sans Arabic`, `JetBrains Mono`) | **Functional** | Missing `viewport-fit=cover` / `interactive-widget=resizes-content`; `<html class="dark">` hardcoded. |
| `src/index.css` | Tailwind v4 CSS import (`@import "tailwindcss";`), `@theme` fonts, dark base styling, scrollbar styling | **Functional** | Lacks semantic CSS custom properties for surface/accent tokens; no `@keyframes` for subtle orb/loading states or mobile safe-area helpers. |
| `src/main.tsx` | React 19 `createRoot` mount inside `<ErrorBoundary>` | **Functional** | Clean entry point. |
| `src/components/ErrorBoundary.tsx` | Top-level class error boundary | **Functional** | Displays fallback card + `"Reload Application"` button (`window.location.reload()`). Hardcoded English copy (does not read `language`). |
| `src/App.tsx` | Central state coordinator (navigation, auth, Firestore hydration, preferences, `OrbitEngine` lifecycle, `runTask`) | **Functional (Heavy Coupling / Gaps)** | 595 lines holding all app state. Gaps: no URL routing; silent `.slice(0, 15)` on conversation load; reloaded messages lose `executionResult` & `attachments`; `onAuthStateChanged` captures stale initial `engine = null` closure (`App.tsx:185`); `refreshEnvironment()` instantiates a fresh `OrbitEngine`, wiping session `LatencyCalibrator` unless re-seeded; sends only single-turn prompt (drops prior messages). |

---

## 2. UI Views & Components (`src/components/`)

| Component | Lines | Consumed Props / Services | Status | Specific UX & Technical Findings |
|---|---|---|---|---|
| `src/components/TopNav.tsx` | 165 | `activeScreen`, `user`, `authLoading`, `t` | **Functional** | Sticky desktop 3-zone header (`h-14`). On `<sm` hides Sign In/Out inside menu; mobile menu button (`~34px`) < 44px touch target; uses hardcoded English `aria-label="Toggle navigation menu"`. |
| `src/components/OnboardingView.tsx` | 148 | `language`, `privacyMode`, callbacks | **Functional** | Clean 2-column hero + language (`EN`/`AR`) & starting privacy posture picker + 3 honest principle cards. Lacks visual focal centerpiece (e.g., ORBIT signature orb from `Screenshot_20261114-164628`) and feels desktop-heavy above the fold on mobile. |
| `src/components/AssistantView.tsx` | 555 | `conversations`, `activeConversationId`, `isExecuting`, `device`, `network`, `serverHealth`, `t` | **Functional (Needs Mobile & Formatting Upgrade)** | Issues: uses `h-[calc(100vh-3.5rem)]` instead of `dvh`; no message auto-scroll; no Markdown/code block renderer (`whitespace-pre-wrap` only); no message copy/retry actions; sidebar mobile drawer lacks backdrop scrim & swipe/escape close; conversation delete button hidden (`opacity-0 group-hover:opacity-100`); `"Conversations"` toggle & attachment remove buttons undersized for touch; `"Routing & executing…"` widens submit button and crushes mobile textarea; no inline privacy/mode switcher. |
| `src/components/ExecutionDetailsDrawer.tsx` | 260 | `execution: ExecutionResult \| null`, `language`, `t` | **Partial (Needs Phase 6 Fields)** | Shows summary telemetry grid, rationale, privacy guarantee, plan step traces, constraint gates, route scores table, and limitations. Missing: backdrop dim & Escape-key close; Phase 6 `decision.explainability` UI (`confidence.level`, `unreliableSignals`, `measurements` provenance badges, structured `rejectedAlternatives`, `networkLimitations`). |
| `src/components/PrivacyCenterView.tsx` | 259 | `privacyMode`, `customPreferences`, `engine`, `t` | **Functional** | Interactive 4 mode cards, boolean/numeric `CUSTOM` overrides, and working `engine.simulateDecision()` sandbox. Simulator preview only renders 1 summary line + constraints—does not display Phase 6 `explainability.confidence` or `conceptualSecurityDiscussion` flag. |
| `src/components/IntelligenceDashboardView.tsx` | 529 | `device`, `network`, `models`, `telemetry`, `serverHealth`, `runBrowserBenchmarkSuite`, `triggerLocalModelDownload`, `t` | **Functional** | Real hardware/Prompt-API/network/backend cards, downloadable Gemini Nano progress bar, live 8-task browser benchmark runner with JSON export, and filterable telemetry table. Tables are dense on `360px` phones; relies on `alert`-free clipboard copy. No visualization of `LatencyCalibrator` reliability/sample readiness. |
| `src/components/SettingsView.tsx` | 216 | `language`, `persistConversations`, `user`, `firestoreConnection`, `serverHealth`, `firebaseMetadata`, `t` | **Functional** | Language switcher, explicit Firestore storage opt-in (`persistConversations`), session/cloud clear actions, account info, and honest Firebase/AppCheck/backend diagnostics + mobile compatibility notice. |

---

## 3. Client Services & Localization (`src/services/`, `src/i18n/`)

| File | Responsibility | Status | Key Findings & Integration Risks |
|---|---|---|---|
| `src/services/browserProbes.ts` | `browserDeviceProbe`, `browserNetworkProbe`, `probeServerHealth`, `browserLocalExecutor`, `browserCloudExecutor`, `createBrowserOrbitEngine` | **Functional** | Real browser API reads (`deviceMemory`, `hardwareConcurrency`, `storage.estimate`, `navigator.connection`); 8s `/api/health` cache checks `application/json` content-type so static hosting doesn't masquerade as Express. Passes `Authorization: Bearer` + `X-Firebase-AppCheck` headers. Uses blocking `fetch()` (no `AbortSignal` or streaming). |
| `src/services/localInference.ts` | Chrome Built-in Prompt API (`globalThis.LanguageModel` / `ai.languageModel`) probe, download trigger, 120s TTL warm session reuse | **Functional (Chrome Desktop 138+)** | Handles `available` / `downloadable` / `downloading` / `unavailable`, download progress monitor, detached-session retry, and explicit `allowSessionCache = false` gating for `low_2gb` / `entry_3_4gb`. Blocking `prompt()` (does not use `promptStreaming()`). |
| `src/services/firebase.ts` | Firebase App, Firestore DB (`ai-studio-48d8a92c-085f-471b-a6c7-295558c033e3`), Google Auth, App Check (`v3`/`enterprise`), `testFirestoreConnection` | **Functional** | Safely reads `firebase-applet-config.json` + env overrides; catches App Check failures safely (`getAppCheckTokenSafe()` returns `null`); structured Firestore error logging. |
| `src/services/firebaseAI.ts` | Firebase AI Logic client (`GoogleAIBackend`, `ONLY_IN_CLOUD`) | **Partial** | `executeViaFirebaseAiLogicCloud()` works when `VITE_CLOUD_BACKEND=firebase-ai-logic` or auto-fallback; **`getFirebaseHybridModel()` (lines 39-45) is unused dead code**; non-streaming `generateContent()`. |
| `src/services/firestoreRepo.ts` | CRUD for `users/{uid}/private/profile`, `conversations`, `messages`, `telemetry` | **Functional (Schema Constraints)** | Validates/clamps fields matching `firestore.rules`. `StoredMessage` schema omits `executionResult` summary and attachment metadata; `clearUserTelemetry` deletes sequentially in a loop rather than `writeBatch`. |
| `src/services/browserBenchmark.ts` | Client-side 8-task live browser runner (`local_only` / `full_comparison`), JS heap delta, cold/warm stats | **Functional** | Honest browser-side harness (`performance.memory` guarded with `null` fallback). Accepts optional `AbortSignal`, though `IntelligenceDashboardView.tsx` does not wire a Cancel button yet. |
| `src/i18n/translations.ts` | Complete EN (LTR) + AR (RTL) dictionary | **Functional** | Clean parity between `en` and `ar` keys (722 lines). Missing labels for Phase 6 explainability badges (confidence levels, measurement provenance tags, rejected alternatives) and chat markdown/copy actions. |

---

## 4. Unused Dependencies & Missing Capabilities Summary

- **Installed but Unused**: `motion` (`^12.23.24` in `package.json:25`) is not imported anywhere; animations currently use CSS `transition-colors` / `animate-spin`.
- **Dead Export**: `getFirebaseHybridModel` (`src/services/firebaseAI.ts:39`).
- **Missing Capabilities**:
  1. Markdown + syntax-highlighted/copyable code rendering for assistant answers.
  2. Multi-turn context history passing (decision needed whether privacy/token budget scopes context to session or opt-in window).
  3. Streaming responses (`SSE` / `ReadableStream` on `/api/ai/execute` + `promptStreaming()` on Chrome Nano) and in-flight abort (`Stop` button).
  4. Rich UI rendering of Phase 6 `decision.explainability` (`confidence`, `measurements` provenance, `rejectedAlternatives`, `networkLimitations`).
  5. Mobile-first `100dvh` layout, `44px+` touch targets, unified mobile chat header, auto-growing composer, auto-scroll, and touch-accessible conversation management.
