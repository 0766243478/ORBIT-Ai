import type { User } from 'firebase/auth';
import type { LanguageCode } from '../engine/types';
import type { Translations } from '../i18n/translations';
import type { ServerHealthSnapshot } from '../services/browserProbes';
import {
  appCheckProviderType,
  appCheckReason,
  appCheckStatus,
  firebaseMetadata,
  type FirestoreConnectionState,
} from '../services/firebase';

interface SettingsViewProps {
  language: LanguageCode;
  onChangeLanguage: (lang: LanguageCode) => void;
  persistConversations: boolean;
  onTogglePersistConversations: (next: boolean) => void;
  onClearSessionHistory: () => void;
  onClearCloudTelemetry: () => Promise<void>;
  user: User | null;
  onSignIn: () => void;
  onSignOut: () => void;
  firestoreConnection: { state: FirestoreConnectionState; detail: string };
  serverHealth: ServerHealthSnapshot | null;
  t: Translations;
}

export function SettingsView({
  language,
  onChangeLanguage,
  persistConversations,
  onTogglePersistConversations,
  onClearSessionHistory,
  onClearCloudTelemetry,
  user,
  onSignIn,
  onSignOut,
  firestoreConnection,
  serverHealth,
  t,
}: SettingsViewProps) {
  return (
    <main className="max-w-[960px] mx-auto px-4 sm:px-6 py-8 space-y-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold text-slate-100">{t.settings.title}</h1>
        <p className="text-sm text-slate-400">{t.settings.subtitle}</p>
      </div>

      {/* Language & Direction */}
      <section className="bg-[#111827] border border-slate-800/90 rounded-lg p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-slate-100">
            {t.settings.languageTitle}
          </h2>
          <p className="text-xs text-slate-400">{t.settings.languageDesc}</p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-[#0B0F17] border border-slate-800 rounded-md shrink-0">
          <button
            type="button"
            onClick={() => onChangeLanguage('en')}
            className={`px-3.5 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap ${
              language === 'en'
                ? 'bg-[#1E293B] text-slate-100'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            English (LTR)
          </button>
          <button
            type="button"
            onClick={() => onChangeLanguage('ar')}
            className={`px-3.5 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap ${
              language === 'ar'
                ? 'bg-[#1E293B] text-slate-100'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            العربية (RTL)
          </button>
        </div>
      </section>

      {/* Conversation Storage Control */}
      <section className="bg-[#111827] border border-slate-800/90 rounded-lg p-6 space-y-4">
        <h2 className="text-base font-semibold text-slate-100">
          {t.settings.storageTitle}
        </h2>

        <label className="flex items-start justify-between gap-4 p-4 bg-[#0B0F17] border border-slate-800 rounded-md cursor-pointer">
          <div className="space-y-1">
            <div className="text-sm font-medium text-slate-200">
              {t.settings.persistLabel}
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              {t.settings.persistDesc}
            </p>
          </div>
          <input
            type="checkbox"
            checked={persistConversations}
            onChange={(e) => onTogglePersistConversations(e.target.checked)}
            className="mt-1 w-4 h-4 accent-sky-400 shrink-0"
          />
        </label>

        <div className="flex flex-wrap gap-3 pt-1">
          <button
            type="button"
            onClick={onClearSessionHistory}
            className="px-4 py-2 text-xs font-medium bg-[#0B0F17] text-slate-200 border border-slate-700/80 rounded-md hover:border-slate-500 transition-colors"
          >
            {t.settings.clearSessionBtn}
          </button>
          {user && (
            <button
              type="button"
              onClick={onClearCloudTelemetry}
              className="px-4 py-2 text-xs font-medium bg-[#0B0F17] text-red-300 border border-red-900/60 rounded-md hover:border-red-500/70 transition-colors"
            >
              {t.settings.clearCloudBtn}
            </button>
          )}
        </div>
      </section>

      {/* Account */}
      <section className="bg-[#111827] border border-slate-800/90 rounded-lg p-6 space-y-4">
        <h2 className="text-base font-semibold text-slate-100">
          {t.settings.accountTitle}
        </h2>

        {user ? (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1 text-sm">
              <div className="text-slate-100 font-medium">
                {user.displayName || t.auth.authenticatedUser}
              </div>
              <div className="text-xs text-slate-400 font-mono">
                {user.email} · {user.emailVerified ? t.auth.verified : t.auth.unverified} ·{' '}
                UID: {user.uid}
              </div>
            </div>
            <button
              type="button"
              onClick={onSignOut}
              className="px-4 py-2 text-xs font-medium bg-[#0B0F17] text-slate-200 border border-slate-700 rounded-md hover:border-slate-500"
            >
              {t.auth.signOut}
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <span className="text-sm text-slate-400">{t.auth.guestMode}</span>
            <button
              type="button"
              onClick={onSignIn}
              className="px-4 py-2 text-xs font-semibold bg-sky-400 text-slate-950 rounded-md hover:bg-sky-300"
            >
              {t.auth.signIn}
            </button>
          </div>
        )}
      </section>

      {/* Diagnostics & Mobile Readiness */}
      <section className="bg-[#111827] border border-slate-800/90 rounded-lg p-6 space-y-4">
        <h2 className="text-base font-semibold text-slate-100">
          {t.settings.diagnosticsTitle}
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
          <div className="p-3.5 bg-[#0B0F17] border border-slate-800 rounded-md space-y-1">
            <div className="text-slate-400">{t.settings.firebaseProjectLabel}</div>
            <div className="font-mono text-slate-100">{firebaseMetadata.projectId}</div>
          </div>
          <div className="p-3.5 bg-[#0B0F17] border border-slate-800 rounded-md space-y-1">
            <div className="text-slate-400">{t.settings.firestoreStatusLabel}</div>
            <div className="font-mono text-slate-100">{firestoreConnection.state}</div>
            <div className="text-[11px] text-slate-500">{firestoreConnection.detail}</div>
          </div>
          <div className="p-3.5 bg-[#0B0F17] border border-slate-800 rounded-md space-y-1">
            <div className="text-slate-400">{t.settings.appCheckLabel}</div>
            <div className="font-mono text-slate-100">
              {appCheckStatus} ({t.settings.appCheckProviderLabel}: {appCheckProviderType})
            </div>
            <div className="text-[11px] text-slate-500">{appCheckReason}</div>
          </div>
          <div className="p-3.5 bg-[#0B0F17] border border-slate-800 rounded-md space-y-1">
            <div className="text-slate-400">{t.settings.cloudBackendLabel}</div>
            <div className="font-mono text-slate-100">
              {serverHealth?.activeCloudBackend || 'checking'}
            </div>
            <div className="text-[11px] text-slate-500">
              {serverHealth?.activeCloudBackend === 'server-gemini'
                ? 'Express /api/ai/execute (Auth required)'
                : serverHealth?.activeCloudBackend === 'firebase-ai-logic'
                  ? 'Firebase AI Logic (GoogleAIBackend)'
                  : 'None active'}
            </div>
          </div>
        </div>

        <div className="pt-2 border-t border-slate-800/80 space-y-1">
          <h3 className="text-xs font-semibold text-slate-300">
            {t.settings.mobileReadinessTitle}
          </h3>
          <p className="text-xs text-slate-400 leading-relaxed">
            {t.settings.mobileReadinessBody}
          </p>
        </div>
      </section>
    </main>
  );
}
