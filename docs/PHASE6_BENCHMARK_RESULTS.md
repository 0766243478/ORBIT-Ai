# Phase 6 — Comparative Benchmark & Regression Results

## 1. Environment & Methodology Disclosure
- **Execution environment**: Node v22 workspace (`tests/oaie.benchmark.baseline.ts`, Vitest v5.1.0, `npx tsx`).
- **Browser / Device Constraint**: Workspace reports `NO_BROWSER_BINARY`; no physical Chrome Prompt API or low-end Android hardware ran in-container. Device tiers (`2 GB`, `3–4 GB`, `6 GB`, `8+ GB`) and `22s vs 450ms` EWMA timings are **deterministic Node simulations / mocked runtime executors**, explicitly labeled as `simulated` by `decision.explainability.measurements`.
- **Pipeline latency overhead**: Measured directly with `node:perf_hooks` (`N = 100` full `analyzeTask -> decideRoute -> buildExecutionPlan` calls).

## 2. Suite-Wide Test Verification
Command executed: `npm test && npx tsx tests/oaie.benchmark.baseline.ts`
- **Test files**: `8 passed (8)`
  - `tests/oaie.phase6.test.ts`: `9/9 passed`
  - `tests/oaie.phase5.test.ts`: `3/3 passed`
  - `tests/server.security.test.ts`: `8/8 passed`
  - `tests/oaie.privacy.test.ts`: `5/5 passed`
  - `tests/oaie.execution.test.ts`: `7/7 passed`
  - `tests/oaie.phase3.test.ts`: `4/4 passed`
  - `tests/oaie.routing.test.ts`: `9/9 passed`
  - `firestore.rules.test.ts`: `5/5 passed`
- **Total automated tests**: `50/50 passed`.

## 3. Baseline 8-Task Corpus Comparison (`REPRESENTATIVE_BENCHMARK_TASKS`)

| Strategy | Completable Tasks | Routing / TaskType Match | Zero-Cost Local Tasks | PII / Unredacted Leak Rate | Notes |
|---|---|---|---|---|---|
| **Local-only (`STRICT_LOCAL`, 8+ GB Ready)** | `5 / 8` (62.5%) | `N/A` (fixed) | `5 / 5` completed | `0%` | Fails `arabic_translation`, `coding`, `deep_reasoning_hybrid` (plus `0/8` on 2 GB constrained devices) |
| **Cloud-only (`FLEXIBLE`, No Local)** | `8 / 8` online (`0 / 8` offline) | `N/A` (fixed) | `0 / 8` | Unchecked if raw prompt sent without guard; `0%` through ORBIT guard | Fails completely offline; pays Cloud latency/token cost even for trivial `simple_qa` |
| **Phase 5 OAIE (`BALANCED`)** | `8 / 8` online (`4 / 8` offline) | `8/8` type, `7/8` baseline route (`bench_07` kept `LOCAL` safely) | `5 / 8` | `0%` (blocked unredacted) | Locked `BALANCED` to `LOCAL` even at `22s` local vs `450ms` cloud; false-blocked conceptual privacy queries |
| **Phase 6 OAIE (`BALANCED`)** | `8 / 8` online (`4 / 8` offline) | `8/8` type, `7/8` baseline route (`bench_07` kept `LOCAL` safely) | `5 / 8` uncalibrated; dynamic on extreme local lag | `0%` (fail-closed preserved) | Matches Phase 5 on healthy baseline while unlocking reliable EWMA offload, conceptual unblocking, and failure/2G model switches |

## 4. Targeted Phase 5 vs Phase 6 Edge-Case Comparison

| Scenario (Node Benchmark Run) | Phase 5 OAIE | Phase 6 OAIE | Observed Metric / Constraint |
|---|---|---|---|
| Non-sensitive `"Briefly explain TLS handshakes."` with 6–10 samples (`local = 22,000 ms`, `cloud = 450 ms`, `BALANCED`) | `LOCAL` (est ~22s) | **`CLOUD`** (`gemini-4-hydrogen`, **933 ms** ETA) | `balanced-performance-offload`; ~23.6x faster ETA with `>=3` stable samples |
| Sensitive `"Summarize my confidential medical diagnosis and salary sheet."` (`local = 22,000 ms`, `BALANCED`) | `LOCAL` | **`LOCAL`** | `privacy-overrides-performance` explicitly recorded; zero cloud calls |
| Redactable PII `"My email is alice@example.com; summarize briefly."` (`local = 22,000 ms`, `BALANCED`) | `LOCAL` | **`HYBRID`** (1,299 ms ETA) | Email deterministically stripped to `[EMAIL_1]` locally before Cloud dispatch (`pii-redaction-required`) |
| Sparse telemetry (`2` samples @ `22,000 ms`, `BALANCED`) | `LOCAL` | **`LOCAL`** | `insufficient-telemetry-stability` prevents premature offload (`2/3` min samples) |
| Noisy jitter (`[400, 35000, 500, 34000] ms`, `BALANCED`) | `LOCAL` | **`LOCAL`** | `insufficient-telemetry-stability` catches high EWMA MAD variance |
| Conceptual privacy prompts (6 EN + AR examples, no local) | **6 / 6 False-Positive `BLOCKED`** | **6 / 6 `CLOUD`** | **100% reduction in false blocks** on tested conceptual prompts |
| Personal disclosure + Eastern Arabic prompts (3 unredacted + 1 redacted ID/secret) | Blocked / incomplete Eastern Arabic digits | **3 `BLOCKED` + 1 verified `HYBRID`** (`[ID_1]`, `[SECRET_1]`, `[EMAIL_1]`) | Zero unredacted leaks across EN, AR, and `\u0660-\u0669` numerals |
| Arabic medium translation (`4G` vs `2G + Save-Data`) | Static quality tie/fallback | `4G` -> `gemini-4-hydrogen`, `2G` -> **`gemini-3.1-flash-lite`** | Slow/metered resilience bonus (`+16` pts) adapts cloud model |
| Summarization with `75%` `gemini-4-hydrogen` failure rate (`FLEXIBLE`) | Ignored error rates (kept failing model) | Switches to **`gemini-3.1-flash-lite`** | `failurePenalty = -41` pts prevents repeated routing to failing model |

## 5. CPU Pipeline Overhead (`N = 100`, Node v22)
Measured over 100 consecutive `analyzeTask -> decideRoute -> buildExecutionPlan` iterations on conceptual-discussion + calibration-enabled input:
- **Minimum**: `92 µs`
- **Median (`p50`)**: `137 µs` (`0.137 ms`)
- **95th percentile (`p95`)**: `291 µs` (`0.291 ms`)
- **Maximum**: `1351 µs` (`1.351 ms`, initial cold JIT sample)

Explainability construction, reliability checks, and multi-factor cloud model scoring add `< 0.3 ms` at `p95`, negligible relative to multi-hundred-millisecond or multi-second inference latency.
