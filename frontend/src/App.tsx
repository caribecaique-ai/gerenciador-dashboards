import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import axios from 'axios';
import {
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  Link2,
  Loader2,
  Plus,
  RefreshCcw,
  Search,
  Trash2,
  UserRound,
  X,
} from 'lucide-react';
import { ClientRowSkeleton } from './components/Skeleton';
import NativeDashboardApp from './native-dashboard/App';

function isLocalHostname(value: string): boolean {
  const normalized = String(value || '').toLowerCase();
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1' || normalized === '[::1]';
}

function resolveHostAwareApiUrl(
  envValue: string | undefined,
  fallbackPort: string,
  fallbackPath: string
): string {
  if (typeof window === 'undefined') {
    return (envValue || `http://localhost:${fallbackPort}${fallbackPath}`).trim();
  }

  const browserHost = window.location.hostname;
  const browserIsLocal = isLocalHostname(browserHost);
  const defaultUrl = `http://${browserHost}:${fallbackPort}${fallbackPath}`;
  const raw = String(envValue || '').trim();
  if (!raw) return defaultUrl;

  try {
    const parsed = new URL(raw);
    const envIsLocal = isLocalHostname(parsed.hostname);
    if (!browserIsLocal && envIsLocal) {
      parsed.protocol = 'http:';
      parsed.hostname = browserHost;
      parsed.port = parsed.port || fallbackPort;
      if (!parsed.pathname || parsed.pathname === '/') parsed.pathname = fallbackPath;
      return parsed.toString().replace(/\/+$/, '');
    }
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return raw;
  }
}

function resolveManagerApiUrl(): string {
  return resolveHostAwareApiUrl(import.meta.env.VITE_API_URL, '3005', '/api');
}

type PrimaryDashboardMode = 'internal' | 'external' | 'embedded';

const EMBEDDED_DASHBOARD_PATH = '/ext-dashboard';

function resolvePrimaryDashboardMode(rawValue: string | undefined): PrimaryDashboardMode {
  const normalized = String(rawValue || 'internal').trim().toLowerCase();
  if (normalized === 'external') return 'external';
  if (normalized === 'embedded') return 'embedded';
  return 'internal';
}

function resolvePrimaryDashboardApiUrl(mode: PrimaryDashboardMode): string {
  if (mode === 'internal') {
    return API_URL;
  }
  return resolveHostAwareApiUrl(import.meta.env.VITE_PRIMARY_DASHBOARD_API_URL, '3001', '/api');
}

const API_URL = resolveManagerApiUrl();
const PAGE_SIZE = 6;
const PRIMARY_DASHBOARD_MODE = resolvePrimaryDashboardMode(import.meta.env.VITE_PRIMARY_DASHBOARD_MODE);
const USE_INTERNAL_DASHBOARD = PRIMARY_DASHBOARD_MODE === 'internal';
const USE_EXTERNAL_DASHBOARD = PRIMARY_DASHBOARD_MODE === 'external';
const USE_EMBEDDED_DASHBOARD = PRIMARY_DASHBOARD_MODE === 'embedded';
const PRIMARY_DASHBOARD_API_URL = resolvePrimaryDashboardApiUrl(PRIMARY_DASHBOARD_MODE);

function resolvePollInterval(rawValue: string | undefined, fallbackMs: number): number {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed < 2000) {
    return fallbackMs;
  }
  return Math.floor(parsed);
}

const MANAGER_POLL_MS = resolvePollInterval(import.meta.env.VITE_MANAGER_POLL_MS, 5000);
const VIEWER_POLL_MS = resolvePollInterval(import.meta.env.VITE_VIEWER_POLL_MS, 10000);

function resolveManagerBaseUrl(): string {
  if (typeof window === 'undefined') {
    return 'http://localhost:3010/';
  }

  const current = new URL(window.location.href);
  current.pathname = '/';
  current.search = '';
  current.hash = '';
  return current.toString();
}

function resolvePrimaryDashboardBaseUrl(mode: PrimaryDashboardMode): string {
  if (mode === 'internal') {
    return resolveManagerBaseUrl();
  }

  if (typeof window === 'undefined') {
    return (import.meta.env.VITE_PRIMARY_DASHBOARD_URL || 'http://localhost:5173/').trim();
  }

  const envValue = String(import.meta.env.VITE_PRIMARY_DASHBOARD_URL || '').trim();
  const browserHost = window.location.hostname;
  const browserIsLocal = isLocalHostname(browserHost);
  const preferredPort = String(import.meta.env.VITE_PRIMARY_DASHBOARD_PORT || '5173').trim() || '5173';

  if (envValue) {
    try {
      const parsed = new URL(envValue);
      if (!browserIsLocal && isLocalHostname(parsed.hostname)) {
        parsed.protocol = 'http:';
        parsed.hostname = browserHost;
        parsed.port = preferredPort;
      }
      return parsed.toString();
    } catch {
      return envValue;
    }
  }

  const current = new URL(window.location.href);
  current.protocol = 'http:';
  current.port = preferredPort;
  current.pathname = '/';
  current.search = '';
  current.hash = '';
  return current.toString();
}

const PRIMARY_DASHBOARD_URL = resolvePrimaryDashboardBaseUrl(PRIMARY_DASHBOARD_MODE);

interface ClientSettings {
  alertEnabled: boolean;
  alertChannel: 'email' | 'whatsapp' | 'webhook' | null;
  alertTarget: string | null;
  webhookUrl: string | null;
  autoRecover: boolean;
  lastAlertAt: string | null;
}

interface ClientHealthSnapshot {
  lastCheckAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastLatencyMs: number | null;
  consecutiveFailures: number;
  successCount: number;
  failureCount: number;
  successRate: number | null;
  lastError: string | null;
}

interface Client {
  id: string;
  name: string;
  clickupToken: string;
  clickupTeamId: string | null;
  dashboardSlug: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  dashboardUrl?: string;
  settings?: ClientSettings;
  health?: ClientHealthSnapshot;
}

function extractTokenFromRawValue(rawValue: string | null | undefined): string | null {
  if (!rawValue) return null;
  let candidate = String(rawValue).replace(/^Bearer\s+/i, '').trim();
  if (!candidate) return null;

  if (/^https?:\/\//i.test(candidate)) {
    try {
      const parsed = new URL(candidate);
      candidate = String(parsed.searchParams.get('token') || parsed.searchParams.get('access_token') || '').replace(/^Bearer\s+/i, '').trim();
    } catch {
      return null;
    }
  }

  if (!candidate) return null;
  if (candidate.includes('://') || /[/?&=]/.test(candidate)) return null;
  if (!/^[A-Za-z0-9._-]{16,}$/.test(candidate)) return null;
  return candidate;
}

function hasValidClickupToken(rawValue: string | null | undefined): boolean {
  return Boolean(extractTokenFromRawValue(rawValue));
}

function resolveClientExternalAccess(
  client: Pick<Client, 'clickupToken' | 'clickupTeamId' | 'dashboardUrl'>
): { token: string; teamId: string | null } | null {
  let token = extractTokenFromRawValue(client.clickupToken);
  if (!token && client.dashboardUrl) {
    try {
      const parsed = new URL(client.dashboardUrl);
      token = extractTokenFromRawValue(parsed.searchParams.get('token'));
    } catch {
      token = null;
    }
  }
  if (!token) return null;
  return { token, teamId: client.clickupTeamId || null };
}

function buildExternalDashboardUrlFromAccess(access: Pick<DashboardAccess, 'token' | 'teamId'>): string | null {
  const token = extractTokenFromRawValue(access.token);
  if (!token) return null;
  const base = new URL(PRIMARY_DASHBOARD_URL, window.location.origin);
  base.searchParams.set('token', token);
  if (access.teamId) {
    base.searchParams.set('teamId', access.teamId);
  } else {
    base.searchParams.delete('teamId');
  }
  return base.toString();
}

function isEmbeddedDashboardRoute(pathname: string): boolean {
  const normalized = String(pathname || '/').replace(/\/+$/, '') || '/';
  return normalized === EMBEDDED_DASHBOARD_PATH;
}

function buildPrimaryDashboardUrl(
  client: Pick<Client, 'clickupToken' | 'clickupTeamId' | 'dashboardUrl' | 'dashboardSlug'>
): string | null {
  if (USE_INTERNAL_DASHBOARD) {
    const slug = String(client.dashboardSlug || '').trim();
    if (!slug) return null;
    const base = new URL(PRIMARY_DASHBOARD_URL, window.location.origin);
    base.searchParams.set('slug', slug);
    base.searchParams.delete('teamId');
    return base.toString();
  }

  const externalAccess = resolveClientExternalAccess(client);
  if (!externalAccess) return null;

  const base = USE_EMBEDDED_DASHBOARD
    ? new URL(resolveManagerBaseUrl(), window.location.origin)
    : new URL(PRIMARY_DASHBOARD_URL, window.location.origin);

  if (USE_EMBEDDED_DASHBOARD) {
    base.pathname = EMBEDDED_DASHBOARD_PATH;
    base.search = '';
  }

  base.searchParams.set('token', externalAccess.token);
  if (externalAccess.teamId) {
    base.searchParams.set('teamId', externalAccess.teamId);
  } else {
    base.searchParams.delete('teamId');
  }

  return base.toString();
}

function prefetchPrimaryDashboard(client: Pick<Client, 'clickupToken' | 'clickupTeamId' | 'dashboardSlug'>): void {
  const warmupUrl = new URL(`${PRIMARY_DASHBOARD_API_URL}/dashboard`);

  if (USE_INTERNAL_DASHBOARD) {
    const slug = String(client.dashboardSlug || '').trim();
    if (!slug) return;
    warmupUrl.searchParams.set('slug', slug);
  } else {
    const token = extractTokenFromRawValue(client.clickupToken);
    if (!token) return;
    warmupUrl.searchParams.set('token', token);
    if (client.clickupTeamId) {
      warmupUrl.searchParams.set('teamId', client.clickupTeamId);
    }
  }

  void axios.get(warmupUrl.toString(), { timeout: 10000 }).catch(() => {
    // Best-effort warmup; the Open action still works if prefetch fails.
  });
}

interface ErrorPayload {
  error?: string;
  details?: unknown;
  message?: string;
}

interface TaskPreview {
  id: string | null;
  name: string;
  status: string;
  listName: string;
  dueDate: string | null;
  closedAt: string | null;
  url: string | null;
}

interface DashboardResponse {
  generatedAt: string;
  client: {
    id: string;
    name: string;
    teamId: string | null;
    dashboardSlug: string;
    status: string;
  };
  totals: {
    totalTasks: number;
    wip: number;
    completed: number;
    overdueOpen: number;
    throughputWeek: number;
  };
  metrics: {
    leadTimeAvgHours: number | null;
    cycleTimeAvgHours: number | null;
    slaCompliancePct: number | null;
  };
  highlights: {
    overdueTasks: TaskPreview[];
    recentDeliveries: TaskPreview[];
  };
}

interface DashboardAccess {
  token?: string;
  teamId?: string;
  slug?: string;
}

function parseDashboardAccessFromUrl(): DashboardAccess | null {
  const params = new URLSearchParams(window.location.search);
  const slug = params.get('slug')?.trim() || '';
  const token = params.get('token')?.trim() || '';
  const teamId = params.get('teamId')?.trim() || '';

  if (token && hasValidClickupToken(token)) {
    return { token, teamId: teamId || undefined };
  }

  if (slug) {
    return { slug };
  }

  return null;
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (!axios.isAxiosError(error)) {
    return fallback;
  }

  const body = error.response?.data as ErrorPayload | undefined;
  const details = typeof body?.details === 'string'
    ? body.details
    : body?.details
      ? JSON.stringify(body.details)
      : undefined;

  return body?.error || body?.message || details || error.message || fallback;
}

function statusChip(status: string): { label: string; className: string } {
  if (status === 'Connected') {
    return {
      label: 'Connected',
      className: 'bg-emerald-500 text-white',
    };
  }

  if (status === 'Offline') {
    return {
      label: 'Offline',
      className: 'bg-rose-500 text-white',
    };
  }

  return {
    label: 'Not Connected',
    className: 'bg-rose-500 text-white',
  };
}

function formatDateTime(value: string | null): string {
  if (!value) return '--';

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '--';

  return parsed.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function formatNumber(value: number | null): string {
  if (value === null || value === undefined) return '--';
  return String(value);
}

function formatHours(value: number | null): string {
  if (value === null) return '--';
  return `${value.toFixed(1)}h`;
}

function formatPercent(value: number | null): string {
  if (value === null) return '--';
  return `${value.toFixed(1)}%`;
}

function getDefaultSettings(): ClientSettings {
  return {
    alertEnabled: false,
    alertChannel: null,
    alertTarget: '',
    webhookUrl: '',
    autoRecover: true,
    lastAlertAt: null,
  };
}

function mapClientToSettings(client: Client): ClientSettings {
  return {
    alertEnabled: Boolean(client.settings?.alertEnabled),
    alertChannel: client.settings?.alertChannel || null,
    alertTarget: client.settings?.alertTarget || '',
    webhookUrl: client.settings?.webhookUrl || '',
    autoRecover: client.settings?.autoRecover ?? true,
    lastAlertAt: client.settings?.lastAlertAt || null,
  };
}

function normalizeAlertTargetInput(
  channel: ClientSettings['alertChannel'],
  alertTarget: string | null | undefined,
  webhookUrl: string | null | undefined,
): string {
  const target = String(alertTarget || '').trim();
  const webhook = String(webhookUrl || '').trim();

  if (channel === 'webhook') {
    return target || webhook;
  }

  if (channel === 'whatsapp') {
    const compact = target.replace(/[^\d+]/g, '');
    if (compact.startsWith('00')) {
      return `+${compact.slice(2)}`;
    }
    return compact;
  }

  return target;
}

function validateAlertTargetByChannel(
  channel: ClientSettings['alertChannel'],
  resolvedTarget: string,
): string | null {
  if (!channel) return null;
  if (!resolvedTarget) {
    if (channel === 'email') return 'Informe um email valido para alertas.';
    if (channel === 'whatsapp') return 'Informe um numero WhatsApp no formato +5511999999999.';
    return 'Informe uma URL valida para o canal webhook.';
  }

  if (channel === 'email') {
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(resolvedTarget)) {
      return 'Email invalido. Exemplo: usuario@dominio.com';
    }
  }

  if (channel === 'whatsapp') {
    const phonePattern = /^\+?\d{10,15}$/;
    if (!phonePattern.test(resolvedTarget)) {
      return 'Numero WhatsApp invalido. Use +5511999999999 (10 a 15 digitos).';
    }
  }

  if (channel === 'webhook') {
    try {
      const parsed = new URL(resolvedTarget);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return 'Webhook deve usar http:// ou https://';
      }
    } catch {
      return 'Webhook invalido. Exemplo: https://seu-endpoint.com/webhook';
    }
  }

  return null;
}

async function copyToClipboard(value: string): Promise<boolean> {
  if (!navigator.clipboard) return false;
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    // Clipboard can be blocked by browser policy.
    return false;
  }
}

function ViewerPage({ access, onBack }: { access: DashboardAccess; onBack: () => void }) {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const viewerSyncInFlightRef = useRef(false);

  const loadDashboard = useCallback(async (options: { initial?: boolean; silent?: boolean } = {}) => {
    const { initial = false, silent = false } = options;

    if (viewerSyncInFlightRef.current) {
      return;
    }

    viewerSyncInFlightRef.current = true;

    if (initial) {
      setIsLoading(true);
    } else if (!silent) {
      setIsRefreshing(true);
    }

    if (!silent) {
      setError(null);
    }

    try {
      const requestConfig: { headers?: { Authorization: string }; params?: { slug: string } } = {};
      if (access.token) {
        requestConfig.headers = { Authorization: access.token };
      }
      if (access.slug) {
        requestConfig.params = { slug: access.slug };
      }

      const response = await axios.get<DashboardResponse>(`${API_URL}/dashboard`, {
        ...requestConfig,
      });
      setData(response.data);
      setLastSyncAt(new Date().toISOString());
      setError(null);
      setError(null);
    } catch (requestError) {
      setError(getErrorMessage(requestError, 'Nao foi possivel carregar o dashboard deste cliente.'));
    } finally {
      setIsLoading(false);
      if (!silent) {
        setIsRefreshing(false);
      }
      viewerSyncInFlightRef.current = false;
    }
  }, [access.slug, access.token]);

  useEffect(() => {
    void loadDashboard({ initial: true });
  }, [loadDashboard]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      void loadDashboard({ silent: true });
    }, VIEWER_POLL_MS);

    return () => window.clearInterval(intervalId);
  }, [loadDashboard]);

  return (
    <div className="manager-ui min-h-screen bg-slate-50 p-8 md:p-12">
      <div className="mx-auto w-full max-w-7xl">
        <header className="mb-6 flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">Lead Dashboard</p>
            <h1 className="mt-2 text-3xl font-bold text-slate-700">
              {data?.client.name || 'Dashboard por Token'}
            </h1>
            <p className="mt-2 text-sm text-slate-500">
              {access.slug ? (
                <>Slug ativo: <span className="font-mono">{access.slug}</span></>
              ) : (
                <>Token ativo: <span className="font-mono">{(access.token || '').slice(0, 8)}...</span></>
              )} | Atualizado em {formatDateTime(data?.generatedAt || null)} | Ultima sync local: {formatDateTime(lastSyncAt)} | Auto-sync {Math.floor(VIEWER_POLL_MS / 1000)}s
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <button type="button" className="btn-secondary" onClick={onBack}>
              Voltar ao Manager
            </button>
            <button type="button" className="btn-primary-blue" onClick={() => void loadDashboard()}>
              {isRefreshing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCcw size={16} />}
              Atualizar
            </button>
          </div>
        </header>

        {error && (
          <div className="mb-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        )}

        {isLoading && (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 text-slate-500">
            Carregando dados do dashboard...
          </div>
        )}

        {!isLoading && data && (
          <>
            <section className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <article className="metric-card">
                <p className="metric-label">WIP</p>
                <p className="metric-value">{formatNumber(data.totals.wip)}</p>
                <p className="metric-sub">Tarefas em andamento</p>
              </article>
              <article className="metric-card">
                <p className="metric-label">Throughput 7d</p>
                <p className="metric-value">{formatNumber(data.totals.throughputWeek)}</p>
                <p className="metric-sub">Entregas da semana</p>
              </article>
              <article className="metric-card">
                <p className="metric-label">Lead / Cycle</p>
                <p className="metric-value">{formatHours(data.metrics.leadTimeAvgHours)}</p>
                <p className="metric-sub">Cycle: {formatHours(data.metrics.cycleTimeAvgHours)}</p>
              </article>
              <article className="metric-card">
                <p className="metric-label">SLA Compliance</p>
                <p className="metric-value">{formatPercent(data.metrics.slaCompliancePct)}</p>
                <p className="metric-sub">Aderencia ao prazo</p>
              </article>
            </section>

            <section className="grid gap-5 xl:grid-cols-2">
              <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-lg font-semibold text-slate-700">Entregas Recentes</h2>
                <div className="mt-4 space-y-3">
                  {data.highlights.recentDeliveries.slice(0, 7).map((task) => (
                    <div key={task.id || task.name} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <p className="font-medium text-slate-700">{task.name}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {task.listName} | {task.status} | {formatDateTime(task.closedAt)}
                      </p>
                    </div>
                  ))}
                  {!data.highlights.recentDeliveries.length && (
                    <p className="text-sm text-slate-500">Nenhuma entrega recente encontrada.</p>
                  )}
                </div>
              </article>

              <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-lg font-semibold text-slate-700">Atrasos em Aberto</h2>
                <div className="mt-4 space-y-3">
                  {data.highlights.overdueTasks.slice(0, 7).map((task) => (
                    <div key={task.id || task.name} className="rounded-lg border border-rose-200 bg-rose-50 p-3">
                      <p className="font-medium text-slate-700">{task.name}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {task.listName} | {task.status} | Due: {formatDateTime(task.dueDate)}
                      </p>
                    </div>
                  ))}
                  {!data.highlights.overdueTasks.length && (
                    <p className="text-sm text-slate-500">Nenhuma tarefa atrasada.</p>
                  )}
                </div>
              </article>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function EmbeddedDashboardPage({ access, onBack }: { access: DashboardAccess; onBack: () => void }) {
  const hasValidToken = Boolean(extractTokenFromRawValue(access.token));

  if (!hasValidToken) {
    return (
      <div className="manager-ui min-h-screen bg-slate-50 p-8 md:p-12">
        <div className="mx-auto max-w-3xl rounded-2xl border border-rose-200 bg-rose-50 p-6 text-rose-700">
          <p className="text-lg font-semibold">Link de dashboard invalido.</p>
          <p className="mt-2 text-sm">Abra novamente pelo gerenciador para regenerar a URL de acesso.</p>
          <button type="button" className="btn-secondary mt-4" onClick={onBack}>
            Voltar ao Manager
          </button>
        </div>
      </div>
    );
  }

  return <NativeDashboardApp />;
}

function ManagerPage({ onOpenViewer }: { onOpenViewer: (url: string) => void }) {
  const [clients, setClients] = useState<Client[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(1);
  const [focusClientId, setFocusClientId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem('manager.focusClientId');
  });
  const [isSyncing, setIsSyncing] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [isAuthorizing, setIsAuthorizing] = useState(false);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const managerSyncInFlightRef = useRef(false);
  const [form, setForm] = useState({ name: '', clickupToken: '', dashboardSlug: '' });
  const [settingsForm, setSettingsForm] = useState<ClientSettings>(getDefaultSettings);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [settingsClientId, setSettingsClientId] = useState<string | null>(null);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [isRunningRecovery, setIsRunningRecovery] = useState(false);
  const [isTestingAlert, setIsTestingAlert] = useState(false);
  const [isTestingWebhook, setIsTestingWebhook] = useState(false);
  const [isSendingKpi, setIsSendingKpi] = useState(false);

  const filteredClients = useMemo(() => {
    if (!searchTerm.trim()) return clients;
    const normalized = searchTerm.toLowerCase();
    return clients.filter((client) => (
      client.name.toLowerCase().includes(normalized) ||
      client.dashboardSlug.toLowerCase().includes(normalized) ||
      (client.clickupTeamId || '').toLowerCase().includes(normalized)
    ));
  }, [clients, searchTerm]);

  const totalPages = Math.max(1, Math.ceil(filteredClients.length / PAGE_SIZE));
  const pagedClients = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredClients.slice(start, start + PAGE_SIZE);
  }, [filteredClients, page]);

  const selectedClient = useMemo(() => {
    if (!focusClientId) return null;
    return clients.find((client) => client.id === focusClientId) || null;
  }, [clients, focusClientId]);

  const resolvedAlertTarget = useMemo(
    () => normalizeAlertTargetInput(settingsForm.alertChannel, settingsForm.alertTarget, settingsForm.webhookUrl),
    [settingsForm.alertChannel, settingsForm.alertTarget, settingsForm.webhookUrl],
  );

  const alertTargetMeta = useMemo(() => {
    if (settingsForm.alertChannel === 'email') {
      return {
        label: 'Destino (email)',
        placeholder: 'lead@empresa.com',
        help: 'Use um email valido para receber alertas.',
      };
    }
    if (settingsForm.alertChannel === 'whatsapp') {
      return {
        label: 'Destino (WhatsApp)',
        placeholder: '+5511999999999',
        help: 'Informe numero com DDI/DDD. Exemplo: +5511999999999',
      };
    }
    if (settingsForm.alertChannel === 'webhook') {
      return {
        label: 'Destino (webhook)',
        placeholder: 'https://seu-endpoint.com/webhook',
        help: 'Se vazio, usa automaticamente a URL do Webhook abaixo.',
      };
    }
    return {
      label: 'Destino (email/numero/url)',
      placeholder: 'destino@dominio.com ou +5511999999999',
      help: 'Selecione um canal para validar automaticamente.',
    };
  }, [settingsForm.alertChannel]);

  useEffect(() => {
    if (!selectedClient) {
      setSettingsForm(getDefaultSettings());
      setSettingsClientId(null);
      setSettingsDirty(false);
      return;
    }
    const nextSettings = mapClientToSettings(selectedClient);
    if (settingsClientId !== selectedClient.id) {
      setSettingsForm(nextSettings);
      setSettingsClientId(selectedClient.id);
      setSettingsDirty(false);
      return;
    }
    if (!settingsDirty) {
      setSettingsForm(nextSettings);
    }
  }, [selectedClient, settingsClientId, settingsDirty]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (focusClientId) {
      window.localStorage.setItem('manager.focusClientId', focusClientId);
    } else {
      window.localStorage.removeItem('manager.focusClientId');
    }
  }, [focusClientId]);

  const fetchClients = useCallback(async (options: { silent?: boolean } = {}) => {
    const { silent = false } = options;

    if (managerSyncInFlightRef.current) {
      return;
    }

    managerSyncInFlightRef.current = true;

    if (!silent) {
      setIsSyncing(true);
      setError(null);
    }

    try {
      const response = await axios.get<Client[]>(`${API_URL}/clients`);
      setClients(response.data);
      setFocusClientId((current) => {
        if (current && response.data.some((client) => client.id === current)) {
          return current;
        }
        return response.data[0]?.id || null;
      });
      setLastSyncAt(new Date().toISOString());
    } catch (requestError) {
      if (!silent) {
        setError(getErrorMessage(requestError, 'Falha ao carregar clientes.'));
      }
    } finally {
      if (!silent) {
        setIsSyncing(false);
      }
      managerSyncInFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    void fetchClients();
  }, [fetchClients]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      void fetchClients({ silent: true });
    }, MANAGER_POLL_MS);

    return () => window.clearInterval(intervalId);
  }, [fetchClients]);

  const handleAddClient = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsAdding(true);
    setError(null);
    setSuccess(null);

    const normalizedToken = extractTokenFromRawValue(form.clickupToken);
    if (!normalizedToken) {
      setError('Token ClickUp invalido. Cole o token (pk_...) ou uma URL que contenha ?token=pk_...');
      setIsAdding(false);
      return;
    }

    try {
      const response = await axios.post<Client>(`${API_URL}/clients`, {
        name: form.name,
        clickupToken: normalizedToken,
        dashboardSlug: form.dashboardSlug || undefined,
      });
      setForm({ name: '', clickupToken: '', dashboardSlug: '' });
      setIsModalOpen(false);
      setFocusClientId(response.data.id);
      await fetchClients();
      setSuccess('Cliente adicionado com sucesso.');
    } catch (requestError) {
      setError(getErrorMessage(requestError, 'Nao foi possivel adicionar o cliente.'));
    } finally {
      setIsAdding(false);
    }
  };

  const connectClient = async (clientId: string, openOnSuccess = false) => {
    setConnectingId(clientId);
    setError(null);
    setSuccess(null);
    const targetClient = clients.find((client) => client.id === clientId) || null;

    try {
      const response = await axios.post<{ teamId?: string }>(`${API_URL}/clients/${clientId}/connect`);
      const resolvedTeamId = response.data?.teamId || targetClient?.clickupTeamId || null;
      const dashboardUrl = targetClient
        ? buildPrimaryDashboardUrl({
          clickupToken: targetClient.clickupToken,
          clickupTeamId: resolvedTeamId,
          dashboardSlug: targetClient.dashboardSlug,
          dashboardUrl: targetClient.dashboardUrl,
        })
        : null;

      await fetchClients();
      setSuccess('Conexao com ClickUp validada.');
      if (openOnSuccess && dashboardUrl) {
        onOpenViewer(dashboardUrl);
      }
    } catch (requestError) {
      setError(getErrorMessage(requestError, 'Falha ao conectar com ClickUp.'));
    } finally {
      setConnectingId(null);
    }
  };

  const deleteClient = async (clientId: string) => {
    const client = clients.find((item) => item.id === clientId);
    if (!client) return;

    const confirmed = window.confirm(`Remover cliente "${client.name}"?`);
    if (!confirmed) return;

    setDeletingId(clientId);
    setError(null);
    setSuccess(null);
    try {
      await axios.delete(`${API_URL}/clients/${clientId}`);
      if (focusClientId === clientId) {
        setFocusClientId(null);
      }
      await fetchClients();
      setSuccess('Cliente removido.');
    } catch (requestError) {
      setError(getErrorMessage(requestError, 'Falha ao remover cliente.'));
    } finally {
      setDeletingId(null);
    }
  };

  const authorizeClickup = async () => {
    if (!clients.length) {
      setError('Adicione um cliente primeiro.');
      setSuccess(null);
      return;
    }

    const target = selectedClient || clients[0];
    try {
      setIsAuthorizing(true);
      setError(null);
      setSuccess(null);
      await connectClient(target.id, true);
    } finally {
      setIsAuthorizing(false);
    }
  };

  const copySelectedDashboardUrl = async () => {
    if (!selectedClient) {
      setError('Selecione um cliente para copiar a URL.');
      setSuccess(null);
      return;
    }

    const dashboardUrl = buildPrimaryDashboardUrl(selectedClient);
    if (!dashboardUrl) {
      setSuccess(null);
      setError('Token do cliente invalido. Corrija o token ClickUp para gerar a URL.');
      return;
    }

    const copied = await copyToClipboard(dashboardUrl);
    if (copied) {
      setError(null);
      setSuccess('URL copiada para a area de transferencia.');
    } else {
      setSuccess(null);
      setError('Nao foi possivel copiar automaticamente. Permita acesso ao clipboard.');
    }
  };

  const saveClientSettings = async () => {
    if (!selectedClient) {
      setError('Selecione um cliente para salvar configuracoes.');
      return;
    }
    const targetValidationError = settingsForm.alertEnabled
      ? validateAlertTargetByChannel(settingsForm.alertChannel, resolvedAlertTarget)
      : null;
    if (targetValidationError) {
      setError(targetValidationError);
      return;
    }
    setIsSavingSettings(true);
    setError(null);
    setSuccess(null);
    try {
      await axios.put(`${API_URL}/clients/${selectedClient.id}/settings`, {
        alertEnabled: settingsForm.alertEnabled,
        alertChannel: settingsForm.alertChannel || null,
        alertTarget: resolvedAlertTarget || null,
        webhookUrl: settingsForm.webhookUrl || null,
        autoRecover: settingsForm.autoRecover,
      });
      setSettingsDirty(false);
      await fetchClients({ silent: true });
      setSuccess('Configuracoes operacionais salvas.');
    } catch (requestError) {
      setError(getErrorMessage(requestError, 'Nao foi possivel salvar as configuracoes.'));
    } finally {
      setIsSavingSettings(false);
    }
  };

  const runHealthCheck = async () => {
    if (!selectedClient) return;
    try {
      await axios.post(`${API_URL}/clients/${selectedClient.id}/health-check`);
      await fetchClients({ silent: true });
    } catch {
      // Silent: manager auto-polls and keeps page responsive.
    }
  };

  const runRecovery = async () => {
    if (!selectedClient) {
      setError('Selecione um cliente para recuperar.');
      return;
    }
    setIsRunningRecovery(true);
    setError(null);
    setSuccess(null);
    try {
      await axios.post(`${API_URL}/clients/${selectedClient.id}/recover`);
      await fetchClients();
      setSuccess('Recuperacao executada com sucesso.');
    } catch (requestError) {
      setError(getErrorMessage(requestError, 'Falha ao recuperar cliente automaticamente.'));
    } finally {
      setIsRunningRecovery(false);
    }
  };

  const sendTestAlert = async () => {
    if (!selectedClient) return;
    const targetValidationError = validateAlertTargetByChannel(settingsForm.alertChannel, resolvedAlertTarget);
    if (!settingsForm.alertChannel) {
      setError('Selecione um canal de alerta antes de testar.');
      return;
    }
    if (targetValidationError) {
      setError(targetValidationError);
      return;
    }
    setIsTestingAlert(true);
    setError(null);
    setSuccess(null);
    try {
      await axios.post(`${API_URL}/clients/${selectedClient.id}/alerts/test`, {
        channel: settingsForm.alertChannel,
        target: resolvedAlertTarget || undefined,
        webhookUrl: settingsForm.webhookUrl || undefined,
      });
      await fetchClients({ silent: true });
      setSuccess('Alerta de teste enviado.');
    } catch (requestError) {
      setError(getErrorMessage(requestError, 'Falha ao enviar alerta de teste.'));
    } finally {
      setIsTestingAlert(false);
    }
  };

  const sendWebhookTest = async () => {
    if (!selectedClient) return;
    setIsTestingWebhook(true);
    setError(null);
    setSuccess(null);
    try {
      await axios.post(`${API_URL}/clients/${selectedClient.id}/webhook/test`, {
        webhookUrl: settingsForm.webhookUrl || undefined,
      });
      await fetchClients({ silent: true });
      setSuccess('Webhook de teste enviado.');
    } catch (requestError) {
      setError(getErrorMessage(requestError, 'Falha no teste de webhook.'));
    } finally {
      setIsTestingWebhook(false);
    }
  };

  const sendKpiNow = async () => {
    if (!selectedClient) return;
    const kpiChannel = settingsForm.alertChannel || (settingsForm.webhookUrl ? 'webhook' : null);
    const targetValidationError = validateAlertTargetByChannel(kpiChannel, resolvedAlertTarget);
    if (!kpiChannel) {
      setError('Selecione um canal para envio de KPI (email, WhatsApp ou webhook).');
      return;
    }
    if (targetValidationError) {
      setError(targetValidationError);
      return;
    }
    setIsSendingKpi(true);
    setError(null);
    setSuccess(null);
    try {
      await axios.post(`${API_URL}/clients/${selectedClient.id}/kpi/send`, {
        channel: kpiChannel,
        target: resolvedAlertTarget || undefined,
        format: 'json',
        webhookUrl: settingsForm.webhookUrl || undefined,
      });
      setSuccess('KPI enviado sob demanda.');
    } catch (requestError) {
      setError(getErrorMessage(requestError, 'Falha ao enviar KPI.'));
    } finally {
      setIsSendingKpi(false);
    }
  };

  const exportKpiCsv = async () => {
    if (!selectedClient) return;
    try {
      const response = await axios.get(`${API_URL}/clients/${selectedClient.id}/kpi/export`, {
        params: { format: 'csv' },
        responseType: 'blob',
      });
      const blob = new Blob([response.data], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `kpi_${selectedClient.dashboardSlug}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (requestError) {
      setError(getErrorMessage(requestError, 'Falha ao exportar KPI em CSV.'));
    }
  };

  const connectedCount = clients.filter((client) => client.status === 'Connected').length;

  return (
    <div className="manager-ui min-h-screen bg-slate-100 p-8 md:p-14">
      <div className="mx-auto w-full max-w-7xl">
        <header className="mb-8 flex flex-col gap-4 border-b border-slate-200 pb-6 md:flex-row md:items-center md:justify-between">
          <h1 className="text-4xl font-semibold tracking-tight text-slate-700">Client Dashboard Management</h1>
          <div className="inline-flex items-center gap-3 rounded-full border border-slate-200 bg-white px-4 py-2 shadow-sm">
            <div className="h-12 w-12 rounded-full bg-gradient-to-br from-sky-500 to-indigo-600 text-white grid place-items-center">
              <UserRound size={22} />
            </div>
            <div className="leading-tight">
              <p className="text-lg font-semibold text-slate-700">Admin User</p>
              <p className="text-sm text-slate-500">Admin</p>
            </div>
            <ChevronDown size={18} className="text-slate-500" />
          </div>
        </header>

        <section className="mb-10 grid gap-5 lg:grid-cols-3">
          <article className="panel-card">
            <h2 className="panel-title"><span className="text-emerald-600">1.</span> Create New Client</h2>
            <button type="button" className="btn-primary-green mt-6 w-full justify-center" onClick={() => setIsModalOpen(true)}>
              <Plus size={18} />
              Add Client
            </button>
          </article>

          <article className="panel-card">
            <h2 className="panel-title"><span className="text-sky-600">2.</span> Connect to ClickUp</h2>
            <button
              type="button"
              className="btn-primary-blue mt-6 w-full justify-center"
              onClick={() => void authorizeClickup()}
              disabled={isAuthorizing || Boolean(connectingId)}
            >
              {isAuthorizing ? <Loader2 size={18} className="animate-spin" /> : <Link2 size={18} />}
              Authorize ClickUp
            </button>
            <p className="mt-4 text-center text-sm text-slate-500">Secure token connection</p>
          </article>

          <article className="panel-card">
            <h2 className="panel-title"><span className="text-violet-600">3.</span> Generate Client URL</h2>
            <button
              type="button"
              className="btn-primary-purple mt-6 w-full justify-center"
              onClick={() => void copySelectedDashboardUrl()}
            >
              <Copy size={18} />
              Copy Dashboard URL
            </button>
            <p className="mt-4 text-center text-sm text-slate-500">Share embed link</p>
          </article>
        </section>

        <section>
          <div className="mb-5 flex flex-col gap-4 border-b border-slate-200 pb-4 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-3xl font-semibold text-slate-700">Manage Clients</h2>
              <p className="mt-2 text-sm text-slate-500">
                {connectedCount} connected de {clients.length} clientes
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Ultima sync: {formatDateTime(lastSyncAt)} | Auto-sync {Math.floor(MANAGER_POLL_MS / 1000)}s
              </p>
            </div>
            <button type="button" className="btn-secondary" onClick={() => void fetchClients()} disabled={isSyncing}>
              <RefreshCcw size={16} className={isSyncing ? 'animate-spin' : ''} />
              Refresh List
            </button>
          </div>

          <div className="mb-4 grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
            <label className="relative">
              <Search size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(event) => {
                  setSearchTerm(event.target.value);
                  setPage(1);
                }}
                placeholder="Search clients..."
                className="h-12 w-full rounded-xl border border-slate-300 bg-white pl-12 pr-4 text-slate-700 outline-none transition focus:border-sky-400"
              />
            </label>

            <div className="inline-flex items-center rounded-xl border border-slate-300 bg-white p-1">
              <button type="button" className="page-btn" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
                {'<'}
              </button>
              <span className="px-3 text-sm text-slate-600">{page} / {totalPages}</span>
              <button type="button" className="page-btn" disabled={page >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>
                {'>'}
              </button>
            </div>
          </div>

          {error && (
            <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          )}
          {success && (
            <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              {success}
            </div>
          )}

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full min-w-[980px] border-collapse">
              <thead className="bg-slate-50">
                <tr className="text-left text-base font-semibold text-slate-600">
                  <th className="px-6 py-4">Client Name</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4">ClickUp Workspace</th>
                  <th className="px-6 py-4">Last Sync</th>
                  <th className="px-6 py-4">Dashboard URL</th>
                  <th className="px-6 py-4">Actions</th>
                </tr>
              </thead>
              <tbody>
                {isSyncing && clients.length === 0 ? (
                  <>
                    {[1, 2, 3, 4, 5, 6].map(i => <ClientRowSkeleton key={i} />)}
                  </>
                ) : pagedClients.length > 0 ? (
                  pagedClients.map((client) => {
                    const chip = statusChip(client.status);
                    const isSelected = selectedClient?.id === client.id;
                    const dashboardUrl = buildPrimaryDashboardUrl(client);
                    return (
                      <tr
                        key={client.id}
                        className={`border-t border-slate-200 ${isSelected ? 'bg-sky-50/50' : ''}`}
                        onClick={() => setFocusClientId(client.id)}
                      >
                        <td className="px-6 py-5">
                          <p className="text-lg font-semibold text-slate-700">{client.name}</p>
                        </td>
                        <td className="px-6 py-5">
                          <span className={`inline-flex items-center rounded-md px-3 py-1.5 text-sm font-semibold ${chip.className}`}>
                            {chip.label}
                          </span>
                        </td>
                        <td className="px-6 py-5 text-sm text-slate-700">
                          {client.clickupTeamId ? `Team ${client.clickupTeamId}` : 'Not Linked'}
                        </td>
                        <td className="px-6 py-5 text-sm text-slate-700">
                          {client.status === 'Connected' ? formatDateTime(client.updatedAt) : '--'}
                        </td>
                        <td className="px-6 py-5">
                          {dashboardUrl ? (
                            <a
                              className="break-all text-sm text-blue-700 underline underline-offset-4"
                              href={dashboardUrl}
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                onOpenViewer(dashboardUrl);
                              }}
                            >
                              {dashboardUrl}
                            </a>
                          ) : (
                            <span className="text-sm text-slate-500">Token invalido</span>
                          )}
                        </td>
                        <td className="px-6 py-5">
                          <div className="flex flex-wrap gap-3">
                            <button
                              type="button"
                              className="btn-primary-blue"
                              onClick={(event) => {
                                event.stopPropagation();
                                void connectClient(client.id);
                              }}
                              disabled={connectingId === client.id || deletingId === client.id}
                            >
                              {connectingId === client.id ? (
                                <Loader2 size={16} className="animate-spin" />
                              ) : (
                                <Check size={16} />
                              )}
                              {client.status === 'Connected' ? 'Reconnect' : 'Connect'}
                            </button>
                            <button
                              type="button"
                              className="btn-primary-purple"
                              onClick={(event) => {
                                event.stopPropagation();
                                void (async () => {
                                  if (!dashboardUrl) {
                                    setSuccess(null);
                                    setError('Cliente com token invalido. Atualize o token ClickUp.');
                                    return;
                                  }
                                  const copied = await copyToClipboard(dashboardUrl);
                                  if (copied) {
                                    setError(null);
                                    setSuccess('URL copiada para a area de transferencia.');
                                  } else {
                                    setSuccess(null);
                                    setError('Nao foi possivel copiar automaticamente. Permita acesso ao clipboard.');
                                  }
                                })();
                              }}
                              disabled={deletingId === client.id || !dashboardUrl}
                            >
                              <Copy size={16} />
                              Copy URL
                            </button>
                            <button
                              type="button"
                              className="btn-secondary"
                              onMouseEnter={() => {
                                prefetchPrimaryDashboard(client);
                              }}
                              onClick={(event) => {
                                event.stopPropagation();
                                if (!dashboardUrl) {
                                  setSuccess(null);
                                  setError('Cliente com token invalido. Atualize o token ClickUp.');
                                  return;
                                }
                                onOpenViewer(dashboardUrl);
                              }}
                              disabled={deletingId === client.id || !dashboardUrl}
                            >
                              <ExternalLink size={16} />
                              Open
                            </button>
                            <button
                              type="button"
                              className="btn-secondary"
                              onClick={(event) => {
                                event.stopPropagation();
                                void deleteClient(client.id);
                              }}
                              disabled={deletingId === client.id}
                            >
                              {deletingId === client.id ? (
                                <Loader2 size={16} className="animate-spin" />
                              ) : (
                                <Trash2 size={16} />
                              )}
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={6} className="px-6 py-16 text-center text-slate-500">
                      Nenhuma instancia encontrada para esse filtro.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-6 grid gap-5 lg:grid-cols-3">
            <article className="panel-card lg:col-span-1">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-slate-700">Saude da instância</h3>
                <button type="button" className="btn-secondary" onClick={() => void runHealthCheck()}>
                  <RefreshCcw size={14} />
                  Verificar
                </button>
              </div>
              <label className="mt-4 block">
                <span className="mb-1 block text-sm font-medium text-slate-600">Cliente monitorado</span>
                <select
                  className="h-11 w-full rounded-lg border border-slate-300 px-3 text-slate-700 outline-none focus:border-sky-400"
                  value={focusClientId || ''}
                  onChange={(event) => setFocusClientId(event.target.value || null)}
                >
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name} ({client.status})
                    </option>
                  ))}
                </select>
              </label>
              <div className="mt-4 space-y-2 text-sm text-slate-600">
                <p><span className="font-medium text-slate-700">Cliente:</span> {selectedClient?.name || '--'}</p>
                <p><span className="font-medium text-slate-700">Latencia:</span> {selectedClient?.health?.lastLatencyMs ?? '--'} ms</p>
                <p><span className="font-medium text-slate-700">Sucesso:</span> {selectedClient?.health?.successRate ?? '--'}%</p>
                <p><span className="font-medium text-slate-700">Falhas consecutivas:</span> {selectedClient?.health?.consecutiveFailures ?? 0}</p>
                <p><span className="font-medium text-slate-700">Ultimo check:</span> {formatDateTime(selectedClient?.health?.lastCheckAt || null)}</p>
                <p><span className="font-medium text-slate-700">Ultimo erro:</span> {selectedClient?.health?.lastError || '--'}</p>
              </div>
              <button
                type="button"
                className="btn-primary-blue mt-4 w-full justify-center"
                onClick={() => void runRecovery()}
                disabled={!selectedClient || isRunningRecovery}
              >
                {isRunningRecovery ? <Loader2 size={16} className="animate-spin" /> : <RefreshCcw size={16} />}
                Auto Recovery Agora
              </button>
            </article>

            <article className="panel-card lg:col-span-2">
              <h3 className="text-lg font-semibold text-slate-700">Alertas, Webhook e KPI</h3>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-slate-600">Canal de alerta</span>
                  <select
                    className="h-11 w-full rounded-lg border border-slate-300 px-3 text-slate-700 outline-none focus:border-sky-400"
                    value={settingsForm.alertChannel || ''}
                    onChange={(event) => {
                      setSettingsDirty(true);
                      setSettingsForm((current) => ({ ...current, alertChannel: (event.target.value || null) as ClientSettings['alertChannel'] }));
                    }}
                  >
                    <option value="">Desativado</option>
                    <option value="email">Email</option>
                    <option value="whatsapp">WhatsApp</option>
                    <option value="webhook">Webhook</option>
                  </select>
                </label>

                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-slate-600">{alertTargetMeta.label}</span>
                  <input
                    className="h-11 w-full rounded-lg border border-slate-300 px-3 text-slate-700 outline-none focus:border-sky-400"
                    value={settingsForm.alertTarget || ''}
                    onChange={(event) => {
                      setSettingsDirty(true);
                      setSettingsForm((current) => ({ ...current, alertTarget: event.target.value }));
                    }}
                    placeholder={alertTargetMeta.placeholder}
                  />
                  <p className="mt-1 text-xs text-slate-500">{alertTargetMeta.help}</p>
                </label>
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-slate-600">Webhook URL</span>
                  <input
                    className="h-11 w-full rounded-lg border border-slate-300 px-3 font-mono text-slate-700 outline-none focus:border-sky-400"
                    value={settingsForm.webhookUrl || ''}
                    onChange={(event) => {
                      setSettingsDirty(true);
                      setSettingsForm((current) => ({ ...current, webhookUrl: event.target.value }));
                    }}
                    placeholder="https://seu-endpoint.com/webhook"
                  />
                </label>
                <div className="pt-7 space-y-2 text-sm font-medium text-slate-700">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={settingsForm.alertEnabled}
                      onChange={(event) => {
                        setSettingsDirty(true);
                        setSettingsForm((current) => ({ ...current, alertEnabled: event.target.checked }));
                      }}
                    />
                    Alertas ativos
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={settingsForm.autoRecover}
                      onChange={(event) => {
                        setSettingsDirty(true);
                        setSettingsForm((current) => ({ ...current, autoRecover: event.target.checked }));
                      }}
                    />
                    Auto-recuperacao ativa
                  </label>
                </div>
              </div>

              <div className="mt-5 flex flex-wrap gap-3">
                <button type="button" className="btn-primary-green" onClick={() => void saveClientSettings()} disabled={!selectedClient || isSavingSettings}>
                  {isSavingSettings ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                  Salvar Config
                </button>
                <button type="button" className="btn-secondary" onClick={() => void sendTestAlert()} disabled={!selectedClient || isTestingAlert}>
                  {isTestingAlert ? <Loader2 size={16} className="animate-spin" /> : <Link2 size={16} />}
                  Testar Alerta
                </button>
                <button type="button" className="btn-secondary" onClick={() => void sendWebhookTest()} disabled={!selectedClient || isTestingWebhook}>
                  {isTestingWebhook ? <Loader2 size={16} className="animate-spin" /> : <Link2 size={16} />}
                  Testar Webhook
                </button>
                <button type="button" className="btn-primary-blue" onClick={() => void sendKpiNow()} disabled={!selectedClient || isSendingKpi}>
                  {isSendingKpi ? <Loader2 size={16} className="animate-spin" /> : <ExternalLink size={16} />}
                  Enviar KPI Agora
                </button>
                <button type="button" className="btn-secondary" onClick={() => void exportKpiCsv()} disabled={!selectedClient}>
                  <Copy size={16} />
                  Exportar KPI CSV
                </button>
              </div>
            </article>
          </div>
        </section>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/60 px-4">
          <form className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-6 shadow-xl" onSubmit={(event) => void handleAddClient(event)}>
            <div className="mb-6 flex items-center justify-between">
              <h3 className="text-2xl font-semibold text-slate-700">Add New Client</h3>
              <button type="button" className="rounded-md border border-slate-300 p-2 text-slate-500 hover:bg-slate-100" onClick={() => setIsModalOpen(false)}>
                <X size={16} />
              </button>
            </div>

            <div className="space-y-4">
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-slate-600">Client Name</span>
                <input
                  required
                  className="h-11 w-full rounded-lg border border-slate-300 px-3 text-slate-700 outline-none focus:border-sky-400"
                  value={form.name}
                  onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder="Acme Inc."
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-sm font-medium text-slate-600">ClickUp Token</span>
                <input
                  required
                  type="password"
                  className="h-11 w-full rounded-lg border border-slate-300 px-3 font-mono text-slate-700 outline-none focus:border-sky-400"
                  value={form.clickupToken}
                  onChange={(event) => {
                    const rawValue = event.target.value;
                    const extractedToken = extractTokenFromRawValue(rawValue);
                    setForm((current) => ({ ...current, clickupToken: extractedToken || rawValue }));
                  }}
                  placeholder="pk_xxxxxxxxxxxxx"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-sm font-medium text-slate-600">Slug (optional)</span>
                <input
                  className="h-11 w-full rounded-lg border border-slate-300 px-3 text-slate-700 outline-none focus:border-sky-400"
                  value={form.dashboardSlug}
                  onChange={(event) => setForm((current) => ({ ...current, dashboardSlug: event.target.value }))}
                  placeholder="acme123"
                />
              </label>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button type="button" className="btn-secondary" onClick={() => setIsModalOpen(false)}>
                Cancel
              </button>
              <button type="submit" className="btn-primary-green" disabled={isAdding}>
                {isAdding ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                Add Client
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function App() {
  const [activeAccess, setActiveAccess] = useState<DashboardAccess | null>(() => parseDashboardAccessFromUrl());
  const [isEmbeddedRoute, setIsEmbeddedRoute] = useState<boolean>(() =>
    typeof window !== 'undefined' ? isEmbeddedDashboardRoute(window.location.pathname) : false
  );

  useEffect(() => {
    const onPopState = () => {
      setActiveAccess(parseDashboardAccessFromUrl());
      setIsEmbeddedRoute(isEmbeddedDashboardRoute(window.location.pathname));
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const openViewer = (dashboardUrl: string) => {
    window.location.assign(dashboardUrl);
  };

  const backToManager = () => {
    window.history.pushState({}, '', '/');
    setActiveAccess(null);
    setIsEmbeddedRoute(false);
  };

  if (activeAccess?.token && USE_EXTERNAL_DASHBOARD) {
    const externalUrl = buildExternalDashboardUrlFromAccess(activeAccess);
    if (externalUrl) {
      const currentUrl = new URL(window.location.href).toString();
      if (externalUrl !== currentUrl) {
        window.location.replace(externalUrl);
        return null;
      }
    }
  }

  if (activeAccess?.token && USE_EMBEDDED_DASHBOARD && !isEmbeddedRoute) {
    const embeddedUrl = buildPrimaryDashboardUrl({
      clickupToken: activeAccess.token,
      clickupTeamId: activeAccess.teamId || null,
      dashboardSlug: '',
      dashboardUrl: undefined,
    });
    if (embeddedUrl) {
      const currentUrl = new URL(window.location.href).toString();
      if (embeddedUrl !== currentUrl) {
        window.location.replace(embeddedUrl);
        return null;
      }
    }
  }

  if (isEmbeddedRoute) {
    return <EmbeddedDashboardPage access={activeAccess || {}} onBack={backToManager} />;
  }

  if (activeAccess && (USE_INTERNAL_DASHBOARD || activeAccess.slug)) {
    return <ViewerPage access={activeAccess} onBack={backToManager} />;
  }

  return <ManagerPage onOpenViewer={openViewer} />;
}

export default App;
