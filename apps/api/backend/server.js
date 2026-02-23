const express = require("express");
const cors = require("cors");
const axios = require("axios");
const compression = require("compression");
const os = require("os");
const { PrismaClient, Prisma } = require("@prisma/client");
require("dotenv").config();

const app = express();
const prisma = new PrismaClient();

app.use(compression());
app.use(cors());
app.use(express.json());

const PORT = Number(process.env.PORT || 3005);
const API_PREFIX = "/api";
const CLICKUP_BASE_URL = "https://api.clickup.com/api/v2";
const CLICKUP_PAGE_SIZE_HINT = 100;
const MAX_CLICKUP_PAGES = 100;
const HEALTH_MONITOR_MS = Math.max(15000, Number(process.env.HEALTH_MONITOR_MS || 60000));
const WARMUP_MS = Math.max(60000, Number(process.env.WARMUP_MS || 600000));
const ALERT_FAILURE_THRESHOLD = Math.max(1, Number(process.env.ALERT_FAILURE_THRESHOLD || 3));
const ALERT_COOLDOWN_MS = Math.max(60000, Number(process.env.ALERT_COOLDOWN_MINUTES || 15) * 60 * 1000);
const DASHBOARD_PUBLIC_URL = (process.env.DASHBOARD_PUBLIC_URL || "").trim();
const ALERT_EMAIL_WEBHOOK_URL = (process.env.ALERT_EMAIL_WEBHOOK_URL || "").trim();
const ALERT_WHATSAPP_WEBHOOK_URL = (process.env.ALERT_WHATSAPP_WEBHOOK_URL || "").trim();
const PRIMARY_DASHBOARD_API_URL = (process.env.PRIMARY_DASHBOARD_API_URL || "http://localhost:3001/api")
  .trim()
  .replace(/\/+$/, "");
const PRIMARY_DASHBOARD_TIMEOUT_MS = Math.max(5000, Number(process.env.PRIMARY_DASHBOARD_TIMEOUT_MS || 25000));
const DASHBOARD_PUBLIC_HOST = (process.env.DASHBOARD_PUBLIC_HOST || process.env.PUBLIC_HOST || "").trim();
const PRIMARY_DASHBOARD_MODE = String(process.env.PRIMARY_DASHBOARD_MODE || "internal").trim().toLowerCase() === "external"
  ? "external"
  : "internal";
const USE_INTERNAL_DASHBOARD = PRIMARY_DASHBOARD_MODE === "internal";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

const STATUS = {
  CONNECTED: "Connected",
  OFFLINE: "Offline",
  NOT_CONNECTED: "Not Connected",
};

function isPrivateIPv4(address) {
  if (!address || typeof address !== "string") return false;
  if (address.startsWith("10.")) return true;
  if (address.startsWith("192.168.")) return true;
  const match = address.match(/^172\.(\d{1,3})\./);
  if (match) {
    const secondOctet = Number(match[1]);
    return secondOctet >= 16 && secondOctet <= 31;
  }
  return false;
}

function detectLanIpv4() {
  const networkMap = os.networkInterfaces();
  const fallback = [];

  for (const entries of Object.values(networkMap)) {
    for (const info of entries || []) {
      const family = typeof info.family === "string" ? info.family : String(info.family);
      if (family !== "IPv4" || info.internal || !info.address) continue;
      if (isPrivateIPv4(info.address)) return info.address;
      fallback.push(info.address);
    }
  }

  return fallback[0] || null;
}

function applyHostOverride(base, rawHost) {
  const hostValue = String(rawHost || "").trim();
  if (!hostValue) return false;

  try {
    const candidate = hostValue.includes("://")
      ? new URL(hostValue)
      : new URL(`http://${hostValue}`);
    if (!candidate.hostname) return false;
    base.hostname = candidate.hostname;
    if (candidate.port) base.port = candidate.port;
    return true;
  } catch {
    return false;
  }
}

function registerRoute(method, path, handler) {
  app[method](`${API_PREFIX}${path}`, handler);
  app[method](path, handler);
}

function normalizeToken(rawValue) {
  if (!rawValue || typeof rawValue !== "string") return null;
  const withoutBearer = rawValue.replace(/^Bearer\s+/i, "").trim();
  return withoutBearer.length ? withoutBearer : null;
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function normalizeAlertChannel(value) {
  if (!value) return null;
  const normalized = String(value).trim().toLowerCase();
  if (["email", "whatsapp", "webhook"].includes(normalized)) return normalized;
  return null;
}

function normalizeAlertTarget(channel, target, webhookUrl) {
  const normalizedChannel = normalizeAlertChannel(channel);
  const targetValue = String(target || "").trim();
  const webhookValue = String(webhookUrl || "").trim();

  if (!normalizedChannel) return targetValue;
  if (normalizedChannel === "webhook") return targetValue || webhookValue;

  if (normalizedChannel === "whatsapp") {
    const compact = targetValue.replace(/[^\d+]/g, "");
    if (compact.startsWith("00")) return `+${compact.slice(2)}`;
    return compact;
  }

  return targetValue;
}

function validateAlertTarget(channel, target) {
  const normalizedChannel = normalizeAlertChannel(channel);
  if (!normalizedChannel) return null;
  const value = String(target || "").trim();
  if (!value) {
    if (normalizedChannel === "email") return "Email target is required";
    if (normalizedChannel === "whatsapp") return "WhatsApp target is required";
    return "Webhook target is required";
  }

  if (normalizedChannel === "email") {
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(value)) return "Invalid email target format";
  }

  if (normalizedChannel === "whatsapp") {
    const phonePattern = /^\+?\d{10,15}$/;
    if (!phonePattern.test(value)) return "Invalid WhatsApp number format. Use +5511999999999";
  }

  if (normalizedChannel === "webhook") {
    try {
      const parsed = new URL(value);
      if (!["http:", "https:"].includes(parsed.protocol)) return "Webhook target must use http or https";
    } catch {
      return "Invalid webhook URL format";
    }
  }

  return null;
}

function parseClickupDate(value) {
  if (value === undefined || value === null || value === "") return null;
  const asNumber = Number(value);
  if (!Number.isFinite(asNumber) || asNumber <= 0) return null;
  const asDate = new Date(asNumber);
  return Number.isNaN(asDate.getTime()) ? null : asDate;
}

function roundMetric(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  return Number(value.toFixed(2));
}

function average(values) {
  if (!values.length) return null;
  const sum = values.reduce((acc, current) => acc + current, 0);
  return sum / values.length;
}

function toHours(start, end) {
  return (end.getTime() - start.getTime()) / (1000 * 60 * 60);
}

function formatDayLabel(date) {
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function dayKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function isTaskClosed(task) {
  const statusType = String(task?.status?.type || "").toLowerCase();
  return statusType === "closed" || Boolean(task?.date_closed);
}

function isTaskInProgress(task) {
  if (isTaskClosed(task)) return false;
  const statusName = String(task?.status?.status || "").toLowerCase();
  if (!statusName) return true;
  const notStarted = ["todo", "to do", "backlog", "open", "new", "queue", "pendente", "a fazer", "pending"];
  return !notStarted.some((keyword) => statusName.includes(keyword));
}

function mapTaskPreview(task) {
  const closedAt = parseClickupDate(task?.date_closed);
  const dueDate = parseClickupDate(task?.due_date);
  return {
    id: task?.id || null,
    name: task?.name || "Untitled",
    status: task?.status?.status || "Unknown",
    listName: task?.list?.name || "Sem lista",
    dueDate: dueDate ? dueDate.toISOString() : null,
    closedAt: closedAt ? closedAt.toISOString() : null,
    url: task?.url || null,
  };
}

function buildMetrics(tasks) {
  const now = new Date();
  const completedTasks = [];
  const wipTasks = [];
  const statusBreakdownMap = new Map();
  const wipByListMap = new Map();
  const leadTimeHours = [];
  const cycleTimeHours = [];
  const overdueTasks = [];
  const recentDeliveries = [];
  let slaEligible = 0;
  let slaOnTime = 0;

  for (const task of tasks) {
    const statusLabel = task?.status?.status || "Unknown";
    statusBreakdownMap.set(statusLabel, (statusBreakdownMap.get(statusLabel) || 0) + 1);

    const createdAt = parseClickupDate(task?.date_created);
    const startedAt = parseClickupDate(task?.start_date) || createdAt;
    const closedAt = parseClickupDate(task?.date_closed);
    const dueDate = parseClickupDate(task?.due_date);
    const closed = isTaskClosed(task) && Boolean(closedAt);

    if (closed) {
      completedTasks.push(task);
      recentDeliveries.push(mapTaskPreview(task));
      if (createdAt && closedAt && closedAt >= createdAt) leadTimeHours.push(toHours(createdAt, closedAt));
      if (startedAt && closedAt && closedAt >= startedAt) cycleTimeHours.push(toHours(startedAt, closedAt));
      if (dueDate) {
        slaEligible += 1;
        if (closedAt <= dueDate) slaOnTime += 1;
      }
    } else {
      if (dueDate && dueDate < now) overdueTasks.push(mapTaskPreview(task));
      if (isTaskInProgress(task)) {
        wipTasks.push(task);
        const listName = task?.list?.name || "Sem lista";
        wipByListMap.set(listName, (wipByListMap.get(listName) || 0) + 1);
      }
    }
  }

  const dayBuckets = [];
  const throughputLookup = new Map();
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date(now);
    date.setHours(0, 0, 0, 0);
    date.setDate(now.getDate() - offset);
    const key = dayKey(date);
    const bucket = { date: key, label: formatDayLabel(date), count: 0 };
    throughputLookup.set(key, bucket);
    dayBuckets.push(bucket);
  }

  for (const task of completedTasks) {
    const closedAt = parseClickupDate(task?.date_closed);
    if (!closedAt) continue;
    const key = dayKey(closedAt);
    const bucket = throughputLookup.get(key);
    if (bucket) bucket.count += 1;
  }

  const throughputWeek = dayBuckets.reduce((sum, bucket) => sum + bucket.count, 0);
  const statusBreakdown = Array.from(statusBreakdownMap.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 12);
  const wipByList = Array.from(wipByListMap.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  const leadTimeAvgHours = average(leadTimeHours);
  const cycleTimeAvgHours = average(cycleTimeHours);
  const slaCompliancePct = slaEligible ? (slaOnTime / slaEligible) * 100 : null;

  return {
    totals: {
      totalTasks: tasks.length,
      wip: wipTasks.length,
      completed: completedTasks.length,
      overdueOpen: overdueTasks.length,
      throughputWeek,
    },
    metrics: {
      leadTimeAvgHours: roundMetric(leadTimeAvgHours),
      cycleTimeAvgHours: roundMetric(cycleTimeAvgHours),
      slaCompliancePct: roundMetric(slaCompliancePct),
    },
    charts: { throughputDaily: dayBuckets, statusBreakdown, wipByList },
    highlights: {
      overdueTasks: overdueTasks
        .sort((a, b) => {
          if (!a.dueDate) return 1;
          if (!b.dueDate) return -1;
          return a.dueDate.localeCompare(b.dueDate);
        })
        .slice(0, 8),
      recentDeliveries: recentDeliveries
        .sort((a, b) => {
          if (!a.closedAt) return 1;
          if (!b.closedAt) return -1;
          return b.closedAt.localeCompare(a.closedAt);
        })
        .slice(0, 8),
    },
  };
}

function clickupClient(token) {
  return axios.create({
    baseURL: CLICKUP_BASE_URL,
    timeout: 20000,
    headers: { Authorization: token },
  });
}

async function fetchTeams(token) {
  const client = clickupClient(token);
  const response = await client.get("/team");
  return response.data?.teams || [];
}

async function resolveTeamId(token, preferredTeamId) {
  const teams = await fetchTeams(token);
  if (!teams.length) throw new Error("Token has no ClickUp teams available");
  const resolved = preferredTeamId ? teams.find((team) => String(team.id) === String(preferredTeamId)) : null;
  return { teams, teamId: String((resolved || teams[0]).id) };
}

async function fetchTeamTasks(token, teamId) {
  const client = clickupClient(token);
  const allTasks = [];
  for (let page = 0; page < MAX_CLICKUP_PAGES; page += 1) {
    const response = await client.get(`/team/${teamId}/task`, {
      params: { page, include_closed: true, subtasks: true },
    });
    const tasks = response.data?.tasks || [];
    allTasks.push(...tasks);
    const isLastPageFlag = response.data?.last_page;
    const pageCount = response.data?.pages;
    if (typeof isLastPageFlag === "boolean" && isLastPageFlag) break;
    if (typeof pageCount === "number" && page >= pageCount - 1) break;
    if (!tasks.length || tasks.length < CLICKUP_PAGE_SIZE_HINT) break;
  }
  return allTasks;
}

function buildErrorPayload(error, fallbackMessage) {
  if (error.response) {
    return {
      statusCode: error.response.status || 500,
      error: fallbackMessage,
      details: error.response.data || null,
    };
  }
  return {
    statusCode: 500,
    error: fallbackMessage,
    details: error.message || null,
  };
}

function resolveDashboardBaseUrl(req) {
  if (DASHBOARD_PUBLIC_URL) {
    return DASHBOARD_PUBLIC_URL.endsWith("/") ? DASHBOARD_PUBLIC_URL : `${DASHBOARD_PUBLIC_URL}/`;
  }
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const forwardedHost = String(req.headers["x-forwarded-host"] || "").split(",")[0].trim();
  const host = forwardedHost || req.get("host") || "localhost:3005";
  const protocol = forwardedProto || req.protocol || "http";
  const base = new URL(`${protocol}://${host}`);

  if (LOOPBACK_HOSTS.has(base.hostname)) {
    const lanHost = DASHBOARD_PUBLIC_HOST || detectLanIpv4();
    applyHostOverride(base, lanHost);
  }

  if (USE_INTERNAL_DASHBOARD) {
    if (base.port === "3005") {
      base.port = "3010";
    }
  } else if (base.port === "3005" || base.port === "3010" || !base.port) {
    base.port = "5173";
  }

  base.pathname = "/";
  base.search = "";
  base.hash = "";
  return base.toString();
}

function buildDashboardUrl(req, client) {
  const base = new URL(resolveDashboardBaseUrl(req));
  if (USE_INTERNAL_DASHBOARD) {
    base.searchParams.set("slug", client.dashboardSlug);
  } else {
    base.searchParams.set("token", client.clickupToken);
    if (client.clickupTeamId) base.searchParams.set("teamId", client.clickupTeamId);
  }
  return base.toString();
}

function buildPrimaryDashboardApiUrl(pathname = "/dashboard") {
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${PRIMARY_DASHBOARD_API_URL}${normalizedPath}`;
}

function computeHealth(client) {
  const totalChecks = Number(client.successCount || 0) + Number(client.failureCount || 0);
  const successRate = totalChecks ? Number(((Number(client.successCount || 0) / totalChecks) * 100).toFixed(2)) : null;
  return {
    lastCheckAt: client.lastCheckAt,
    lastSuccessAt: client.lastSuccessAt,
    lastFailureAt: client.lastFailureAt,
    lastLatencyMs: client.lastLatencyMs,
    consecutiveFailures: client.consecutiveFailures || 0,
    successCount: client.successCount || 0,
    failureCount: client.failureCount || 0,
    successRate,
    lastError: client.lastError || null,
  };
}

function serializeClient(req, client) {
  return {
    id: client.id,
    name: client.name,
    clickupToken: client.clickupToken,
    clickupTeamId: client.clickupTeamId,
    status: client.status,
    dashboardSlug: client.dashboardSlug,
    createdAt: client.createdAt,
    updatedAt: client.updatedAt,
    dashboardUrl: buildDashboardUrl(req, client),
    settings: {
      alertEnabled: Boolean(client.alertEnabled),
      alertChannel: client.alertChannel || null,
      alertTarget: client.alertTarget || null,
      webhookUrl: client.webhookUrl || null,
      autoRecover: parseBoolean(client.autoRecover, true),
      lastAlertAt: client.lastAlertAt || null,
    },
    health: computeHealth(client),
  };
}

async function dispatchChannelMessage({ channel, target, subject, message, payload }) {
  const normalizedChannel = normalizeAlertChannel(channel);
  if (!normalizedChannel) return { delivered: false, reason: "invalid_channel" };
  if (!target) return { delivered: false, reason: "missing_target" };

  if (normalizedChannel === "email") {
    if (!ALERT_EMAIL_WEBHOOK_URL) return { delivered: false, reason: "email_webhook_not_configured" };
    await axios.post(
      ALERT_EMAIL_WEBHOOK_URL,
      { to: target, subject: subject || "GERENTE.CENTRAL Alert", message, payload },
      { timeout: 15000 }
    );
    return { delivered: true };
  }

  if (normalizedChannel === "whatsapp") {
    if (!ALERT_WHATSAPP_WEBHOOK_URL) return { delivered: false, reason: "whatsapp_webhook_not_configured" };
    await axios.post(ALERT_WHATSAPP_WEBHOOK_URL, { to: target, message, payload }, { timeout: 15000 });
    return { delivered: true };
  }

  await axios.post(target, payload, { timeout: 15000 });
  return { delivered: true };
}

async function markHealthSuccess(clientId, latencyMs) {
  return prisma.client.update({
    where: { id: clientId },
    data: {
      status: STATUS.CONNECTED,
      lastCheckAt: new Date(),
      lastSuccessAt: new Date(),
      lastLatencyMs: Math.max(0, Math.round(Number(latencyMs || 0))),
      consecutiveFailures: 0,
      successCount: { increment: 1 },
      lastError: null,
    },
  });
}

async function markHealthFailure(clientId, errorMessage) {
  return prisma.client.update({
    where: { id: clientId },
    data: {
      status: STATUS.OFFLINE,
      lastCheckAt: new Date(),
      lastFailureAt: new Date(),
      consecutiveFailures: { increment: 1 },
      failureCount: { increment: 1 },
      lastError: String(errorMessage || "unknown_error").slice(0, 1500),
    },
  });
}

function shouldEmitAlert(client) {
  if (!client.alertEnabled) return false;
  if (!client.alertChannel || !client.alertTarget) return false;
  if ((client.consecutiveFailures || 0) < ALERT_FAILURE_THRESHOLD) return false;
  if (!client.lastAlertAt) return true;
  const elapsedMs = Date.now() - new Date(client.lastAlertAt).getTime();
  return elapsedMs >= ALERT_COOLDOWN_MS;
}

async function emitFailureAlertIfNeeded(client, reason) {
  if (!shouldEmitAlert(client)) return { delivered: false, skipped: true };
  const alertPayload = {
    type: "client_health_failure",
    clientId: client.id,
    clientName: client.name,
    reason,
    consecutiveFailures: client.consecutiveFailures,
    lastFailureAt: client.lastFailureAt,
    lastError: client.lastError || null,
    dashboardSlug: client.dashboardSlug,
  };
  const message = `[ALERTA] ${client.name} com ${client.consecutiveFailures} falhas consecutivas. Motivo: ${reason}`;
  const result = await dispatchChannelMessage({
    channel: client.alertChannel,
    target: client.alertTarget,
    subject: `Alerta ClickUp - ${client.name}`,
    message,
    payload: alertPayload,
  });
  if (result.delivered) {
    await prisma.client.update({
      where: { id: client.id },
      data: { lastAlertAt: new Date() },
    });
  }
  return result;
}

async function connectClientByRecord(clientRecord) {
  const { teams, teamId } = await resolveTeamId(clientRecord.clickupToken, clientRecord.clickupTeamId);
  const updated = await prisma.client.update({
    where: { id: clientRecord.id },
    data: {
      status: STATUS.CONNECTED,
      clickupTeamId: teamId,
      lastError: null,
    },
  });
  return { updated, teams, teamId };
}

async function probePrimaryDashboard(client, { force = false } = {}) {
  if (!client?.clickupToken) return;

  if (USE_INTERNAL_DASHBOARD) {
    await buildClientKpiPayload(client);
    return;
  }

  await axios.get(buildPrimaryDashboardApiUrl("/dashboard"), {
    params: {
      token: client.clickupToken,
      teamId: client.clickupTeamId || "",
      force: force ? "true" : undefined,
    },
    timeout: PRIMARY_DASHBOARD_TIMEOUT_MS,
  });
}

async function warmupPrimaryDashboard(client) {
  await probePrimaryDashboard(client, { force: true });
}

async function runClientHealthCheck(client, { allowAutoRecover = true } = {}) {
  const startedAt = Date.now();
  try {
    await probePrimaryDashboard(client);
    const updated = await markHealthSuccess(client.id, Date.now() - startedAt);
    return { ok: true, latencyMs: Date.now() - startedAt, client: updated };
  } catch (error) {
    const errorMessage = error?.response?.data?.error || error?.message || "health_check_failed";
    let updated = await markHealthFailure(client.id, errorMessage);
    await emitFailureAlertIfNeeded(updated, errorMessage).catch(() => null);

    if (
      allowAutoRecover &&
      parseBoolean(updated.autoRecover, true) &&
      (updated.consecutiveFailures || 0) >= ALERT_FAILURE_THRESHOLD
    ) {
      try {
        const reconnect = await connectClientByRecord(updated);
        await warmupPrimaryDashboard(reconnect.updated);
        updated = await markHealthSuccess(updated.id, Date.now() - startedAt);
        return { ok: true, recovered: true, latencyMs: Date.now() - startedAt, client: updated };
      } catch (recoverError) {
        const recoverReason = recoverError?.response?.data?.error || recoverError?.message || "auto_recover_failed";
        updated = await markHealthFailure(updated.id, recoverReason);
        await emitFailureAlertIfNeeded(updated, recoverReason).catch(() => null);
      }
    }

    return { ok: false, error: errorMessage, client: updated };
  }
}

async function buildClientKpiPayload(client) {
  let teamId = client.clickupTeamId;
  if (!teamId) {
    const resolved = await resolveTeamId(client.clickupToken, null);
    teamId = resolved.teamId;
    await prisma.client.update({ where: { id: client.id }, data: { clickupTeamId: teamId } });
  }
  const tasks = await fetchTeamTasks(client.clickupToken, teamId);
  const metrics = buildMetrics(tasks);
  return {
    generatedAt: new Date().toISOString(),
    client: { id: client.id, name: client.name, dashboardSlug: client.dashboardSlug, teamId },
    kpis: {
      totalTasks: metrics.totals.totalTasks,
      wip: metrics.totals.wip,
      completed: metrics.totals.completed,
      overdueOpen: metrics.totals.overdueOpen,
      throughputWeek: metrics.totals.throughputWeek,
      leadTimeAvgHours: metrics.metrics.leadTimeAvgHours,
      cycleTimeAvgHours: metrics.metrics.cycleTimeAvgHours,
      slaCompliancePct: metrics.metrics.slaCompliancePct,
    },
    highlights: metrics.highlights,
    charts: metrics.charts,
  };
}

function toCsv(rows) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const escapeValue = (value) => {
    if (value === null || value === undefined) return "";
    const asString = String(value);
    if (asString.includes(",") || asString.includes("\"") || asString.includes("\n")) {
      return `"${asString.replace(/"/g, "\"\"")}"`;
    }
    return asString;
  };
  return [headers.join(","), ...rows.map((row) => headers.map((key) => escapeValue(row[key])).join(","))].join("\n");
}

registerRoute("get", "/health", async (_req, res) => {
  res.json({
    status: "ok",
    now: new Date().toISOString(),
    dbProvider: "postgresql",
    monitor: {
      healthIntervalMs: HEALTH_MONITOR_MS,
      warmupIntervalMs: WARMUP_MS,
      failureThreshold: ALERT_FAILURE_THRESHOLD,
      primaryDashboardMode: PRIMARY_DASHBOARD_MODE,
      primaryDashboardApiUrl: USE_INTERNAL_DASHBOARD ? null : PRIMARY_DASHBOARD_API_URL,
      primaryDashboardTimeoutMs: PRIMARY_DASHBOARD_TIMEOUT_MS,
    },
  });
});

registerRoute("get", "/clients", async (req, res) => {
  try {
    const clients = await prisma.client.findMany({ orderBy: { createdAt: "desc" } });
    res.json(clients.map((client) => serializeClient(req, client)));
  } catch (error) {
    res.status(500).json({ error: "Failed to list clients", details: error.message });
  }
});

registerRoute("post", "/clients", async (req, res) => {
  const { name, clickupToken, dashboardSlug } = req.body || {};
  if (!name || !clickupToken) {
    return res.status(400).json({ error: "name and clickupToken are required" });
  }
  const normalizedToken = normalizeToken(String(clickupToken));
  if (!normalizedToken) {
    return res.status(400).json({ error: "Invalid clickupToken format" });
  }
  const resolvedSlug = slugify(dashboardSlug || name);
  if (!resolvedSlug) {
    return res.status(400).json({ error: "Could not derive a valid dashboardSlug from name" });
  }
  try {
    const created = await prisma.client.create({
      data: {
        name: String(name).trim(),
        clickupToken: normalizedToken,
        dashboardSlug: resolvedSlug,
        status: STATUS.NOT_CONNECTED,
      },
    });
    return res.status(201).json(serializeClient(req, created));
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return res.status(409).json({ error: "Client already exists", details: error.meta?.target || null });
    }
    return res.status(400).json({ error: "Failed to create client", details: error.message });
  }
});

registerRoute("put", "/clients/:id", async (req, res) => {
  const { id } = req.params;
  const { name, clickupToken, status, clickupTeamId, dashboardSlug } = req.body || {};
  const normalizedUpdateToken = clickupToken ? normalizeToken(String(clickupToken)) : undefined;
  if (clickupToken && !normalizedUpdateToken) {
    return res.status(400).json({ error: "Invalid clickupToken format" });
  }
  try {
    const updated = await prisma.client.update({
      where: { id },
      data: {
        name,
        clickupToken: normalizedUpdateToken,
        status,
        clickupTeamId,
        dashboardSlug: dashboardSlug ? slugify(dashboardSlug) : undefined,
      },
    });
    return res.json(serializeClient(req, updated));
  } catch (error) {
    return res.status(400).json({ error: "Failed to update client", details: error.message });
  }
});

registerRoute("put", "/clients/:id/settings", async (req, res) => {
  const { id } = req.params;
  const { alertEnabled, alertChannel, alertTarget, webhookUrl, autoRecover } = req.body || {};
  const normalizedChannel = normalizeAlertChannel(alertChannel);
  if (alertChannel !== undefined && alertChannel !== null && !normalizedChannel) {
    return res.status(400).json({ error: "Invalid alertChannel. Use email, whatsapp or webhook." });
  }
  const cleanedWebhookUrl = webhookUrl ? String(webhookUrl).trim() : "";
  const cleanedAlertTarget = normalizeAlertTarget(normalizedChannel, alertTarget, cleanedWebhookUrl);
  const targetError = parseBoolean(alertEnabled, false)
    ? validateAlertTarget(normalizedChannel, cleanedAlertTarget)
    : null;
  if (targetError) {
    return res.status(400).json({ error: targetError });
  }
  const resolvedAlertTarget =
    normalizedChannel === "webhook" ? cleanedAlertTarget || cleanedWebhookUrl : cleanedAlertTarget;
  try {
    const updated = await prisma.client.update({
      where: { id },
      data: {
        alertEnabled: parseBoolean(alertEnabled, false),
        alertChannel: normalizedChannel,
        alertTarget: resolvedAlertTarget || null,
        webhookUrl: cleanedWebhookUrl || null,
        autoRecover: parseBoolean(autoRecover, true),
      },
    });
    return res.json(serializeClient(req, updated));
  } catch (error) {
    return res.status(400).json({ error: "Failed to update settings", details: error.message });
  }
});

registerRoute("get", "/clients/:id/health", async (req, res) => {
  const { id } = req.params;
  try {
    const client = await prisma.client.findUnique({ where: { id } });
    if (!client) return res.status(404).json({ error: "Client not found" });
    return res.json({
      client: { id: client.id, name: client.name, status: client.status },
      health: computeHealth(client),
      settings: {
        alertEnabled: client.alertEnabled,
        alertChannel: client.alertChannel,
        alertTarget: client.alertTarget,
        webhookUrl: client.webhookUrl,
        autoRecover: parseBoolean(client.autoRecover, true),
      },
    });
  } catch (error) {
    return res.status(500).json({ error: "Failed to load health", details: error.message });
  }
});

registerRoute("post", "/clients/:id/health-check", async (req, res) => {
  const { id } = req.params;
  try {
    const client = await prisma.client.findUnique({ where: { id } });
    if (!client) return res.status(404).json({ error: "Client not found" });
    const result = await runClientHealthCheck(client, { allowAutoRecover: false });
    return res.json({
      ok: result.ok,
      recovered: Boolean(result.recovered),
      latencyMs: result.latencyMs || null,
      error: result.error || null,
      client: serializeClient(req, result.client),
    });
  } catch (error) {
    return res.status(500).json({ error: "Health check failed", details: error.message });
  }
});

registerRoute("post", "/clients/:id/recover", async (req, res) => {
  const { id } = req.params;
  try {
    const client = await prisma.client.findUnique({ where: { id } });
    if (!client) return res.status(404).json({ error: "Client not found" });
    const reconnect = await connectClientByRecord(client);
    await warmupPrimaryDashboard(reconnect.updated);
    const refreshed = await markHealthSuccess(reconnect.updated.id, 0);
    return res.json({
      message: "Recovery completed",
      teamId: reconnect.teamId,
      teams: reconnect.teams,
      client: serializeClient(req, refreshed),
    });
  } catch (error) {
    const payload = buildErrorPayload(error, "Recovery failed");
    return res.status(payload.statusCode).json({ error: payload.error, details: payload.details });
  }
});

registerRoute("delete", "/clients/:id", async (req, res) => {
  const { id } = req.params;
  try {
    await prisma.client.delete({ where: { id } });
    return res.status(204).send();
  } catch (error) {
    return res.status(400).json({ error: "Failed to delete client", details: error.message });
  }
});

registerRoute("post", "/clients/:id/connect", async (req, res) => {
  const { id } = req.params;
  try {
    const client = await prisma.client.findUnique({ where: { id } });
    if (!client) return res.status(404).json({ error: "Client not found" });
    const reconnect = await connectClientByRecord(client);
    const refreshed = await markHealthSuccess(reconnect.updated.id, 0);
    return res.json({
      message: "Handshake completed",
      teamId: reconnect.teamId,
      teams: reconnect.teams,
      client: serializeClient(req, refreshed),
    });
  } catch (error) {
    const errorMessage = error?.response?.data?.error || error?.message || "ClickUp handshake failed";
    const updated = await markHealthFailure(id, errorMessage).catch(() => null);
    if (updated) await emitFailureAlertIfNeeded(updated, errorMessage).catch(() => null);
    const payload = buildErrorPayload(error, "ClickUp handshake failed");
    return res.status(payload.statusCode).json({ error: payload.error, details: payload.details });
  }
});

registerRoute("post", "/clients/:id/alerts/test", async (req, res) => {
  const { id } = req.params;
  const { channel, target, message, webhookUrl } = req.body || {};
  try {
    const client = await prisma.client.findUnique({ where: { id } });
    if (!client) return res.status(404).json({ error: "Client not found" });
    const resolvedChannel = normalizeAlertChannel(channel || client.alertChannel);
    const resolvedTarget = normalizeAlertTarget(
      resolvedChannel,
      target || client.alertTarget,
      webhookUrl || client.webhookUrl
    );
    const targetError = validateAlertTarget(resolvedChannel, resolvedTarget);
    if (!resolvedChannel) {
      return res.status(400).json({ error: "Alert channel is required" });
    }
    if (targetError) {
      return res.status(400).json({ error: targetError });
    }
    const text = String(message || `[TESTE] Alerta manual enviado para ${client.name}`);

    const result = await dispatchChannelMessage({
      channel: resolvedChannel,
      target: resolvedTarget,
      subject: `Teste de alerta - ${client.name}`,
      message: text,
      payload: { type: "manual_test", clientId: client.id, clientName: client.name, at: new Date().toISOString() },
    });

    if (!result.delivered) {
      return res.status(400).json({ error: "Alert not delivered", details: result.reason || "unknown_reason" });
    }
    await prisma.client.update({ where: { id: client.id }, data: { lastAlertAt: new Date() } });
    return res.json({ message: "Alert sent", channel: resolvedChannel, target: resolvedTarget });
  } catch (error) {
    return res.status(500).json({ error: "Failed to send alert", details: error.message });
  }
});

registerRoute("post", "/clients/:id/webhook/test", async (req, res) => {
  const { id } = req.params;
  const { webhookUrl } = req.body || {};
  try {
    const client = await prisma.client.findUnique({ where: { id } });
    if (!client) return res.status(404).json({ error: "Client not found" });
    const resolvedWebhook = String(webhookUrl || client.webhookUrl || "").trim();
    if (!resolvedWebhook) return res.status(400).json({ error: "Webhook URL is required" });

    await dispatchChannelMessage({
      channel: "webhook",
      target: resolvedWebhook,
      payload: { type: "webhook_test", clientId: client.id, clientName: client.name, emittedAt: new Date().toISOString() },
      message: "Webhook test",
      subject: "Webhook test",
    });

    if (!client.webhookUrl) {
      await prisma.client.update({ where: { id: client.id }, data: { webhookUrl: resolvedWebhook } });
    }
    return res.json({ message: "Webhook test sent", webhookUrl: resolvedWebhook });
  } catch (error) {
    return res.status(500).json({ error: "Webhook test failed", details: error.message });
  }
});

registerRoute("get", "/clients/:id/kpi/export", async (req, res) => {
  const { id } = req.params;
  const format = String(req.query.format || "json").toLowerCase();
  try {
    const client = await prisma.client.findUnique({ where: { id } });
    if (!client) return res.status(404).json({ error: "Client not found" });
    const payload = await buildClientKpiPayload(client);

    if (format === "csv") {
      const csv = toCsv([{
        client: payload.client.name,
        teamId: payload.client.teamId,
        generatedAt: payload.generatedAt,
        totalTasks: payload.kpis.totalTasks,
        wip: payload.kpis.wip,
        completed: payload.kpis.completed,
        overdueOpen: payload.kpis.overdueOpen,
        throughputWeek: payload.kpis.throughputWeek,
        leadTimeAvgHours: payload.kpis.leadTimeAvgHours,
        cycleTimeAvgHours: payload.kpis.cycleTimeAvgHours,
        slaCompliancePct: payload.kpis.slaCompliancePct,
      }]);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="kpi_${payload.client.dashboardSlug || payload.client.id}.csv"`);
      return res.send(csv);
    }
    return res.json(payload);
  } catch (error) {
    return res.status(500).json({ error: "Failed to export KPI", details: error.message });
  }
});

registerRoute("post", "/clients/:id/kpi/send", async (req, res) => {
  const { id } = req.params;
  const { channel, target, format = "json", webhookUrl } = req.body || {};
  try {
    const client = await prisma.client.findUnique({ where: { id } });
    if (!client) return res.status(404).json({ error: "Client not found" });
    const payload = await buildClientKpiPayload(client);

    const normalizedChannel = normalizeAlertChannel(channel || client.alertChannel || (webhookUrl || client.webhookUrl ? "webhook" : null));
    const resolvedTarget = normalizeAlertTarget(
      normalizedChannel,
      target || client.alertTarget,
      webhookUrl || client.webhookUrl
    );
    const targetError = validateAlertTarget(normalizedChannel, resolvedTarget);
    if (!normalizedChannel || !resolvedTarget) {
      return res.status(400).json({ error: "Missing channel/target", details: "Set channel and target before sending KPI" });
    }
    if (targetError) {
      return res.status(400).json({ error: targetError });
    }

    const summaryMessage = [
      `KPI ${client.name}`,
      `WIP: ${payload.kpis.wip}`,
      `Throughput7d: ${payload.kpis.throughputWeek}`,
      `LeadTime(h): ${payload.kpis.leadTimeAvgHours ?? "--"}`,
      `CycleTime(h): ${payload.kpis.cycleTimeAvgHours ?? "--"}`,
      `SLA(%): ${payload.kpis.slaCompliancePct ?? "--"}`,
    ].join(" | ");

    let dispatchPayload = payload;
    if (String(format).toLowerCase() === "csv") {
      dispatchPayload = {
        csv: toCsv([{
          client: payload.client.name,
          teamId: payload.client.teamId,
          generatedAt: payload.generatedAt,
          totalTasks: payload.kpis.totalTasks,
          wip: payload.kpis.wip,
          completed: payload.kpis.completed,
          overdueOpen: payload.kpis.overdueOpen,
          throughputWeek: payload.kpis.throughputWeek,
          leadTimeAvgHours: payload.kpis.leadTimeAvgHours,
          cycleTimeAvgHours: payload.kpis.cycleTimeAvgHours,
          slaCompliancePct: payload.kpis.slaCompliancePct,
        }]),
      };
    }

    const result = await dispatchChannelMessage({
      channel: normalizedChannel,
      target: resolvedTarget,
      subject: `KPI export - ${client.name}`,
      message: summaryMessage,
      payload: dispatchPayload,
    });

    if (!result.delivered) {
      return res.status(400).json({ error: "KPI dispatch failed", details: result.reason || "unknown_reason" });
    }

    return res.json({
      message: "KPI sent",
      channel: normalizedChannel,
      target: resolvedTarget,
      generatedAt: payload.generatedAt,
      kpis: payload.kpis,
    });
  } catch (error) {
    return res.status(500).json({ error: "Failed to send KPI", details: error.message });
  }
});

registerRoute("get", "/dashboard", async (req, res) => {
  const tokenFromHeader = normalizeToken(req.headers.authorization);
  const tokenFromQuery = normalizeToken(typeof req.query.token === "string" ? req.query.token : "");
  const teamIdFromQuery = String(req.query.teamId || "").trim();
  const slugFromQuery = typeof req.query.slug === "string" ? slugify(req.query.slug) : null;

  let token = tokenFromHeader || tokenFromQuery;
  let client = null;
  if (token) {
    client = await prisma.client.findUnique({ where: { clickupToken: token } });
  } else if (slugFromQuery) {
    client = await prisma.client.findUnique({ where: { dashboardSlug: slugFromQuery } });
    token = client?.clickupToken || null;
  } else {
    return res.status(401).json({ error: "Missing access key (token or slug)" });
  }

  if (!client) {
    return res.status(404).json({ error: "Client dashboard not found", details: "Use a valid token or registered slug" });
  }

  const startedAt = Date.now();
  try {
    let teamId = teamIdFromQuery || client.clickupTeamId;
    if (!teamId) {
      const resolved = await resolveTeamId(token, null);
      teamId = resolved.teamId;
    }
    const tasks = await fetchTeamTasks(token, teamId);
    const dashboardPayload = buildMetrics(tasks);
    const updatedClient = await prisma.client.update({
      where: { id: client.id },
      data: { status: STATUS.CONNECTED, clickupTeamId: teamId },
    });
    await markHealthSuccess(client.id, Date.now() - startedAt).catch(() => null);
    return res.json({
      generatedAt: new Date().toISOString(),
      client: {
        id: updatedClient.id,
        name: updatedClient.name,
        teamId: updatedClient.clickupTeamId,
        dashboardSlug: updatedClient.dashboardSlug,
        status: updatedClient.status,
      },
      ...dashboardPayload,
    });
  } catch (error) {
    const errorMessage = error?.response?.data?.error || error?.message || "dashboard_failed";
    const failedClient = await markHealthFailure(client.id, errorMessage).catch(() => null);
    if (failedClient) await emitFailureAlertIfNeeded(failedClient, errorMessage).catch(() => null);
    const payload = buildErrorPayload(error, "Failed to generate dashboard");
    return res.status(payload.statusCode).json({ error: payload.error, details: payload.details });
  }
});

async function runBackgroundWarmup() {
  try {
    const activeClients = await prisma.client.findMany({
      where: { status: STATUS.CONNECTED },
      take: 10,
      orderBy: { updatedAt: "desc" },
    });
    await Promise.all(activeClients.map((client) => warmupPrimaryDashboard(client).catch(() => null)));
    console.log(`[Warmup] started for ${activeClients.length} connected clients`);
  } catch (error) {
    console.error("[Warmup] failed:", error.message);
  }
}

async function runHealthMonitor() {
  try {
    const trackedClients = await prisma.client.findMany({
      where: {
        OR: [{ status: STATUS.CONNECTED }, { consecutiveFailures: { gt: 0 } }],
      },
      take: 25,
      orderBy: { updatedAt: "desc" },
    });
    for (const client of trackedClients) {
      await runClientHealthCheck(client, { allowAutoRecover: true });
    }
  } catch (error) {
    console.error("[HealthMonitor] failed:", error.message);
  }
}

app.listen(PORT, () => {
  console.log(`GERENTE.CENTRAL backend running on port ${PORT}`);
  setInterval(() => {
    runBackgroundWarmup().catch(() => null);
  }, WARMUP_MS);
  setInterval(() => {
    runHealthMonitor().catch(() => null);
  }, HEALTH_MONITOR_MS);
});

process.on("SIGINT", async () => {
  await prisma.$disconnect();
  process.exit(0);
});
