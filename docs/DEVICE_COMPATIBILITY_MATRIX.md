# ORBIT AI — Device & Browser Compatibility Matrix

**Evidence Boundary:**  
- **Container Tests Executed:** Deterministic Node engine + `SYNTHETIC_DEVICE_TIERS` (`src/engine/benchmarkCorpus.ts`), browser capability probe behavior in headless Node (`browserDeviceProbe`), and `buildModelRegistry` / `classifyDeviceTier` verification.  
- **Physical Hardware:** **No physical desktop, laptop, Android, or iOS device tests were executed inside this workspace (`NO_BROWSER_BINARY`).** Physical rows below document **expected code-path behavior derived from source code** plus explicit fields marked `[REQUIRES PHYSICAL TEST]`.

---

## 1. Compatibility Matrix by Memory Tier & Platform

| Category / Platform | Hardware Signals Read | `classifyDeviceTier()` Result | Local Nano Support in Codebase | Routing & Session Reuse Behavior | Physical Verification Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Low-End Desktop / Phone (≤ 2 GB RAM or ≤ 2 cores or < 512 MB quota)** | `deviceMemory <= 2` OR `hardwareConcurrency <= 2` | `low_2gb` (`maxLocalTokens = 0`, `resourceConstrained = true`) | **Disabled (`localAvailable = false`)** (`modelRegistry.ts:26-27`) | All eligible online tasks route `CLOUD` or verified `HYBRID`; warm session cache disabled (`allowWarmSessionCache: false`). Offline tasks → `BLOCKED` (`STRICT_LOCAL` → `BLOCKED`). | Verified via `SYNTHETIC_DEVICE_TIERS[0]`. **Physical device `[REQUIRES MANUAL TEST]`**. |
| **Entry-Level (3–4 GB RAM)** | `deviceMemory` ∈ `(2, 4]` | `entry_3_4gb` (`maxLocalTokens = 1536`, `allowWarmSessionCache = false`) | **Chrome Desktop 138+ only** when weights available & storage >= 512 MB | Tasks `<= 1,536` tokens eligible for `LOCAL`; long prompts (`>1,536` tokens, e.g., `bench_02` stress 1,450+ words) overflow to `CLOUD`; session destroyed after every call to avoid OOM. Downloadable models warn if quota `< 4,096 MB`. | Verified via `SYNTHETIC_DEVICE_TIERS[1]` & `oaie.phase5.test.ts:410-424`. **Physical device `[REQUIRES MANUAL TEST]`**. |
| **Mid-Range (6 GB RAM)** | `deviceMemory` ∈ `(4, 6]` (Chromium caps `deviceMemory` at `8`; `6` only if browser/harness reports `6`) | `mid_6gb` (`maxLocalTokens = 3072` w/ WebGPU, `2048` CPU) | **Chrome Desktop 138+ only** | Warm session reuse (`WARM_SESSION_TTL_MS = 120,000 ms`) enabled **only when WebGPU is present**. Note: Real Chromium `navigator.deviceMemory` buckets to `0.25, 0.5, 1, 2, 4, 8`, so a physical 6 GB PC commonly reports `4` (`entry_3_4gb`) or `8` (`high_8gb_plus`). | Verified via `SYNTHETIC_DEVICE_TIERS[2]`. **Chromium bucketing quirk documented from Web spec**. |
| **High-End (≥ 8 GB RAM)** | `deviceMemory >= 8`, `cores > 4`, WebGPU `true` | `high_8gb_plus` (`maxLocalTokens = 4096`, `allowWarmSessionCache = true`) | **Desktop Chrome 138+** with Gemini Nano downloaded (`~1.7–4 GB`) | Simple Q&A, rewrite, extraction, medium summarization (`<= 4,096` tokens) route `LOCAL` with 120s warm session reuse; Arabic, attachments, coding, deep reasoning route `CLOUD` / `HYBRID`. | Verified via `SYNTHETIC_DEVICE_TIERS[3]`. **Physical Chrome 138+ run `[REQUIRES MANUAL TEST]`**. |
| **Desktop Mozilla Firefox / Apple Safari (macOS)** | `deviceMemory: null` (hidden by browser privacy), `Prompt API` absent | `entry_3_4gb` if `cores <= 4`, else `unknown` (`deviceProfiler.ts:96-113`) | **None (`apiPresent = false`, `unavailable`)** | **Cloud / Verified Hybrid only.** `STRICT_LOCAL` and offline sessions always return `BLOCKED`. Conceptual sensitivity triggers fail-closed `BLOCKED`. | Confirmed via `localInference.ts:18-46` & `deviceProfiler.ts:96-113`. **Manual browser run `[REQUIRES MANUAL TEST]`**. |
| **Android (Chrome / WebView / Low-end 2–4 GB phones)** | Mobile UA (`platform: 'mobile-web'`); `deviceMemory` / `connection` available on Android Chrome | Follows `2 / 3–4 / 8 GB` caps above | **None in this codebase** (no native Android/AICore/Capacitor bridge; Desktop Prompt API generally absent on Android Chrome) | **Cloud / Verified Hybrid only** (unless an experimental Android Chromium flag exposes `globalThis.LanguageModel`). **Zero native Android APK or offline AI exists today.** | Confirmed via workspace inspection (`package.json`, no `android/`). **Physical Android device `[REQUIRES MANUAL TEST]`**. |
| **iOS (Safari / Chrome / Edge on iPhone & iPad)** | Mobile UA (`WebKit` for all browsers), `deviceMemory: null`, `navigator.connection` unsupported | `entry_3_4gb` (if `cores <= 4`) or `unknown` | **None (`apiPresent = false`)** | **Cloud / Verified Hybrid only.** Offline execution impossible (`BLOCKED`). | Confirmed via `browserProbes.ts` + iOS WebKit platform limits. |

---

## 2. Important Hardware Telemetry Caveat (`navigator.deviceMemory`)

1. **Coarse Bucketing Spec:** Chromium intentionally rounds `navigator.deviceMemory` to powers of 2 (`0.25, 0.5, 1, 2, 4, 8`) to mitigate fingerprinting. Consequently, a 6 GB laptop will be classified as either `entry_3_4gb` (`4`) or `high_8gb_plus` (`8`) rather than `mid_6gb` in real Chrome.
2. **Non-Visible Memory Footprint:** `performance.memory.usedJSHeapSize` (used in `src/services/browserBenchmark.ts:63-70`) measures **only the React/JS tab heap**. The `~1.7–4 GB` Gemini Nano weights and inference buffers live inside Chrome's privileged Optimization Guide utility/GPU processes and **cannot be queried from web JavaScript**.
3. **Unmeasurable Metrics in Browsers:** Per-task CPU percentage, GPU compute utilization, thermal throttling state, and battery mAh drain are not exposed by Web APIs.

---

## 3. Reproducible Manual Hardware Test Protocol

To collect physical hardware measurements using the built-in **Live Browser Benchmark Suite** (`src/components/IntelligenceDashboardView.tsx:289-400` + `src/services/browserBenchmark.ts`):

### Prerequisites
- Host the app locally (`npm run dev` on `http://localhost:3000`) or use the HTTPS Dev URL.
- For **Chrome Local Nano tests**: Use Desktop **Google Chrome 138+** with sufficient disk (`> 4 GB` free) and Prompt API flags/components active; confirm model readiness in `SettingsView` or inspect `probeChromeLocalModel()` status badge showing `available`.
- For **Full 8-Task Comparison (`LOCAL / CLOUD / HYBRID`)**: Sign in via Google Auth in the app UI (required by `/api/ai/execute` auth gate).

### Procedure per Device Tier (2 GB, 3–4 GB, 6 GB, 8+ GB, Android, Safari)
1. **System Baseline Recording (Outside Browser):** Record OS Activity Monitor / Task Manager / `adb shell dumpsys meminfo` baseline RAM and Chrome GPU/Utility process RSS before launching prompts.
2. **Open ORBIT AI → Intelligence Dashboard → Live Browser Benchmark Suite.**
3. **Run Scope 1 (`Local Only (0 Cloud Calls)`):**
   - Click **Run Live Benchmark** while monitoring Chrome Task Manager (`Shift+Esc`) to observe Nano utility process memory delta and cold-start vs warm reuse latencies (`localColdStartMs`, `localWarmMeanMs`, `heapDeltaKb`).
   - Click **Copy JSON Report** and save output.
4. **Run Scope 2 (`Full 8-Task Comparison`):**
   - Run signed-in with DevTools **Network** tab open (`Disable cache` checked) to measure total HTTP transfer bytes (`KB`) and round-trip latency for `CLOUD` and `HYBRID` rows.
   - Click **Copy JSON Report** and save output.
5. **Simulated Low-End & Slow Network Matrix in Desktop Chrome DevTools (when sparse physical hardware is unavailable):**
   - Throttle Network to **`Slow 3G` / custom `2G`** (`250 kbps`, `800 ms RTT`) in DevTools Network panel and re-run to confirm `simple_qa` stays `LOCAL` instead of hitting slow cloud RTT.
   - Toggle DevTools **Offline** preset and execute both an English simple Q&A (verifies offline `LOCAL` succeeds with `0` network calls) and an Arabic prompt (reproduces known `BLOCKED` limitation).
6. **Physical Android / Low-RAM Confirmation:** Open the Dev/Shared HTTPS URL on physical 2 GB / 4 GB Android Chrome and macOS/iOS Safari, confirm hardware banner & local availability (`Unavailable`), verify zero crashes, and execute a `HYBRID` PII prompt to confirm `[PLACEHOLDER]` masking on the Network tab.
