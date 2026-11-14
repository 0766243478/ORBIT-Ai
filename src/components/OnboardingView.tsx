import { ArrowRight, Cpu, Globe, Lock, ShieldCheck } from 'lucide-react';
import type { LanguageCode, PrivacyMode } from '../engine/types';
import type { Translations } from '../i18n/translations';

interface OnboardingViewProps {
  language: LanguageCode;
  privacyMode: PrivacyMode;
  onChangeLanguage: (lang: LanguageCode) => void;
  onChangePrivacyMode: (mode: PrivacyMode) => void;
  onStartAssistant: () => void;
  onOpenPrivacy: () => void;
  t: Translations;
}

export function OnboardingView({
  language,
  privacyMode,
  onChangeLanguage,
  onChangePrivacyMode,
  onStartAssistant,
  onOpenPrivacy,
  t,
}: OnboardingViewProps) {
  const selectableModes: PrivacyMode[] = ['BALANCED', 'STRICT_LOCAL', 'FLEXIBLE'];

  return (
    <main className="max-w-[1160px] mx-auto px-4 sm:px-6 py-10 sm:py-16 space-y-12">
      {/* Hero Section */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        <div className="lg:col-span-7 space-y-5">
          <p className="text-xs font-medium tracking-wide text-sky-400">
            {t.onboarding.kicker}
          </p>
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-semibold tracking-tight text-slate-50 leading-tight">
            {t.onboarding.headline}
          </h1>
          <p className="text-base text-slate-300 leading-relaxed max-w-2xl">
            {t.onboarding.subheadline}
          </p>

          <div className="pt-2 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={onStartAssistant}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold bg-sky-400 text-slate-950 rounded-md hover:bg-sky-300 transition-colors whitespace-nowrap shrink-0"
            >
              <span>{t.onboarding.ctaStart}</span>
              <ArrowRight className="w-4 h-4 rtl:rotate-180" />
            </button>
            <button
              type="button"
              onClick={onOpenPrivacy}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium bg-[#111827] text-slate-200 border border-slate-700/80 rounded-md hover:border-slate-500 transition-colors whitespace-nowrap shrink-0"
            >
              <ShieldCheck className="w-4 h-4 text-slate-400" />
              <span>{t.onboarding.ctaLearnPrivacy}</span>
            </button>
          </div>
        </div>

        {/* Initial Setup Panel */}
        <div className="lg:col-span-5 bg-[#111827] border border-slate-800/90 rounded-lg p-6 space-y-6">
          <div className="space-y-2.5">
            <label className="block text-xs font-medium text-slate-400">
              {t.onboarding.chooseLanguage}
            </label>
            <div className="grid grid-cols-2 gap-2 p-1 bg-[#0B0F17] border border-slate-800 rounded-md">
              <button
                type="button"
                onClick={() => onChangeLanguage('en')}
                className={`px-3 py-2 text-xs font-medium rounded transition-colors whitespace-nowrap ${
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
                className={`px-3 py-2 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                  language === 'ar'
                    ? 'bg-[#1E293B] text-slate-100'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                العربية (RTL)
              </button>
            </div>
          </div>

          <div className="space-y-2.5">
            <label className="block text-xs font-medium text-slate-400">
              {t.onboarding.choosePrivacy}
            </label>
            <div className="space-y-2">
              {selectableModes.map((mode) => {
                const selected = privacyMode === mode;
                const copy = t.privacyModes[mode];
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => onChangePrivacyMode(mode)}
                    className={`w-full text-start p-3 rounded-md border transition-colors ${
                      selected
                        ? 'bg-[#151D2B] border-sky-500/70 text-slate-100'
                        : 'bg-[#0B0F17]/60 border-slate-800 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{copy.title}</span>
                      <span className="text-xs font-mono text-slate-400">
                        {selected ? t.common.active : t.common.select}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-400 leading-relaxed">
                      {copy.subtitle}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* Principles Grid */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4 border-t border-slate-800/80">
        {t.onboarding.principles.map((p, idx) => {
          const Icon = idx === 0 ? Cpu : idx === 1 ? Globe : Lock;
          return (
            <div
              key={p.title}
              className="bg-[#111827] border border-slate-800/80 rounded-lg p-6 space-y-3"
            >
              <Icon className="w-5 h-5 text-sky-400" />
              <h2 className="text-base font-semibold text-slate-100">{p.title}</h2>
              <p className="text-sm text-slate-400 leading-relaxed">{p.body}</p>
            </div>
          );
        })}
      </section>
    </main>
  );
}
