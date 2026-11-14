# Phase 6 — Network-Aware & Failure-Aware Cloud Model Selection

## 1. Previous Limitation
Prior to Phase 6, `pickBestCloudModel()` in `src/engine/decisionEngine.ts` used only two static heuristics:
1. For `coding_technical`, `deep_reasoning`, `translation`, `complexity === 'high' | 'expert'`, or attachments -> always `gemini-4-hydrogen`.
2. Otherwise -> lowest estimated latency regardless of `LatencyCalibrator` history, model error rate, `saveData` flag, `2g`/`slow-2g` cellular throttling, or relative token cost.

## 2. Upgraded Multi-Factor Cloud Model Selector (`pickBestCloudModel()`)
`pickBestCloudModel()` now accepts:
- `models`: available `ModelDescriptor[]` (`gemini-4-hydrogen`, `gemini-3.1-flash-lite`)
- `analysis`: `TaskAnalysis` (capabilities, task type, complexity, estimated input/output tokens, language, attachments)
- `preferLowCost`: `boolean`
- `network`: `NetworkStatusSnapshot` (`effectiveType`, `rttMs`, `saveData`)
- `privacyMode`: `PrivacyMode`
- `budgetLimitUsd`: `number | null`
- `calibrationByModel`: `Record<string, CalibratedModelStats>` (`ewmaLatencyMs`, `ewmaTokensPerSec`, `failureRate`)

### 2.1 Candidate Filtering & Budget Guard
- Filters to cloud models with `available === true`, `supportedTasks.includes(taskType)`, and `estimatedInputTokens <= maxContextTokens`.
- Prefers models satisfying `estimateModelCost().withinBudget` when a `CUSTOM` USD cap is configured.

### 2.2 Multi-Factor Utility Scoring
Each eligible candidate is scored deterministically:
```text
totalUtility =
  qualityScore * qualityWeight
+ latencyNorm * latencyWeight
+ costNorm * costWeight
+ networkEconomyBonus
- failurePenalty
```
Where:
- **Quality weight (`qualityWeight`)**: `0.50` for complex/reasoning/coding/attachments or non-low Arabic tasks; `0.42` for `FLEXIBLE`; `0.25` for lightweight tasks.
- **Slow/metered detection (`slowOrMeteredNetwork`)**: true when `saveData === true`, `effectiveType === '2g' | 'slow-2g'`, or `rttMs >= 300`.
- **Latency weight (`latencyWeight`)**: `0.28` on slow/metered networks; `0.22` on healthy networks. Uses calibrated `estimateModelLatencyMs()` (combining `ewmaLatencyMs`, `ewmaTokensPerSec`, and `rttMs * 1.5`).
- **Cost normalization & weight**: `costNorm = clamp(30..100, round(100 - estimatedCostUsd * 120_000))` so sub-cent token differences meaningfully distinguish `flash-lite` vs `hydrogen` on lightweight tasks; `costWeight = 0.22` on slow/metered networks, `0.20` when `preferLowCost || CUSTOM`, `0.08` otherwise.
- **Network economy bonus**: `+16` for `gemini-3.1-flash-lite` when `slowOrMeteredNetwork === true` and `analysis.complexity !== 'expert'`.
- **Failure penalty (`failurePenalty`)**: when a candidate has `>= 2` recorded outcomes (`successCount + errorCount`), subtracts `round(failureRate * 55)` (up to `-55` points at 100% failure), demoting degraded models even if static capability is higher.
- **Capability preservation**: Tasks where only `gemini-4-hydrogen` lists support (such as `coding_technical` and `deep_reasoning`) never downgrade to `flash-lite` on `2g`.

## 3. Verified Model Selection Switches (`tests/oaie.phase6.test.ts` Section 3)

| Scenario | Task / Complexity | Network | Calibration State | Selected Model | Why |
|---|---|---|---|---|---|
| 4G Arabic translation | `translation` / `medium` (AR) | 4G, RTT 45ms | Uncalibrated | `gemini-4-hydrogen` | Quality priority (`0.50`) on Arabic generation |
| Slow 2G Arabic translation | `translation` / `medium` (AR) | `2g`, RTT 650ms, `saveData` | Uncalibrated | `gemini-3.1-flash-lite` | `+16` slow/metered resilience bonus flips choice |
| Slow 2G Coding refactor | `coding_technical` / `high` | `2g`, RTT 650ms, `saveData` | Uncalibrated | `gemini-4-hydrogen` | Capability constraint: `flash-lite` lacks `coding_technical` |
| Summarization under high `hydrogen` failure | `summarization` / `medium` (`FLEXIBLE`) | 4G, RTT 45ms | `hydrogen`: 1 ok / 3 errors (`75%` fail) | `gemini-3.1-flash-lite` | Failure penalty (`-41` pts) overrides static quality |

`pickBestCloudModel()` also emits human-readable bilingual `selectionReasonsEn` / `selectionReasonsAr`, surfaced inside `decision.explainability.mainReasonsEn/Ar`.
