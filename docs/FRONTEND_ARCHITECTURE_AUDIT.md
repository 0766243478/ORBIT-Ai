# ORBIT AI — Frontend Architecture Audit

> **Audit Scope & Constraints**: Read-only code inspection of `index.html`, `package.json`, `vite.config.ts`, `server.ts`, `server/security.ts`, `src/**`. No source, backend, dependency, or OAIE files were modified during this audit.

---

## 1. Framework, Runtime & Build Stack

| Layer | Technology / Version (`package.json`) | Notes & Actual Usage |
|---|---|---|
| UI Library | `react` `^19.0.1`, `react-dom` `^19.0.1` | SPA mounted at `#root` via `createRoot` (`src/main.tsx:6`). |
| Build Tool | `vite` `^8.3.0`, `@vitejs/plugin-react` `^6.1.1` | `@` alias mapped to workspace root (`vite.config.ts:11`); HMR controllable via `DISABLE_HMR`. |
| Language | `typescript` `^7.0.2` (`tsc --noEmit`) | Strict modular TypeScript across `src/`, `server/`, and `tests/`. |
| Styling | `tailwindcss` `^4.3.3`, `@tailwindcss/vite` `^4.3.3` | Zero inline styles or component CSS files; single global CSS entry `src/index.css`. |
| Icons & Motion | `lucide-react` `^0.546.0`, `motion` `^12.23.24` | `lucide-react` used actively across components; **`motion` is installed but unused** in `src/`. |
| Cloud SDKs | `firebase` `^13.3.0` | Firebase Auth (Google popup), Cloud Firestore, App Check (`v3` / `enterprise`), Firebase AI Logic (`firebase/ai`). |
| Dev/Prod Host | `express` `^4.21.2`, `tsx` `^4.21.0` (`server.ts`) | Serves `/api/health`, `/api/ai/execute`, plus Vite middlewares (`dev`) or static `dist/` (`start`). |

---

## 2. Entry Points & Page Routing Structure

1. **HTML Document (`index.html`)**:
   - Hardcoded `<html lang="en" dir="ltr" class="dark">` (overridden dynamically at runtime by `src/App.tsx:96-99`).
   - Standard viewport `<meta name="viewport" content="width=device-width, initial-scale=1.0" />` (**lacks `viewport-fit=cover` or `interactive-widget=resizes-content`** for mobile safe-area and virtual-keyboard ergonomics).
   - Loads Google Fonts: `Plus Jakarta Sans`, `IBM Plex Sans Arabic`, `JetBrains Mono`.
2. **React Bootstrap (`src/main.tsx`)**:
   - Wraps `<App />` in class-based `<ErrorBoundary>` (`src/components/ErrorBoundary.tsx`).
3. **Screen Navigation (`src/App.tsx:54-62`, `src/components/TopNav.tsx:6-12`)**:
   - **No URL routing library** (`react-router` or History API syncing is absent).
   - Screens are controlled exclusively by React state `activeScreen: 'onboarding' | 'assistant' | 'privacy' | 'intelligence' | 'settings'`.
   - Initial route checks `localStorage.getItem('orbit_onboarded') === '1'` -> `'assistant'`, otherwise `'onboarding'`.
   - **Architectural implication**: Browser Back/Forward gestures do not navigate between views; conversation IDs and tabs cannot be deep-linked or refreshed cleanly.

---

## 3. Component Organization

All UI lives flat inside `src/components/` (8 components total; no atomic UI primitive library or shared `ui/` directory):

- `src/App.tsx` (595 lines) — Root container, state store, auth/Firestore sync, engine execution handler.
- `src/components/TopNav.tsx` (165 lines) — Sticky `56px` global header + mobile collapsible menu drawer.
- `src/components/OnboardingView.tsx` (148 lines) — Landing/setup view with EN/AR selector & starter privacy posture.
- `src/components/AssistantView.tsx` (555 lines) — Main workspace: conversation sidebar, environment status bar, auth banner, message stream, file attachment + prompt composer.
- `src/components/ExecutionDetailsDrawer.tsx` (260 lines) — Right/end-anchored slide-over panel inspecting a single `ExecutionResult`.
- `src/components/PrivacyCenterView.tsx` (259 lines) — Mode cards (`STRICT_LOCAL`, `BALANCED`, `FLEXIBLE`, `CUSTOM`), custom policy inputs, and live OAIE route simulator (`engine.simulateDecision()`).
- `src/components/IntelligenceDashboardView.tsx` (529 lines) — Live hardware/network/local/cloud probe cards, session metrics strip, live 8-task browser benchmark runner (`runBrowserBenchmarkSuite`), and telemetry table.
- `src/components/SettingsView.tsx` (216 lines) — Language toggle, Firestore persistence opt-in, session/cloud clearing, account card, Firebase/AppCheck diagnostics.
- `src/components/ErrorBoundary.tsx` (50 lines) — Top-level runtime crash fallback.

---

## 4. Styling System & Design Tokens

- **Token definition (`src/index.css:1-14`)**:
  - Imports `@import "tailwindcss";` and `@custom-variant dark (&:where(.dark, .dark *));`.
  - Defines `@theme` font tokens `--font-sans` (`Plus Jakarta Sans`, `IBM Plex Sans Arabic`, system fallback) and `--font-mono` (`JetBrains Mono`).
  - No semantic color tokens (`--bg-surface`, `--accent`, etc.) exist in CSS; palette values are repeated verbatim as utility classes across files:
    - Primary Canvas: `#0B0F17`
    - Secondary Shell (Sidebar / Nav Drawer / Composer / Drawer): `#0E141F`
    - Elevated Card / Input Surface: `#111827`
    - Hover / Selected / User Bubble Surface: `#151D2B`
    - Active Toggle Segment: `#1E293B`
    - Borders: `border-slate-800` / `border-slate-800/80` / `border-slate-700`
    - Accents: `sky-400`/`sky-500` (primary CTA & Cloud), `emerald-400` (Local/pass), `amber-400` (Hybrid/redaction), `red-400` (Blocked/error).
- **Theme & i18n Directionality**:
  - Dark mode only (no light theme).
  - Full logical CSS support for RTL Arabic and LTR English (`ms-*`, `me-*`, `start-*`, `end-*`, `text-start`, `rtl:rotate-180`), synchronized onto `document.documentElement.lang` and `dir`.
  - All UI copy is centralized in `src/i18n/translations.ts` (722 lines, EN + AR).

---

## 5. State Management & Persistence Architecture

`src/App.tsx` acts as the single centralized state container (15 `useState` hooks), passing props downward and callbacks upward:

| State Domain | Owner | Persistence | Verified Gaps / Risks |
|---|---|---|---|
| Navigation (`activeScreen`) | `App.tsx` | Only `orbit_onboarded` flag in `localStorage` | No URL sync; reload always resets to `'assistant'`. |
| Preferences (`language`, `privacyMode`, `customPreferences`, `persistConversations`) | `App.tsx` | Synced to Firestore `users/{uid}/private/profile` when signed in | Default `persistConversations = false` (`App.tsx:69`). Anonymous changes are lost on page refresh (not persisted to `localStorage`). |
| Conversations (`conversations`, `activeConversationId`) | `App.tsx` | Optional Cloud Firestore (`conversations` + `messages` subcollection) only if signed in AND `persistConversations === true` | **Metadata loss on reload**: Hydrated `UiMessage` objects (`App.tsx:153-164`) omit `executionResult` and `attachments`. Reloaded assistant messages lose their `"Inspect execution"` trigger. `listUserConversations` slices to top 15 (`App.tsx:146`). |
| OAIE Engine Instance & Probes (`engine`, `device`, `network`, `models`, `serverHealth`) | `App.tsx` + `browserProbes.ts` | In-memory; re-created on boot, `online`/`offline` events, auth state change, and manual Refresh Probes | **Stale closure risk (`App.tsx:185, 194`)**: `onAuthStateChanged` registers with `[]` deps (`eslint-disable-next-line`). Because `engine` starts as `null` before `refreshEnvironment()` resolves, `engine?.seedTelemetry(storedTelemetry)` on boot sign-in can silently evaluate against `null` engine and skip EWMA telemetry seeding. Additionally, `refreshEnvironment()` creates a brand-new `OrbitEngine` instance (`createBrowserOrbitEngine()`), resetting the in-memory `LatencyCalibrator` whenever `online`/`offline` or `Refresh Probes` fires! |
| Execution Telemetry (`telemetry`) | `App.tsx` | Written per run to Firestore `telemetry/{id}` when signed in | Does not store `executionResult` detail objects or `explainability` metadata; cleared locally cleanly, cloud deletion deletes user `telemetry` docs. |

---

## 6. Backend & OAIE Frontend Integration Audit

### 6.1 How Frontend Consumes OAIE (`src/engine/`)
- **Browser Adapter (`src/services/browserProbes.ts`)**: Instantiates `OrbitEngine` (`src/engine/index.ts`) with:
  - `browserDeviceProbe`: reads `navigator.userAgent`, `navigator.deviceMemory` (unavailable/null on Safari/Firefox), `navigator.hardwareConcurrency`, `navigator.gpu` (`webGpuAvailable`), `navigator.storage.estimate()`, and Chrome Prompt API status (`probeChromeLocalModel()`).
  - `browserNetworkProbe`: reads `navigator.onLine`, `navigator.connection` (`effectiveType`, `rtt`, `downlink`, `saveData` — Chromium-only), plus `/api/health` latency probe (8s cache).
  - `browserLocalExecutor`: delegates to `executeChromeLocalPrompt()` (`src/services/localInference.ts`), supporting `allowSessionCache` (automatically `false` on `low_2gb` and `entry_3_4gb` in `executionManager.ts:117-122`), 120s idle eviction TTL, and session recreation on detached Chrome sessions.
  - `browserCloudExecutor`:
    - If `provider === 'firebase-ai-logic'`, calls `executeViaFirebaseAiLogicCloud()` (`InferenceMode.ONLY_IN_CLOUD`). *(Note: `getFirebaseHybridModel()` in `firebaseAI.ts:39-45` is dead/unused code.)*
    - Otherwise enforces `auth.currentUser`, attaches Firebase ID token (`Authorization: Bearer ...`) and safe App Check token (`X-Firebase-AppCheck` via `getAppCheckTokenSafe()`), and `POST`s to `/api/ai/execute`.

### 6.2 Critical Integration Gaps Between Frontend & Backend/OAIE
1. **Single-Turn Prompt Dispatch Only (No Conversation Context)**:
   - `App.tsx:350-355` passes `{ prompt, attachments, language }` to `activeEngine.runTask(...)`. Neither `TaskInput`, `executionManager.ts`, `localInference.ts`, nor `POST /api/ai/execute` (`server/security.ts:298-303`) accepts prior message history. The UI renders multi-turn threads, **but every prompt executes independently without conversational memory**.
2. **Non-Streaming Execution Everywhere**:
   - `server/security.ts:394-401` calls blocking `ai.models.generateContent()`, `firebaseAI.ts:61` calls blocking `model.generateContent()`, and `localInference.ts:250` calls blocking `activeSession.prompt()`. There is **zero streaming (SSE/ReadableStream)**, **no progressive token rendering (TTFT)**, and **no request cancellation (`AbortController`)** in `AssistantView`.
3. **Phase 6 Explainability Fields Not Structured in UI**:
   - Phase 6 added rich structured metadata on `decision.explainability` (`confidence.level`, `confidence.unreliableSignals`, `measurements.{hardwareSpecs, localRuntime, networkTelemetry, latencyCalibration}`, `rejectedAlternatives`, `networkLimitationsEn/Ar`, `mainReasonsEn/Ar`).
   - Inspection of `ExecutionDetailsDrawer.tsx` and `PrivacyCenterView.tsx` confirms **zero direct reads of `decision.explainability`**. The UI only displays `decisionExplainer.ts`'s flattened text strings (`rationaleEn/Ar`, `limitationsEn/Ar`), `constraints`, and `routeScores`—missing visual confidence indicators, telemetry sample counts, or `simulated` vs `measured` vs `unavailable` provenance tags.
4. **`LatencyCalibrator` Reset on `refreshEnvironment()`**:
   - Calling `createBrowserOrbitEngine()` allocates a new `OrbitEngine` (and new empty `LatencyCalibrator`) on Refresh Probes or network reconnect (`App.tsx:101-109`), discarding session calibration unless explicitly re-seeded from `telemetry`.
5. **Inline Error Recovery Gaps**:
   - If `/api/ai/execute` returns HTTP `401`/`403`/`429`/`503` (or offline mid-request), `executionManager.ts` catches it into `status: 'error'` and `AssistantView` renders raw monospace text (`msg.errorMessage`) without contextual retry, rate-limit countdown (`Retry-After`), or auth re-prompt actions.
