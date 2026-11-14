import { AlertTriangle, CheckCircle2, Cpu, Cloud, ShieldAlert, X } from 'lucide-react';
import type { ExecutionResult, LanguageCode } from '../engine/types';
import type { Translations } from '../i18n/translations';

interface ExecutionDetailsDrawerProps {
  execution: ExecutionResult | null;
  language: LanguageCode;
  onClose: () => void;
  t: Translations;
}

export function ExecutionDetailsDrawer({
  execution,
  language,
  onClose,
  t,
}: ExecutionDetailsDrawerProps) {
  if (!execution) return null;

  const isAr = language === 'ar';
  const rationale = isAr
    ? execution.explanation.rationaleAr
    : execution.explanation.rationaleEn;
  const privacyGuarantee = isAr
    ? execution.explanation.privacyGuaranteeAr
    : execution.explanation.privacyGuaranteeEn;
  const limitations = isAr
    ? execution.explanation.limitationsAr
    : execution.explanation.limitationsEn;

  const routeColor =
    execution.route === 'LOCAL'
      ? 'text-emerald-400'
      : execution.route === 'HYBRID'
        ? 'text-amber-400'
        : execution.route === 'CLOUD'
          ? 'text-sky-400'
          : 'text-red-400';

  return (
    <aside
      aria-label={t.executionDetails.title}
      className="fixed inset-y-0 end-0 z-40 w-full max-w-xl bg-[#0E141F] border-s border-slate-800 shadow-2xl flex flex-col"
    >
      <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between gap-4">
        <h2 className="text-base font-semibold text-slate-100">
          {t.executionDetails.title}
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 text-slate-400 hover:text-slate-100 rounded-md border border-slate-800"
          aria-label={t.executionDetails.close}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-6">
        {/* Key Telemetry Summary Grid */}
        <div className="grid grid-cols-2 gap-4 bg-[#111827] border border-slate-800 rounded-lg p-4">
          <div>
            <div className="text-xs text-slate-400">{t.executionDetails.selectedRoute}</div>
            <div className={`mt-1 text-sm font-semibold ${routeColor}`}>
              {t.routes[execution.route]}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-400">{t.executionDetails.modelUsed}</div>
            <div className="mt-1 text-sm font-mono text-slate-100 truncate">
              {execution.modelUsed}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-400">{t.executionDetails.estimatedLatency}</div>
            <div className="mt-1 text-sm font-mono tabular-nums text-slate-200">
              {execution.decision.estimatedLatencyMs} ms
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-400">{t.executionDetails.actualLatency}</div>
            <div className="mt-1 text-sm font-mono tabular-nums text-slate-100">
              {execution.evaluation.actualLatencyMs} ms
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-400">{t.executionDetails.estimatedCost}</div>
            <div className="mt-1 text-sm font-mono tabular-nums text-slate-100">
              ${execution.estimatedCostUsd.toFixed(6)}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-400">{t.executionDetails.tokens}</div>
            <div className="mt-1 text-sm font-mono tabular-nums text-slate-200">
              {execution.actualInputTokens} / {execution.actualOutputTokens}
            </div>
          </div>
        </div>

        {/* Decision Rationale */}
        <section className="space-y-2">
          <h3 className="text-xs font-semibold text-slate-400">
            {t.executionDetails.rationale}
          </h3>
          <p className="text-sm text-slate-200 leading-relaxed">{rationale}</p>
        </section>

        {/* Privacy Status */}
        <section className="space-y-2 pt-4 border-t border-slate-800/80">
          <h3 className="text-xs font-semibold text-slate-400">
            {t.executionDetails.privacyStatus}
          </h3>
          <p className="text-sm text-slate-200">
            {isAr
              ? execution.decision.privacyStatusAr || execution.decision.privacyStatus
              : execution.decision.privacyStatus}{' '}
            · {privacyGuarantee}
          </p>
          {execution.plan.redactedCount > 0 && (
            <p className="text-xs font-mono text-amber-400">
              {t.executionDetails.redactedCountLabel}: {execution.plan.redactedCount}
            </p>
          )}
        </section>

        {/* Execution Plan Steps */}
        {execution.plan.steps.length > 0 && (
          <section className="space-y-3 pt-4 border-t border-slate-800/80">
            <h3 className="text-xs font-semibold text-slate-400">
              {t.executionDetails.stepsTitle}
            </h3>
            <div className="space-y-2">
              {execution.plan.steps.map((step) => {
                const trace = execution.stepTraces.find((tr) => tr.stepId === step.stepId);
                return (
                  <div
                    key={step.stepId}
                    className="p-3 bg-[#111827] border border-slate-800 rounded-md space-y-1"
                  >
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="inline-flex items-center gap-1.5 font-medium text-slate-100">
                        {step.locality === 'local' ? (
                          <Cpu className="w-3.5 h-3.5 text-emerald-400" />
                        ) : (
                          <Cloud className="w-3.5 h-3.5 text-sky-400" />
                        )}
                        {step.order}.{' '}
                        {step.locality === 'local'
                          ? t.executionDetails.localLocality
                          : t.executionDetails.cloudLocality}
                        {' · '}
                        <span className="font-mono text-slate-400">{step.modelId}</span>
                      </span>
                      {trace && (
                        <span className="font-mono tabular-nums text-slate-400">
                          {trace.durationMs} ms
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-300 leading-relaxed">
                      {isAr ? step.descriptionAr : step.descriptionEn}
                    </p>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Constraints */}
        {execution.decision.constraints.length > 0 && (
          <section className="space-y-2.5 pt-4 border-t border-slate-800/80">
            <h3 className="text-xs font-semibold text-slate-400">
              {t.executionDetails.constraintsTitle}
            </h3>
            <div className="space-y-2">
              {execution.decision.constraints.map((c) => (
                <div
                  key={c.id}
                  className="flex items-start gap-2.5 text-xs text-slate-300"
                >
                  {c.passed ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  ) : (
                    <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  )}
                  <span>{isAr ? c.summaryAr : c.summaryEn}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Scoring Matrix */}
        {execution.decision.routeScores.length > 0 && (
          <section className="space-y-2.5 pt-4 border-t border-slate-800/80">
            <h3 className="text-xs font-semibold text-slate-400">
              {t.executionDetails.scoringTitle}
            </h3>
            <div className="overflow-x-auto border border-slate-800 rounded-md">
              <table className="w-full text-xs">
                <thead className="bg-[#111827] text-slate-400">
                  <tr>
                    <th className="text-start px-3 py-2 font-medium">{t.executionDetails.colRoute}</th>
                    <th className="text-end px-3 py-2 font-medium">{t.executionDetails.colScore}</th>
                    <th className="text-end px-3 py-2 font-medium">{t.executionDetails.colEstMs}</th>
                    <th className="text-start px-3 py-2 font-medium">{t.executionDetails.colStatus}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80">
                  {execution.decision.routeScores.map((r) => (
                    <tr key={r.route} className="text-slate-200">
                      <td className="px-3 py-2 font-medium">{t.routes[r.route]}</td>
                      <td className="px-3 py-2 text-end font-mono tabular-nums">
                        {r.eligible ? r.totalScore : '—'}
                      </td>
                      <td className="px-3 py-2 text-end font-mono tabular-nums">
                        {r.eligible ? r.estimatedLatencyMs : '—'}
                      </td>
                      <td className="px-3 py-2 text-slate-400">
                        {r.eligible
                          ? r.route === execution.route
                            ? t.common.selected
                            : t.common.eligible
                          : (isAr
                              ? r.disqualificationReasonAr || r.disqualificationReason
                              : r.disqualificationReason) || t.common.excluded}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Limitations */}
        {limitations.length > 0 && (
          <section className="space-y-2 pt-4 border-t border-slate-800/80">
            <h3 className="text-xs font-semibold text-slate-400">
              {t.executionDetails.limitationsTitle}
            </h3>
            <ul className="space-y-1.5">
              {limitations.map((lim, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2 text-xs text-slate-400 leading-relaxed"
                >
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                  <span>{lim}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </aside>
  );
}
