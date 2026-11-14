import crypto from 'node:crypto';
import http from 'node:http';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createAiRouter,
  SlidingWindowRateLimiter,
  type CertProvider,
  type GeminiTextExecutor,
} from '../server/security';

const PROJECT_ID = 'orbit-test-project';
const PROJECT_NUMBER = '123456789012';
const APP_ID = '1:123456789012:web:abcdef123456';

function signRs256Jwt(params: {
  kid: string;
  privateKey: crypto.KeyObject;
  payload: Record<string, unknown>;
}): string {
  const headerB64 = Buffer.from(
    JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: params.kid })
  ).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(params.payload)).toString('base64url');
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${headerB64}.${payloadB64}`);
  signer.end();
  const sigB64 = signer.sign(params.privateKey).toString('base64url');
  return `${headerB64}.${payloadB64}.${sigB64}`;
}

describe('POST /api/ai/execute Security, Auth, App Check, Validation & Rate Limiting', () => {
  let server: http.Server;
  let baseUrl = '';
  let authPrivateKey: crypto.KeyObject;
  let authPublicPem: string;
  let appCheckPrivateKey: crypto.KeyObject;
  let appCheckPublicJwk: crypto.JsonWebKey;
  let mockGemini: GeminiTextExecutor;

  beforeAll(async () => {
    const authKeys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    authPrivateKey = authKeys.privateKey;
    authPublicPem = authKeys.publicKey.export({ type: 'spki', format: 'pem' }).toString();

    const appCheckKeys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    appCheckPrivateKey = appCheckKeys.privateKey;
    appCheckPublicJwk = {
      ...appCheckKeys.publicKey.export({ format: 'jwk' }),
      kid: 'appcheck-key-1',
    };

    const certProvider: CertProvider = {
      getIdTokenCerts: async () => ({ 'auth-key-1': authPublicPem }),
      getAppCheckJwks: async () => ({ 'appcheck-key-1': appCheckPublicJwk }),
    };

    mockGemini = {
      generateText: vi.fn(async ({ modelId, prompt }) => ({
        text: `Authorized reply from ${modelId}: ${prompt.slice(0, 20)}`,
        inputTokens: 12,
        outputTokens: 8,
      })),
    };

    const app = express();
    app.use(express.json({ limit: '512kb' }));
    app.use(
      createAiRouter({
        firebaseConfig: {
          projectId: PROJECT_ID,
          projectNumber: PROJECT_NUMBER,
          appId: APP_ID,
          appCheckEnforced: true,
        },
        certProvider,
        isGeminiConfigured: () => true,
        geminiExecutor: mockGemini,
        uidLimiter: new SlidingWindowRateLimiter(3, 60_000),
        ipLimiter: new SlidingWindowRateLimiter(50, 60_000),
      })
    );

    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address() as { port: number };
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  function makeValidIdToken(overrides: Record<string, unknown> = {}) {
    const now = Math.floor(Date.now() / 1000);
    return signRs256Jwt({
      kid: 'auth-key-1',
      privateKey: authPrivateKey,
      payload: {
        iss: `https://securetoken.google.com/${PROJECT_ID}`,
        aud: PROJECT_ID,
        sub: 'user_uid_123',
        email: 'architect@orbit.dev',
        email_verified: true,
        iat: now - 10,
        auth_time: now - 10,
        exp: now + 3600,
        ...overrides,
      },
    });
  }

  function makeValidAppCheckToken(overrides: Record<string, unknown> = {}) {
    const now = Math.floor(Date.now() / 1000);
    return signRs256Jwt({
      kid: 'appcheck-key-1',
      privateKey: appCheckPrivateKey,
      payload: {
        iss: `https://firebaseappcheck.googleapis.com/${PROJECT_NUMBER}`,
        aud: [`projects/${PROJECT_NUMBER}`],
        sub: APP_ID,
        iat: now - 5,
        exp: now + 1800,
        ...overrides,
      },
    });
  }

  it('rejects unauthenticated requests with 401', async () => {
    const res = await fetch(`${baseUrl}/api/ai/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Hello', modelId: 'gemini-3.1-flash-lite' }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Authentication required');
  });

  it('rejects forged or expired Firebase ID tokens with 401', async () => {
    const expired = makeValidIdToken({ exp: Math.floor(Date.now() / 1000) - 60 });
    const resExpired = await fetch(`${baseUrl}/api/ai/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${expired}`,
      },
      body: JSON.stringify({ prompt: 'Hello', modelId: 'gemini-3.1-flash-lite' }),
    });
    expect(resExpired.status).toBe(401);

    const wrongAud = makeValidIdToken({ aud: 'wrong-project' });
    const resWrongAud = await fetch(`${baseUrl}/api/ai/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${wrongAud}`,
      },
      body: JSON.stringify({ prompt: 'Hello', modelId: 'gemini-3.1-flash-lite' }),
    });
    expect(resWrongAud.status).toBe(401);
  });

  it('rejects unverified email users with 403', async () => {
    const unverified = makeValidIdToken({ email_verified: false });
    const res = await fetch(`${baseUrl}/api/ai/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${unverified}`,
      },
      body: JSON.stringify({ prompt: 'Hello', modelId: 'gemini-3.1-flash-lite' }),
    });
    expect(res.status).toBe(403);
  });

  it('rejects missing or invalid Firebase App Check tokens with 401 when enforced', async () => {
    const idToken = makeValidIdToken({ sub: 'user_appcheck_test' });

    const missingAc = await fetch(`${baseUrl}/api/ai/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ prompt: 'Hello', modelId: 'gemini-3.1-flash-lite' }),
    });
    expect(missingAc.status).toBe(401);

    const invalidAc = await fetch(`${baseUrl}/api/ai/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
        'X-Firebase-AppCheck': 'tampered.jwt.token',
      },
      body: JSON.stringify({ prompt: 'Hello', modelId: 'gemini-3.1-flash-lite' }),
    });
    expect(invalidAc.status).toBe(401);
  });

  it('validates prompt and modelId whitelist strictly (400)', async () => {
    const idToken = makeValidIdToken({ sub: 'user_validation_test' });
    const appCheckToken = makeValidAppCheckToken();

    const badModel = await fetch(`${baseUrl}/api/ai/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
        'X-Firebase-AppCheck': appCheckToken,
      },
      body: JSON.stringify({ prompt: 'Hello', modelId: 'gemini-1.5-flash' }),
    });
    expect(badModel.status).toBe(400);

    const emptyPrompt = await fetch(`${baseUrl}/api/ai/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
        'X-Firebase-AppCheck': appCheckToken,
      },
      body: JSON.stringify({ prompt: '   ', modelId: 'gemini-3.1-flash-lite' }),
    });
    expect(emptyPrompt.status).toBe(400);
  });

  it('executes authorized requests and enforces per-UID rate limiting (429)', async () => {
    const idToken = makeValidIdToken({ sub: 'user_rate_limit_test' });
    const appCheckToken = makeValidAppCheckToken();

    for (let i = 0; i < 3; i++) {
      const okRes = await fetch(`${baseUrl}/api/ai/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
          'X-Firebase-AppCheck': appCheckToken,
        },
        body: JSON.stringify({ prompt: `Run ${i}`, modelId: 'gemini-3.1-flash-lite' }),
      });
      expect(okRes.status).toBe(200);
      const data = (await okRes.json()) as { text: string; modelUsed: string };
      expect(data.modelUsed).toBe('gemini-3.1-flash-lite');
      expect(data.text).toContain('Authorized reply');
    }

    const throttled = await fetch(`${baseUrl}/api/ai/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
        'X-Firebase-AppCheck': appCheckToken,
      },
      body: JSON.stringify({ prompt: 'Run 4', modelId: 'gemini-3.1-flash-lite' }),
    });
    expect(throttled.status).toBe(429);
    expect(throttled.headers.get('retry-after')).toBeTruthy();
  });

  it('rejects 3-part RS256 ID tokens with valid header/payload but tampered signature (401)', async () => {
    const valid = makeValidIdToken({ sub: 'user_tamper_test' });
    const [h, p] = valid.split('.');
    const tamperedSig = Buffer.from('forged-signature-bytes').toString('base64url');
    const res = await fetch(`${baseUrl}/api/ai/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${h}.${p}.${tamperedSig}`,
      },
      body: JSON.stringify({ prompt: 'Hello', modelId: 'gemini-3.1-flash-lite' }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('signature verification failed');
  });

  it('when appCheckEnforced is false, permits requests without App Check header but still rejects invalid App Check headers', async () => {
    const optionalApp = express();
    optionalApp.use(express.json({ limit: '512kb' }));
    optionalApp.use(
      createAiRouter({
        firebaseConfig: {
          projectId: PROJECT_ID,
          projectNumber: PROJECT_NUMBER,
          appId: APP_ID,
          appCheckEnforced: false,
          appCheckSiteKeyConfigured: false,
        },
        certProvider: {
          getIdTokenCerts: async () => ({ 'auth-key-1': authPublicPem }),
          getAppCheckJwks: async () => ({ 'appcheck-key-1': appCheckPublicJwk }),
        },
        isGeminiConfigured: () => true,
        geminiExecutor: mockGemini,
      })
    );

    const optServer = await new Promise<http.Server>((resolve) => {
      const s = optionalApp.listen(0, '127.0.0.1', () => resolve(s));
    });
    try {
      const addr = optServer.address() as { port: number };
      const optUrl = `http://127.0.0.1:${addr.port}`;
      const idToken = makeValidIdToken({ sub: 'user_optional_ac' });

      const okRes = await fetch(`${optUrl}/api/ai/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ prompt: 'Optional App Check pass', modelId: 'gemini-3.1-flash-lite' }),
      });
      expect(okRes.status).toBe(200);

      const badAcRes = await fetch(`${optUrl}/api/ai/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
          'X-Firebase-AppCheck': 'tampered.appcheck.token',
        },
        body: JSON.stringify({ prompt: 'Invalid App Check fail', modelId: 'gemini-3.1-flash-lite' }),
      });
      expect(badAcRes.status).toBe(401);
    } finally {
      await new Promise<void>((resolve, reject) => {
        optServer.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });
});
