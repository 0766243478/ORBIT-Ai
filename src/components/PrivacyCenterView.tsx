import { Play, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import type { OrbitEngine } from '../engine';
import type {
  CustomPrivacyPreferences,
  LanguageCode,
  PrivacyMode,
  RoutingDecision,
} from '../engine/types';
import type { Translations } from '../i18n/translations';

interface PrivacyCenterViewProps {
  privacyMode: PrivacyMode;
  customPreferences: CustomPrivacyPreferences;
  language: LanguageCode;
  engine: OrbitEngine | null;
  onChangePrivacyMode: (mode: PrivacyMode) => void;
  onChangeCustomPreferences: (prefs: CustomPrivacyPreferences) => void;
  t: Translations;
}

const MODES: PrivacyMode[] = ['STRICT_LOCAL', 'BALANCED', 'FLEXIBLE', 'CUSTOM'];

export function PrivacyCenterView({
  privacyMode,
  customPreferences,
  language,
  engine,
  onChangePrivacyMode,
  onChangeCustomPreferences,
  t,
}: PrivacyCenterViewProps) {
  const [simPrompt, setSimPrompt] = useState(
    'Draft a security review email for lead@company.com regarding key sk-demo9988776655443322.'
  );
  const [simDecision, setSimDecision] = useState<RoutingDecision | null>(null);
  const [simRunning, setSimRunning] = useState(false);

  const runSimulation = async () => {
    if (!engine || !simPrompt.trim()) return;
    setSimRunning(true);
    try {
      const { decision } = await engine.simulateDecision({
        input: { prompt: simPrompt, language },
        privacyMode,
        customPreferences,
      });
      setSimDecision(decision);
    } finally {
      setSimRunning(false);
    }
  };

  const togglePref = (key: keyof CustomPrivacyPreferences) => {
    if (typeof customPreferences[key] !== 'boolean') return;
    onChangeCustomPreferences({
      ...customPreferences,
      [key]: !customPreferences[key],
    });
  };

  return (
    <main className="max-w-[1160px] mx-auto px-4 sm:px-6 py-8 space-y-10">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold text-slate-100">{t.privacyCenter.title}</h1>
        <p className="text-sm text-slate-400 max-w-2xl">{t.privacyCenter.subtitle}</p>
      </div>

      {/* Mode Selector Grid */}
      <section className="space-y-4">
        <h2 className="text-xs font-semibold text-slate-400">
          {t.privacyCenter.modeHeading}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {MODES.map((mode) => {
            const active = privacyMode === mode;
            const info = t.privacyModes[mode];
            return (
              <button
                key={mode}
                type="button"
                onClick={() => onChangePrivacyMode(mode)}
                className={`text-start p-5 rounded-lg border transition-colors ${
                  active
                    ? 'bg-[#151D2B] border-sky-400/80 text-slate-100'
                    : 'bg-[#111827] border-slate-800/80 text-slate-300 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-base font-semibold">{info.title}</span>
                  <span
                    className={`text-xs font-mono ${
                      active ? 'text-sky-400' : 'text-slate-500'
                    }`}
                  >
                    {active ? t.common.active : t.common.select}
                  </span>
                </div>
                <p className="mt-1.5 text-sm text-slate-300">{info.subtitle}</p>
                <p className="mt-2 text-xs text-slate-400 leading-relaxed">{info.rule}</p>
              </button>
            );
          })}
        </div>
      </section>

      {/* Custom Policy Controls */}
      <section className="bg-[#111827] border border-slate-800/90 rounded-lg p-6 space-y-5">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-base font-semibold text-slate-100">
            {t.privacyCenter.customHeading}
          </h2>
          {privacyMode !== 'CUSTOM' && (
            <button
              type="button"
              onClick={() => onChangePrivacyMode('CUSTOM')}
              className="text-xs font-medium text-sky-400 hover:underline"
            >
              {t.privacyCenter.activateCustomMode}
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {(
            [
              ['allowCloudFallback', t.privacyCenter.allowCloudFallback],
              ['redactPiiBeforeCloud', t.privacyCenter.redactPiiBeforeCloud],
              ['preferLocalForSimpleTasks', t.privacyCenter.preferLocalForSimpleTasks],
              ['blockAttachmentsInCloud', t.privacyCenter.blockAttachmentsInCloud],
            ] as const
          ).map(([key, label]) => (
            <label
              key={key}
              className="flex items-center justify-between gap-3 p-3.5 bg-[#0B0F17] border border-slate-800 rounded-md cursor-pointer"
            >
              <span className="text-sm text-slate-200">{label}</span>
              <input
                type="checkbox"
                checked={Boolean(customPreferences[key])}
                onChange={() => {
                  if (privacyMode !== 'CUSTOM') onChangePrivacyMode('CUSTOM');
                  togglePref(key);
                }}
                className="w-4 h-4 accent-sky-400 rounded"
              />
            </label>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
          <label className="space-y-1.5 block">
            <span className="text-xs text-slate-400">
              {t.privacyCenter.maxCloudPayloadKb}
            </span>
            <input
              type="number"
              min={1}
              max={1024}
              value={customPreferences.maxCloudPayloadKb}
              onChange={(e) => {
                if (privacyMode !== 'CUSTOM') onChangePrivacyMode('CUSTOM');
                onChangeCustomPreferences({
                  ...customPreferences,
                  maxCloudPayloadKb: Math.max(1, Math.min(1024, Number(e.target.value) || 64)),
                });
              }}
              className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-[#0B0F17] border border-slate-800 rounded-md text-slate-100"
            />
          </label>

          <label className="space-y-1.5 block">
            <span className="text-xs text-slate-400">
              {t.privacyCenter.maxEstimatedCostUsd}
            </span>
            <input
              type="number"
              min={0}
              max={10}
              step={0.001}
              value={customPreferences.maxEstimatedCostUsd}
              onChange={(e) => {
                if (privacyMode !== 'CUSTOM') onChangePrivacyMode('CUSTOM');
                onChangeCustomPreferences({
                  ...customPreferences,
                  maxEstimatedCostUsd: Math.max(0, Math.min(10, Number(e.target.value) || 0)),
                });
              }}
              className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-[#0B0F17] border border-slate-800 rounded-md text-slate-100"
            />
          </label>
        </div>
      </section>

      {/* Live OAIE Route Simulator */}
      <section className="bg-[#111827] border border-slate-800/90 rounded-lg p-6 space-y-4">
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-sky-400" />
            <span>{t.privacyCenter.simulatorTitle}</span>
          </h2>
          <p className="text-xs text-slate-400">{t.privacyCenter.simulatorSubtitle}</p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            value={simPrompt}
            onChange={(e) => setSimPrompt(e.target.value)}
            placeholder={t.privacyCenter.simulatorPlaceholder}
            className="flex-1 px-3.5 py-2 text-sm bg-[#0B0F17] border border-slate-800 rounded-md text-slate-100"
          />
          <button
            type="button"
            onClick={runSimulation}
            disabled={simRunning || !engine}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold bg-sky-400 text-slate-950 rounded-md hover:bg-sky-300 transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            <Play className="w-3.5 h-3.5 rtl:rotate-180" />
            <span>{t.privacyCenter.simulatorRun}</span>
          </button>
        </div>

        {simDecision && (
          <div className="p-4 bg-[#0B0F17] border border-slate-800 rounded-md space-y-2 text-xs">
            <div className="flex flex-wrap items-center gap-2 text-slate-200">
              <span className="text-slate-400">{t.privacyCenter.simulatorResultRoute}:</span>
              <span className="font-semibold text-sky-400">
                {t.routes[simDecision.selectedRoute]}
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono">
                {language === 'ar'
                  ? simDecision.primaryModelDisplayAr || simDecision.primaryModelDisplay
                  : simDecision.primaryModelDisplay}
              </span>
              <span aria-hidden="true">·</span>
              <span>
                {language === 'ar'
                  ? simDecision.privacyStatusAr || simDecision.privacyStatus
                  : simDecision.privacyStatus}
              </span>
            </div>
            {simDecision.constraints.length > 0 && (
              <ul className="space-y-1 text-slate-400">
                {simDecision.constraints.map((c) => (
                  <li key={c.id}>
                    {language === 'ar' ? c.summaryAr : c.summaryEn}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
