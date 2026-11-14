import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import type {
  CustomPrivacyPreferences,
  ExecutionRoute,
  LanguageCode,
  PrivacyMode,
  TelemetryRecord,
} from '../engine/types';
import { DEFAULT_CUSTOM_PREFERENCES } from '../engine/privacyGuardian';
import { db, handleFirestoreError, OperationType } from './firebase';

export interface StoredUserProfile {
  uid: string;
  email: string;
  displayName: string;
  language: LanguageCode;
  privacyMode: PrivacyMode;
  persistConversations: boolean;
  customPreferences: CustomPrivacyPreferences;
}

export interface StoredConversation {
  id: string;
  ownerId: string;
  title: string;
  language: LanguageCode;
  messageCount: number;
  lastRoute: ExecutionRoute;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface StoredMessage {
  id: string;
  ownerId: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  route: ExecutionRoute;
  modelUsed: string;
  latencyMs: number;
  estimatedCostUsd: number;
  privacyStatus: string;
  createdAtMs: number;
}

function timestampToMs(val: unknown): number {
  if (val instanceof Timestamp) return val.toMillis();
  if (val && typeof val === 'object' && 'toMillis' in val && typeof (val as { toMillis: () => number }).toMillis === 'function') {
    return (val as { toMillis: () => number }).toMillis();
  }
  return Date.now();
}

export function makeSafeId(prefix: string): string {
  const rand = Math.random().toString(36).replace(/[^a-zA-Z0-9]/g, '').slice(0, 8);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

export async function loadUserProfile(uid: string): Promise<StoredUserProfile | null> {
  const path = `users/${uid}/private/profile`;
  try {
    const snap = await getDoc(doc(db, 'users', uid, 'private', 'profile'));
    if (!snap.exists()) return null;
    const data = snap.data();
    return {
      uid: String(data.uid),
      email: String(data.email || ''),
      displayName: String(data.displayName || ''),
      language: data.language === 'ar' ? 'ar' : 'en',
      privacyMode: (data.privacyMode as PrivacyMode) || 'BALANCED',
      persistConversations: Boolean(data.persistConversations),
      customPreferences: {
        ...DEFAULT_CUSTOM_PREFERENCES,
        ...(data.customPreferences || {}),
      },
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function saveUserProfile(
  user: User,
  profile: Omit<StoredUserProfile, 'uid' | 'email' | 'displayName'>
): Promise<void> {
  const path = `users/${user.uid}/private/profile`;
  const ref = doc(db, 'users', user.uid, 'private', 'profile');
  try {
    const existing = await getDoc(ref);
    const displayName = (user.displayName || 'ORBIT User').slice(0, 120);
    const email = (user.email || 'user@example.com').slice(0, 254);

    if (!existing.exists()) {
      await setDoc(ref, {
        uid: user.uid,
        email,
        displayName,
        language: profile.language,
        privacyMode: profile.privacyMode,
        persistConversations: profile.persistConversations,
        customPreferences: profile.customPreferences,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        displayName,
        language: profile.language,
        privacyMode: profile.privacyMode,
        persistConversations: profile.persistConversations,
        customPreferences: profile.customPreferences,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function listUserConversations(uid: string): Promise<StoredConversation[]> {
  const path = 'conversations';
  try {
    const q = query(collection(db, 'conversations'), where('ownerId', '==', uid));
    const snap = await getDocs(q);
    const items: StoredConversation[] = snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        ownerId: String(data.ownerId),
        title: String(data.title || 'Conversation'),
        language: data.language === 'ar' ? 'ar' : 'en',
        messageCount: Number(data.messageCount || 0),
        lastRoute: (data.lastRoute as ExecutionRoute) || 'LOCAL',
        createdAtMs: timestampToMs(data.createdAt),
        updatedAtMs: timestampToMs(data.updatedAt),
      };
    });
    return items.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function createConversationRecord(params: {
  uid: string;
  conversationId: string;
  title: string;
  language: LanguageCode;
  lastRoute: ExecutionRoute;
}): Promise<void> {
  const path = `conversations/${params.conversationId}`;
  try {
    await setDoc(doc(db, 'conversations', params.conversationId), {
      ownerId: params.uid,
      title: params.title.trim().slice(0, 140) || 'New Conversation',
      language: params.language,
      messageCount: 0,
      lastRoute: params.lastRoute,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateConversationRecord(params: {
  conversationId: string;
  messageCount: number;
  lastRoute: ExecutionRoute;
  title?: string;
}): Promise<void> {
  const path = `conversations/${params.conversationId}`;
  try {
    const payload: Record<string, unknown> = {
      messageCount: Math.max(0, Math.min(500, Math.floor(params.messageCount))),
      lastRoute: params.lastRoute,
      updatedAt: serverTimestamp(),
    };
    if (params.title) {
      payload.title = params.title.trim().slice(0, 140);
    }
    await updateDoc(doc(db, 'conversations', params.conversationId), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function listConversationMessages(
  uid: string,
  conversationId: string
): Promise<StoredMessage[]> {
  const path = `conversations/${conversationId}/messages`;
  try {
    const q = query(
      collection(db, 'conversations', conversationId, 'messages'),
      where('ownerId', '==', uid)
    );
    const snap = await getDocs(q);
    const items: StoredMessage[] = snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        ownerId: String(data.ownerId),
        conversationId: String(data.conversationId),
        role: data.role === 'user' ? 'user' : 'assistant',
        content: String(data.content || ''),
        route: (data.route as ExecutionRoute) || 'LOCAL',
        modelUsed: String(data.modelUsed || 'unknown'),
        latencyMs: Number(data.latencyMs || 0),
        estimatedCostUsd: Number(data.estimatedCostUsd || 0),
        privacyStatus: String(data.privacyStatus || 'Unknown'),
        createdAtMs: timestampToMs(data.createdAt),
      };
    });
    return items.sort((a, b) => a.createdAtMs - b.createdAtMs);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function addMessageRecord(params: {
  uid: string;
  conversationId: string;
  messageId: string;
  role: 'user' | 'assistant';
  content: string;
  route: ExecutionRoute;
  modelUsed: string;
  latencyMs: number;
  estimatedCostUsd: number;
  privacyStatus: string;
}): Promise<void> {
  const path = `conversations/${params.conversationId}/messages/${params.messageId}`;
  try {
    await setDoc(doc(db, 'conversations', params.conversationId, 'messages', params.messageId), {
      ownerId: params.uid,
      conversationId: params.conversationId,
      role: params.role,
      content: params.content.slice(0, 32000) || '(empty)',
      route: params.route,
      modelUsed: params.modelUsed.slice(0, 100) || 'none',
      latencyMs: Math.max(0, Math.min(600000, params.latencyMs)),
      estimatedCostUsd: Math.max(0, Math.min(10, params.estimatedCostUsd)),
      privacyStatus: params.privacyStatus.slice(0, 80) || 'Default',
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function deleteConversationCascade(
  uid: string,
  conversationId: string
): Promise<void> {
  const path = `conversations/${conversationId}`;
  try {
    const msgQ = query(
      collection(db, 'conversations', conversationId, 'messages'),
      where('ownerId', '==', uid)
    );
    const msgSnap = await getDocs(msgQ);
    const batch = writeBatch(db);
    for (const d of msgSnap.docs) {
      batch.delete(d.ref);
    }
    batch.delete(doc(db, 'conversations', conversationId));
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function recordTelemetryEntry(
  uid: string,
  record: TelemetryRecord
): Promise<void> {
  const safeId = record.id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
  const path = `telemetry/${safeId}`;
  try {
    await setDoc(doc(db, 'telemetry', safeId), {
      ownerId: uid,
      taskType: record.taskType.slice(0, 64),
      route: record.route,
      modelUsed: record.modelUsed.slice(0, 100),
      privacyMode: record.privacyMode,
      estimatedLatencyMs: Math.max(0, Math.min(600000, record.estimatedLatencyMs)),
      actualLatencyMs: Math.max(0, Math.min(600000, record.actualLatencyMs)),
      estimatedCostUsd: Math.max(0, Math.min(10, record.estimatedCostUsd)),
      inputTokens: Math.max(0, Math.min(1000000, Math.floor(record.inputTokens))),
      outputTokens: Math.max(0, Math.min(1000000, Math.floor(record.outputTokens))),
      status: record.status,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function listUserTelemetry(uid: string): Promise<TelemetryRecord[]> {
  const path = 'telemetry';
  try {
    const q = query(collection(db, 'telemetry'), where('ownerId', '==', uid));
    const snap = await getDocs(q);
    const items: TelemetryRecord[] = snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        timestampIso: new Date(timestampToMs(data.createdAt)).toISOString(),
        taskType: data.taskType,
        route: data.route,
        modelUsed: String(data.modelUsed),
        privacyMode: data.privacyMode,
        estimatedLatencyMs: Number(data.estimatedLatencyMs || 0),
        actualLatencyMs: Number(data.actualLatencyMs || 0),
        estimatedCostUsd: Number(data.estimatedCostUsd || 0),
        inputTokens: Number(data.inputTokens || 0),
        outputTokens: Number(data.outputTokens || 0),
        status: data.status,
      };
    });
    return items.sort(
      (a, b) => new Date(b.timestampIso).getTime() - new Date(a.timestampIso).getTime()
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function clearUserTelemetry(uid: string): Promise<void> {
  const path = 'telemetry';
  try {
    const q = query(collection(db, 'telemetry'), where('ownerId', '==', uid));
    const snap = await getDocs(q);
    for (const d of snap.docs) {
      await deleteDoc(d.ref);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}
