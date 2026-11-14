import {
  AlertCircle,
  Cloud,
  Cpu,
  FileText,
  Layers,
  Paperclip,
  Plus,
  Send,
  ShieldBan,
  Trash2,
  X,
} from 'lucide-react';
import { useRef, useState } from 'react';
import type {
  AttachmentPayload,
  DeviceCapabilityProfile,
  ExecutionResult,
  ExecutionRoute,
  LanguageCode,
  NetworkStatusSnapshot,
  PrivacyMode,
} from '../engine/types';
import type { Translations } from '../i18n/translations';
import type { ServerHealthSnapshot } from '../services/browserProbes';

export interface UiMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  route: ExecutionRoute;
  modelUsed: string;
  latencyMs: number;
  estimatedCostUsd: number;
  privacyStatus: string;
  status: 'success' | 'blocked' | 'error';
  errorMessage?: string;
  executionResult?: ExecutionResult;
  attachments?: AttachmentPayload[];
  createdAtMs: number;
}

export interface UiConversation {
  id: string;
  title: string;
  messages: UiMessage[];
  updatedAtMs: number;
  lastRoute: ExecutionRoute;
}

interface AssistantViewProps {
  conversations: UiConversation[];
  activeConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onNewConversation: () => void;
  onDeleteConversation: (id: string) => void;
  onSendMessage: (prompt: string, attachments: AttachmentPayload[]) => Promise<void>;
  onInspectExecution: (result: ExecutionResult) => void;
  onSwitchPrivacyMode: (mode: PrivacyMode) => void;
  onSignIn: () => void;
  isExecuting: boolean;
  privacyMode: PrivacyMode;
  language: LanguageCode;
  device: DeviceCapabilityProfile | null;
  network: NetworkStatusSnapshot | null;
  serverHealth: ServerHealthSnapshot | null;
  persistConversations: boolean;
  isSignedIn: boolean;
  t: Translations;
}

const ALLOWED_EXTENSIONS = [
  '.txt',
  '.md',
  '.json',
  '.csv',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.py',
  '.sql',
  '.log',
];
const MAX_FILE_BYTES = 128 * 1024;

function RouteIcon({ route }: { route: ExecutionRoute }) {
  switch (route) {
    case 'LOCAL':
      return <Cpu className="w-3.5 h-3.5 text-emerald-400 shrink-0" />;
    case 'HYBRID':
      return <Layers className="w-3.5 h-3.5 text-amber-400 shrink-0" />;
    case 'CLOUD':
      return <Cloud className="w-3.5 h-3.5 text-sky-400 shrink-0" />;
    case 'BLOCKED':
      return <ShieldBan className="w-3.5 h-3.5 text-red-400 shrink-0" />;
  }
}

export function AssistantView({
  conversations,
  activeConversationId,
  onSelectConversation,
  onNewConversation,
  onDeleteConversation,
  onSendMessage,
  onInspectExecution,
  onSwitchPrivacyMode,
  onSignIn,
  isExecuting,
  privacyMode,
  language,
  device,
  network,
  serverHealth,
  persistConversations,
  isSignedIn,
  t,
}: AssistantViewProps) {
  const [promptInput, setPromptInput] = useState('');
  const [attachments, setAttachments] = useState<AttachmentPayload[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const activeConversation =
    conversations.find((c) => c.id === activeConversationId) || null;
  const messages = activeConversation?.messages || [];

  const cloudAuthBlocked =
    serverHealth?.activeCloudBackend === 'server-gemini' &&
    serverHealth.authRequired &&
    !isSignedIn;

  const cloudStatusLabel = cloudAuthBlocked
    ? t.assistant.cloudSignInRequired
    : network?.cloudReachable
      ? t.assistant.cloudReady
      : t.assistant.cloudOffline;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setAttachmentError(null);
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    const loaded: AttachmentPayload[] = [];
    for (const file of files) {
      const lower = file.name.toLowerCase();
      const validExt = ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext));
      if (!validExt) {
        setAttachmentError(
          `Unsupported file "${file.name}". ${t.assistant.attachmentHint}`
        );
        continue;
      }
      if (file.size > MAX_FILE_BYTES) {
        setAttachmentError(
          `File "${file.name}" exceeds 128 KB limit (${Math.round(file.size / 1024)} KB).`
        );
        continue;
      }
      const textContent = await file.text();
      loaded.push({
        id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: file.name,
        mimeType: file.type || 'text/plain',
        sizeBytes: file.size,
        textContent,
      });
    }

    if (loaded.length > 0) {
      setAttachments((prev) => [...prev, ...loaded].slice(0, 3));
    }
    e.target.value = '';
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if ((!promptInput.trim() && attachments.length === 0) || isExecuting) return;
    const textToSend = promptInput;
    const attsToSend = attachments;
    setPromptInput('');
    setAttachments([]);
    setAttachmentError(null);
    await onSendMessage(textToSend, attsToSend);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit();
    }
  };

  return (
    <div className="max-w-[1440px] mx-auto flex h-[calc(100vh-3.5rem)] overflow-hidden">
      {/* Sidebar: Conversations + Environment Readiness */}
      <aside
        className={`${
          mobileSidebarOpen ? 'fixed inset-y-14 start-0 z-30 flex' : 'hidden'
        } lg:static lg:flex w-72 shrink-0 bg-[#0E141F] border-e border-slate-800/80 flex-col`}
      >
        <div className="p-4 border-b border-slate-800/80 flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-slate-300">
            {t.assistant.historyTitle}
          </span>
          <button
            type="button"
            onClick={() => {
              onNewConversation();
              setMobileSidebarOpen(false);
            }}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-[#151D2B] text-slate-100 border border-slate-700/80 rounded-md hover:border-sky-500/60 transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{t.assistant.newChat}</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {conversations.length === 0 ? (
            <p className="px-3 py-6 text-xs text-slate-500 text-center">
              {t.assistant.noHistory}
            </p>
          ) : (
            conversations.map((conv) => {
              const isSelected = conv.id === activeConversation?.id;
              return (
                <div
                  key={conv.id}
                  className={`group flex items-center justify-between gap-2 px-3 py-2.5 rounded-md transition-colors ${
                    isSelected
                      ? 'bg-[#151D2B] text-slate-100 border border-slate-700/80'
                      : 'text-slate-400 hover:bg-[#151D2B]/50 hover:text-slate-200 border border-transparent'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      onSelectConversation(conv.id);
                      setMobileSidebarOpen(false);
                    }}
                    className="flex-1 text-start min-w-0"
                  >
                    <div className="text-xs font-medium truncate">{conv.title}</div>
                    <div className="mt-0.5 text-[11px] text-slate-500 font-mono tabular-nums">
                      {t.routes[conv.lastRoute]} · {conv.messages.length} {t.assistant.msgsSuffix}
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteConversation(conv.id)}
                    className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1 text-slate-500 hover:text-red-400 transition-opacity"
                    aria-label={t.assistant.deleteChat}
                    title={t.assistant.deleteChat}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })
          )}
        </div>

        {/* Quiet, Honest Environment Summary Footer */}
        <div className="p-4 border-t border-slate-800/80 space-y-2 text-xs text-slate-400">
          <div className="flex items-center justify-between gap-2">
            <span>{t.assistant.privacyModeLabel}</span>
            <span className="font-medium text-slate-200">
              {t.privacyModes[privacyMode].title}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span>{t.assistant.onDeviceModelLabel}</span>
            <span className="font-mono text-slate-300">
              {device ? t.availability[device.localModelAvailability] : t.common.checking}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span>{t.assistant.networkLabel}</span>
            <span className="font-mono text-slate-300">
              {network
                ? network.online
                  ? t.common.online
                  : t.common.offline
                : t.common.checking}
            </span>
          </div>
          <div className="pt-1 text-[11px] text-slate-500">
            {isSignedIn && persistConversations
              ? t.assistant.persistenceOn
              : t.assistant.persistenceOff}
          </div>
        </div>
      </aside>

      {/* Main Chat Canvas */}
      <section className="flex-1 flex flex-col min-w-0 bg-[#0B0F17]">
        {/* Workspace Sub-Toolbar */}
        <div className="px-4 sm:px-6 py-2.5 border-b border-slate-800/80 flex items-center justify-between gap-4 bg-[#0B0F17]">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileSidebarOpen((v) => !v)}
              className="lg:hidden px-2.5 py-1 text-xs font-medium text-slate-300 bg-[#111827] border border-slate-800 rounded-md whitespace-nowrap"
            >
              {t.assistant.historyTitle}
            </button>
            <div className="text-xs text-slate-400 truncate">
              <span>{t.privacyModes[privacyMode].title}</span>
              <span aria-hidden="true"> · </span>
              <span className="font-mono">
                {device?.localModelAvailability === 'available'
                  ? t.assistant.localReady
                  : t.assistant.localUnavailable}
              </span>
              <span aria-hidden="true"> · </span>
              <span>{cloudStatusLabel}</span>
            </div>
          </div>

          <span className="text-[11px] text-slate-500 hidden sm:inline whitespace-nowrap">
            {privacyMode === 'STRICT_LOCAL'
              ? t.assistant.localOnlyBadge
              : t.assistant.cloudNotice}
          </span>
        </div>

        {/* Auth Notice when Express Backend is Active and User is Signed Out */}
        {cloudAuthBlocked && (
          <div className="px-4 sm:px-6 py-2.5 border-b border-slate-800/80 bg-[#0E141F] flex flex-wrap items-center justify-between gap-3 text-xs">
            <span className="text-slate-300">{t.assistant.cloudSignInBanner}</span>
            <button
              type="button"
              onClick={onSignIn}
              className="px-3 py-1 font-semibold bg-sky-400 text-slate-950 rounded hover:bg-sky-300 transition-colors whitespace-nowrap shrink-0"
            >
              {t.auth.signIn}
            </button>
          </div>
        )}

        {/* Message Stream */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6">
          {messages.length === 0 ? (
            <div className="max-w-2xl mx-auto py-12 space-y-6">
              <div className="space-y-2">
                <h1 className="text-xl sm:text-2xl font-semibold text-slate-100">
                  {t.assistant.emptyTitle}
                </h1>
                <p className="text-sm text-slate-400 leading-relaxed">
                  {t.assistant.emptySubtitle}
                </p>
              </div>

              <div className="space-y-2.5">
                {t.assistant.starterPrompts.map((starter) => (
                  <button
                    key={starter}
                    type="button"
                    onClick={() => setPromptInput(starter)}
                    className="w-full text-start p-3.5 text-sm text-slate-200 bg-[#111827] border border-slate-800/90 rounded-lg hover:border-sky-500/60 transition-colors"
                  >
                    {starter}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto space-y-6">
              {messages.map((msg) => (
                <article
                  key={msg.id}
                  className={`flex flex-col ${
                    msg.role === 'user' ? 'items-end' : 'items-start'
                  }`}
                >
                  {msg.role === 'user' ? (
                    <div className="max-w-[85%] bg-[#151D2B] border border-slate-700/70 rounded-lg px-4 py-3 text-sm text-slate-100 whitespace-pre-wrap leading-relaxed">
                      {msg.content}
                      {msg.attachments && msg.attachments.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-slate-700/60 flex flex-wrap gap-3 text-xs text-slate-400">
                          {msg.attachments.map((att) => (
                            <span key={att.id} className="inline-flex items-center gap-1 font-mono">
                              <FileText className="w-3.5 h-3.5 text-sky-400" />
                              {att.name} ({Math.max(1, Math.round(att.sizeBytes / 1024))} KB)
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="w-full bg-[#111827] border border-slate-800/90 rounded-lg p-4 space-y-3">
                      {msg.status === 'blocked' ? (
                        <div className="space-y-2.5">
                          <div className="flex items-center gap-2 text-sm font-medium text-red-400">
                            <ShieldBan className="w-4 h-4 shrink-0" />
                            <span>{t.assistant.blockedTitle}</span>
                          </div>
                          <p className="text-sm text-slate-300 leading-relaxed">
                            {msg.errorMessage || msg.content}
                          </p>
                          {privacyMode === 'STRICT_LOCAL' && (
                            <button
                              type="button"
                              onClick={() => onSwitchPrivacyMode('BALANCED')}
                              className="px-3 py-1.5 text-xs font-medium bg-[#151D2B] text-sky-400 border border-slate-700 rounded-md hover:border-sky-500/60 transition-colors"
                            >
                              {t.assistant.switchBalanced}
                            </button>
                          )}
                        </div>
                      ) : msg.status === 'error' ? (
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-2 text-sm font-medium text-red-400">
                            <AlertCircle className="w-4 h-4 shrink-0" />
                            <span>{t.assistant.executionErrorTitle}</span>
                          </div>
                          <p className="text-sm text-slate-300 font-mono break-words">
                            {msg.errorMessage || msg.content}
                          </p>
                        </div>
                      ) : (
                        <div className="text-sm text-slate-100 whitespace-pre-wrap leading-relaxed">
                          {msg.content}
                        </div>
                      )}

                      {/* Unboxed Metadata Bar (Zero-Pill Rule) */}
                      <div className="pt-2.5 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="inline-flex items-center gap-1.5 font-medium text-slate-200">
                            <RouteIcon route={msg.route} />
                            {t.routes[msg.route]}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono">{msg.modelUsed}</span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums">{msg.latencyMs} ms</span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums">
                            ${msg.estimatedCostUsd.toFixed(5)}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>{msg.privacyStatus}</span>
                        </div>

                        {msg.executionResult && (
                          <button
                            type="button"
                            onClick={() => onInspectExecution(msg.executionResult!)}
                            className="text-xs font-medium text-sky-400 hover:text-sky-300 hover:underline whitespace-nowrap shrink-0"
                          >
                            {t.assistant.inspectExecution}
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </article>
              ))}

              {isExecuting && (
                <div className="w-full bg-[#111827] border border-slate-800/90 rounded-lg p-4 text-xs text-slate-400 font-mono">
                  {t.assistant.sending}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Composer */}
        <form
          onSubmit={handleSubmit}
          className="border-t border-slate-800/80 bg-[#0E141F] px-4 sm:px-6 py-3"
        >
          <div className="max-w-3xl mx-auto space-y-2">
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-3 text-xs text-slate-300">
                {attachments.map((att) => (
                  <span
                    key={att.id}
                    className="inline-flex items-center gap-1.5 bg-[#151D2B] border border-slate-700 rounded px-2 py-1 font-mono"
                  >
                    <FileText className="w-3.5 h-3.5 text-sky-400" />
                    <span>{att.name}</span>
                    <button
                      type="button"
                      onClick={() =>
                        setAttachments((prev) => prev.filter((a) => a.id !== att.id))
                      }
                      className="text-slate-400 hover:text-slate-100"
                      aria-label={`Remove ${att.name}`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {attachmentError && (
              <p className="text-xs text-amber-400">{attachmentError}</p>
            )}

            <div className="flex items-end gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept={ALLOWED_EXTENSIONS.join(',')}
                multiple
                onChange={handleFileChange}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isExecuting}
                title={t.assistant.attachFile}
                aria-label={t.assistant.attachFile}
                className="p-2.5 text-slate-400 hover:text-slate-100 bg-[#111827] border border-slate-800 rounded-md transition-colors disabled:opacity-50 shrink-0"
              >
                <Paperclip className="w-4 h-4" />
              </button>

              <textarea
                rows={2}
                value={promptInput}
                onChange={(e) => setPromptInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t.assistant.placeholder}
                disabled={isExecuting}
                className="flex-1 resize-none bg-[#111827] border border-slate-800 focus:border-sky-500/80 focus:outline-none rounded-md px-3.5 py-2 text-sm text-slate-100 placeholder:text-slate-500"
              />

              <button
                type="submit"
                disabled={isExecuting || (!promptInput.trim() && attachments.length === 0)}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold bg-sky-400 text-slate-950 rounded-md hover:bg-sky-300 transition-colors disabled:opacity-40 whitespace-nowrap shrink-0"
              >
                <Send className="w-3.5 h-3.5 rtl:rotate-180" />
                <span>{isExecuting ? t.assistant.sending : t.assistant.send}</span>
              </button>
            </div>
            <p className="text-[11px] text-slate-500">
              {t.assistant.attachmentHint} · {language === 'ar' ? 'العربية' : 'EN'}
            </p>
          </div>
        </form>
      </section>
    </div>
  );
}
