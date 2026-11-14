# ORBIT AI — Setup, Testing & Firebase Hosting Deployment

## 1. Local Development Setup

### Prerequisites
- Node.js 20+
- npm 10+
- A Gemini API key set in `GEMINI_API_KEY` (automatically injected in AI Studio Secrets, or placed in `.env` locally — never commit secrets).

### Install & Run
```bash
npm install
npm run dev
```
The full-stack Express + Vite server listens on `http://localhost:3000`.

### Environment Variables (`.env.example`)
- `GEMINI_API_KEY`: Server-only Gemini API key used by `server.ts` (`/api/ai/execute`).
- `APP_URL`: Hosted application origin.
- `VITE_FIREBASE_APP_CHECK_PROVIDER`: `'v3'` (`ReCaptchaV3Provider`) or `'enterprise'` (`ReCaptchaEnterpriseProvider`). Must match the key type registered in Firebase Console.
- `VITE_FIREBASE_APP_CHECK_SITE_KEY`: reCAPTCHA site key for Firebase App Check.
- `APP_CHECK_ENFORCE`: Set to `'true'` on the Express server once an App Check site key is configured.
- `VITE_CLOUD_BACKEND`: `'auto'` (default), `'server-gemini'`, or `'firebase-ai-logic'`.
- `VITE_ENABLE_FIREBASE_AI_LOGIC`: `'true'` to allow `firebase/ai` fallback when static Firebase Hosting serves `dist/` without Express `/api/ai/execute`.

---

## 2. Automated Test Suite

Run the complete OAIE unit, privacy, hybrid decomposition, server Auth/AppCheck/rate-limit security tests, and Firestore security-invariant tests:

```bash
npm test
```

Type-check, build, and lint Firestore rules:
```bash
npm run lint
npm run build
npx eslint firestore.rules
```

---

## 3. Supported Local Inference Platforms

| Platform | Local Engine / API | Status | Notes |
| --- | --- | --- | --- |
| Desktop Chrome 138+ | Chrome Built-in Prompt API (`LanguageModel`) + Gemini Nano | Supported | Requires Gemini Nano download (~22 GB free disk) and Chrome AI flags/origin support |
| Safari / Firefox / iOS Web | None | Unsupported | Browser reports `'unavailable'`; OAIE never fakes local execution |
| Headless / Container Chromium | None | Unsupported | Reports `'unavailable'`; `STRICT_LOCAL` blocks cleanly |
| Android 14+ (Native) | Firebase AI Logic + ML Kit GenAI / AICore | Architecture Ready | `src/engine/` is DOM-free; requires native Android SDK (`com.google.firebase:firebase-ai`) |
| React Native / Expo | Custom `expo-dev-client` build | Architecture Ready | Expo Go is unsupported; requires native config plugin wrapping `firebase-ai` |

---

## 4. Firebase Hosting Deployment (Spark Plan Compatibility)

### Option A: Spark Plan (Static `dist/` + Firebase AI Logic) — Zero Paid Compute
Static Firebase Hosting (`firebase.json`) does **not** run Express (`server.ts`). To run ORBIT AI purely on the **Firebase Spark** plan:
1. In the Firebase Console for your verified project:
   - Enable **Google Sign-In** in Firebase Authentication.
   - Enable **Firebase AI Logic** (Gemini Developer API free tier).
   - Register **Firebase App Check** (`reCAPTCHA v3` or `reCAPTCHA Enterprise`) and place the site key in `VITE_FIREBASE_APP_CHECK_SITE_KEY` + matching `VITE_FIREBASE_APP_CHECK_PROVIDER`.
2. Build with Firebase AI Logic enabled:
   ```bash
   VITE_CLOUD_BACKEND=firebase-ai-logic VITE_ENABLE_FIREBASE_AI_LOGIC=true npm run build
   firebase deploy --only hosting,firestore:rules --project <your-verified-project-id>
   ```
   *(Never deploy or change projects until your target Firebase project ID is verified and approved.)*

### Option B: Full-Stack Express Backend (AI Studio / Self-Hosted / Cloud Run)
When running `node server.ts` (`npm run start`), Express serves both `dist/` and the authenticated `POST /api/ai/execute` endpoint using `GEMINI_API_KEY` on the server. Note that hosting Node containers on Google Cloud Run / Firebase App Hosting requires the **Blaze** plan.
