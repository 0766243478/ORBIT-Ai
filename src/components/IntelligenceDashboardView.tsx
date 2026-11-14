import { Check, Copy, Download, Play, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import type {
  DeviceCapabilityProfile,
  ExecutionRoute,
  LanguageCode,
  ModelDescriptor,
  NetworkStatusSnapshot,
  TelemetryRecord,
} from '../engine/types';
import type { Translations } from '../i18n/translations';
import {
  runBrowserBenchmarkSuite,
  type BrowserBenchmarkScope,
  type BrowserBenchmarkSuiteReport,
} from '../services/browserBenchmark';
import type { ServerHealthSnapshot } from '../services/browserProbes';
import { triggerLocalModelDownload } from '../services/localInference';

interface IntelligenceDashboardViewProps {
  language: LanguageCode;
  device: DeviceCapabilityProfile | null;
  network: NetworkStatusSnapshot | null;
  models: ModelDescriptor[];
  telemetry: TelemetryRecord[];
  serverHealth: ServerHealthSnapshot | null;
  isSignedIn: boolean;
  onRefreshProbes: () => Promise<void>;
  onOpenAssistant: () => void;
  t: Translations;
}

export function IntelligenceDashboardView({
  language,
  device,
  network,
  models,
  telemetry,
  serverHealth,
  isSignedIn,
  onRefreshProbes,
  onOpenAssistant,
  t,
}: IntelligenceDashboardViewProps) {
  const [routeFilter, setRouteFilter] = useState<'ALL' | ExecutionRoute>('ALL');
  const [refreshing, setRefreshing] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [downloadMsg, setDownloadMsg] = useState<string | null>(null);
  const [benchmarkScope, setBenchmarkScope] =
    useState<BrowserBenchmarkScope>('full_comparison');
  const [benchmarkRunning, setBenchmarkRunning] = useState(false);
  const [benchmarkProgress, setBenchmarkProgress] = useState<{
    completed: number;
    total: number;
    label: string;
  } | null>(null);
  const [benchmarkReport, setBenchmarkReport] =
    useState<BrowserBenchmarkSuiteReport | null>(null);
  const [copiedJson, setCopiedJson] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await onRefreshProbes();
    } finally {
      setRefreshing(false);
    }
  };

  const handleDownloadLocal = async () => {
    setDownloadProgress(0);
    setDownloadMsg(null);
    const res = await triggerLocalModelDownload((fraction) => {
      setDownloadProgress(Math.round(fraction * 100));
    });
    setDownloadProgress(null);
    setDownloadMsg(res.message);
    await onRefreshProbes();
  };

  const handleRunBenchmark = async () => {
    setBenchmarkRunning(true);
    setCopiedJson(false);
    try {
      const report = await runBrowserBenchmarkSuite({
        scope: benchmarkScope,
        language,
        onProgress: (completed, total, task) => {
          setBenchmarkProgress({
            completed,
            total,
            label: language === 'ar' ? task.labelAr : task.labelEn,
          });
        },
      });
      setBenchmarkReport(report);
    } finally {
      setBenchmarkRunning(false);
      setBenchmarkProgress(null);
    }
  };

  const handleCopyBenchmarkJson = async () => {
    if (!benchmarkReport || !navigator.clipboard) return;
    await navigator.clipboard.writeText(JSON.stringify(benchmarkReport, null, 2));
    setCopiedJson(true);
    setTimeout(() => setCopiedJson(false), 2000);
  };

  const filteredTelemetry =
    routeFilter === 'ALL'
      ? telemetry
      : telemetry.filter((item) => item.route === routeFilter);

  const totalRuns = telemetry.length;
  const completedRuns = telemetry.filter((tItem) => tItem.status === 'success');
  const avgLatency =
    completedRuns.length > 0
      ? Math.round(
          completedRuns.reduce((sum, item) => sum + item.actualLatencyMs, 0) /
            completedRuns.length
        )
      : 0;
  const totalCost = telemetry.reduce((sum, item) => sum + item.estimatedCostUsd, 0);
  const localHybridRuns = telemetry.filter(
    (item) => item.route === 'LOCAL' || item.route === 'HYBRID'
  ).length;
  const localSharePct =
    totalRuns > 0 ? Math.round((localHybridRuns / totalRuns) * 100) : 0;

  const cloudModelsAvailable = models.some(
    (m) => m.executionLocality === 'cloud' && m.available
  );
  const cloudAuthNeeded =
    serverHealth?.activeCloudBackend === 'server-gemini' &&
    serverHealth.authRequired &&
    !isSignedIn;

  return (
    <main className="max-w-[1280px] mx-auto px-4 sm:px-6 py-8 space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold text-slate-100">{t.intelligence.title}</h1>
          <p className="text-sm text-slate-400">{t.intelligence.subtitle}</p>
        </div>

        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium bg-[#111827] text-slate-200 border border-slate-700/80 rounded-md hover:border-slate-500 transition-colors whitespace-nowrap shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          <span>{t.intelligence.refreshProbes}</span>
        </button>
      </div>

      {/* Live Environment Probes (Strictly Real Measurements) */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Local Model Probe */}
        <div className="bg-[#111827] border border-slate-800/90 rounded-lg p-5 space-y-2">
          <div className="text-xs text-slate-400">{t.intelligence.localModelLabel}</div>
          <div
            className={`text-base font-semibold font-mono ${
              device?.localModelAvailability === 'available'
                ? 'text-emerald-400'
                : device?.localModelAvailability === 'downloadable'
                  ? 'text-amber-400'
                  : 'text-slate-200'
            }`}
          >
            {device ? t.availability[device.localModelAvailability] : t.common.probing}
          </div>
          <p className="text-xs text-slate-400 leading-relaxed">
            {device?.localModelReason || t.intelligence.inspectingPromptApi}
          </p>
          {device?.localModelAvailability === 'downloadable' && (
            <button
              type="button"
              onClick={handleDownloadLocal}
              disabled={downloadProgress !== null}
              className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-sky-400 text-slate-950 rounded hover:bg-sky-300"
            >
              <Download className="w-3.5 h-3.5" />
              <span>
                {downloadProgress !== null
                  ? `${t.intelligence.downloadingLabel} ${downloadProgress}%`
                  : t.intelligence.downloadLocalBtn}
              </span>
            </button>
          )}
          {downloadMsg && <p className="text-xs text-slate-300">{downloadMsg}</p>}
        </div>

        {/* Cloud Endpoint Probe */}
        <div className="bg-[#111827] border border-slate-800/90 rounded-lg p-5 space-y-2">
          <div className="text-xs text-slate-400">{t.intelligence.cloudApiLabel}</div>
          <div
            className={`text-base font-semibold font-mono ${
              cloudModelsAvailable ? 'text-sky-400' : 'text-amber-400'
            }`}
          >
            {cloudModelsAvailable ? t.common.available : t.common.unavailable}
          </div>
          <p className="text-xs text-slate-400 leading-relaxed">
            {cloudAuthNeeded
              ? t.intelligence.serverEndpointAuthNeeded
              : network?.cloudReachable
                ? `${t.intelligence.serverEndpointReady} (${network.cloudHealthLatencyMs ?? '—'} ms)`
                : t.intelligence.serverEndpointUnavailable}
          </p>
        </div>

        {/* Network Probe */}
        <div className="bg-[#111827] border border-slate-800/90 rounded-lg p-5 space-y-2">
          <div className="text-xs text-slate-400">{t.intelligence.networkLabel}</div>
          <div
            className={`text-base font-semibold font-mono ${
              network?.online ? 'text-emerald-400' : 'text-red-400'
            }`}
          >
            {network
              ? network.online
                ? t.common.online
                : t.common.offline
              : t.common.probing}
          </div>
          <p className="text-xs text-slate-400 font-mono tabular-nums">
            {network
              ? `${t.intelligence.netTypeLabel}: ${network.effectiveType} · ${t.intelligence.netRttLabel}: ${network.rttMs ?? t.common.notAvailableAbbr} ms`
              : t.intelligence.checkingConnection}
          </p>
        </div>

        {/* Hardware Probe */}
        <div className="bg-[#111827] border border-slate-800/90 rounded-lg p-5 space-y-2">
          <div className="text-xs text-slate-400">{t.intelligence.hardwareLabel}</div>
          <div className="text-base font-semibold text-slate-100 truncate">
            {device?.browserName || t.common.probing}
          </div>
          <p className="text-xs text-slate-400 font-mono tabular-nums">
            {t.intelligence.ramLabel}:{' '}
            {device?.deviceMemoryGb ? `${device.deviceMemoryGb} GB` : t.common.notAvailableAbbr}{' '}
            · {t.intelligence.coresLabel}: {device?.hardwareConcurrency ?? t.common.notAvailableAbbr}{' '}
            · {t.intelligence.webGpuLabel}:{' '}
            {device?.webGpuAvailable ? t.common.yes : t.common.no}
          </p>
        </div>
      </section>

      {/* Measured Session Telemetry Strip */}
      <section className="space-y-3">
        <h2 className="text-xs font-semibold text-slate-400">
          {t.intelligence.metricsTitle}
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 bg-[#111827] border border-slate-800/90 rounded-lg p-5">
          <div>
            <div className="text-xs text-slate-400">{t.intelligence.totalRuns}</div>
            <div className="mt-1 text-2xl font-semibold font-mono tabular-nums text-slate-100">
              {totalRuns}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-400">{t.intelligence.avgLatency}</div>
            <div className="mt-1 text-2xl font-semibold font-mono tabular-nums text-slate-100">
              {totalRuns > 0 ? `${avgLatency} ms` : '—'}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-400">{t.intelligence.totalCost}</div>
            <div className="mt-1 text-2xl font-semibold font-mono tabular-nums text-slate-100">
              ${totalCost.toFixed(5)}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-400">{t.intelligence.localShare}</div>
            <div className="mt-1 text-2xl font-semibold font-mono tabular-nums text-slate-100">
              {totalRuns > 0 ? `${localSharePct}%` : '—'}
            </div>
          </div>
        </div>
      </section>

      {/* Reproducible Browser Benchmark Runner */}
      <section className="bg-[#111827] border border-slate-800/90 rounded-lg p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1 max-w-2xl">
            <h2 className="text-base font-semibold text-slate-100">
              {t.intelligence.benchmarkTitle}
            </h2>
            <p className="text-xs text-slate-400 leading-relaxed">
              {t.intelligence.benchmarkSubtitle}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={benchmarkScope}
              onChange={(e) =>
                setBenchmarkScope(e.target.value as BrowserBenchmarkScope)
              }
              disabled={benchmarkRunning}
              className="px-3 py-2 text-xs bg-[#0B0F17] text-slate-200 border border-slate-700/80 rounded-md focus:outline-none focus:border-sky-400"
            >
              <option value="full_comparison">{t.intelligence.benchmarkScopeFull}</option>
              <option value="local_only">{t.intelligence.benchmarkScopeLocal}</option>
            </select>

            <button
              type="button"
              onClick={handleRunBenchmark}
              disabled={benchmarkRunning}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-sky-400 text-slate-950 rounded-md hover:bg-sky-300 disabled:opacity-60 transition-colors whitespace-nowrap"
            >
              <Play className="w-3.5 h-3.5" />
              <span>
                {benchmarkRunning
                  ? `${t.intelligence.benchmarkRunning} (${benchmarkProgress?.completed ?? 0}/${benchmarkProgress?.total ?? 0})`
                  : t.intelligence.benchmarkRunBtn}
              </span>
            </button>

            {benchmarkReport && (
              <button
                type="button"
                onClick={handleCopyBenchmarkJson}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-[#0B0F17] text-slate-200 border border-slate-700/80 rounded-md hover:border-slate-500 transition-colors whitespace-nowrap"
              >
                {copiedJson ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                <span>
                  {copiedJson
                    ? t.intelligence.benchmarkCopied
                    : t.intelligence.benchmarkCopyJson}
                </span>
              </button>
            )}
          </div>
        </div>

        <p className="text-[11px] text-slate-500">{t.intelligence.benchmarkDisclaimer}</p>

        {benchmarkProgress && (
          <div className="text-xs font-mono text-sky-300 bg-[#0B0F17] border border-slate-800 rounded px-3 py-2">
            [{benchmarkProgress.completed}/{benchmarkProgress.total}] {benchmarkProgress.label}
          </div>
        )}

        {benchmarkReport && (
          <div className="space-y-4 pt-1">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
              <div className="p-3 bg-[#0B0F17] border border-slate-800 rounded-md">
                <div className="text-slate-400">{t.intelligence.benchmarkSuccessRate}</div>
                <div className="mt-1 text-base font-semibold font-mono text-slate-100">
                  {benchmarkReport.summary.successCount}/{benchmarkReport.summary.totalRuns}
                </div>
              </div>
              <div className="p-3 bg-[#0B0F17] border border-slate-800 rounded-md">
                <div className="text-slate-400">{t.intelligence.avgLatency}</div>
                <div className="mt-1 text-base font-semibold font-mono text-slate-100">
                  {benchmarkReport.summary.meanLatencyMs} ms
                </div>
              </div>
              <div className="p-3 bg-[#0B0F17] border border-slate-800 rounded-md">
                <div className="text-slate-400">{t.intelligence.benchmarkColdStart}</div>
                <div className="mt-1 text-base font-semibold font-mono text-slate-100">
                  {benchmarkReport.summary.localColdStartMs !== null
                    ? `${benchmarkReport.summary.localColdStartMs} ms`
                    : t.common.notAvailableAbbr}
                </div>
              </div>
              <div className="p-3 bg-[#0B0F17] border border-slate-800 rounded-md">
                <div className="text-slate-400">{t.intelligence.benchmarkWarmMean}</div>
                <div className="mt-1 text-base font-semibold font-mono text-slate-100">
                  {benchmarkReport.summary.localWarmMeanMs !== null
                    ? `${benchmarkReport.summary.localWarmMeanMs} ms`
                    : t.common.notAvailableAbbr}
                </div>
              </div>
            </div>

            <div className="overflow-x-auto border border-slate-800 rounded-md">
              <table className="w-full text-xs">
                <thead className="bg-[#0B0F17] border-b border-slate-800 text-slate-400">
                  <tr>
                    <th className="text-start px-3 py-2 font-medium">{t.intelligence.colTask}</th>
                    <th className="text-start px-3 py-2 font-medium">{t.intelligence.colRoute}</th>
                    <th className="text-start px-3 py-2 font-medium">{t.intelligence.colModel}</th>
                    <th className="text-end px-3 py-2 font-medium">{t.intelligence.colLatency}</th>
                    <th className="text-end px-3 py-2 font-medium">{t.intelligence.benchmarkHeapDelta}</th>
                    <th className="text-end px-3 py-2 font-medium">{t.intelligence.colCost}</th>
                    <th className="text-start px-3 py-2 font-medium">{t.intelligence.colStatus}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {benchmarkReport.rows.map((row) => (
                    <tr key={row.taskId} className="text-slate-200">
                      <td className="px-3 py-2">{row.label}</td>
                      <td className="px-3 py-2 font-medium">{t.routes[row.actualRoute]}</td>
                      <td className="px-3 py-2 font-mono text-slate-300">{row.modelUsed}</td>
                      <td className="px-3 py-2 text-end font-mono tabular-nums">
                        {row.latencyMs} ms
                      </td>
                      <td className="px-3 py-2 text-end font-mono tabular-nums text-slate-400">
                        {row.heapDeltaKb !== null
                          ? `${row.heapDeltaKb >= 0 ? '+' : ''}${row.heapDeltaKb} KB`
                          : t.common.notAvailableAbbr}
                      </td>
                      <td className="px-3 py-2 text-end font-mono tabular-nums">
                        ${row.estimatedCostUsd.toFixed(5)}
                      </td>
                      <td className="px-3 py-2 font-mono">
                        <span
                          className={
                            row.status === 'success'
                              ? 'text-emerald-400'
                              : row.status === 'blocked'
                                ? 'text-amber-400'
                                : 'text-red-400'
                          }
                        >
                          {row.status}
                        </span>
                        {row.errorMessage ? ` — ${row.errorMessage}` : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* Execution History Table or Honest Empty State */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-slate-100">
            {t.intelligence.historyTitle}
          </h2>

          <div className="flex items-center gap-1 p-1 bg-[#111827] border border-slate-800 rounded-md overflow-x-auto">
            {(['ALL', 'LOCAL', 'HYBRID', 'CLOUD', 'BLOCKED'] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setRouteFilter(f)}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                  routeFilter === f
                    ? 'bg-[#1E293B] text-slate-100'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {f === 'ALL' ? t.intelligence.filterAll : t.routes[f]}
              </button>
            ))}
          </div>
        </div>

        {filteredTelemetry.length === 0 ? (
          <div className="bg-[#111827] border border-slate-800/90 rounded-lg p-10 text-center space-y-3">
            <h3 className="text-base font-semibold text-slate-100">
              {t.intelligence.emptyHistoryTitle}
            </h3>
            <p className="text-sm text-slate-400 max-w-lg mx-auto">
              {t.intelligence.emptyHistoryBody}
            </p>
            <button
              type="button"
              onClick={onOpenAssistant}
              className="mt-2 px-4 py-2 text-xs font-semibold bg-sky-400 text-slate-950 rounded-md hover:bg-sky-300 transition-colors"
            >
              {t.intelligence.goToAssistant}
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto bg-[#111827] border border-slate-800/90 rounded-lg">
            <table className="w-full text-xs">
              <thead className="border-b border-slate-800 text-slate-400">
                <tr>
                  <th className="text-start px-4 py-3 font-medium">{t.intelligence.colTime}</th>
                  <th className="text-start px-4 py-3 font-medium">{t.intelligence.colTask}</th>
                  <th className="text-start px-4 py-3 font-medium">{t.intelligence.colRoute}</th>
                  <th className="text-start px-4 py-3 font-medium">{t.intelligence.colModel}</th>
                  <th className="text-end px-4 py-3 font-medium">{t.intelligence.colLatency}</th>
                  <th className="text-end px-4 py-3 font-medium">{t.intelligence.colCost}</th>
                  <th className="text-start px-4 py-3 font-medium">{t.intelligence.colStatus}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {filteredTelemetry.map((row) => (
                  <tr key={row.id} className="hover:bg-[#151D2B]/60 text-slate-200">
                    <td className="px-4 py-2.5 font-mono tabular-nums text-slate-400 whitespace-nowrap">
                      {new Date(row.timestampIso).toLocaleTimeString(
                        language === 'ar' ? 'ar' : 'en-US'
                      )}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-slate-300">
                      {row.taskType}
                    </td>
                    <td className="px-4 py-2.5 font-medium">
                      {t.routes[row.route]}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-slate-300">
                      {row.modelUsed}
                    </td>
                    <td className="px-4 py-2.5 text-end font-mono tabular-nums">
                      {row.actualLatencyMs} ms
                    </td>
                    <td className="px-4 py-2.5 text-end font-mono tabular-nums">
                      ${row.estimatedCostUsd.toFixed(5)}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-slate-300">
                      {row.status}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
