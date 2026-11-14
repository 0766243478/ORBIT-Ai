import crypto from 'node:crypto';
import express, { type Request, type Response, type Router } from 'express';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';

export const ALLOWED_GEMINI_MODELS = new Set([
  'gemini-4-hydrogen',
  'gemini-3.1-flash-lite',
]);

export interface FirebaseServerConfig {
  projectId: string;
  projectNumber: string;
  appId: string;
  appCheckEnforced: boolean;
  appCheckSiteKeyConfigured?: boolean;
}

export interface VerifiedFirebaseUser {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  issuer: string;
  audience: string;
}

export interface VerifiedAppCheckClaims {
  appId: string;
  projectNumber: string;
  exp: number;
}

interface JwtParts {
  headerB64: string;
  payloadB64: string;
  signature: Buffer;
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
}

function parseJwt(token: string): JwtParts {
  const segments = token.trim().split('.');
  if (segments.length !== 3 || !segments[0] || !segments[1] || !segments[2]) {
    throw new Error('Malformed JWT structure.');
  }
  const [headerB64, payloadB64, sigB64] = segments;
  const header = JSON.parse(
    Buffer.from(headerB64, 'base64url').toString('utf8')
  ) as Record<string, unknown>;
  const payload = JSON.parse(
    Buffer.from(payloadB64, 'base64url').toString('utf8')
  ) as Record<string, unknown>;
  const signature = Buffer.from(sigB64, 'base64url');
  return { headerB64, payloadB64, signature, header, payload };
}

function parseMaxAgeSeconds(cacheControl: string | null, fallbackSec: number): number {
  if (!cacheControl) return fallbackSec;
  const match = /max-age=(\d+)/i.exec(cacheControl);
  if (!match) return fallbackSec;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackSec;
}

const GOOGLE_SECURETOKEN_CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
const FIREBASE_APP_CHECK_JWKS_URL =
  'https://firebaseappcheck.googleapis.com/v1/jwks';

export interface CertProvider {
  getIdTokenCerts(forceRefresh?: boolean): Promise<Record<string, string>>;
  getAppCheckJwks(forceRefresh?: boolean): Promise<Record<string, crypto.JsonWebKey>>;
}

export function createGoogleCertProvider(): CertProvider {
  let cachedIdCerts: Record<string, string> | null = null;
  let idCertsExpiresAt = 0;

  let cachedJwks: Record<string, crypto.JsonWebKey> | null = null;
  let jwksExpiresAt = 0;

  return {
    async getIdTokenCerts(forceRefresh = false) {
      const now = Date.now();
      if (!forceRefresh && cachedIdCerts && now < idCertsExpiresAt) {
        return cachedIdCerts;
      }
      const res = await fetch(GOOGLE_SECURETOKEN_CERTS_URL);
      if (!res.ok) {
        throw new Error(`Failed to fetch Firebase public certificates (${res.status}).`);
      }
      const certs = (await res.json()) as Record<string, string>;
      const maxAge = parseMaxAgeSeconds(res.headers.get('cache-control'), 3600);
      cachedIdCerts = certs;
      idCertsExpiresAt = now + maxAge * 1000;
      return certs;
    },

    async getAppCheckJwks(forceRefresh = false) {
      const now = Date.now();
      if (!forceRefresh && cachedJwks && now < jwksExpiresAt) {
        return cachedJwks;
      }
      const res = await fetch(FIREBASE_APP_CHECK_JWKS_URL);
      if (!res.ok) {
        throw new Error(`Failed to fetch Firebase App Check JWKS (${res.status}).`);
      }
      const body = (await res.json()) as {
        keys?: Array<crypto.JsonWebKey & { kid?: string }>;
      };
      const map: Record<string, crypto.JsonWebKey> = {};
      for (const jwk of body.keys || []) {
        if (typeof jwk.kid === 'string') {
          map[jwk.kid] = jwk;
        }
      }
      const maxAge = parseMaxAgeSeconds(res.headers.get('cache-control'), 21600);
      cachedJwks = map;
      jwksExpiresAt = now + maxAge * 1000;
      return map;
    },
  };
}

export class AuthVerificationError extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

export async function verifyFirebaseIdToken(
  token: string,
  projectId: string,
  certProvider: CertProvider,
  nowSec = Math.floor(Date.now() / 1000)
): Promise<VerifiedFirebaseUser> {
  let parts: JwtParts;
  try {
    parts = parseJwt(token);
  } catch {
    throw new AuthVerificationError(401, 'Invalid Firebase ID token format.');
  }

  const { headerB64, payloadB64, signature, header, payload } = parts;
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid) {
    throw new AuthVerificationError(401, 'Unsupported Firebase ID token algorithm or missing kid.');
  }

  let certs = await certProvider.getIdTokenCerts(false);
  let pem = certs[header.kid];
  if (!pem) {
    certs = await certProvider.getIdTokenCerts(true);
    pem = certs[header.kid];
  }
  if (!pem) {
    throw new AuthVerificationError(401, 'Firebase ID token key ID is unknown or expired.');
  }

  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${headerB64}.${payloadB64}`);
  verifier.end();
  const validSig = verifier.verify(pem, signature);
  if (!validSig) {
    throw new AuthVerificationError(401, 'Firebase ID token signature verification failed.');
  }

  const expectedIssuer = `https://securetoken.google.com/${projectId}`;
  if (payload.aud !== projectId) {
    throw new AuthVerificationError(401, 'Firebase ID token audience mismatch.');
  }
  if (payload.iss !== expectedIssuer) {
    throw new AuthVerificationError(401, 'Firebase ID token issuer mismatch.');
  }
  if (typeof payload.sub !== 'string' || payload.sub.length === 0 || payload.sub.length > 128) {
    throw new AuthVerificationError(401, 'Firebase ID token missing valid subject.');
  }
  if (typeof payload.exp !== 'number' || payload.exp <= nowSec) {
    throw new AuthVerificationError(401, 'Firebase ID token has expired.');
  }
  if (typeof payload.iat !== 'number' || payload.iat > nowSec + 300) {
    throw new AuthVerificationError(401, 'Firebase ID token issued-at timestamp is invalid.');
  }
  if (typeof payload.auth_time === 'number' && payload.auth_time > nowSec + 300) {
    throw new AuthVerificationError(401, 'Firebase ID token auth_time is in the future.');
  }
  if (payload.email_verified !== true) {
    throw new AuthVerificationError(
      403,
      'Verified account email is required before executing Cloud Gemini tasks.'
    );
  }

  return {
    uid: payload.sub,
    email: typeof payload.email === 'string' ? payload.email : null,
    emailVerified: true,
    issuer: payload.iss,
    audience: payload.aud,
  };
}

export async function verifyFirebaseAppCheckToken(
  token: string,
  config: Pick<FirebaseServerConfig, 'projectNumber' | 'appId'>,
  certProvider: CertProvider,
  nowSec = Math.floor(Date.now() / 1000)
): Promise<VerifiedAppCheckClaims> {
  let parts: JwtParts;
  try {
    parts = parseJwt(token);
  } catch {
    throw new AuthVerificationError(401, 'Invalid App Check token format.');
  }

  const { headerB64, payloadB64, signature, header, payload } = parts;
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid) {
    throw new AuthVerificationError(401, 'Unsupported App Check token header.');
  }

  let jwks = await certProvider.getAppCheckJwks(false);
  let jwk = jwks[header.kid];
  if (!jwk) {
    jwks = await certProvider.getAppCheckJwks(true);
    jwk = jwks[header.kid];
  }
  if (!jwk) {
    throw new AuthVerificationError(401, 'App Check signing key not found.');
  }

  const publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${headerB64}.${payloadB64}`);
  verifier.end();
  if (!verifier.verify(publicKey, signature)) {
    throw new AuthVerificationError(401, 'App Check signature verification failed.');
  }

  const expectedIssuer = `https://firebaseappcheck.googleapis.com/${config.projectNumber}`;
  const expectedAudience = `projects/${config.projectNumber}`;
  const audList = Array.isArray(payload.aud)
    ? payload.aud
    : typeof payload.aud === 'string'
      ? [payload.aud]
      : [];

  if (payload.iss !== expectedIssuer) {
    throw new AuthVerificationError(401, 'App Check token issuer mismatch.');
  }
  if (!audList.includes(expectedAudience)) {
    throw new AuthVerificationError(401, 'App Check token audience mismatch.');
  }
  if (payload.sub !== config.appId) {
    throw new AuthVerificationError(401, 'App Check token app ID mismatch.');
  }
  if (typeof payload.exp !== 'number' || payload.exp <= nowSec) {
    throw new AuthVerificationError(401, 'App Check token has expired.');
  }

  return {
    appId: payload.sub,
    projectNumber: config.projectNumber,
    exp: payload.exp,
  };
}

export class SlidingWindowRateLimiter {
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private readonly buckets = new Map<string, number[]>();

  constructor(maxRequests = 20, windowMs = 60_000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  check(key: string, nowMs = Date.now()): { allowed: boolean; retryAfterSec: number; remaining: number } {
    const cutoff = nowMs - this.windowMs;
    const recent = (this.buckets.get(key) || []).filter((ts) => ts > cutoff);

    if (recent.length >= this.maxRequests) {
      const oldest = recent[0] ?? nowMs;
      const retryAfterSec = Math.max(1, Math.ceil((oldest + this.windowMs - nowMs) / 1000));
      this.buckets.set(key, recent);
      return { allowed: false, retryAfterSec, remaining: 0 };
    }

    recent.push(nowMs);
    this.buckets.set(key, recent);
    return {
      allowed: true,
      retryAfterSec: 0,
      remaining: Math.max(0, this.maxRequests - recent.length),
    };
  }
}

export interface ValidatedAiRequest {
  prompt: string;
  modelId: 'gemini-4-hydrogen' | 'gemini-3.1-flash-lite';
  systemInstruction: string;
  thinkingLevel?: 'LOW' | 'MEDIUM' | 'HIGH';
}

export function validateAiExecuteBody(rawBody: unknown): ValidatedAiRequest {
  if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
    throw new AuthVerificationError(400, 'Request body must be a JSON object.');
  }

  const body = rawBody as Record<string, unknown>;
  if (typeof body.prompt !== 'string' || !body.prompt.trim()) {
    throw new AuthVerificationError(400, 'Field "prompt" must be a non-empty string.');
  }
  if (body.prompt.length > 48_000) {
    throw new AuthVerificationError(400, 'Prompt exceeds maximum server payload length (48,000 chars).');
  }

  if (typeof body.modelId !== 'string' || !ALLOWED_GEMINI_MODELS.has(body.modelId)) {
    throw new AuthVerificationError(
      400,
      `Field "modelId" must be one of: ${Array.from(ALLOWED_GEMINI_MODELS).join(', ')}.`
    );
  }

  let systemInstruction = 'You are ORBIT AI, a precise adaptive intelligence assistant.';
  if (body.systemInstruction !== undefined) {
    if (typeof body.systemInstruction !== 'string') {
      throw new AuthVerificationError(400, 'Field "systemInstruction" must be a string.');
    }
    if (body.systemInstruction.length > 4_000) {
      throw new AuthVerificationError(400, 'Field "systemInstruction" exceeds 4,000 characters.');
    }
    if (body.systemInstruction.trim()) {
      systemInstruction = body.systemInstruction.trim();
    }
  }

  let thinkingLevel: ValidatedAiRequest['thinkingLevel'];
  if (body.thinkingLevel !== undefined) {
    if (
      body.thinkingLevel !== 'LOW' &&
      body.thinkingLevel !== 'MEDIUM' &&
      body.thinkingLevel !== 'HIGH'
    ) {
      throw new AuthVerificationError(400, 'Field "thinkingLevel" must be LOW, MEDIUM, or HIGH.');
    }
    thinkingLevel = body.thinkingLevel;
  }

  return {
    prompt: body.prompt,
    modelId: body.modelId as ValidatedAiRequest['modelId'],
    systemInstruction,
    thinkingLevel,
  };
}

export interface GeminiTextExecutor {
  generateText(params: ValidatedAiRequest): Promise<{
    text: string;
    inputTokens?: number;
    outputTokens?: number;
  }>;
}

export function createDefaultGeminiExecutor(apiKeyProvider: () => string | undefined): GeminiTextExecutor | null {
  return {
    async generateText(params) {
      const apiKey = apiKeyProvider();
      if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
        throw new Error('GEMINI_API_KEY_MISSING');
      }
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      const thinkingConfig =
        params.modelId === 'gemini-4-hydrogen'
          ? {
              thinkingLevel:
                params.thinkingLevel === 'HIGH'
                  ? ThinkingLevel.HIGH
                  : params.thinkingLevel === 'MEDIUM'
                    ? ThinkingLevel.MEDIUM
                    : ThinkingLevel.LOW,
            }
          : undefined;

      const response = await ai.models.generateContent({
        model: params.modelId,
        contents: params.prompt,
        config: {
          systemInstruction: params.systemInstruction,
          ...(thinkingConfig ? { thinkingConfig } : {}),
        },
      });

      const text = response.text ?? '';
      const usage = response.usageMetadata;
      return {
        text,
        inputTokens: usage?.promptTokenCount,
        outputTokens: usage?.candidatesTokenCount,
      };
    },
  };
}

export interface CreateAiRouterDeps {
  firebaseConfig: FirebaseServerConfig;
  certProvider?: CertProvider;
  isGeminiConfigured: () => boolean;
  geminiExecutor: GeminiTextExecutor;
  uidLimiter?: SlidingWindowRateLimiter;
  ipLimiter?: SlidingWindowRateLimiter;
}

export function createAiRouter(deps: CreateAiRouterDeps): Router {
  const router = express.Router();
  const certProvider = deps.certProvider || createGoogleCertProvider();
  const uidLimiter = deps.uidLimiter || new SlidingWindowRateLimiter(20, 60_000);
  const ipLimiter = deps.ipLimiter || new SlidingWindowRateLimiter(40, 60_000);

  router.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      geminiConfigured: deps.isGeminiConfigured(),
      authRequired: true,
      appCheckEnforced: deps.firebaseConfig.appCheckEnforced,
      appCheckSiteKeyConfigured: Boolean(deps.firebaseConfig.appCheckSiteKeyConfigured),
      allowedModels: Array.from(ALLOWED_GEMINI_MODELS),
      timestamp: new Date().toISOString(),
    });
  });

  router.post('/api/ai/execute', async (req: Request, res: Response) => {
    if (!deps.isGeminiConfigured()) {
      res.status(503).json({
        error:
          'Server Gemini API key is not configured. Add GEMINI_API_KEY in AI Studio Secrets or environment.',
      });
      return;
    }

    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    const ipCheck = ipLimiter.check(`ip:${clientIp}`);
    if (!ipCheck.allowed) {
      res.setHeader('Retry-After', String(ipCheck.retryAfterSec));
      res.status(429).json({
        error: `Rate limit exceeded. Retry in ${ipCheck.retryAfterSec}s.`,
      });
      return;
    }

    // 1. Verify Firebase Auth ID Token (Mandatory)
    const authHeader = req.header('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        error: 'Authentication required. Sign in with Google to call Cloud Gemini inference.',
      });
      return;
    }
    const idToken = authHeader.slice('Bearer '.length).trim();
    if (!idToken) {
      res.status(401).json({ error: 'Bearer token must not be empty.' });
      return;
    }

    let verifiedUser: VerifiedFirebaseUser;
    try {
      verifiedUser = await verifyFirebaseIdToken(
        idToken,
        deps.firebaseConfig.projectId,
        certProvider
      );
    } catch (err) {
      const status = err instanceof AuthVerificationError ? err.statusCode : 401;
      const message = err instanceof Error ? err.message : 'Invalid authentication token.';
      res.status(status).json({ error: message });
      return;
    }

    // 2. Per-UID Rate Limit
    const uidCheck = uidLimiter.check(`uid:${verifiedUser.uid}`);
    if (!uidCheck.allowed) {
      res.setHeader('Retry-After', String(uidCheck.retryAfterSec));
      res.status(429).json({
        error: `User rate limit exceeded. Retry in ${uidCheck.retryAfterSec}s.`,
      });
      return;
    }

    // 3. Verify Firebase App Check Token (Strict when enforced OR when token is supplied)
    const appCheckToken = req.header('x-firebase-appcheck')?.trim();
    if (deps.firebaseConfig.appCheckEnforced && !appCheckToken) {
      res.status(401).json({
        error: 'Missing X-Firebase-AppCheck token header.',
      });
      return;
    }
    if (appCheckToken) {
      try {
        await verifyFirebaseAppCheckToken(
          appCheckToken,
          deps.firebaseConfig,
          certProvider
        );
      } catch (err) {
        const status = err instanceof AuthVerificationError ? err.statusCode : 401;
        const message = err instanceof Error ? err.message : 'Invalid App Check token.';
        res.status(status).json({ error: message });
        return;
      }
    }

    // 4. Strict Request Validation
    let validated: ValidatedAiRequest;
    try {
      validated = validateAiExecuteBody(req.body);
    } catch (err) {
      const status = err instanceof AuthVerificationError ? err.statusCode : 400;
      const message = err instanceof Error ? err.message : 'Invalid request payload.';
      res.status(status).json({ error: message });
      return;
    }

    // 5. Execute Gemini server-side without ever returning secrets
    try {
      const result = await deps.geminiExecutor.generateText(validated);
      res.json({
        text: result.text,
        modelUsed: validated.modelId,
        inputTokens: result.inputTokens ?? Math.ceil(validated.prompt.length / 4),
        outputTokens: result.outputTokens ?? Math.ceil(result.text.length / 4),
        providerUsed: 'server-gemini',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('Gemini server execution failed:', message);

      if (message.includes('403') || message.includes('PERMISSION_DENIED')) {
        res.status(403).json({
          error: 'Gemini API permission denied. Check GEMINI_API_KEY in Settings > Secrets.',
        });
        return;
      }
      if (message.includes('429') || message.includes('RESOURCE_EXHAUSTED')) {
        res.status(429).json({
          error: 'Gemini API quota exhausted. Please retry shortly or verify tier quota.',
        });
        return;
      }
      if (message.includes('404') || message.includes('NOT_FOUND')) {
        res.status(404).json({
          error: `Requested model (${validated.modelId}) was not found or is unsupported.`,
        });
        return;
      }
      if (message.includes('503') || message.includes('UNAVAILABLE')) {
        res.status(503).json({
          error: `Gemini model (${validated.modelId}) is temporarily overloaded (503 UNAVAILABLE).`,
        });
        return;
      }

      res.status(502).json({ error: 'Cloud Gemini execution failed upstream.' });
    }
  });

  return router;
}
