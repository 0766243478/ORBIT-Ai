import { initializeApp } from 'firebase/app';
import {
  getToken as getAppCheckToken,
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
  ReCaptchaV3Provider,
  type AppCheck,
} from 'firebase/app-check';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { doc, getDocFromServer, getFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export const firebaseMetadata = {
  projectId: firebaseConfig.projectId,
  firestoreDatabaseId: firebaseConfig.firestoreDatabaseId,
  authDomain: firebaseConfig.authDomain,
  appId: firebaseConfig.appId,
};

export type AppCheckProviderKind = 'v3' | 'enterprise' | 'none';

const envMeta =
  typeof import.meta !== 'undefined'
    ? (import.meta.env as Record<string, string | undefined> | undefined)
    : undefined;

const rawProvider = (envMeta?.VITE_FIREBASE_APP_CHECK_PROVIDER || 'v3').toLowerCase().trim();
const configuredSiteKey = (
  envMeta?.VITE_FIREBASE_APP_CHECK_SITE_KEY ||
  firebaseConfig.recaptchaSiteKey ||
  ''
).trim();

let appCheckInstance: AppCheck | null = null;
let appCheckStatus: 'active' | 'not-configured' | 'error' = 'not-configured';
let appCheckProviderType: AppCheckProviderKind = 'none';
let appCheckReason =
  'No reCAPTCHA site key configured in firebase-applet-config.json or VITE_FIREBASE_APP_CHECK_SITE_KEY.';

if (typeof window !== 'undefined' && configuredSiteKey.length > 0) {
  try {
    if (rawProvider === 'enterprise') {
      appCheckProviderType = 'enterprise';
      appCheckInstance = initializeAppCheck(app, {
        provider: new ReCaptchaEnterpriseProvider(configuredSiteKey),
        isTokenAutoRefreshEnabled: true,
      });
      appCheckStatus = 'active';
      appCheckReason = 'Firebase App Check active (ReCaptchaEnterpriseProvider).';
    } else if (rawProvider === 'v3') {
      appCheckProviderType = 'v3';
      appCheckInstance = initializeAppCheck(app, {
        provider: new ReCaptchaV3Provider(configuredSiteKey),
        isTokenAutoRefreshEnabled: true,
      });
      appCheckStatus = 'active';
      appCheckReason = 'Firebase App Check active (ReCaptchaV3Provider).';
    } else {
      appCheckStatus = 'error';
      appCheckProviderType = 'none';
      appCheckReason = `Invalid VITE_FIREBASE_APP_CHECK_PROVIDER="${rawProvider}". Expected "v3" or "enterprise".`;
    }
  } catch (err) {
    appCheckStatus = 'error';
    appCheckReason = err instanceof Error ? err.message : String(err);
  }
}

export async function getAppCheckTokenSafe(): Promise<string | null> {
  if (!appCheckInstance) return null;
  try {
    const tokenResult = await getAppCheckToken(appCheckInstance, false);
    return tokenResult.token || null;
  } catch {
    return null;
  }
}

export {
  appCheckInstance,
  appCheckProviderType,
  appCheckStatus,
  appCheckReason,
};

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export type FirestoreConnectionState = 'checking' | 'connected' | 'offline' | 'error';

export async function testFirestoreConnection(): Promise<{
  state: FirestoreConnectionState;
  detail: string;
}> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return { state: 'connected', detail: 'Firestore server reachable.' };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
      return { state: 'offline', detail: 'Firestore client is offline.' };
    }
    if (msg.toLowerCase().includes('permission') || msg.toLowerCase().includes('insufficient')) {
      return { state: 'connected', detail: 'Firestore server reachable (rules active).' };
    }
    return { state: 'error', detail: msg };
  }
}
