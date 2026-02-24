import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AlertTriangle, Moon, RefreshCcw, Sun } from "lucide-react";
import {
  type CapacityPoint,
  type DashboardDetailRow,
  type NavigationNode,
  type ScopeType,
} from "./services/api";
import { useClickUpData } from "./hooks/useClickUpData";
import {
  HorizontalBarChartKpi,
  TrendComparisonChart,
  TrendSparkline,
  ValueTrend,
  VerticalBarChartKpi,
} from "./components/charts/TaskCharts";
import { ChartSkeleton, MetricSkeleton } from "./components/Skeleton";
import "./native-dashboard.css";

const FIXED_REFRESH_MS = 3000;
const PERIOD_OPTIONS = [7, 14, 30, 60, 90, 180, 365];
const THEME_STORAGE_KEY = "clickup_dashboard_theme";
const HELP_TEXT = {
  trendThroughput:
    "Mostra a quantidade de tarefas concluidas por dia e compara com o periodo anterior para indicar aceleracao ou queda do fluxo.",
  executiveReading:
    "Resumo de operacao para leitura rapida: volume atual, fila, entregas e risco de atraso.",
  summaryWip:
    "Total de tarefas abertas em andamento no escopo e filtros atuais.",
  summaryBacklog:
    "Total de tarefas ainda nao iniciadas; quando sobe, a fila de entrada esta aumentando.",
  summaryThroughput:
    "Entregas realizadas na semana. Serve para medir capacidade real de conclusao.",
  summaryOverdue:
    "Quantidade de tarefas abertas que ja passaram do vencimento.",
  insightSla:
    "Percentual de tarefas com prazo cumprido entre as tarefas que possuem vencimento.",
  insightRework:
    "Proxy de retrabalho: tarefas abertas que ja tiveram fechamento anterior.",
  insightLead:
    "Tempo medio de ponta a ponta da tarefa (entrada ate conclusao).",
  insightCycle:
    "Tempo medio de execucao ativa da tarefa (inicio real ate conclusao).",
  insightCoverage:
    "Percentual da base filtrada em relacao ao total do escopo atual.",
  metricWip:
    "Tarefas abertas em execucao neste momento.",
  metricBacklog:
    "Tarefas que ainda nao entraram em execucao.",
  metricDoneToday:
    "Tarefas concluidas no dia de hoje.",
  metricDoneWeek:
    "Tarefas concluidas desde o inicio da semana.",
  metricOverdue:
    "Tarefas abertas com vencimento ultrapassado.",
  metricOverduePct:
    "Percentual de atrasadas dentro da base filtrada.",
  metricCriticalQueue:
    "Volume de fila nas prioridades criticas P0 e P1.",
  metricBaseTotal:
    "Total de tarefas consideradas no dashboard apos aplicar escopo e filtros.",
  processFlowByDay:
    "Compara movimento atual vs periodo anterior para mostrar mudanca de ritmo no processo.",
  processStatusDistribution:
    "Distribuicao de tarefas abertas por status para identificar concentracao e gargalo.",
  processAssigneeLoad:
    "Carga de tarefas abertas por responsavel no processo selecionado.",
  processStageDistribution:
    "Participacao de cada etapa no total do processo.",
  panelWipByStatus:
    "Volume em aberto por status no escopo atual; ajuda a localizar o gargalo principal.",
  panelOverdueByAssignee:
    "Concentracao de tarefas atrasadas por responsavel para priorizacao de acao.",
  panelPriorityQueue:
    "Fila atual por nivel de prioridade para orientar alocacao de esforco.",
  kpiTotal:
    "Total de tarefas no bloco atual.",
  kpiOpen:
    "Quantidade de tarefas abertas no bloco atual.",
  kpiClosed:
    "Quantidade de tarefas concluidas no bloco atual.",
  kpiOverdue:
    "Quantidade de tarefas abertas e vencidas no bloco atual.",
  kpiStageTime:
    "Tempo medio que as tarefas estao permanecendo na etapa/status atual.",
} as const;

type DashboardTheme = "dark" | "light";

function resolveInitialTheme(): DashboardTheme {
  if (typeof window === "undefined") return "dark";

  try {
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (storedTheme === "light" || storedTheme === "dark") {
      return storedTheme;
    }
  } catch {
    // Ignore storage restrictions.
  }

  if (typeof window.matchMedia === "function") {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }

  return "dark";
}

interface ScopeOption {
  key: string;
  label: string;
  type: ScopeType;
  id: string | null;
}

interface SparkPoint {
  label: string;
  current: number | null;
  previous: number | null;
}

interface PipelineStagePoint {
  status: string;
  value: number;
  overdue: number;
}

interface PipelineAssigneePoint {
  assignee: string;
  value: number;
  overdue: number;
}

type PipelineTaskFilter = "total" | "open" | "closed" | "overdue";

interface PipelineTaskItem {
  id: string;
  name: string;
  url: string | null;
  status: string;
  statusType: string;
  priority: string;
  category: string;
  assignee: string;
  isClosed: boolean;
  isOverdue: boolean;
  updatedAt: string | null;
  dueAt: string | null;
  statusAgeHours: number;
}

interface PipelineBlock {
  id: string;
  label: string;
  hierarchy: string;
  total: number;
  open: number;
  closed: number;
  overdue: number;
  completionPct: number;
  trend: SparkPoint[];
  stages: PipelineStagePoint[];
  assignees: PipelineAssigneePoint[];
  tasks: PipelineTaskItem[];
}

interface PipelineAccumulator {
  id: string;
  label: string;
  hierarchy: string;
  total: number;
  open: number;
  closed: number;
  overdue: number;
  stageMap: Map<string, PipelineStagePoint>;
  assigneeMap: Map<string, PipelineAssigneePoint>;
  eventsByDay: Map<string, number>;
  tasks: PipelineTaskItem[];
}

interface PipelineCatalogEntry {
  id: string;
  label: string;
  hierarchy: string;
}

interface PipelineTaskModalState {
  blockId: string;
  filter: PipelineTaskFilter;
}

type DashboardMainView = "resumo" | "pessoas";

interface AssigneeStatusPoint {
  status: string;
  value: number;
  overdue: number;
}

interface AssigneeMetricsBlock {
  id: string;
  hierarchy: string;
  assignee: string;
  total: number;
  open: number;
  closed: number;
  overdue: number;
  highPriority: number;
  avgStatusAgeHours: number;
  completionPct: number;
  trend: SparkPoint[];
  statusBreakdown: AssigneeStatusPoint[];
  loadScore: number | null;
  capacityWip: number | null;
  capacityOverdue: number | null;
  capacityHighPriority: number | null;
  tasks: PipelineTaskItem[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

const toNumberOrNull = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeLabel = (value: string | null | undefined, fallback: string): string => {
  const normalized = String(value || "").trim();
  return normalized || fallback;
};

const normalizeIdLabel = (value: string): string => {
  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "sem-responsavel";
};

const parseDateMs = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const toDayKey = (ms: number): string => {
  const date = new Date(ms);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const toDayLabel = (ms: number): string =>
  new Date(ms).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  });

const buildPairSparkline = (current: number | null, previous: number | null): SparkPoint[] => {
  if (!Number.isFinite(current) && !Number.isFinite(previous)) return [];
  const safeCurrent = Number.isFinite(current) ? Number(current) : Number(previous || 0);
  const safePrevious = Number.isFinite(previous) ? Number(previous) : safeCurrent;
  return Array.from({ length: 8 }).map((_, index) => {
    const progress = index / 7;
    return {
      label: String(index + 1),
      current: Number((safePrevious + (safeCurrent - safePrevious) * progress).toFixed(4)),
      previous: safePrevious,
    };
  });
};

const flattenScopes = (nodes: NavigationNode[], depth = 0): ScopeOption[] => {
  const result: ScopeOption[] = [];
  nodes.forEach((node) => {
    result.push({
      key: `${node.scopeType}:${node.scopeId || "all"}`,
      label: `${" ".repeat(depth * 2)}${node.label}`,
      type: node.scopeType,
      id: node.scopeId,
    });
    if (node.children?.length) {
      result.push(...flattenScopes(node.children, depth + 1));
    }
  });
  return result;
};

const buildPipelineCatalog = (nodes: NavigationNode[]): PipelineCatalogEntry[] => {
  if (!Array.isArray(nodes) || nodes.length === 0) return [];

  const catalog = new Map<string, PipelineCatalogEntry>();

  const visitNode = (
    node: NavigationNode,
    context: { space: string; folder: string | null }
  ) => {
    const label = normalizeLabel(node.label, "Sem nome");
    let nextContext = context;

    if (node.scopeType === "space") {
      nextContext = { space: label, folder: null };
    } else if (node.scopeType === "folder") {
      nextContext = { space: context.space, folder: label };
    } else if (node.scopeType === "list" && node.scopeId) {
      const id = `list:${String(node.scopeId)}`;
      if (!catalog.has(id)) {
        const hierarchy = context.folder
          ? `${normalizeLabel(context.space, "Sem espaco")} / ${context.folder}`
          : normalizeLabel(context.space, "Sem espaco");
        catalog.set(id, {
          id,
          label,
          hierarchy,
        });
      }
    }

    (node.children || []).forEach((child) => visitNode(child, nextContext));
  };

  nodes.forEach((node) => visitNode(node, { space: "Sem espaco", folder: null }));
  return Array.from(catalog.values());
};

const formatDateTime = (value?: string | null): string => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("pt-BR");
};

const resolvePipelineIdentity = (row: DashboardDetailRow): { id: string; label: string; hierarchy: string } => {
  const listId = normalizeLabel(row.listId, "");
  const folderId = normalizeLabel(row.folderId, "");
  const spaceId = normalizeLabel(row.spaceId, "");

  if (listId || row.list) {
    return {
      id: `list:${listId || normalizeLabel(row.list, "sem-lista")}`,
      label: normalizeLabel(row.list, "Lista sem nome"),
      hierarchy: `${normalizeLabel(row.space, "Sem espaco")} / ${normalizeLabel(row.folder, "Sem pasta")}`,
    };
  }

  if (folderId || row.folder) {
    return {
      id: `folder:${folderId || normalizeLabel(row.folder, "sem-pasta")}`,
      label: normalizeLabel(row.folder, "Pasta sem nome"),
      hierarchy: normalizeLabel(row.space, "Sem espaco"),
    };
  }

  return {
    id: `space:${spaceId || normalizeLabel(row.space, "sem-espaco")}`,
    label: normalizeLabel(row.space, "Espaco sem nome"),
    hierarchy: "Nivel espaco",
  };
};

const resolveEventMs = (row: DashboardDetailRow): number | null =>
  parseDateMs(row.statusChangedAt) ??
  parseDateMs(row.updatedAt) ??
  parseDateMs(row.referenceAt) ??
  parseDateMs(row.createdAt);

const buildPipelineBlocks = (rows: DashboardDetailRow[], periodDays: number): PipelineBlock[] => {
  if (!rows.length) return [];

  const spanDays = Math.max(3, Math.min(periodDays, 14));
  const nowMs = Date.now();
  const accumulator = new Map<string, PipelineAccumulator>();

  rows.forEach((row) => {
    const identity = resolvePipelineIdentity(row);
    const existing = accumulator.get(identity.id);
    const item: PipelineAccumulator =
      existing ||
      {
        id: identity.id,
        label: identity.label,
        hierarchy: identity.hierarchy,
        total: 0,
        open: 0,
        closed: 0,
        overdue: 0,
        stageMap: new Map(),
        assigneeMap: new Map(),
        eventsByDay: new Map(),
        tasks: [],
      };

    item.total += 1;
    if (row.isClosed) item.closed += 1;
    else item.open += 1;
    if (row.isOverdue) item.overdue += 1;

    const stageKey = normalizeLabel(row.status, "Sem status");
    const stage = item.stageMap.get(stageKey) || { status: stageKey, value: 0, overdue: 0 };
    stage.value += 1;
    if (row.isOverdue) stage.overdue += 1;
    item.stageMap.set(stageKey, stage);

    const assigneeKey = normalizeLabel(row.assignee, "Nao atribuido");
    const assignee = item.assigneeMap.get(assigneeKey) || { assignee: assigneeKey, value: 0, overdue: 0 };
    if (!row.isClosed) assignee.value += 1;
    if (row.isOverdue) assignee.overdue += 1;
    item.assigneeMap.set(assigneeKey, assignee);

    item.tasks.push({
      id: row.id,
      name: normalizeLabel(row.name, "Sem titulo"),
      url: row.url || null,
      status: normalizeLabel(row.status, "Sem status"),
      statusType: normalizeLabel(row.statusType, "custom"),
      priority: normalizeLabel(row.priority, "Sem prioridade"),
      category: normalizeLabel(row.category, "Sem categoria"),
      assignee: assigneeKey,
      isClosed: Boolean(row.isClosed),
      isOverdue: Boolean(row.isOverdue),
      updatedAt: row.updatedAt || row.referenceAt || null,
      dueAt: row.dueAt || null,
      statusAgeHours: Number.isFinite(row.statusAgeHours) ? row.statusAgeHours : 0,
    });

    const eventMs = resolveEventMs(row);
    if (eventMs !== null) {
      const dayKey = toDayKey(eventMs);
      item.eventsByDay.set(dayKey, (item.eventsByDay.get(dayKey) || 0) + 1);
    }

    if (!existing) accumulator.set(identity.id, item);
  });

  const blocks = Array.from(accumulator.values()).map((item): PipelineBlock => {
    const rawTrend: SparkPoint[] = Array.from({ length: spanDays }).map((_, index) => {
      const offset = spanDays - index - 1;
      const currentMs = nowMs - offset * DAY_MS;
      const previousMs = nowMs - (offset + spanDays) * DAY_MS;
      return {
        label: toDayLabel(currentMs),
        current: item.eventsByDay.get(toDayKey(currentMs)) || 0,
        previous: item.eventsByDay.get(toDayKey(previousMs)) || 0,
      };
    });

    const hasCurrent = rawTrend.some((point) => Number(point.current || 0) > 0);
    const hasPrevious = rawTrend.some((point) => Number(point.previous || 0) > 0);

    const trend: SparkPoint[] =
      hasCurrent && !hasPrevious
        ? rawTrend.map((point, index) => ({
            label: point.label,
            current: point.current,
            previous: index === 0 ? rawTrend[0].current : rawTrend[index - 1].current,
          }))
        : rawTrend;

    const stages = Array.from(item.stageMap.values()).sort((a, b) => {
      if (b.value !== a.value) return b.value - a.value;
      return a.status.localeCompare(b.status);
    });

    const assignees = Array.from(item.assigneeMap.values())
      .filter((entry) => entry.value > 0 || entry.overdue > 0)
      .sort((a, b) => {
        if (b.overdue !== a.overdue) return b.overdue - a.overdue;
        if (b.value !== a.value) return b.value - a.value;
        return a.assignee.localeCompare(b.assignee);
      });

    const completionPct = item.total > 0 ? Number(((item.closed / item.total) * 100).toFixed(1)) : 0;

    return {
      id: item.id,
      label: item.label,
      hierarchy: item.hierarchy,
      total: item.total,
      open: item.open,
      closed: item.closed,
      overdue: item.overdue,
      completionPct,
      trend,
      stages,
      assignees,
      tasks: item.tasks,
    };
  });

  blocks.sort((a, b) => {
    if (b.overdue !== a.overdue) return b.overdue - a.overdue;
    if (b.open !== a.open) return b.open - a.open;
    return b.total - a.total;
  });

  return blocks;
};

const buildEmptyPipelineBlock = (entry: PipelineCatalogEntry, periodDays: number): PipelineBlock => {
  const spanDays = Math.max(3, Math.min(periodDays, 14));
  const nowMs = Date.now();
  const trend: SparkPoint[] = Array.from({ length: spanDays }).map((_, index) => {
    const offset = spanDays - index - 1;
    const currentMs = nowMs - offset * DAY_MS;
    return {
      label: toDayLabel(currentMs),
      current: 0,
      previous: 0,
    };
  });

  return {
    id: entry.id,
    label: entry.label,
    hierarchy: entry.hierarchy,
    total: 0,
    open: 0,
    closed: 0,
    overdue: 0,
    completionPct: 0,
    trend,
    stages: [],
    assignees: [],
    tasks: [],
  };
};

const stageColor = (status: string): string => {
  const normalized = String(status || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

  if (
    normalized.includes("pronto") ||
    normalized.includes("aprovad") ||
    normalized.includes("liberad") ||
    normalized.includes("done") ||
    normalized.includes("closed") ||
    normalized.includes("conclu")
  ) {
    return "#22c55e"; // verde (etapas finais)
  }

  if (
    normalized.includes("recebid") ||
    normalized.includes("na fila") ||
    normalized.includes("fila") ||
    normalized.includes("queue") ||
    normalized.includes("backlog")
  ) {
    return "#f97316"; // laranja (entrada/fila)
  }

  if (
    normalized.includes("validacao financeira") ||
    normalized.includes("validacao/financeira") ||
    normalized.includes("financeir")
  ) {
    return "#f59e0b"; // amarelo/ambar (validacao financeira)
  }

  if (
    normalized.includes("trabalhand") ||
    normalized.includes("andamento") ||
    normalized.includes("progress") ||
    normalized.includes("doing")
  ) {
    return "#06b6d4"; // ciano (execucao)
  }

  if (
    normalized.includes("a fazer") ||
    normalized.includes("afazer") ||
    normalized.includes("to do") ||
    normalized.includes("todo")
  ) {
    return "#ef4444"; // vermelho (inicio)
  }

  if (normalized.includes("atras") || normalized.includes("overdue") || normalized.includes("blocked")) {
    return "#ef4444"; // vermelho (risco)
  }

  return "#a78bfa";
};

const PIPELINE_FILTER_LABEL: Record<PipelineTaskFilter, string> = {
  total: "Total",
  open: "Abertas",
  closed: "Concluidas",
  overdue: "Atrasadas",
};

const PIPELINE_FILTER_DESCRIPTION: Record<PipelineTaskFilter, string> = {
  total: "todas as tarefas do processo",
  open: "somente tarefas em aberto",
  closed: "somente tarefas concluidas",
  overdue: "tarefas com prazo vencido",
};

const filterPipelineTasks = (tasks: PipelineTaskItem[], filter: PipelineTaskFilter): PipelineTaskItem[] => {
  if (filter === "open") return tasks.filter((task) => !task.isClosed);
  if (filter === "closed") return tasks.filter((task) => task.isClosed);
  if (filter === "overdue") return tasks.filter((task) => task.isOverdue);
  return tasks;
};

const sortPipelineTasks = (tasks: PipelineTaskItem[]): PipelineTaskItem[] =>
  [...tasks].sort((a, b) => {
    if (Number(b.isOverdue) !== Number(a.isOverdue)) return Number(b.isOverdue) - Number(a.isOverdue);
    if (Number(a.isClosed) !== Number(b.isClosed)) return Number(a.isClosed) - Number(b.isClosed);
    const dueA = parseDateMs(a.dueAt);
    const dueB = parseDateMs(b.dueAt);
    if (dueA !== null && dueB !== null && dueA !== dueB) return dueA - dueB;
    if (dueA !== null && dueB === null) return -1;
    if (dueA === null && dueB !== null) return 1;
    const updatedA = parseDateMs(a.updatedAt) || 0;
    const updatedB = parseDateMs(b.updatedAt) || 0;
    return updatedB - updatedA;
  });

const formatHoursWindow = (hours: number): string => {
  if (!Number.isFinite(hours) || hours <= 0) return "0h";
  if (hours >= 24 * 7) return `${(hours / (24 * 7)).toFixed(1)} sem`;
  if (hours >= 24) return `${(hours / 24).toFixed(1)} d`;
  return `${hours.toFixed(1)} h`;
};

const isHighPriorityTask = (priority: string): boolean => {
  const normalized = priority.toLowerCase();
  return (
    normalized.includes("p0") ||
    normalized.includes("p1") ||
    normalized.includes("urg") ||
    normalized.includes("high") ||
    normalized.includes("alta")
  );
};

const resolveRowAssignees = (row: DashboardDetailRow): string[] => {
  const fromArray = (row.assignees || [])
    .map((name) => normalizeLabel(name, ""))
    .filter(Boolean);

  if (fromArray.length) {
    return Array.from(new Set(fromArray));
  }

  const fallback = normalizeLabel(row.assignee, "");
  if (!fallback) return ["Sem responsavel"];

  const parsed = fallback
    .split(",")
    .map((name) => normalizeLabel(name, ""))
    .filter((name) => name && name.toLowerCase() !== "sem responsavel");

  if (!parsed.length) return ["Sem responsavel"];
  return Array.from(new Set(parsed));
};

const buildAssigneeMetrics = (
  rows: DashboardDetailRow[],
  periodDays: number,
  capacityByAssignee: CapacityPoint[]
): AssigneeMetricsBlock[] => {
  if (!rows.length) return [];

  const nowMs = Date.now();
  const spanDays = Math.max(7, Math.min(periodDays, 14));
  const capacityMap = new Map<string, CapacityPoint>();

  (capacityByAssignee || []).forEach((entry) => {
    const key = normalizeLabel(entry.assignee, "Sem responsavel");
    capacityMap.set(key, entry);
  });

  const accumulator = new Map<
    string,
    {
      assignee: string;
      total: number;
      open: number;
      closed: number;
      overdue: number;
      highPriority: number;
      statusAgeSum: number;
      statusAgeSamples: number;
      statusMap: Map<string, AssigneeStatusPoint>;
      eventsByDay: Map<string, number>;
      tasks: PipelineTaskItem[];
    }
  >();

  rows.forEach((row) => {
    const assignees = resolveRowAssignees(row);

    assignees.forEach((assignee) => {
      const bucket =
        accumulator.get(assignee) ||
        {
          assignee,
          total: 0,
          open: 0,
          closed: 0,
          overdue: 0,
          highPriority: 0,
          statusAgeSum: 0,
          statusAgeSamples: 0,
          statusMap: new Map<string, AssigneeStatusPoint>(),
          eventsByDay: new Map<string, number>(),
          tasks: [],
        };

      bucket.total += 1;
      if (row.isClosed) bucket.closed += 1;
      else bucket.open += 1;
      if (row.isOverdue) bucket.overdue += 1;
      if (isHighPriorityTask(normalizeLabel(row.priority, ""))) bucket.highPriority += 1;
      if (Number.isFinite(row.statusAgeHours) && row.statusAgeHours > 0) {
        bucket.statusAgeSum += row.statusAgeHours;
        bucket.statusAgeSamples += 1;
      }

      const statusKey = normalizeLabel(row.status, "Sem status");
      const statusEntry =
        bucket.statusMap.get(statusKey) || { status: statusKey, value: 0, overdue: 0 };
      statusEntry.value += 1;
      if (row.isOverdue) statusEntry.overdue += 1;
      bucket.statusMap.set(statusKey, statusEntry);

      bucket.tasks.push({
        id: row.id,
        name: normalizeLabel(row.name, "Sem titulo"),
        url: row.url || null,
        status: normalizeLabel(row.status, "Sem status"),
        statusType: normalizeLabel(row.statusType, "custom"),
        priority: normalizeLabel(row.priority, "Sem prioridade"),
        category: normalizeLabel(row.category, "Sem categoria"),
        assignee,
        isClosed: Boolean(row.isClosed),
        isOverdue: Boolean(row.isOverdue),
        updatedAt: row.updatedAt || row.referenceAt || null,
        dueAt: row.dueAt || null,
        statusAgeHours: Number.isFinite(row.statusAgeHours) ? row.statusAgeHours : 0,
      });

      const eventMs = resolveEventMs(row);
      if (eventMs !== null) {
        const key = toDayKey(eventMs);
        bucket.eventsByDay.set(key, (bucket.eventsByDay.get(key) || 0) + 1);
      }

      if (!accumulator.has(assignee)) {
        accumulator.set(assignee, bucket);
      }
    });
  });

  return Array.from(accumulator.values())
    .map((item): AssigneeMetricsBlock => {
      const rawTrend: SparkPoint[] = Array.from({ length: spanDays }).map((_, index) => {
        const offset = spanDays - index - 1;
        const currentMs = nowMs - offset * DAY_MS;
        const previousMs = nowMs - (offset + spanDays) * DAY_MS;
        return {
          label: toDayLabel(currentMs),
          current: item.eventsByDay.get(toDayKey(currentMs)) || 0,
          previous: item.eventsByDay.get(toDayKey(previousMs)) || 0,
        };
      });

      const hasCurrent = rawTrend.some((point) => Number(point.current || 0) > 0);
      const hasPrevious = rawTrend.some((point) => Number(point.previous || 0) > 0);
      const trend: SparkPoint[] =
        hasCurrent && !hasPrevious
          ? rawTrend.map((point, index) => ({
              label: point.label,
              current: point.current,
              previous: index === 0 ? rawTrend[0].current : rawTrend[index - 1].current,
            }))
          : rawTrend;

      const statusBreakdown = Array.from(item.statusMap.values()).sort((a, b) => {
        if (b.value !== a.value) return b.value - a.value;
        return a.status.localeCompare(b.status);
      });

      const completionPct =
        item.total > 0 ? Number(((item.closed / item.total) * 100).toFixed(1)) : 0;
      const avgStatusAgeHours =
        item.statusAgeSamples > 0 ? Number((item.statusAgeSum / item.statusAgeSamples).toFixed(2)) : 0;

      const capacity = capacityMap.get(item.assignee);

      return {
        id: `assignee:${normalizeIdLabel(item.assignee)}`,
        hierarchy: "Metricas por responsavel",
        assignee: item.assignee,
        total: item.total,
        open: item.open,
        closed: item.closed,
        overdue: item.overdue,
        highPriority: item.highPriority,
        avgStatusAgeHours,
        completionPct,
        trend,
        statusBreakdown,
        loadScore: capacity ? toNumberOrNull(capacity.loadScore) : null,
        capacityWip: capacity ? toNumberOrNull(capacity.wip) : null,
        capacityOverdue: capacity ? toNumberOrNull(capacity.overdue) : null,
        capacityHighPriority: capacity ? toNumberOrNull(capacity.highPriority) : null,
        tasks: item.tasks,
      };
    })
    .sort((a, b) => {
      if (b.overdue !== a.overdue) return b.overdue - a.overdue;
      if (b.open !== a.open) return b.open - a.open;
      if (b.total !== a.total) return b.total - a.total;
      return a.assignee.localeCompare(b.assignee);
    });
};

const resolvePriorityClass = (priority: string): string => {
  const normalized = priority.toLowerCase();
  if (normalized.includes("urg") || normalized.includes("p0")) return "border-rose-500/40 bg-rose-500/12 text-rose-300";
  if (normalized.includes("alta") || normalized.includes("high") || normalized.includes("p1")) return "border-amber-500/40 bg-amber-500/12 text-amber-300";
  if (normalized.includes("normal") || normalized.includes("m")) return "border-cyan-500/40 bg-cyan-500/12 text-cyan-300";
  return "border-white/20 bg-white/5 text-slate-300";
};

function NativeDashboardApp() {
  const refreshMs = FIXED_REFRESH_MS;
  const [theme, setTheme] = useState<DashboardTheme>(resolveInitialTheme);
  const [activeView, setActiveView] = useState<DashboardMainView>("resumo");
  const [assigneeSearch, setAssigneeSearch] = useState("");
  const [dashboardFilters, setDashboardFilters] = useState({
    periodDays: 30,
    status: "",
    category: "",
    assignee: "",
    priority: "",
    page: 1,
    pageSize: 5000,
  });
  const [selectedPipelineId, setSelectedPipelineId] = useState("all");
  const [pipelineTaskModal, setPipelineTaskModal] = useState<PipelineTaskModalState | null>(null);

  const {
    teams,
    selectedTeam,
    selectedTeamId,
    dashboard,
    navigationTree,
    selectedScope,
    loading,
    error,
    lastSyncAt,
    isSyncing,
    changeTeam,
    changeScope,
    refreshNow,
  } = useClickUpData(refreshMs, dashboardFilters);

  useEffect(() => {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Ignore storage restrictions.
    }
  }, [theme]);

  const scopeOptions = useMemo(() => flattenScopes(navigationTree), [navigationTree]);
  const pipelineCatalog = useMemo(() => buildPipelineCatalog(navigationTree), [navigationTree]);
  const scopeKey = `${selectedScope.type}:${selectedScope.id || "all"}`;
  const scopeOptionsSafe = useMemo(
    () =>
      scopeOptions.length
        ? scopeOptions
        : [
            {
              key: scopeKey,
              label: selectedScope.label,
              type: selectedScope.type,
              id: selectedScope.id,
            },
          ],
    [scopeKey, scopeOptions, selectedScope.id, selectedScope.label, selectedScope.type]
  );

  const throughputTrendData = useMemo(() => {
    const current = dashboard?.throughput?.daily || [];
    const previous = dashboard?.throughput?.dailyPrevious || [];
    const maxLength = Math.max(current.length, previous.length);
    return Array.from({ length: maxLength }).map((_, index) => ({
      label: current[index]?.label || previous[index]?.label || String(index + 1),
      value: toNumberOrNull(current[index]?.value),
      baselineValue: toNumberOrNull(previous[index]?.value),
    }));
  }, [dashboard]);

  const throughputSparkData = useMemo(
    () =>
      throughputTrendData.map((item) => ({
        label: item.label,
        current: item.value,
        previous: item.baselineValue,
      })),
    [throughputTrendData]
  );

  const detailRows = useMemo(() => dashboard?.details?.rows || [], [dashboard?.details?.rows]);
  const capacityByAssignee = useMemo(
    () => dashboard?.capacityByAssignee || [],
    [dashboard?.capacityByAssignee]
  );
  const peopleMetrics = useMemo(
    () =>
      buildAssigneeMetrics(
        detailRows,
        dashboardFilters.periodDays,
        capacityByAssignee
      ),
    [capacityByAssignee, dashboardFilters.periodDays, detailRows]
  );

  const visiblePeopleMetrics = useMemo(() => {
    const query = assigneeSearch.trim().toLowerCase();
    if (!query) return peopleMetrics;
    return peopleMetrics.filter((item) => item.assignee.toLowerCase().includes(query));
  }, [assigneeSearch, peopleMetrics]);

  const pipelineBlocks = useMemo(() => {
    const blocksFromRows = buildPipelineBlocks(detailRows, dashboardFilters.periodDays);
    if (!pipelineCatalog.length) return blocksFromRows;

    const blockById = new Map(blocksFromRows.map((block) => [block.id, block]));
    const merged: PipelineBlock[] = [];
    const seen = new Set<string>();

    pipelineCatalog.forEach((entry) => {
      const existing = blockById.get(entry.id);
      if (existing) {
        merged.push({
          ...existing,
          label: entry.label,
          hierarchy: entry.hierarchy,
        });
      } else {
        merged.push(buildEmptyPipelineBlock(entry, dashboardFilters.periodDays));
      }
      seen.add(entry.id);
    });

    blocksFromRows.forEach((block) => {
      if (!seen.has(block.id)) {
        merged.push(block);
      }
    });

    return merged;
  }, [detailRows, dashboardFilters.periodDays, pipelineCatalog]);

  const assigneePipelineBlocks = useMemo(
    () =>
      peopleMetrics.map(
        (person): PipelineBlock => ({
          id: person.id,
          label: person.assignee,
          hierarchy: person.hierarchy,
          total: person.total,
          open: person.open,
          closed: person.closed,
          overdue: person.overdue,
          completionPct: person.completionPct,
          trend: person.trend,
          stages: person.statusBreakdown.map((status) => ({
            status: status.status,
            value: status.value,
            overdue: status.overdue,
          })),
          assignees: [{ assignee: person.assignee, value: person.open, overdue: person.overdue }],
          tasks: person.tasks,
        })
      ),
    [peopleMetrics]
  );

  const taskModalBlockRegistry = useMemo(() => {
    const registry = new Map<string, PipelineBlock>();
    pipelineBlocks.forEach((block) => registry.set(block.id, block));
    assigneePipelineBlocks.forEach((block) => registry.set(block.id, block));
    return registry;
  }, [pipelineBlocks, assigneePipelineBlocks]);

  const resolvedSelectedPipelineId = useMemo(
    () =>
      selectedPipelineId === "all" || pipelineBlocks.some((block) => block.id === selectedPipelineId)
        ? selectedPipelineId
        : "all",
    [pipelineBlocks, selectedPipelineId]
  );

  const visiblePipelineBlocks = useMemo(() => {
    if (resolvedSelectedPipelineId === "all") return pipelineBlocks;
    return pipelineBlocks.filter((block) => block.id === resolvedSelectedPipelineId);
  }, [pipelineBlocks, resolvedSelectedPipelineId]);

  const activeModalBlock = useMemo(() => {
    if (!pipelineTaskModal) return null;
    return taskModalBlockRegistry.get(pipelineTaskModal.blockId) || null;
  }, [pipelineTaskModal, taskModalBlockRegistry]);

  const hasOpenModal = Boolean(pipelineTaskModal && activeModalBlock);

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (!hasOpenModal) {
      document.body.style.overflow = "";
      return;
    }

    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [hasOpenModal]);

  const updateFilter = useCallback(
    (key: "periodDays" | "status" | "category" | "assignee" | "priority", value: number | string) => {
      setDashboardFilters((current) => ({ ...current, [key]: value, page: 1 }));
    },
    []
  );

  if (loading && !dashboard) {
    return (
      <div className={`dashboard-root min-h-screen p-5 text-slate-100 md:p-10 ${theme === "light" ? "theme-light" : ""}`}>
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-5">
          {[1, 2, 3, 4, 5].map((item) => <MetricSkeleton key={item} />)}
        </div>
        <div className="mt-5"><ChartSkeleton /></div>
      </div>
    );
  }

  const counters = dashboard?.counters;
  const previous = dashboard?.countersPrevious;
  const dashboardHeaderTag = (dashboard?.team?.name || selectedTeam?.name || "Dashboard").trim();
  const totalTasks = Number(counters?.totalTasks || 0);
  const filteredTasks = Number(counters?.filteredTasks ?? counters?.totalTasks ?? 0);
  const scopedTasks = Number(counters?.scopedTasks || filteredTasks);
  const overdueTotal = Number(counters?.overdueTotal || 0);
  const doneToday = Number(dashboard?.throughput?.doneToday ?? counters?.doneToday ?? 0);
  const doneWeek = Number(dashboard?.throughput?.doneWeek ?? counters?.doneWeek ?? 0);
  const slaMet = Number(counters?.slaMet || 0);
  const slaBreached = Number(counters?.slaBreached || 0);
  const slaTotal = slaMet + slaBreached;
  const slaCompliancePct = slaTotal > 0 ? Number(((slaMet / slaTotal) * 100).toFixed(1)) : null;
  const overdueRatePct =
    filteredTasks > 0 ? Number(((overdueTotal / filteredTasks) * 100).toFixed(1)) : null;
  const scopeCoveragePct =
    scopedTasks > 0 ? Number(((filteredTasks / scopedTasks) * 100).toFixed(1)) : null;
  const reworkRatePct = toNumberOrNull(counters?.reworkRatePercent);
  const leadTimeDays = toNumberOrNull(dashboard?.leadTime?.avgDays);
  const cycleTimeDays = toNumberOrNull(dashboard?.cycleTime?.avgDays);
  const criticalPriorityQueue = (dashboard?.priorityQueue || []).reduce((sum, item) => {
    const priority = String(item.priority || "").toLowerCase();
    if (priority === "p0" || priority === "p1") {
      return sum + Number(item.value || 0);
    }
    return sum;
  }, 0);

  const compactInsights = [
    { label: "SLA", value: slaCompliancePct === null ? "--" : `${slaCompliancePct}%`, help: HELP_TEXT.insightSla },
    { label: "Retrabalho", value: reworkRatePct === null ? "--" : `${reworkRatePct.toFixed(1)}%`, help: HELP_TEXT.insightRework },
    { label: "Lead", value: leadTimeDays === null ? "--" : `${leadTimeDays.toFixed(1)}d`, help: HELP_TEXT.insightLead },
    { label: "Cycle", value: cycleTimeDays === null ? "--" : `${cycleTimeDays.toFixed(1)}d`, help: HELP_TEXT.insightCycle },
    { label: "Cobertura", value: scopeCoveragePct === null ? "--" : `${scopeCoveragePct}%`, help: HELP_TEXT.insightCoverage },
  ];

  const executiveMetrics = [
    { title: "Em andamento", value: String(counters?.wipTotal ?? 0), help: HELP_TEXT.metricWip },
    { title: "Fila de entrada", value: String(counters?.backlog ?? 0), help: HELP_TEXT.metricBacklog },
    { title: "Concluidas hoje", value: String(doneToday), help: HELP_TEXT.metricDoneToday },
    { title: "Concluidas semana", value: String(doneWeek), help: HELP_TEXT.metricDoneWeek },
    { title: "Atrasadas", value: String(overdueTotal), help: HELP_TEXT.metricOverdue },
    { title: "Atrasadas (%)", value: overdueRatePct === null ? "--" : `${overdueRatePct}%`, help: HELP_TEXT.metricOverduePct },
    { title: "Fila critica P0/P1", value: String(criticalPriorityQueue), help: HELP_TEXT.metricCriticalQueue },
    { title: "Base total", value: String(totalTasks), help: HELP_TEXT.metricBaseTotal },
  ];

  const summaryCards = [
    {
      id: "wip",
      label: "Em andamento aberto",
      help: HELP_TEXT.summaryWip,
      value: Number(counters?.wipTotal || 0),
      prev: toNumberOrNull(previous?.wipTotal),
      color: "#00f3ff",
      note: "tarefas abertas",
      inverse: false,
      spark: buildPairSparkline(toNumberOrNull(counters?.wipTotal), toNumberOrNull(previous?.wipTotal)),
    },
    {
      id: "backlog",
      label: "Fila de entrada",
      help: HELP_TEXT.summaryBacklog,
      value: Number(counters?.backlog || 0),
      prev: toNumberOrNull(previous?.backlog),
      color: "#47a9ff",
      note: "nao iniciadas",
      inverse: false,
      spark: buildPairSparkline(toNumberOrNull(counters?.backlog), toNumberOrNull(previous?.backlog)),
    },
    {
      id: "throughput",
      label: "Vazao",
      help: HELP_TEXT.summaryThroughput,
      value: Number(counters?.doneWeek || 0),
      prev: toNumberOrNull(previous?.doneWeek),
      color: "#55e986",
      note: "concluidas na semana",
      inverse: false,
      spark: throughputSparkData,
    },
    {
      id: "overdue",
      label: "Atrasadas",
      help: HELP_TEXT.summaryOverdue,
      value: overdueTotal,
      prev: toNumberOrNull(previous?.overdueTotal),
      color: "#ff5f87",
      note: "vencidas abertas",
      inverse: true,
      spark: buildPairSparkline(toNumberOrNull(counters?.overdueTotal), toNumberOrNull(previous?.overdueTotal)),
    },
  ];

  return (
    <div className={`dashboard-root min-h-screen text-slate-100 ${theme === "light" ? "theme-light" : ""}`}>
      <div
        className={`pointer-events-none fixed inset-0 -z-10 ${
          theme === "light"
            ? "bg-[radial-gradient(circle_at_8%_9%,rgba(59,130,246,0.2),transparent_36%),radial-gradient(circle_at_86%_14%,rgba(15,23,42,0.11),transparent_34%),linear-gradient(180deg,#edf3fa_0%,#dde7f2_55%,#d1dce8_100%)]"
            : "bg-[radial-gradient(circle_at_15%_12%,rgba(96,165,250,0.15),transparent_36%),radial-gradient(circle_at_82%_18%,rgba(56,189,248,0.11),transparent_32%),#161b23]"
        }`}
      />
      <main className="mx-auto max-w-[1800px] space-y-4 p-3 sm:space-y-5 sm:p-4 md:space-y-6 md:p-8">
        <section className="dashboard-hero panel-rise border border-cyan-500/10 bg-black/40 p-3 sm:p-4 md:p-5">
          <div className="flex flex-wrap items-start justify-between gap-1.5 sm:gap-2">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cyan-400/70">{dashboardHeaderTag}</p>
              <h1 className="font-['Space_Grotesk'] text-lg font-semibold sm:text-xl md:text-2xl">Visao Resumida e Tendencias</h1>
              <p className="text-[11px] leading-snug text-slate-400 sm:text-xs md:text-sm">Esteira ClickUp em blocos visuais, com comparativo e leitura rapida.</p>
            </div>
            <div className="grid w-full grid-cols-2 gap-1 sm:gap-1.5 sm:flex sm:w-auto sm:flex-wrap">
              <label className="control-card min-w-0 sm:min-w-[126px]"><span className="control-label">Equipe</span>
                <select className="control-input" value={selectedTeamId || ""} onChange={(event) => changeTeam(event.target.value)}>
                  {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
                </select>
              </label>
              <label className="control-card min-w-0 sm:min-w-[110px]"><span className="control-label">Atualizacao</span>
                <select className="control-input" value={refreshMs} disabled>
                  <option value={FIXED_REFRESH_MS}>3s (fixo)</option>
                </select>
              </label>
              <button type="button" className="control-card control-button min-w-0 sm:min-w-[110px] border-cyan-500/25 bg-cyan-500/10 text-cyan-200" onClick={() => refreshNow()}>
                <span className="control-label">Sincronizar</span>
                <span className="top-action-value mt-0.5 inline-flex items-center gap-1.5 text-xs"><RefreshCcw className={`h-3.5 w-3.5 ${isSyncing ? "animate-spin" : ""}`} />Atualizar</span>
              </button>
              <button
                type="button"
                className="control-card control-button min-w-0 sm:min-w-[110px] border-amber-500/25 bg-amber-500/10 text-amber-200"
                onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
              >
                <span className="control-label">Tema</span>
                <span className="top-action-value mt-0.5 inline-flex items-center gap-1.5 text-xs">
                  {theme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
                  {theme === "dark" ? "Claro" : "Escuro"}
                </span>
              </button>
            </div>
          </div>

          <div className="mt-2 grid grid-cols-2 gap-1.5 sm:gap-2 lg:grid-cols-5">
            <label className="control-card col-span-2 lg:col-span-1"><span className="control-label">Escopo</span>
              <select className="control-input" value={scopeKey} onChange={(event) => {
                const next = scopeOptionsSafe.find((item) => item.key === event.target.value);
                if (!next) return;
                changeScope({ type: next.type, id: next.id, label: next.label.trim() });
              }}>
                {scopeOptionsSafe.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
              </select>
            </label>
            <label className="control-card"><span className="control-label">Janela</span>
              <select className="control-input" value={dashboardFilters.periodDays} onChange={(event) => updateFilter("periodDays", Number(event.target.value))}>
                {PERIOD_OPTIONS.map((days) => <option key={days} value={days}>{days} dias</option>)}
              </select>
            </label>
            <label className="control-card"><span className="control-label">Status</span>
              <select className="control-input" value={dashboardFilters.status} onChange={(event) => updateFilter("status", event.target.value)}>
                <option value="">Todos</option>
                {(dashboard?.dimensions?.statuses || []).map((item) => <option key={item.label} value={item.label}>{item.label}</option>)}
              </select>
            </label>
            <label className="control-card"><span className="control-label">Categoria</span>
              <select className="control-input" value={dashboardFilters.category} onChange={(event) => updateFilter("category", event.target.value)}>
                <option value="">Todas</option>
                {(dashboard?.dimensions?.categories || []).map((item) => <option key={item.label} value={item.label}>{item.label}</option>)}
              </select>
            </label>
            <label className="control-card"><span className="control-label">Responsavel</span>
              <select className="control-input" value={dashboardFilters.assignee} onChange={(event) => updateFilter("assignee", event.target.value)}>
                <option value="">Todos</option>
                {(dashboard?.dimensions?.assignees || []).map((item) => <option key={item.label} value={item.label}>{item.label}</option>)}
              </select>
            </label>
          </div>

          <div className="mt-2 grid grid-cols-2 gap-1.5 sm:mt-2.5 sm:gap-2 sm:flex sm:flex-wrap sm:items-center">
            <button
              type="button"
              onClick={() => setActiveView("resumo")}
              className={`w-full rounded border px-2.5 py-1 text-center font-mono text-[10px] uppercase tracking-[0.12em] transition sm:w-auto sm:py-1.5 ${
                activeView === "resumo"
                  ? "border-cyan-400/70 bg-cyan-500/15 text-cyan-200"
                  : "border-white/15 bg-white/5 text-slate-300 hover:border-cyan-500/35"
              }`}
            >
              Dashboard Atual
            </button>
            <button
              type="button"
              onClick={() => setActiveView("pessoas")}
              className={`w-full rounded border px-2.5 py-1 text-center font-mono text-[10px] uppercase tracking-[0.12em] transition sm:w-auto sm:py-1.5 ${
                activeView === "pessoas"
                  ? "border-cyan-400/70 bg-cyan-500/15 text-cyan-200"
                  : "border-white/15 bg-white/5 text-slate-300 hover:border-cyan-500/35"
              }`}
            >
              Metricas por Pessoa
            </button>
          </div>
        </section>

        <section className={`${activeView === "resumo" ? "panel-rise" : "hidden"} border border-cyan-500/12 bg-black/25 p-4 md:p-5`}>
          <div className="grid gap-3 xl:grid-cols-[1.7fr_1fr]">
            <article className="rounded border border-white/10 bg-black/30 p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="inline-flex items-center gap-1.5">
                    <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-300/80">Tendencia de vazao</p>
                    <InlineHint text={HELP_TEXT.trendThroughput} />
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">fluxo recente com variacao sobre o periodo anterior</p>
                </div>
                <div className="grid w-full grid-cols-2 gap-2 xl:w-auto xl:grid-cols-4">
                  {summaryCards.map((card) => (
                    <div key={card.id} className="summary-metric rounded border border-white/10 bg-black/20 px-2 py-1.5">
                      <div className="inline-flex items-center gap-1">
                        <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-slate-400">{card.label}</p>
                        <InlineHint text={card.help} />
                      </div>
                      <div className="mt-1 flex items-center justify-between gap-2">
                        <p className="font-['Space_Grotesk'] text-xl font-semibold text-slate-100">{card.value}</p>
                        <ValueTrend current={card.value} previous={card.prev} inverse={card.inverse} suffix="%" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2">
                {compactInsights.map((item) => (
                  <span
                    key={item.label}
                    className="inline-flex items-center gap-1 rounded border border-white/15 bg-white/5 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.11em] text-slate-300"
                  >
                    {item.label}: {item.value}
                    <InlineHint text={item.help} />
                  </span>
                ))}
              </div>

              <div className="chart-box chart-box-cyan mt-3 h-[240px] sm:h-[260px]">
                {throughputTrendData.length ? (
                  <TrendComparisonChart
                    data={throughputTrendData}
                    valueLabel="Atual"
                    baselineLabel="Periodo anterior"
                    valueColor="#00f3ff"
                    baselineColor="rgba(173,191,215,0.65)"
                  />
                ) : (
                  <EmptyData message="Historico em coleta. Aguarde snapshots." />
                )}
              </div>
            </article>

            <article className="rounded border border-white/10 bg-black/30 p-3">
              <div>
                <div className="inline-flex items-center gap-1.5">
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-300/80">Leitura essencial</p>
                  <InlineHint text={HELP_TEXT.executiveReading} />
                </div>
                <p className="mt-0.5 text-xs text-slate-500">indicadores diretos para decisao rapida</p>
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {executiveMetrics.map((metric) => (
                  <InfoLine key={metric.title} title={metric.title} value={metric.value} helpText={metric.help} />
                ))}
              </div>
            </article>
          </div>
        </section>

        <section className={`${activeView === "resumo" ? "panel-rise" : "hidden"} border border-cyan-500/12 bg-black/25 p-4 md:p-6`}>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="flex items-center gap-2"><div className="h-3 w-[2px] bg-cyan-500" /><h2 className="font-['Space_Grotesk'] text-sm font-bold uppercase tracking-wider text-slate-200">Esteira por Processo</h2></div>
              <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-slate-500">lista/pasta do clickup, status atual, carga e tendencia</p>
            </div>
            <label className="control-card w-full min-w-0 flex-1 md:w-auto md:min-w-[320px] md:flex-none">
              <span className="control-label">Filtrar processo</span>
              <select className="control-input" value={resolvedSelectedPipelineId} onChange={(event) => setSelectedPipelineId(event.target.value)}>
                <option value="all">Todos os processos</option>
                {pipelineBlocks.map((block) => <option key={block.id} value={block.id}>{block.label} ({block.open} ab / {block.overdue} atr)</option>)}
              </select>
            </label>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="rounded border border-cyan-500/35 bg-cyan-500/12 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-cyan-300">
              Processos carregados: {pipelineBlocks.length}
            </span>
            <span className="rounded border border-white/20 bg-white/5 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-slate-300">
              Exibindo: {visiblePipelineBlocks.length}
            </span>
            <span className="rounded border border-white/20 bg-white/5 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-slate-300">
              Base carregada: {detailRows.length} / {dashboard?.details?.totalRows || detailRows.length}
            </span>
          </div>

          {visiblePipelineBlocks.length ? (
            <div className="mt-4 grid gap-4 xl:grid-cols-2">
              {visiblePipelineBlocks.map((block) => (
                <PipelineProcessCard
                  key={block.id}
                  block={block}
                  onOpenTasks={(filter) => setPipelineTaskModal({ blockId: block.id, filter })}
                />
              ))}
            </div>
          ) : (
            <div className="mt-4"><EmptyData message="Sem dados detalhados de esteira para os filtros atuais." /></div>
          )}
        </section>

        <section className={`${activeView === "resumo" ? "grid" : "hidden"} gap-4 md:grid-cols-2 2xl:grid-cols-3`}>
          <Panel title="Em andamento por status" subtitle="distribuicao atual no escopo" helpText={HELP_TEXT.panelWipByStatus}>
            <div className="chart-box chart-box-cyan h-[220px] sm:h-[280px] xl:h-[300px]">
              {(dashboard?.wipByStatus || []).length ? (
                <HorizontalBarChartKpi
                  data={(dashboard?.wipByStatus || [])
                    .slice(0, 8)
                    .map((item) => ({ label: item.status, value: item.value }))}
                  barColor="#00f3ff"
                />
              ) : (
                <EmptyData message="Sem dados de status" />
              )}
            </div>
          </Panel>
          <Panel title="Atrasadas por responsavel" subtitle="quem concentra maior risco" helpText={HELP_TEXT.panelOverdueByAssignee}>
            <div className="chart-box chart-box-rose h-[220px] sm:h-[280px] xl:h-[300px]">
              {(dashboard?.overdue.byAssignee || []).length ? (
                <HorizontalBarChartKpi data={(dashboard?.overdue.byAssignee || []).slice(0, 8).map((item) => ({ label: item.assignee, value: item.value }))} barColor="#ff5f87" />
              ) : (
                <EmptyData message="Sem tarefas atrasadas" />
              )}
            </div>
          </Panel>
          <Panel title="Fila por prioridade" subtitle="P0, P1, P2" helpText={HELP_TEXT.panelPriorityQueue}>
            <div className="chart-box chart-box-violet h-[220px] sm:h-[280px] xl:h-[300px]">
              {(dashboard?.priorityQueue || []).length ? (
                <VerticalBarChartKpi data={(dashboard?.priorityQueue || []).map((item) => ({ label: item.priority, value: item.value }))} barColor="#a68dff" />
              ) : (
                <EmptyData message="Sem dados de prioridade" />
              )}
            </div>
          </Panel>
        </section>

        <section className={`${activeView === "pessoas" ? "panel-rise" : "hidden"} border border-cyan-500/12 bg-black/25 p-4 md:p-6`}>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <div className="h-3 w-[2px] bg-cyan-500" />
                <h2 className="font-['Space_Grotesk'] text-sm font-bold uppercase tracking-wider text-slate-200">
                  Metricas por Pessoa
                </h2>
              </div>
              <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-slate-500">
                blocos por responsavel com indicadores e graficos laterais
              </p>
            </div>

            <label className="control-card w-full min-w-0 flex-1 md:w-auto md:min-w-[260px] md:flex-none">
              <span className="control-label">Filtrar responsavel</span>
              <input
                type="text"
                className="control-input"
                placeholder="Digite um nome"
                value={assigneeSearch}
                onChange={(event) => setAssigneeSearch(event.target.value)}
              />
            </label>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <span className="rounded border border-cyan-500/35 bg-cyan-500/12 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-cyan-300">
              Responsaveis: {visiblePeopleMetrics.length}
            </span>
            <span className="rounded border border-white/20 bg-white/5 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-slate-300">
              Base carregada: {detailRows.length} / {dashboard?.details?.totalRows || detailRows.length}
            </span>
          </div>

          {visiblePeopleMetrics.length ? (
            <div className="mt-4 grid gap-4 xl:grid-cols-2 2xl:grid-cols-3">
              {visiblePeopleMetrics.map((person) => (
                <AssigneeMetricsCard
                  key={person.id}
                  block={person}
                  onOpenTasks={(filter) =>
                    setPipelineTaskModal({ blockId: person.id, filter })
                  }
                />
              ))}
            </div>
          ) : (
            <div className="mt-4">
              <EmptyData message="Sem responsaveis para os filtros atuais." />
            </div>
          )}
        </section>

        {error ? <div className="rounded border border-rose-500/30 bg-rose-500/10 px-3 py-2 font-mono text-xs text-rose-300">ERRO_SISTEMA: {error}</div> : null}
        <footer className="rounded border border-white/5 bg-black/30 px-3 py-2.5 font-mono text-[10px] uppercase tracking-wider text-slate-500 sm:px-4 sm:py-3">
          <p>escopo: {selectedScope.label} // equipe: {selectedTeam?.name || "-"}</p>
          <p className="mt-1">ultima coleta: {formatDateTime(lastSyncAt || dashboard?.generatedAt)}</p>
        </footer>
      </main>

      {pipelineTaskModal && activeModalBlock ? (
        <PipelineTasksModal
          key={`${pipelineTaskModal.blockId}:${pipelineTaskModal.filter}`}
          block={activeModalBlock}
          initialFilter={pipelineTaskModal.filter}
          loadedRows={detailRows.length}
          totalRows={dashboard?.details?.totalRows || detailRows.length}
          onClose={() => setPipelineTaskModal(null)}
        />
      ) : null}
    </div>
  );
}

function InlineHint({ text }: { text: string }) {
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const popRef = useRef<HTMLSpanElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [layout, setLayout] = useState({
    offsetX: 0,
    openUpward: false,
    maxHeight: 220,
  });

  const updateHintLayout = useCallback(() => {
    if (typeof window === "undefined") return;
    const anchor = anchorRef.current;
    const pop = popRef.current;
    if (!anchor || !pop) return;

    const anchorRect = anchor.getBoundingClientRect();
    const popRect = pop.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const gap = 6;
    const margin = 8;
    const centerX = anchorRect.left + anchorRect.width / 2;
    const halfPopover = popRect.width / 2;
    const minCenter = margin + halfPopover;
    const maxCenter = viewportWidth - margin - halfPopover;

    let offsetX = 0;
    if (minCenter > maxCenter) {
      offsetX = viewportWidth / 2 - centerX;
    } else if (centerX < minCenter) {
      offsetX = minCenter - centerX;
    } else if (centerX > maxCenter) {
      offsetX = maxCenter - centerX;
    }

    const spaceBelow = Math.max(0, viewportHeight - anchorRect.bottom - gap - margin);
    const spaceAbove = Math.max(0, anchorRect.top - gap - margin);
    const openUpward = popRect.height > spaceBelow && spaceAbove > spaceBelow;
    const availableVerticalSpace = openUpward ? spaceAbove : spaceBelow;
    const maxHeight = Math.max(96, Math.min(320, Math.floor(availableVerticalSpace)));

    setLayout({ offsetX, openUpward, maxHeight });
  }, []);

  const openHint = useCallback(() => {
    setIsOpen(true);
  }, []);

  const closeHint = useCallback(() => {
    setIsOpen(false);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const rafId = window.requestAnimationFrame(updateHintLayout);
    const handleViewportChange = () => updateHintLayout();

    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [isOpen, updateHintLayout]);

  useEffect(() => {
    if (!isOpen) return;
    const handleOutsideClick = (event: MouseEvent) => {
      if (!(event.target instanceof Node)) return;
      if (anchorRef.current?.contains(event.target)) return;
      closeHint();
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeHint();
    };

    window.addEventListener("click", handleOutsideClick);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("click", handleOutsideClick);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [closeHint, isOpen]);

  const handleClick = useCallback((event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIsOpen((current) => !current);
  }, []);

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent) => {
      if (event.key === "Escape") {
        closeHint();
        return;
      }

      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      if (isOpen) {
        closeHint();
      } else {
        openHint();
      }
    },
    [closeHint, isOpen, openHint]
  );

  const popStyle = {
    "--hint-shift-x": `${layout.offsetX}px`,
    maxHeight: `${layout.maxHeight}px`,
  } as CSSProperties;

  return (
    <span
      ref={anchorRef}
      className="hint-anchor"
      onMouseEnter={openHint}
      onMouseLeave={closeHint}
    >
      <span
        className="hint-dot"
        role="button"
        tabIndex={0}
        aria-label="Explicacao tecnica"
        aria-expanded={isOpen}
        onFocus={openHint}
        onBlur={closeHint}
        onKeyDown={handleKeyDown}
        onClick={handleClick}
      >
        i
      </span>
      <span
        ref={popRef}
        className={`hint-pop ${layout.openUpward ? "hint-pop-up" : ""} ${isOpen ? "hint-pop-open" : ""}`}
        role="tooltip"
        style={popStyle}
      >
        {text}
      </span>
    </span>
  );
}

function Panel({
  title,
  subtitle,
  children,
  helpText,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  helpText?: string;
}) {
  return (
    <section className="panel-rise relative border border-white/5 bg-black/20 p-4 backdrop-blur-sm md:p-5">
      <div className="absolute right-0 top-0 h-8 w-8 border-r border-t border-cyan-500/10" />
      <div className="mb-5 flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <div className="h-3 w-[2px] bg-cyan-500" />
          <h2 className="font-['Space_Grotesk'] text-sm font-bold uppercase tracking-wider text-slate-200">{title}</h2>
          {helpText ? <InlineHint text={helpText} /> : null}
        </div>
        <p className="font-mono text-[9px] uppercase tracking-[0.15em] text-slate-500">{subtitle}</p>
      </div>
      <div className="relative">{children}</div>
    </section>
  );
}

function InfoLine({
  title,
  value,
  helpText,
}: {
  title: string;
  value: string;
  helpText?: string;
}) {
  return (
    <div className="rounded border border-white/10 bg-black/20 px-2.5 py-1.5">
      <div className="inline-flex items-center gap-1">
        <p className="text-[10px] uppercase tracking-[0.12em] text-slate-400">{title}</p>
        {helpText ? <InlineHint text={helpText} /> : null}
      </div>
      <p className="mt-0.5 font-['Space_Grotesk'] text-xl font-semibold text-cyan-300">{value}</p>
    </div>
  );
}

function AssigneeMetricsCard({
  block,
  onOpenTasks,
}: {
  block: AssigneeMetricsBlock;
  onOpenTasks: (filter: PipelineTaskFilter) => void;
}) {
  const topStatuses = block.statusBreakdown.slice(0, 4);
  const paddedStatuses: Array<AssigneeStatusPoint & { placeholder?: boolean }> = [...topStatuses];
  while (paddedStatuses.length < 4) {
    paddedStatuses.push({
      status: "sem volume",
      value: 0,
      overdue: 0,
      placeholder: true,
    });
  }
  const maxStatusValue = topStatuses.length
    ? Math.max(...topStatuses.map((item) => item.value), 1)
    : 1;
  const riskClass =
    block.overdue > 0
      ? "border-rose-500/30 bg-rose-500/10 text-rose-300"
      : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";

  return (
    <article className="rounded border border-white/10 bg-black/30 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-['Space_Grotesk'] text-lg font-bold text-slate-50 tracking-[0.01em]">{block.assignee}</p>
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-slate-500">
            {block.total} tarefas // {block.open} abertas
          </p>
        </div>
        <span className={`inline-flex rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] ${riskClass}`}>
          {block.overdue ? `${block.overdue} atr` : "sem atraso"}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <KpiPill label="Total" value={block.total} tone="cyan" onClick={() => onOpenTasks("total")} />
        <KpiPill label="Concluidas" value={block.closed} tone="green" onClick={() => onOpenTasks("closed")} />
        <KpiPill
          label="Atrasadas"
          value={block.overdue}
          tone="rose"
          icon={<AlertTriangle className="h-3 w-3" />}
          onClick={() => onOpenTasks("overdue")}
        />
        <SimpleMetricCell label="Tempo etapa" value={formatHoursWindow(block.avgStatusAgeHours)} helpText={HELP_TEXT.kpiStageTime} />
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[1.15fr_1fr]">
        <div className="chart-box chart-box-blue rounded border border-white/10 bg-black/20 p-2">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="inline-flex items-center gap-1">
              <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-slate-400">Movimento diario</p>
              <InlineHint text={HELP_TEXT.processFlowByDay} />
            </div>
            <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-slate-500">
              concl: {block.completionPct}%
            </span>
          </div>
          <div className="h-[92px]">
            <TrendSparkline
              data={block.trend}
              currentColor="#47a9ff"
              previousColor="#f59e0b"
            />
          </div>
        </div>

        <div className="chart-box chart-box-emerald rounded border border-white/10 bg-black/20 p-2">
          <div className="inline-flex items-center gap-1">
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-slate-400">Distribuicao por status</p>
            <InlineHint text={HELP_TEXT.processStatusDistribution} />
          </div>
          <div className="mt-2 space-y-1.5">
            {paddedStatuses.map((status, index) => {
              const width =
                status.value > 0 ? Math.max(10, (status.value / maxStatusValue) * 100) : 0;
              return (
                <div key={`${block.assignee}-${status.status}-${index}`} className="space-y-0.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`truncate text-xs ${status.placeholder ? "text-slate-500" : "text-slate-300"}`}>
                      {status.status}
                    </span>
                    <span className="font-mono text-[10px] text-slate-400">{status.value}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded bg-white/5">
                    <div
                      className="h-full rounded"
                      style={{
                        width: `${width}%`,
                        backgroundColor: status.placeholder
                          ? "rgba(148,163,184,0.35)"
                          : stageColor(status.status),
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="rounded border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] text-amber-300">
          alta prio: {block.highPriority}
        </span>
        <span className="rounded border border-cyan-500/25 bg-cyan-500/10 px-1.5 py-0.5 font-mono text-[10px] text-cyan-300">
          carga: {block.loadScore === null ? "-" : block.loadScore.toFixed(1)}
        </span>
        <span className="rounded border border-blue-500/25 bg-blue-500/10 px-1.5 py-0.5 font-mono text-[10px] text-blue-300">
          wip: {block.capacityWip === null ? "-" : block.capacityWip}
        </span>
        <span className="rounded border border-rose-500/25 bg-rose-500/10 px-1.5 py-0.5 font-mono text-[10px] text-rose-300">
          atr: {block.capacityOverdue === null ? "-" : block.capacityOverdue}
        </span>
        <span className="rounded border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] text-amber-300">
          alta: {block.capacityHighPriority === null ? "-" : block.capacityHighPriority}
        </span>
      </div>
    </article>
  );
}

function SimpleMetricCell({
  label,
  value,
  helpText,
}: {
  label: string;
  value: string | number;
  helpText?: string;
}) {
  return (
    <div className="rounded border border-white/10 bg-black/20 px-2 py-1.5">
      <div className="inline-flex items-center gap-1">
        <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-slate-500">{label}</p>
        {helpText ? <InlineHint text={helpText} /> : null}
      </div>
      <p className="mt-0.5 font-['Space_Grotesk'] text-xl font-semibold text-slate-100">{value}</p>
    </div>
  );
}

function PipelineProcessCard({
  block,
  onOpenTasks,
}: {
  block: PipelineBlock;
  onOpenTasks: (filter: PipelineTaskFilter) => void;
}) {
  const completionClass =
    block.completionPct >= 75
      ? "border-emerald-500/35 bg-emerald-500/12 text-emerald-300"
      : block.completionPct >= 45
        ? "border-cyan-500/35 bg-cyan-500/12 text-cyan-300"
        : "border-amber-500/35 bg-amber-500/12 text-amber-300";

  return (
    <article className="rounded border border-white/10 bg-black/30 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-['Space_Grotesk'] text-lg font-bold text-slate-50 tracking-[0.01em]">{block.label}</p>
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-slate-500">{block.hierarchy}</p>
        </div>
        <span className={`inline-flex items-center rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] ${completionClass}`}>
          {block.completionPct}% concluido
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <KpiPill label="Total" value={block.total} tone="cyan" onClick={() => onOpenTasks("total")} />
        <KpiPill label="Abertas" value={block.open} tone="blue" onClick={() => onOpenTasks("open")} />
        <KpiPill label="Concluidas" value={block.closed} tone="green" onClick={() => onOpenTasks("closed")} />
        <KpiPill
          label="Atrasadas"
          value={block.overdue}
          tone="rose"
          icon={<AlertTriangle className="h-3 w-3" />}
          onClick={() => onOpenTasks("overdue")}
        />
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[1.15fr_1fr]">
        <div className="chart-box chart-box-cyan rounded border border-white/10 bg-black/20 p-2">
          <div className="inline-flex items-center gap-1">
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-slate-400">Movimento diario</p>
            <InlineHint text={HELP_TEXT.processFlowByDay} />
          </div>
          <div className="mt-2 h-[96px]"><TrendSparkline data={block.trend} currentColor="#00f3ff" previousColor="#f59e0b" /></div>
        </div>

        <div className="chart-box chart-box-indigo rounded border border-white/10 bg-black/20 p-2">
          <div className="inline-flex items-center gap-1">
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-slate-400">Carga por responsavel</p>
            <InlineHint text={HELP_TEXT.processAssigneeLoad} />
          </div>
          <AssigneeLoadBars assignees={block.assignees} />
        </div>
      </div>

      <div className="chart-box chart-box-amber mt-3 rounded border border-white/10 bg-black/20 p-2">
        <div className="inline-flex items-center gap-1">
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-slate-400">Distribuicao por etapa</p>
          <InlineHint text={HELP_TEXT.processStageDistribution} />
        </div>
        <StageDistributionChart stages={block.stages} total={block.total} />
      </div>
    </article>
  );
}

function KpiPill({
  label,
  value,
  tone,
  icon,
  onClick,
}: {
  label: string;
  value: number;
  tone: "cyan" | "green" | "rose" | "blue";
  icon?: ReactNode;
  onClick?: () => void;
}) {
  const toneClass =
    tone === "green"
      ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-300"
      : tone === "rose"
        ? "border-rose-500/25 bg-rose-500/10 text-rose-300"
        : tone === "blue"
          ? "border-blue-500/25 bg-blue-500/10 text-blue-300"
          : "border-cyan-500/25 bg-cyan-500/10 text-cyan-300";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded border px-2 py-1.5 text-left transition hover:-translate-y-[1px] hover:brightness-110 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400/70 ${toneClass}`}
      title={`Abrir tarefas de ${label.toLowerCase()}`}
    >
      <p className="font-mono text-[9px] uppercase tracking-[0.12em]">{label}</p>
      <p className="mt-1 inline-flex items-center gap-1 font-['Space_Grotesk'] text-xl font-semibold">{icon}{value}</p>
    </button>
  );
}

function PipelineTasksModal({
  block,
  initialFilter,
  loadedRows,
  totalRows,
  onClose,
}: {
  block: PipelineBlock;
  initialFilter: PipelineTaskFilter;
  loadedRows: number;
  totalRows: number;
  onClose: () => void;
}) {
  const [activeFilter, setActiveFilter] = useState<PipelineTaskFilter>(initialFilter);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  const sortedTasks = useMemo(() => sortPipelineTasks(block.tasks), [block.tasks]);
  const visibleTasks = useMemo(
    () => filterPipelineTasks(sortedTasks, activeFilter),
    [sortedTasks, activeFilter]
  );

  const groupedByStage = useMemo(() => {
    const stageMap = new Map<string, { status: string; count: number; overdue: number }>();

    visibleTasks.forEach((task) => {
      const key = normalizeLabel(task.status, "Sem status");
      const current = stageMap.get(key) || { status: key, count: 0, overdue: 0 };
      current.count += 1;
      if (task.isOverdue) current.overdue += 1;
      stageMap.set(key, current);
    });

    return Array.from(stageMap.values()).sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.status.localeCompare(b.status);
    });
  }, [visibleTasks]);

  const maxStageCount = groupedByStage.length
    ? Math.max(...groupedByStage.map((item) => item.count))
    : 1;

  const processCounts = useMemo(
    () => ({
      total: block.tasks.length,
      open: block.tasks.filter((task) => !task.isClosed).length,
      closed: block.tasks.filter((task) => task.isClosed).length,
      overdue: block.tasks.filter((task) => task.isOverdue).length,
    }),
    [block.tasks]
  );

  const filteredCount = processCounts[activeFilter];
  const resolvedTotalRows = Number.isFinite(totalRows) && totalRows > 0 ? totalRows : loadedRows;
  const hasPartialData = resolvedTotalRows > loadedRows;

  return (
    <div
      className="fixed inset-0 z-[90] grid place-items-center bg-black/65 p-3 sm:p-5"
      onClick={onClose}
    >
      <section
        className="panel-rise flex w-full max-w-[1120px] max-h-[86vh] min-h-[340px] sm:min-h-[420px] flex-col rounded border border-cyan-500/20 bg-black/80 p-3 shadow-[0_24px_70px_rgba(0,0,0,0.5)] backdrop-blur-xl sm:p-4 md:p-5"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-300/80">Detalhe da Esteira</p>
            <h3 className="mt-1 truncate font-['Space_Grotesk'] text-xl font-bold text-slate-50 tracking-[0.01em]">{block.label}</h3>
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-slate-500">{block.hierarchy}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-white/20 bg-white/5 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-slate-300 transition hover:border-cyan-400/50 hover:text-cyan-200"
          >
            fechar
          </button>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
          {(Object.keys(PIPELINE_FILTER_LABEL) as PipelineTaskFilter[]).map((filterKey) => {
            const isActive = activeFilter === filterKey;
            const value = processCounts[filterKey];
            return (
              <button
                key={filterKey}
                type="button"
                onClick={() => setActiveFilter(filterKey)}
                className={`rounded border px-2 py-2 text-left transition ${
                  isActive
                    ? "border-cyan-400/70 bg-cyan-500/16 text-cyan-100"
                    : "border-white/15 bg-white/5 text-slate-300 hover:border-cyan-500/35 hover:bg-cyan-500/10"
                }`}
              >
                <p className="font-mono text-[9px] uppercase tracking-[0.14em]">{PIPELINE_FILTER_LABEL[filterKey]}</p>
                <p className="mt-1 font-['Space_Grotesk'] text-2xl font-semibold">{value}</p>
                <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-slate-400">{PIPELINE_FILTER_DESCRIPTION[filterKey]}</p>
              </button>
            );
          })}
        </div>

        <div className="mt-3 hidden flex-wrap items-center gap-2 lg:flex">
          <span className="rounded border border-cyan-500/35 bg-cyan-500/12 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-cyan-300">
            Exibindo: {PIPELINE_FILTER_LABEL[activeFilter]}
          </span>
          <span className="rounded border border-white/20 bg-white/5 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-slate-300">
            Itens: {filteredCount}
          </span>
          <span className="rounded border border-white/20 bg-white/5 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-slate-300">
            Base carregada: {loadedRows} / {resolvedTotalRows}
          </span>
          {hasPartialData ? (
            <span className="rounded border border-amber-500/35 bg-amber-500/12 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-amber-300">
              exibicao parcial do detalhe (pagina atual)
            </span>
          ) : null}
        </div>

        <div className="mt-3 hidden rounded border border-white/10 bg-black/25 p-2.5 lg:block">
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-slate-400">Distribuicao da etapa selecionada</p>
          {groupedByStage.length ? (
            <div className="mt-2 space-y-1.5">
              {groupedByStage.slice(0, 8).map((stage) => {
                const width = Math.max(8, (stage.count / Math.max(1, maxStageCount)) * 100);
                return (
                  <div key={stage.status} className="grid grid-cols-[minmax(0,1fr)_74px] items-center gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="truncate text-slate-300">{stage.status}</span>
                        <span className="font-mono text-[10px] text-slate-400">{stage.count}</span>
                      </div>
                      <div className="mt-0.5 h-2 overflow-hidden rounded bg-white/5">
                        <div className="h-full rounded" style={{ width: `${width}%`, backgroundColor: stageColor(stage.status) }} />
                      </div>
                    </div>
                    <div className="text-right">
                      {stage.overdue > 0 ? (
                        <span className="rounded border border-rose-500/30 bg-rose-500/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-rose-300">
                          atr {stage.overdue}
                        </span>
                      ) : (
                        <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-slate-500">ok</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="mt-2 rounded border border-dashed border-white/10 px-2 py-3 font-mono text-[10px] uppercase tracking-[0.1em] text-slate-500">
              sem tarefas para este filtro
            </div>
          )}
        </div>

        <div className="mt-3 min-h-0 flex-1 overflow-auto overscroll-contain rounded border border-white/10 bg-black/20">
          {visibleTasks.length ? (
            <>
              <div className="hidden lg:block overflow-x-auto">
                <table className="w-full min-w-[860px] border-collapse">
                  <thead className="sticky top-0 bg-black/85">
                    <tr className="border-b border-white/10 text-left">
                      <th className="px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-slate-500">Tarefa</th>
                      <th className="px-2 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-slate-500">Status</th>
                      <th className="px-2 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-slate-500">Responsavel</th>
                      <th className="px-2 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-slate-500">Prioridade</th>
                      <th className="px-2 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-slate-500">Vencimento</th>
                      <th className="px-2 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-slate-500">Tempo na etapa</th>
                      <th className="px-2 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-slate-500">Acao</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleTasks.map((task) => (
                      <tr key={task.id} className="border-b border-white/5 align-top">
                        <td className="px-3 py-2">
                          <p className="text-sm text-slate-200">{task.name}</p>
                          <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-slate-500">{task.category}</p>
                        </td>
                        <td className="px-2 py-2">
                          <span className="inline-flex rounded border border-white/15 bg-white/5 px-2 py-0.5 text-xs text-slate-300">
                            {task.status}
                          </span>
                        </td>
                        <td className="px-2 py-2 text-sm text-slate-300">{task.assignee}</td>
                        <td className="px-2 py-2">
                          <span className={`inline-flex rounded border px-2 py-0.5 text-xs uppercase ${resolvePriorityClass(task.priority)}`}>
                            {task.priority}
                          </span>
                        </td>
                        <td className="px-2 py-2">
                          <p className={`text-sm ${task.isOverdue ? "text-rose-300" : "text-slate-300"}`}>{formatDateTime(task.dueAt)}</p>
                        </td>
                        <td className="px-2 py-2">
                          <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-slate-400">{formatHoursWindow(task.statusAgeHours)}</p>
                        </td>
                        <td className="px-2 py-2">
                          {task.url ? (
                            <a
                              href={task.url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex rounded border border-cyan-500/35 bg-cyan-500/10 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-cyan-300 transition hover:border-cyan-300/70 hover:text-cyan-100"
                            >
                              abrir
                            </a>
                          ) : (
                            <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-slate-500">sem link</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="space-y-2 p-2 lg:hidden">
                {visibleTasks.map((task) => (
                  <article key={task.id} className="rounded border border-white/10 bg-black/20 p-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm text-slate-200">{task.name}</p>
                      <span className={`inline-flex shrink-0 rounded border px-2 py-0.5 text-[10px] uppercase ${resolvePriorityClass(task.priority)}`}>
                        {task.priority}
                      </span>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-1.5">
                      <InfoChip label="Status" value={task.status} />
                      <InfoChip label="Responsavel" value={task.assignee} />
                      <InfoChip label="Vencimento" value={formatDateTime(task.dueAt)} tone={task.isOverdue ? "danger" : "neutral"} />
                      <InfoChip label="Tempo na etapa" value={formatHoursWindow(task.statusAgeHours)} />
                    </div>
                    <div className="mt-2 flex justify-between">
                      <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-slate-500">{task.category}</span>
                      {task.url ? (
                        <a
                          href={task.url}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-[10px] uppercase tracking-[0.1em] text-cyan-300"
                        >
                          abrir
                        </a>
                      ) : (
                        <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-slate-500">sem link</span>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </>
          ) : (
            <div className="flex h-full min-h-[120px] items-center justify-center px-3 text-center font-mono text-[10px] uppercase tracking-[0.1em] text-slate-500">
              sem tarefas para o filtro selecionado
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function InfoChip({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "danger";
}) {
  const toneClass =
    tone === "danger"
      ? "border-rose-500/30 bg-rose-500/10 text-rose-300"
      : "border-white/15 bg-white/5 text-slate-300";

  return (
    <div className={`rounded border px-2 py-1 ${toneClass}`}>
      <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-slate-500">{label}</p>
      <p className="mt-0.5 text-xs">{value}</p>
    </div>
  );
}

function StageDistributionChart({ stages, total }: { stages: PipelineStagePoint[]; total: number }) {
  if (!stages.length || !total) {
    return <div className="mt-2 rounded border border-dashed border-white/10 px-2 py-3 font-mono text-[10px] uppercase tracking-[0.1em] text-slate-500">sem etapas para este processo</div>;
  }

  const topStages = stages.slice(0, 6);
  return (
    <div className="mt-2">
      <div className="flex h-3 overflow-hidden rounded border border-white/10 bg-white/5">
        {topStages.map((stage) => (
          <div key={stage.status} style={{ width: `${(stage.value / total) * 100}%`, backgroundColor: stageColor(stage.status) }} title={`${stage.status}: ${stage.value}`} />
        ))}
      </div>
      <div className="mt-2 space-y-1">
        {topStages.map((stage) => {
          const pct = Number(((stage.value / total) * 100).toFixed(1));
          return (
            <div key={stage.status} className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: stageColor(stage.status) }} />
                <span className="truncate text-xs text-slate-300">{stage.status}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] text-slate-400">{stage.value} ({pct}%)</span>
                {stage.overdue > 0 ? <span className="rounded border border-rose-500/30 bg-rose-500/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-rose-300">atr {stage.overdue}</span> : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AssigneeLoadBars({ assignees }: { assignees: PipelineAssigneePoint[] }) {
  const topAssignees = assignees.slice(0, 5);
  if (!topAssignees.length) {
    return <div className="mt-2 rounded border border-dashed border-white/10 px-2 py-3 font-mono text-[10px] uppercase tracking-[0.1em] text-slate-500">sem responsavel alocado</div>;
  }

  const maxValue = Math.max(...topAssignees.map((item) => item.value), 1);
  return (
    <div className="mt-2 space-y-1.5">
      {topAssignees.map((item) => {
        const width = (item.value / maxValue) * 100;
        return (
          <div key={item.assignee} className="space-y-0.5">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-xs text-slate-300">{item.assignee}</span>
              <span className="font-mono text-[10px] text-slate-400">{item.value} ab{item.overdue ? ` / ${item.overdue} atr` : ""}</span>
            </div>
            <div className="h-2 overflow-hidden rounded bg-white/5">
              <div className="h-full rounded bg-cyan-400/80" style={{ width: `${Math.max(6, width)}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EmptyData({ message }: { message: string }) {
  return <div className="flex h-full min-h-[120px] items-center justify-center rounded border border-dashed border-white/10 text-sm text-slate-500">{message}</div>;
}

export default NativeDashboardApp;


