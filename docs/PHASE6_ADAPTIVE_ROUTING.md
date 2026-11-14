# Phase 6 — Adaptive Routing & Principled `BALANCED` Policy

## 1. Root Cause Identified in Phase 5
In Phase 5 (`docs/PHASE5_REAL_WORLD_VALIDATION.md`), deterministic testing established that even when `LatencyCalibrator` converged on **22,000 ms** on-device latency versus **450 ms** on Cloud, `BALANCED` mode still selected `LOCAL` (`totalScore = 88` vs `84`) because:
1. `scoreLocalRoute()` applied `Math.max(20, ...)` floor to local `latencyScore` and unconditionally granted a `preferLocal` `privacyAlignment` (`98 * 0.30 = 29.4`) plus `+8` `localSuitabilityBonus` regardless of whether the task contained sensitive data or merely reflected a default non-sensitive latency preference.
2. `scoreCloudRoute()` penalized `CLOUD` `privacyAlignment` (`60 * 0.25 = 15.0`) even for generic zero-PII queries like `"Briefly define TLS."`.

## 2. Phase 6 Principled Decision Policy (`src/engine/decisionEngine.ts` & `src/engine/costEstimator.ts`)

### 2.1 Explicit Telemetry Reliability Gate (`assessTelemetryReliability()`)
Before allowing calibrated latency measurements to influence `BALANCED` route selection, `assessTelemetryReliability()` validates:
- **Minimum sample count**: `samples >= 3`. Fewer than 3 samples triggers `reliable: false` (`Insufficient latency sample count`).
- **Variance / jitter stability**: Tracks EWMA Mean Absolute Deviation (`ewmaDeviationMs`). If `ewmaDeviationMs > Math.max(ewmaLatencyMs * 0.65, 500)`, telemetry is marked unstable (`highVariance: true`).
- **Outcome tracking**: Tracks `successCount`, `errorCount`, and `failureRate` per model (`LatencyCalibrator.recordFailure()`, plus `seedFromTelemetry()` reading `'error'` records).

### 2.2 Separating Privacy Hard Boundaries from Performance Preferences
In `decideRoute()`:
1. **`STRICT_LOCAL` invariant**: Always excludes `CLOUD` and `HYBRID` unconditionally (`strict-local-policy`). Zero cloud egress under any latency.
2. **Unredacted / Uncertain Sensitive Inputs (`containsPii || hasSensitiveKeywords`)**:
   - Retains strict fail-closed protection (`evaluatePrivacyPolicy()` + `executionManager.ts` verification).
   - If sensitive content or redaction uncertainty locks execution locally while calibrated local telemetry is severely slow (`>= 10,000 ms` and `>= 4x` Cloud ETA), OAIE preserves `LOCAL` and records the advisory constraint `privacy-overrides-performance`, explicitly documenting that privacy intentionally overrode speed.
   - If structured PII is cleanly extracted with zero unredacted keywords (`redactionUncertain === false`, e.g., bare email redacted to `[EMAIL_1]`), `HYBRID` remains eligible in `BALANCED`/`FLEXIBLE`/`CUSTOM` and sends only sanitized placeholders to Cloud.
3. **Non-Sensitive Tasks Under `BALANCED`**:
   - Offloads to `CLOUD` (`balanced-performance-offload`) **only when all conditions pass**:
     - `privacyMode === 'BALANCED'` and `!hasSensitiveSignal` and `privacyOutcome.cloudPermitted`
     - Network is online, cloud-reachable, and not `2g` / `slow-2g`
     - `localTelemetry.reliable === true` (`>= 3` samples and low EWMA MAD)
     - `estLocalLatencyMs >= 10_000` and `estLocalLatencyMs >= estCloudLatencyMs * 4`
     - Candidate cloud model `failureRate <= 0.25`
   - When non-sensitive telemetry is `< 3` samples or noisy jitter (`[400, 35000, 500, 34000] ms`), `BALANCED` holds `LOCAL` and attaches `insufficient-telemetry-stability` to prevent route flapping.
4. **Slow & Offline Networks**:
   - `offline`, unreachable cloud health, `2g`, or `slow-2g` blocks `balancedOffloadActive`, keeping `LOCAL` preferred when available.

## 3. Structured Explainability & Honest Provenance (`src/engine/decisionExplainer.ts`)
Every `RoutingDecision` now includes `explainability` (`DecisionExplainabilityMetadata`):
- `selectedRoute`, `selectedModelId`, `selectedProvider`
- `mainReasonsEn` / `mainReasonsAr`
- `rejectedAlternatives`: per-route eligibility, score, and exact disqualification or ranking reason
- `privacyRestrictionsEn` / `privacyRestrictionsAr`
- `networkLimitationsEn` / `networkLimitationsAr`
- `confidence`: deterministic certainty level (`high` / `medium` / `low`), margin in score points, sample count, and list of missing/unreliable signals (e.g., `navigator.deviceMemory unavailable`, `Insufficient latency sample count`)
- `measurements`: per-subsystem provenance (`'measured' | 'partial' | 'simulated' | 'unavailable'`) across `hardwareSpecs`, `localRuntime`, `networkTelemetry`, and `latencyCalibration`.

## 4. Verified Test Evidence (`tests/oaie.phase6.test.ts` Section 1 & 4)
- **Before (Phase 5)**: `afterBalanced.selectedRoute` remained `'LOCAL'` at `22s` vs `450ms` (`88` vs `84`).
- **After (Phase 6)**:
  - Non-sensitive TLS prompt with `>= 3` reliable samples (`22s` vs `450ms`) -> `CLOUD` (`estLatencyMs = 933 ms`, `balanced-performance-offload`).
  - Unredacted salary/diagnosis prompt under same `22s` vs `450ms` telemetry -> `LOCAL` (`privacy-overrides-performance`).
  - `2`-sample sparse telemetry or `[400, 35000, 500, 34000]` noisy jitter -> `LOCAL` (`insufficient-telemetry-stability`).
  - `slow-2g` and `offline` networks -> `LOCAL`.
  - Repeatability across 10 consecutive `decideRoute()` invocations -> identical route, model ID, and score breakdowns.
  - Sensitive prompts across `STRICT_LOCAL`, `BALANCED`, `FLEXIBLE`, `CUSTOM` when local Nano is unavailable -> `BLOCKED` with **0** `executeCloud` calls.
