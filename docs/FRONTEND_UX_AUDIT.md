# ORBIT AI — Frontend & Mobile UX Audit

> **Audit Basis**: Verified directly against `src/components/*.tsx`, `src/App.tsx`, `src/index.css`, `index.html`, and benchmarked against the target mobile visual direction in `public/assets/aistudio/Screenshot_20261114-164504_12dcb809.jpg` and `public/assets/aistudio/Screenshot_20261114-164628_d0cd4800.jpg`. Zero files modified.

---

## 1. Feature-by-Feature Implementation Status

| Screen / Capability | Actual Files | Status | Ground-Truth Assessment |
|---|---|---|---|
| **Main Chat Interface** | `src/components/AssistantView.tsx`, `src/App.tsx` | **Functional (Basic)** | Single-turn prompt submission works end-to-end across LOCAL / HYBRID / CLOUD / BLOCKED. Lacks markdown/code rendering, streaming output, conversation context carry-over, inline copy/retry/regenerate controls, and auto-scroll. |
| **Conversation History** | `src/components/AssistantView.tsx:199-265`, `src/App.tsx:268-292`, `src/services/firestoreRepo.ts` | **Functional (Partial Persistence)** | Ephemeral in-memory threads by default; optional Firestore persistence exists for signed-in users (`persistConversations`). Hydrated history drops `executionResult` (disabling `"Inspect execution"`) and caps initial load at 15 threads without pagination. |
| **Message Composer & Attachments** | `src/components/AssistantView.tsx:473-550` | **Partial** | Supports plain text (`Shift+Enter` newline, `Enter` submit) and up to 3 text/code files (`.txt,.md,.json,.csv,.ts,.tsx,.js,.jsx,.py,.sql,.log`, `<=128 KB`). No auto-growing textarea, no voice/camera/image upload, no cancel/abort in flight, no inline model or privacy selector. |
| **Execution Status Indicators** | `src/components/AssistantView.tsx:300-342, 464-468` | **Partial** | Shows static `"Routing & executing…"` placeholder box while waiting. Workspace sub-toolbar shows `{privacyMode} · {Local status} · {Cloud status}`. No step-by-step live stage progress (e.g., `"Analyzing locally → Redacting → Calling Gemini"`). |
| **LOCAL / CLOUD / HYBRID / BLOCKED Presentation** | `src/components/AssistantView.tsx:87-98, 395-458` | **Functional (Honest)** | Uses crisp color-coded icons (`Cpu` emerald, `Layers` amber, `Cloud` sky, `ShieldBan` red) and unboxed inline telemetry metadata (`Route · Model · ms · $Cost · PrivacyStatus`). Clearly surfaces `BLOCKED` policy states with quick `"Switch to Balanced"` recovery when in `STRICT_LOCAL`. |
| **Privacy Settings** | `src/components/PrivacyCenterView.tsx`, `src/components/OnboardingView.tsx` | **Functional** | All 4 modes (`STRICT_LOCAL`, `BALANCED`, `FLEXIBLE`, `CUSTOM`) plus Custom sliders/checkboxes and live route simulator work against real OAIE rules. Not reachable inline from inside `AssistantView` without switching tabs. |
| **Device & Network Telemetry** | `src/components/IntelligenceDashboardView.tsx`, `src/services/browserProbes.ts` | **Functional (Honest)** | Displays strictly measured browser APIs (`Prompt API`, `/api/health`, `navigator.connection`, `deviceMemory`, `hardwareConcurrency`, `WebGPU`) and a live 8-task browser benchmark suite (`runBrowserBenchmarkSuite`). |
| **Decision Explainability** | `src/components/ExecutionDetailsDrawer.tsx`, `src/engine/decisionExplainer.ts` | **Partial (Phase 6 Metadata Unsurfaced)** | Slide-over drawer displays rationale, privacy guarantee, execution steps, constraint gates, route score comparison table, and limitations. **However**, Phase 6 structured `decision.explainability` fields (`confidence.level`, `measurements` provenance tags, `rejectedAlternatives`, `networkLimitations`) are not rendered as UI elements—only compressed text suffixes inside `rationaleEn/Ar`. |
| **Artifacts & Generated Files** | — | **Missing** | No artifact panel, downloadable file cards, structured code preview/copy blocks, or image/audio/document output cards exist. |
| **Navigation & Mobile Menu** | `src/components/TopNav.tsx`, `src/components/AssistantView.tsx:199-203` | **Functional (Crowded on Mobile)** | Dual navigation structure on mobile: `TopNav` hamburger drawer for 5 screens + Sign In/Out, AND a second workspace toolbar `"Conversations"` button inside `AssistantView` to open the chat sidebar drawer. |

---

## 2. Mobile UX Deep Audit (`320px–430px` Viewports)

Inspecting CSS layout classes across `src/App.tsx`, `src/components/TopNav.tsx`, `src/components/AssistantView.tsx`, and `src/components/ExecutionDetailsDrawer.tsx`:

### 2.1 Header, Chrome Height & Navigation Friction
- **Excessive vertical chrome**: `TopNav` (`h-14` = `56px`) + `AssistantView` sub-toolbar (`~44px`) + optional `cloudAuthBlocked` banner (`~60px`) consume **100px–160px** before a single chat message is visible on a small phone screen.
- **Hidden Auth CTA on mobile**: In `TopNav.tsx:85-104`, Sign In / Sign Out uses `hidden sm:inline-flex`. Mobile users must open the hamburger menu just to see whether they are signed in or to sign out.
- **Drawer without backdrop scrim (`AssistantView.tsx:199-203`)**: Tapping `"Conversations"` fixes the `w-72` sidebar at `inset-y-14 start-0 z-30` with **no overlay backdrop**, no Escape-key close handler, and no tap-outside dismissal.

### 2.2 Viewport Height, Keyboard Behavior & Scrolling (`CRITICAL`)
- **`100vh` keyboard clipping (`AssistantView.tsx:197`)**:
  - `AssistantView` uses `h-[calc(100vh-3.5rem)] overflow-hidden`.
  - On iOS Safari and Android Chrome, `100vh` represents the *unobstructed maximum viewport height*, not the visual viewport when the address bar or virtual software keyboard opens. When focusing the composer `<textarea>` on mobile, the bottom composer can slide partially under the keyboard or trigger awkward body scroll. Should use `h-[calc(100dvh-3.5rem)]` (or `min-h-0 flex-1` inside a `h-dvh` shell) plus safe-area bottom padding (`pb-[env(safe-area-inset-bottom)]`).
- **Missing auto-scroll**: Appending a user prompt or receiving an assistant response does not scroll the message stream (`div.flex-1.overflow-y-auto`, `line 345`) to the bottom automatically.

### 2.3 Touch Target Sizes & Hover-Only Controls
Multiple mobile controls fall well below the `44×44px` accessibility guideline:
- `TopNav.tsx:109`: Mobile hamburger button `p-2` with `16px` icon = **`~34×34px`**.
- `AssistantView.tsx:306`: Sub-toolbar `"Conversations"` toggle `px-2.5 py-1` `text-xs` = **`~26px` tall**.
- `AssistantView.tsx:254`: Conversation `"Delete"` button uses `opacity-0 group-hover:opacity-100` (`p-1` = **`~24×24px`**). On touch screens with no persistent hover state, **delete is invisible and nearly untappable**.
- `AssistantView.tsx:493`: Attachment remove `X` button = **`~12×12px` hit area**.
- `AssistantView.tsx:450`: `"Inspect execution"` text link has no padding (`~16px` touch height).
- `ExecutionDetailsDrawer.tsx:52`: Drawer close button `p-1.5` = **`~30×30px`**.

### 2.4 Chat Width, Readability & Overflow Risks
- **Unstyled AI Responses (`AssistantView.tsx:425`)**: Plain `whitespace-pre-wrap` renders Markdown tokens verbatim (`**bold**`, `### headings`, ```` ```ts ```` fences), degrading readability on multi-step coding or analytical answers. Long unbroken tokens (URLs, JSON keys, long code lines) inside assistant or metadata rows lack `break-words` / horizontal code-scroll containers.
- **Metadata wrapping density (`AssistantView.tsx:431-458`)**: On `360px` viewports, wrapping 5 metadata segments (`Local · chrome-gemini-nano · 4210 ms · $0.00000 · On-device only`) plus `"Inspect execution"` splits across 3 cramped lines inside every assistant card.
- **Composer button width squeeze (`AssistantView.tsx:537-544`)**: When `isExecuting` is true, the submit button text expands to `"Routing & executing…"` (`~145px` wide + `px-4`), squeezing the adjacent `<textarea>` to `< 140px` on a `320px–360px` phone!
- **Horizontal table overflow (`ExecutionDetailsDrawer.tsx:200`, `IntelligenceDashboardView.tsx:385, 480`)**: Route score and telemetry tables correctly wrap with `overflow-x-auto`, though mobile cards would scan much more easily than 7-column tables on `360px` screens.

---

## 3. Alignment with Visual Reference (`Screenshot_20261114-164628` & `Screenshot_20261114-164504`)

Comparing ORBIT AI's current utility-heavy layout against the two reference screenshots reveals clear design opportunities **without compromising ORBIT's engineering honesty**:

| Element | Reference Screenshots Direction | Current ORBIT UI Gap | Target Adaptation Rule (Honest + Elevated) |
|---|---|---|---|
| **Brand Presence & Empty State** | Centered luminous violet/blue 3D-style orb on deep obsidian canvas (`Start New Chat / Let's Talk`, minimal centered welcome `"Hi ..., how can I help you today?"` + compact action chips). | Plain left-aligned `"Ready to route your next task"` text + 3 tall vertical boxes (`AssistantView.tsx:347-369`). | Introduce a subtle ambient ORBIT orb / ring signature in Onboarding & Assistant Empty State, compact horizontal/2-column starter chips adapted strictly to ORBIT's real text/code/privacy capabilities (no unsupported *"Create Image"* chip!). |
| **Top Mobile Bar** | Ultra-minimal single header: back/menu icon + centered context title (`New Chat` / conversation topic) + history button on right. | `56px` navbar + `44px` sub-toolbar + truncated status text stacked above chat. | Consolidate mobile chat chrome into a single sleek `52px` header (`Menu/History` · `Topic + Active Mode` · `New Chat / Privacy Quick Switch`). |
| **Message Presentation** | Right-aligned compact dark pill/card for user prompt + optional clean attachment preview; unboxed clean `Answer` stream with crisp typography + compact bottom action bar (Copy, Inspect, Retry). | Heavy boxed `bg-[#111827] border` card around every assistant answer + cramped 5-item metadata footer. | Keep user bubble sleek (`max-w-[85%] rounded-2xl`); give assistant answers full breathing room with Markdown/code typography, compact status chip (`Local` / `Hybrid · 2 Redacted` / `Cloud`), and `44px`-compliant action row (`Copy`, `Inspect`, `Retry`). |
| **Bottom Composer** | Anchored floating dark rounded composer bar with left `+` attach trigger, flexible input (`Ask me anything...`), inline compact mode/model chip, and circular high-contrast submit button. | Boxy 2-line `<textarea>` + separate square paperclip button + wide text `"Send"` button + permanently visible tiny file hint line below. | Full-width rounded bottom composer with auto-growing input (`1` to `5` rows), inline privacy mode quick-chip (`Balanced` / `Strict Local`), icon-only `44×44` circular Send/Stop button, `dvh` + `safe-area-inset-bottom` support. |
| **Integrity Boundary** | Commercial mobile UI mockup (`Lumira 2.0`, `Upgrade to pro`, `Create Image`, fake `Sources` cards). | Honest diagnostics, real `STRICT_LOCAL` boundary, no paywall/mock features. | **Zero dark patterns or fake claims**: Do not show fake upgrades, fake web sources, audio waveform placeholders without working audio/TTS, or image generation triggers unless implemented. |
