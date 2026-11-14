import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import {
  createAiRouter,
  createDefaultGeminiExecutor,
  type FirebaseServerConfig,
} from './server/security.ts';

const PORT = Number(process.env.PORT || 3000);

function loadFirebaseServerConfig(): FirebaseServerConfig {
  const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
  const raw = fs.readFileSync(configPath, 'utf8');
  const parsed = JSON.parse(raw) as {
    projectId: string;
    appId: string;
    messagingSenderId: string;
    recaptchaSiteKey?: string;
  };

  const hasAppCheckSiteKey = Boolean(
    (parsed.recaptchaSiteKey && parsed.recaptchaSiteKey.trim()) ||
      (process.env.VITE_FIREBASE_APP_CHECK_SITE_KEY &&
        process.env.VITE_FIREBASE_APP_CHECK_SITE_KEY.trim())
  );

  const appCheckEnforced =
    process.env.APP_CHECK_ENFORCE === 'true' ||
    (process.env.APP_CHECK_ENFORCE !== 'false' && hasAppCheckSiteKey);

  return {
    projectId: parsed.projectId,
    projectNumber: parsed.messagingSenderId,
    appId: parsed.appId,
    appCheckEnforced,
    appCheckSiteKeyConfigured: hasAppCheckSiteKey,
  };
}

function isGeminiApiKeyConfigured(): boolean {
  const apiKey = process.env.GEMINI_API_KEY;
  return Boolean(apiKey && apiKey !== 'MY_GEMINI_API_KEY');
}

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '512kb' }));

  const firebaseServerConfig = loadFirebaseServerConfig();
  const geminiExecutor = createDefaultGeminiExecutor(() => process.env.GEMINI_API_KEY);
  if (!geminiExecutor) {
    throw new Error('Failed to initialize Gemini executor.');
  }

  app.use(
    createAiRouter({
      firebaseConfig: firebaseServerConfig,
      isGeminiConfigured: isGeminiApiKeyConfigured,
      geminiExecutor,
    })
  );

  const distDir = path.resolve(process.cwd(), 'dist');
  const isProd = process.env.NODE_ENV === 'production' && fs.existsSync(distDir);

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distDir));
    app.get('*all', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ORBIT AI server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start ORBIT AI server:', err);
  process.exit(1);
});
