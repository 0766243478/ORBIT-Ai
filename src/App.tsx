import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { useCallback, useEffect, useState } from 'react';
import {
  AssistantView,
  type UiConversation,
  type UiMessage,
} from './components/AssistantView';
import { ExecutionDetailsDrawer } from './components/ExecutionDetailsDrawer';
import { IntelligenceDashboardView } from './components/IntelligenceDashboardView';
import { OnboardingView } from './components/OnboardingView';
import { PrivacyCenterView } from './components/PrivacyCenterView';
import { SettingsView } from './components/SettingsView';
import { TopNav, type ActiveScreen } from './components/TopNav';
import {
  DEFAULT_CUSTOM_PREFERENCES,
  type AttachmentPayload,
  type CustomPrivacyPreferences,
  type DeviceCapabilityProfile,
  type ExecutionResult,
  type LanguageCode,
  type ModelDescriptor,
  type NetworkStatusSnapshot,
  type OrbitEngine,
  type PrivacyMode,
  type TelemetryRecord,
} from './engine';
import { TRANSLATIONS } from './i18n/translations';
import {
  createBrowserOrbitEngine,
  type ServerHealthSnapshot,
} from './services/browserProbes';
import {
  auth,
  googleProvider,
  testFirestoreConnection,
  type FirestoreConnectionState,
} from './services/firebase';
import {
  addMessageRecord,
  clearUserTelemetry,
  createConversationRecord,
  deleteConversationCascade,
  listConversationMessages,
  listUserConversations,
  listUserTelemetry,
  loadUserProfile,
  makeSafeId,
  recordTelemetryEntry,
  saveUserProfile,
  updateConversationRecord,
} from './services/firestoreRepo';

export default function App() {
  const [activeScreen, setActiveScreen] = useState<ActiveScreen>(() => {
    try {
      return localStorage.getItem('orbit_onboarded') === '1'
        ? 'assistant'
        : 'onboarding';
    } catch {
      return 'onboarding';
    }
  });

  const [language, setLanguage] = useState<LanguageCode>('en');
  const [privacyMode, setPrivacyMode] = useState<PrivacyMode>('BALANCED');
  const [customPreferences, setCustomPreferences] = useState<CustomPrivacyPreferences>(
    DEFAULT_CUSTOM_PREFERENCES
  );
  const [persistConversations, setPersistConversations] = useState<boolean>(false);

  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const [engine, setEngine] = useState<OrbitEngine | null>(null);
  const [device, setDevice] = useState<DeviceCapabilityProfile | null>(null);
  const [network, setNetwork] = useState<NetworkStatusSnapshot | null>(null);
  const [models, setModels] = useState<ModelDescriptor[]>([]);
  const [serverHealth, setServerHealth] = useState<ServerHealthSnapshot | null>(null);
  const [firestoreConnection, setFirestoreConnection] = useState<{
    state: FirestoreConnectionState;
    detail: string;
  }>({ state: 'checking', detail: 'Testing Firestore connection…' });

  const [conversations, setConversations] = useState<UiConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [isExecuting, setIsExecuting] = useState<boolean>(false);
  const [inspectedExecution, setInspectedExecution] = useState<ExecutionResult | null>(
    null
  );
  const [telemetry, setTelemetry] = useState<TelemetryRecord[]>([]);

  const t = TRANSLATIONS[language];

  // Sync HTML dir & lang attributes for proper English LTR / Arabic RTL
  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
  }, [language]);

  const refreshEnvironment = useCallback(async () => {
    const { engine: nextEngine, health } = await createBrowserOrbitEngine();
    const env = await nextEngine.inspectEnvironment();
    setEngine(nextEngine);
    setServerHealth(health);
    setDevice(env.device);
    setNetwork(env.network);
    setModels(env.models);
  }, []);

  // Boot probes & Firestore connection check
  useEffect(() => {
    void refreshEnvironment();
    void testFirestoreConnection().then(setFirestoreConnection);

    const onOnline = () => void refreshEnvironment();
    const onOffline = () => void refreshEnvironment();
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [refreshEnvironment]);

  // Firebase Auth listener & Firestore data hydration
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      setAuthLoading(false);
      void refreshEnvironment();

      if (!nextUser) return;

      try {
        const profile = await loadUserProfile(nextUser.uid);
        if (profile) {
          setLanguage(profile.language);
          setPrivacyMode(profile.privacyMode);
          setPersistConversations(profile.persistConversations);
          setCustomPreferences(profile.customPreferences);

          if (profile.persistConversations) {
            const storedConvs = await listUserConversations(nextUser.uid);
            const hydrated: UiConversation[] = await Promise.all(
              storedConvs.slice(0, 15).map(async (c) => {
                const msgs = await listConversationMessages(nextUser.uid, c.id);
                return {
                  id: c.id,
                  title: c.title,
                  lastRoute: c.lastRoute,
                  updatedAtMs: c.updatedAtMs,
                  messages: msgs.map((m) => ({
                    id: m.id,
                    role: m.role,
                    content: m.content,
                    route: m.route,
                    modelUsed: m.modelUsed,
                    latencyMs: m.latencyMs,
                    estimatedCostUsd: m.estimatedCostUsd,
                    privacyStatus: m.privacyStatus,
                    status: m.route === 'BLOCKED' ? 'blocked' : 'success',
                    createdAtMs: m.createdAtMs,
                  })),
                };
              })
            );
            if (hydrated.length > 0) {
              setConversations(hydrated);
              setActiveConversationId(hydrated[0].id);
            }
          }
        } else {
          await saveUserProfile(nextUser, {
            language,
            privacyMode,
            persistConversations,
            customPreferences,
          });
        }

        const storedTelemetry = await listUserTelemetry(nextUser.uid);
        if (storedTelemetry.length > 0) {
          setTelemetry(storedTelemetry);
          engine?.seedTelemetry(storedTelemetry);
        }
      } catch (err) {
        console.error('Failed to load user Firestore state:', err);
      }
    });

    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const syncProfileToFirestore = useCallback(
    async (overrides: {
      language?: LanguageCode;
      privacyMode?: PrivacyMode;
      persistConversations?: boolean;
      customPreferences?: CustomPrivacyPreferences;
    }) => {
      if (!user) return;
      try {
        await saveUserProfile(user, {
          language: overrides.language ?? language,
          privacyMode: overrides.privacyMode ?? privacyMode,
          persistConversations:
            overrides.persistConversations ?? persistConversations,
          customPreferences: overrides.customPreferences ?? customPreferences,
        });
      } catch (err) {
        console.error('Failed to sync profile:', err);
      }
    },
    [user, language, privacyMode, persistConversations, customPreferences]
  );

  const handleChangeLanguage = (nextLang: LanguageCode) => {
    setLanguage(nextLang);
    void syncProfileToFirestore({ language: nextLang });
  };

  const handleChangePrivacyMode = (nextMode: PrivacyMode) => {
    setPrivacyMode(nextMode);
    void syncProfileToFirestore({ privacyMode: nextMode });
  };

  const handleChangeCustomPrefs = (nextPrefs: CustomPrivacyPreferences) => {
    setCustomPreferences(nextPrefs);
    void syncProfileToFirestore({ customPreferences: nextPrefs });
  };

  const handleTogglePersistConversations = (next: boolean) => {
    setPersistConversations(next);
    void syncProfileToFirestore({ persistConversations: next });
  };

  const handleSignIn = async () => {
    setAuthError(null);
    setAuthLoading(true);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : String(err));
      setAuthLoading(false);
    }
  };

  const handleSignOut = async () => {
    setAuthLoading(true);
    try {
      await signOut(auth);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleCompleteOnboarding = (dest: ActiveScreen) => {
    try {
      localStorage.setItem('orbit_onboarded', '1');
    } catch {
      // Ignore storage failures in restricted frames
    }
    setActiveScreen(dest);
  };

  const handleNewConversation = () => {
    const newConv: UiConversation = {
      id: makeSafeId('conv'),
      title: language === 'ar' ? 'محادثة جديدة' : 'New Conversation',
      messages: [],
      updatedAtMs: Date.now(),
      lastRoute: 'LOCAL',
    };
    setConversations((prev) => [newConv, ...prev]);
    setActiveConversationId(newConv.id);
  };

  const handleDeleteConversation = async (convId: string) => {
    setConversations((prev) => prev.filter((c) => c.id !== convId));
    if (activeConversationId === convId) {
      setActiveConversationId(null);
    }
    if (user && persistConversations) {
      try {
        await deleteConversationCascade(user.uid, convId);
      } catch (err) {
        console.error('Failed to delete Firestore conversation:', err);
      }
    }
  };

  const handleSendMessage = async (
    prompt: string,
    attachments: AttachmentPayload[]
  ) => {
    const activeEngine = engine || (await createBrowserOrbitEngine()).engine;

    let convId = activeConversationId;
    const existingConv = conversations.find((c) => c.id === convId);
    const isNewConv = !convId || !existingConv;
    const priorMessageCount = existingConv ? existingConv.messages.length : 0;
    const derivedTitle = (prompt.trim() || attachments[0]?.name || 'Task').slice(0, 60);

    if (isNewConv) {
      convId = makeSafeId('conv');
      const created: UiConversation = {
        id: convId,
        title: derivedTitle,
        messages: [],
        updatedAtMs: Date.now(),
        lastRoute: 'LOCAL',
      };
      setConversations((prev) => [created, ...prev]);
      setActiveConversationId(convId);
    }

    const userMsgId = makeSafeId('msg');
    const userMsg: UiMessage = {
      id: userMsgId,
      role: 'user',
      content: prompt.trim() || `[Attached ${attachments.map((a) => a.name).join(', ')}]`,
      route: 'LOCAL',
      modelUsed: 'user-input',
      latencyMs: 0,
      estimatedCostUsd: 0,
      privacyStatus: t.privacyModes[privacyMode].title,
      status: 'success',
      attachments,
      createdAtMs: Date.now(),
    };

    setConversations((prev) =>
      prev.map((c) =>
        c.id === convId
          ? {
              ...c,
              title: c.messages.length === 0 ? derivedTitle : c.title,
              messages: [...c.messages, userMsg],
              updatedAtMs: Date.now(),
            }
          : c
      )
    );

    setIsExecuting(true);

    try {
      const result = await activeEngine.runTask({
        input: {
          prompt,
          attachments,
          language,
        },
        privacyMode,
        customPreferences,
        language,
      });

      setDevice(result.device);
      setNetwork(result.network);

      const assistantMsgId = makeSafeId('msg');
      const localizedPrivacyStatus =
        language === 'ar'
          ? result.decision.privacyStatusAr || result.decision.privacyStatus
          : result.decision.privacyStatus;
      const assistantMsg: UiMessage = {
        id: assistantMsgId,
        role: 'assistant',
        content: result.outputText || result.errorMessage || '',
        route: result.route,
        modelUsed: result.modelUsed,
        latencyMs: result.evaluation.actualLatencyMs,
        estimatedCostUsd: result.estimatedCostUsd,
        privacyStatus: localizedPrivacyStatus,
        status: result.status,
        errorMessage: result.errorMessage,
        executionResult: result,
        createdAtMs: Date.now(),
      };

      setConversations((prev) =>
        prev.map((c) =>
          c.id === convId
            ? {
                ...c,
                lastRoute: result.route,
                messages: [...c.messages, assistantMsg],
                updatedAtMs: Date.now(),
              }
            : c
        )
      );

      const telemetryItem: TelemetryRecord = {
        id: result.id,
        timestampIso: result.timestampIso,
        taskType: result.analysis.taskType,
        route: result.route,
        modelUsed: result.modelUsed,
        privacyMode,
        estimatedLatencyMs: result.decision.estimatedLatencyMs,
        actualLatencyMs: result.evaluation.actualLatencyMs,
        estimatedCostUsd: result.estimatedCostUsd,
        inputTokens: result.actualInputTokens,
        outputTokens: result.actualOutputTokens,
        status: result.status,
      };
      setTelemetry((prev) => [telemetryItem, ...prev]);

      // Persist to Firestore if authenticated & consented
      if (user) {
        void recordTelemetryEntry(user.uid, telemetryItem).catch((err) =>
          console.error('Telemetry Firestore write skipped:', err)
        );

        if (persistConversations && convId) {
          try {
            if (isNewConv) {
              await createConversationRecord({
                uid: user.uid,
                conversationId: convId,
                title: derivedTitle,
                language,
                lastRoute: result.route,
              });
            }
            await addMessageRecord({
              uid: user.uid,
              conversationId: convId,
              messageId: userMsgId,
              role: 'user',
              content: userMsg.content,
              route: 'LOCAL',
              modelUsed: 'user-input',
              latencyMs: 0,
              estimatedCostUsd: 0,
              privacyStatus: userMsg.privacyStatus,
            });
            await addMessageRecord({
              uid: user.uid,
              conversationId: convId,
              messageId: assistantMsgId,
              role: 'assistant',
              content: assistantMsg.content || '(blocked)',
              route: result.route,
              modelUsed: result.modelUsed,
              latencyMs: result.evaluation.actualLatencyMs,
              estimatedCostUsd: result.estimatedCostUsd,
              privacyStatus: localizedPrivacyStatus,
            });
            await updateConversationRecord({
              conversationId: convId,
              messageCount: priorMessageCount + 2,
              lastRoute: result.route,
              title: isNewConv ? derivedTitle : undefined,
            });
          } catch (err) {
            console.error('Conversation Firestore persistence failed:', err);
          }
        }
      }
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0B0F17] text-slate-100 flex flex-col">
      <TopNav
        activeScreen={activeScreen}
        onNavigate={setActiveScreen}
        user={user}
        authLoading={authLoading}
        onSignIn={handleSignIn}
        onSignOut={handleSignOut}
        t={t}
      />

      {authError && (
        <div className="bg-red-950/60 border-b border-red-900 px-4 py-2 text-xs text-red-200 flex items-center justify-between gap-4">
          <span>
            {t.common.signInErrorPrefix} {authError}
          </span>
          <button
            type="button"
            onClick={() => setAuthError(null)}
            className="text-red-300 hover:text-white underline"
          >
            {t.common.dismiss}
          </button>
        </div>
      )}

      <div className="flex-1">
        {activeScreen === 'onboarding' && (
          <OnboardingView
            language={language}
            privacyMode={privacyMode}
            onChangeLanguage={handleChangeLanguage}
            onChangePrivacyMode={handleChangePrivacyMode}
            onStartAssistant={() => handleCompleteOnboarding('assistant')}
            onOpenPrivacy={() => handleCompleteOnboarding('privacy')}
            t={t}
          />
        )}

        {activeScreen === 'assistant' && (
          <AssistantView
            conversations={conversations}
            activeConversationId={activeConversationId}
            onSelectConversation={setActiveConversationId}
            onNewConversation={handleNewConversation}
            onDeleteConversation={handleDeleteConversation}
            onSendMessage={handleSendMessage}
            onInspectExecution={setInspectedExecution}
            onSwitchPrivacyMode={handleChangePrivacyMode}
            onSignIn={handleSignIn}
            isExecuting={isExecuting}
            privacyMode={privacyMode}
            language={language}
            device={device}
            network={network}
            serverHealth={serverHealth}
            persistConversations={persistConversations}
            isSignedIn={Boolean(user)}
            t={t}
          />
        )}

        {activeScreen === 'privacy' && (
          <PrivacyCenterView
            privacyMode={privacyMode}
            customPreferences={customPreferences}
            language={language}
            engine={engine}
            onChangePrivacyMode={handleChangePrivacyMode}
            onChangeCustomPreferences={handleChangeCustomPrefs}
            t={t}
          />
        )}

        {activeScreen === 'intelligence' && (
          <IntelligenceDashboardView
            language={language}
            device={device}
            network={network}
            models={models}
            telemetry={telemetry}
            serverHealth={serverHealth}
            isSignedIn={Boolean(user)}
            onRefreshProbes={refreshEnvironment}
            onOpenAssistant={() => setActiveScreen('assistant')}
            t={t}
          />
        )}

        {activeScreen === 'settings' && (
          <SettingsView
            language={language}
            onChangeLanguage={handleChangeLanguage}
            persistConversations={persistConversations}
            onTogglePersistConversations={handleTogglePersistConversations}
            onClearSessionHistory={() => {
              setConversations([]);
              setActiveConversationId(null);
              setTelemetry([]);
            }}
            onClearCloudTelemetry={async () => {
              if (!user) return;
              await clearUserTelemetry(user.uid);
              setTelemetry([]);
            }}
            user={user}
            onSignIn={handleSignIn}
            onSignOut={handleSignOut}
            firestoreConnection={firestoreConnection}
            serverHealth={serverHealth}
            t={t}
          />
        )}
      </div>

      <ExecutionDetailsDrawer
        execution={inspectedExecution}
        language={language}
        onClose={() => setInspectedExecution(null)}
        t={t}
      />
    </div>
  );
}
