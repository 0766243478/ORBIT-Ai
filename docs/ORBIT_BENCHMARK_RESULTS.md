# ORBIT AI — Phase 5 Benchmark Results & Strategy Comparison

**Strict Evidence Attribution:**  
- **Measured in Workspace Container (Node.js):** Pipeline CPU overhead (`p50`/`p95` µs, `N = 50` iterations), deterministic route decisions across privacy/device/network profiles, payload wire byte sizes (`cloudPayloadBytes`), fail-closed privacy wire audits (`fetch` spy), EWMA before/after latency & score deltas, and Express `/api/health` readiness.  
- **Mocked in Tests:** Chrome `globalThis.LanguageModel` Prompt API timing, signed-in Firebase ID token stub + `fetch('/api/ai/execute')` transport test (`tests/oaie.phase5.test.ts`).  
- **Requires Signed-In Desktop Chrome 138+ / Physical Hardware (`[NOT EXECUTED IN CONTAINER]`):** Live Gemini Nano tok/s & cold-start ms, live end-to-end Gemini Cloud latency/quality grading, Chrome JS Heap delta, and real network transfer bytes.

---

## 1. Benchmark Comparison: Routing Strategies Across 8 Representative Tasks

Simulated profile: High-end local-ready machine (`SYNTHETIC_DEVICE_TIERS[3]`: 16 GB RAM, 8 cores, WebGPU enabled, 80 GB storage quota, Chrome Prompt API `available`) on `online_4g` (`80 ms` RTT), `cloudGeminiConfigured = true`.

> **Note on "Firebase Hybrid":** As verified in `src/services/firebaseAI.ts:39–45`, `getFirebaseHybridModel()` (`InferenceMode.PREFER_ON_DEVICE`) is **uncalled dead code**. Live Firebase AI Logic calls (`executeViaFirebaseAiLogicCloud`) run strictly `ONLY_IN_CLOUD`, so structurally in production today Firebase Hybrid is either `ONLY_IN_CLOUD` or, conceptually if wired, equivalent to local-first (`LOCAL`) with cloud fallback (`CLOUD`)—with zero client-side PII redaction (`redactedCount = 0`).

| Task ID | Task Type (Tokens In/Out) | Has PII? | **Local Only (`STRICT_LOCAL`)** | **Cloud Only (`server-gemini`)** | **Firebase AI Logic (`ONLY_IN_CLOUD`)** | **ORBIT Adaptive (`spec.privacyMode`)** | Est. Latency (ms) | Est. Cloud Cost (USD) | Redacted Spans |
| :--- | :--- | :---: | :--- | :--- | :--- | :--- | :---: | :---: | :---: |
| `bench_01_simple_qa` | `simple_qa` (22 / 220) | No | `LOCAL` | `CLOUD` (`flash-lite`) | `CLOUD` (no PII guard) | **`LOCAL` (`chrome-gemini-nano`)** | `7,015` *(est)* | `$0.000000` | `0` |
| `bench_02_summarization` | `summarization` (33 / 480) | No | `LOCAL` | `CLOUD` (`hydrogen`) | `CLOUD` (no PII guard) | **`LOCAL` (`chrome-gemini-nano`)** | `15,140` *(est)* | `$0.000000` | `0` |
| `bench_03_rewrite` | `rewrite_proofread` (36 / 220) | No | `LOCAL` | `CLOUD` (`flash-lite`) | `CLOUD` (no PII guard) | **`LOCAL` (`chrome-gemini-nano`)** | `7,015` *(est)* | `$0.000000` | `0` |
| `bench_04_extraction` | `classification_extraction` (32 / 180) | No | `LOCAL` | `CLOUD` (`flash-lite`) | `CLOUD` (no PII guard) | **`LOCAL` (`chrome-gemini-nano`)** | `5,765` *(est)* | `$0.000000` | `0` |
| `bench_05_arabic_translation` | `translation` (34 / 480) | No | **`BLOCKED`** | `CLOUD` (`hydrogen`) | `CLOUD` (no PII guard) | **`CLOUD` (`gemini-4-hydrogen`)** | `6,848` *(est)* | `$0.000293` | `0` |
| `bench_06_coding` | `coding_technical` (25 / 900) | No | **`BLOCKED`** | `CLOUD` (`hydrogen`) | `CLOUD` (no PII guard) | **`CLOUD` (`gemini-4-hydrogen`)** | `12,448` *(est)* | `$0.000544` | `0` |
| `bench_07_pii_hybrid` | `pii_sensitive_draft` (38 / 220) | **Yes** | `LOCAL` | `CLOUD` **(Exposes PII!)** | `CLOUD` **(Exposes PII!)** | **`LOCAL` (`chrome-gemini-nano`)** *(note 1)* | `7,015` *(est)* | `$0.000000` | `0` *(stays on-device)* |
| `bench_08_deep_reasoning_hybrid` | `deep_reasoning` (58 / 1400) | **Yes** | **`BLOCKED`** | `CLOUD` **(Exposes PII!)** | `CLOUD` **(Exposes PII!)** | **`HYBRID` (`guardian + hydrogen`)** | `19,139` *(est)* | `$0.000849` | **`2` (`[EMAIL_1]`, `[PHONE_1]`)** |

*Note 1:* When Chrome Nano is unavailable (Firefox/Safari/Android/2 GB device), `bench_07_pii_hybrid` shifts cleanly to **`HYBRID` (`gemini-3.1-flash-lite`)** with verified PII redaction, while naive Cloud-Only / Firebase `ONLY_IN_CLOUD` transmit raw PII or fail when offline.

---

## 2. Node Engine Pipeline Overhead (`npx tsx tests/oaie.benchmark.baseline.ts`, `N = 50` per task)

Measured directly on Node.js (`process.hrtime.bigint()`) via `npx tsx tests/oaie.benchmark.baseline.ts`:

| Task ID | TaskType Match | Route Match | `analyzeTask` p50 (µs) | `analyzeTask` p95 (µs) | `decideRoute` p50 (µs) | `buildPlan` p50 (µs) | Cloud Payload Bytes |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| `bench_01_simple_qa` | Match (`simple_qa`) | Match (`LOCAL`) | `33 µs` | `174 µs` | `20 µs` | `9 µs` | `0 B` |
| `bench_02_summarization` | Match (`summarization`) | Match (`LOCAL`) | `27 µs` | `85 µs` | `13 µs` | `5 µs` | `0 B` |
| `bench_03_rewrite` | Match (`rewrite_proofread`) | Match (`LOCAL`) | `29 µs` | `61 µs` | `13 µs` | `4 µs` | `0 B` |
| `bench_04_extraction` | Match (`classification_extraction`) | Match (`LOCAL`) | `28 µs` | `37 µs` | `9 µs` | `3 µs` | `0 B` |
| `bench_05_arabic_translation` | Match (`translation`) | Match (`CLOUD`) | `44 µs` | `97 µs` | `9 µs` | `31 µs` | `156 B` |
| `bench_06_coding` | Match (`coding_technical`) | Match (`CLOUD`) | `32 µs` | `47 µs` | `18 µs` | `31 µs` | `94 B` |
| `bench_07_pii_hybrid` | Match (`pii_sensitive_draft`) | Diff (`LOCAL` vs `HYBRID` exp.) | `49 µs` | `58 µs` | `26 µs` | `3 µs` | `0 B` |
| `bench_08_deep_reasoning_hybrid` | Match (`deep_reasoning`) | Match (`HYBRID`) | `33 µs` | `86 µs` | `9 µs` | `33 µs` | `204 B` |
| **Summary** | **`8 / 8 (100%)`** | **`7 / 8 (87.5%)`** | **~`30–49 µs`** | **~`37–174 µs`** | **~`9–26 µs`** | **~`3–33 µs`** | **Total `< 0.5 ms` CPU overhead** |

---

## 3. Slow Network & Offline Comparison (`2G` vs `Offline` vs `Online 4G`)

| Scenario / Profile | **Local Only** | **Cloud Only** | **ORBIT Adaptive (`BALANCED`)** | Observed Engineering Advantage / Gap |
| :--- | :--- | :--- | :--- | :--- |
| **`high_8gb_plus` + Slow 2G (`850 ms` RTT, `saveData: true`)** | Simple QA: `LOCAL` (`7,015 ms` est), Coding: `BLOCKED` | Simple QA: `CLOUD` (+network lag), Coding: `CLOUD` | Simple QA: **`LOCAL` (`7,015 ms` est, `0 B`)**, Coding: **`CLOUD` (`13,355 ms` est)** | Avoids slow 2G RTT for `LOCAL`-capable tasks; Cloud coding model still runs with network-adjusted ETA (`12,448 → 13,355 ms`). |
| **`high_8gb_plus` + Offline (`online: false`)** | Simple EN QA: `LOCAL`; Simple AR QA: `BLOCKED` | All tasks: **Error / Unreachable** | Simple EN QA: **`LOCAL` (0 HTTP calls)**; Coding & Simple AR QA: **`BLOCKED`** | Clean fail-closed offline behavior; known weakness: trivial 4-word offline Arabic Q&A blocked due to `supportsArabicWell: false`. |
| **`low_2gb` + Online 4G** | All tasks: **`BLOCKED`** | All tasks: `CLOUD` (leaks PII) | Simple/Coding: **`CLOUD`**, PII: **`HYBRID` (`2` spans masked)** | Protects 2 GB RAM from multi-GB Nano download/crash AND shields PII via verified `HYBRID`. |

---

## 4. EWMA Predicted vs. Simulated Actual Latency & Calibration Impact (`tests/oaie.phase5.test.ts`)

| Test Condition (`"Briefly define TLS."`, `8+ GB` Online) | Route Scores (`LOCAL` / `CLOUD`) | Winner Route | Predicted ETA | Simulated Observed Latency | Calibrated Result |
| :--- | :---: | :---: | :---: | :---: | :--- |
| `BALANCED` (Before calibration) | `100` / `82` | `LOCAL` | `7,015 ms` | `22,000 ms` (local) / `450 ms` (cloud) | Under-predicted 3.1× before telemetry |
| `BALANCED` (After 10× EWMA samples) | `97` / `84` | **`LOCAL`** | **`22,811 ms`** | `22,000 ms` (local) / `450 ms` (cloud) | **ETA converges (~`+3.7%` error), but route remains locked to `LOCAL`** |
| `FLEXIBLE` (Before calibration) | `89` / `89` | `LOCAL` *(tie-break)* | `7,015 ms` | `22,000 ms` (local) / `450 ms` (cloud) | Static tie picks `LOCAL` |
| `FLEXIBLE` (After 10× EWMA samples) | `84` / `92` | **`CLOUD`** | **`933 ms`** | `450–750 ms` | **Calibrator flips inferior local route → `CLOUD` (`+8 pt` margin)** |

---

## 5. Live Metrics Collection Audit (What Can vs. Cannot Be Measured)

| Metric | Container / Node Harness Status | Browser Support (`browserBenchmark.ts`) | Collection Limitation & Root Cause |
| :--- | :--- | :--- | :--- |
| **Time to First Token (TTFT)** | **Cannot Collect** | **Cannot Collect** | Both `session.prompt()` (`localInference.ts:250`) and `ai.models.generateContent()` (`server/security.ts:394`) are non-streaming unary APIs. |
| **Total Response Latency (ms)** | Measured for engine pipeline (`<0.2 ms`), simulated/mocked for model calls | Collected (`res.evaluation.actualLatencyMs`) | Real model wall-clock requires signed-in Desktop Chrome 138+ (`[REQUIRES MANUAL RUN]`). |
| **Tokens Per Second (tok/s)** | Static model defaults (`32` Nano, `75` Hydrogen, `110` Flash Lite) | Estimated from `outputTokens / latencyMs` | Cloud `outputTokens` uses Gemini `usageMetadata.candidatesTokenCount`; local uses `Math.ceil(len / 4)` approximation (`localInference.ts:301`). |
| **Task Completion & Failure Rate** | `100%` pass on `38+3` deterministic/mocked Vitest assertions | Collected (`successCount / totalRuns`) | Live Gemini API availability / Nano completion rate requires manual browser benchmark run. |
| **Output Quality (Rubric)** | **Cannot Collect (Needs Live Outputs)** | Requires human/rubric grading of copied JSON responses | Mock responses cannot score real semantic coherence or Arabic fluency. |
| **Memory Consumption** | Not applicable in Node | JS Tab Heap Δ (`performance.memory`) on Chromium only | Excludes off-heap/GPU Gemini Nano model weights (`1.7–4 GB`); unavailable on Firefox/Safari. |
| **Network Requests & Payload Size** | Exact `cloudPayloadBytes` + mocked `fetch` count audited | Visible via DevTools Network (`POST /api/ai/execute`) | Zero unauthorized background traffic verified by `fetch` spy (`tests/oaie.phase5.test.ts`). |
| **Cloud Cost (USD)** | Formula verified (`costEstimator.ts`) | Estimated only (`estimatedCostUsd`) | Uses static per-1k token pricing constants; Gemini API responses do not return real USD billing charges. |
| **Live Browser Benchmark Slot** | **Not Executed (`NO_BROWSER_BINARY`)** | Ready in UI (`IntelligenceDashboardView.tsx`) | Run "Full 8-Task Comparison" in signed-in Chrome 138+ and paste JSON export here for live hardware ground truth. |
