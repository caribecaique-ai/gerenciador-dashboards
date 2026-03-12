import {
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AlertTriangle, ChevronDown, ExternalLink, LoaderCircle, Moon, Sun } from "lucide-react";
import {
  type CapacityPoint,
  type DashboardDetailRow,
  type NavigationNode,
  getDashboard,
  updateDashboardTaskStatus,
} from "./services/api";
import { useClickUpData } from "./hooks/useClickUpData";
import {
  HorizontalBarChartKpi,
  MultiTrendWaveChart,
  TrendComparisonChart,
  TrendSparkline,
  ValueTrend,
} from "./components/charts/TaskCharts";
import { ChartSkeleton, MetricSkeleton } from "./components/Skeleton";
import "./native-dashboard.css";

const FIXED_REFRESH_MS = 3000;
const THEME_STORAGE_KEY = "clickup_dashboard_theme";
const CHECKLIST_STORAGE_KEY_PREFIX = "clickup_dashboard_checklist_state";
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
  panelExpertFlow:
    "Mostra quantos status e frentes cada expert ainda possui ativos dentro da esteira de afiliados.",
  panelProcessFlow:
    "Volume atual de tarefas em aberto por processo para leitura rapida da esteira.",
  panelStageFlow:
    "Distribuicao atual das tarefas por etapa/status para localizar concentracao do fluxo.",
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
  masterProgress:
    "Barra de acompanhamento com a composicao atual do fluxo entre execucao, fila, vazao e risco.",
  dailyFocus:
    "Checklist inteligente gerado a partir do backlog, fila critica, atraso, WIP e entregas do dia.",
  kanbanView:
    "Vista de pipeline por etapa com cards individuais para leitura operacional e triagem.",
  kanbanList:
    "Lista auditavel do processo selecionado, com status, dono, prioridade e vencimento.",
  peopleRoster:
    "Lista resumida de responsaveis com cor de risco/carga para leitura imediata.",
  miniPipelineDashboard:
    "Painel resumido da esteira de experts: etapas, nomes e processos ativos, com leitura mais direta que os graficos tradicionais.",
} as const;

type DashboardTheme = "dark" | "light";
type ViewportProfile = "mobile" | "tablet" | "desktop" | "tv";

function resolveViewportProfile(width: number): ViewportProfile {
  if (width >= 1920) return "tv";
  if (width <= 640) return "mobile";
  if (width <= 1024) return "tablet";
  return "desktop";
}

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

  return "dark";
}

function readChecklistState(storageKey: string): Record<string, boolean> {
  if (typeof window === "undefined" || !storageKey) return {};

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
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
  pipelineLabel?: string | null;
  pipelineHierarchy?: string | null;
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
  stage?: string | null;
}

interface FocusChecklistItem {
  id: string;
  label: string;
  tone: "rose" | "emerald" | "orange" | "cyan" | "slate";
}

interface MasterProgressSegment {
  id: string;
  label: string;
  value: number;
  pct: number;
  color: string;
  note: string;
}

interface KanbanColumn {
  id: string;
  status: string;
  color: string;
  total: number;
  overdue: number;
  tasks: PipelineTaskItem[];
}

type DashboardMainView = "resumo" | "kanban" | "pessoas";
type PeopleLayoutMode = "cards" | "list";

interface KanbanTaskOverride {
  status: string;
  previousStatus: string;
  pending: boolean;
  updatedAt: number;
}

interface KanbanDragPayload {
  taskId: string;
  blockId: string;
  fromStatus: string;
}

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

interface AffiliateProcessColumn {
  key: string;
  label: string;
  sourceLabel: string;
  order: number;
}

interface AffiliateProcessCell {
  taskId: string;
  taskName: string;
  url: string | null;
  status: string;
  statusType: string;
  assignee: string;
  dueAt: string | null;
  updatedAt: string | null;
  isClosed: boolean;
  isOverdue: boolean;
  processLabel: string;
  folderLabel: string;
}

interface AffiliateExpertRow {
  id: string;
  expertName: string;
  expertCode: string;
  hubUrl: string | null;
  latestAt: number;
  openCount: number;
  closedCount: number;
  overdueCount: number;
  cells: Record<string, AffiliateProcessCell>;
}

interface AffiliateStatusBoardData {
  columns: AffiliateProcessColumn[];
  rows: AffiliateExpertRow[];
  totalOpenCells: number;
  totalClosedCells: number;
  totalOverdueCells: number;
}

interface AffiliateStageDefinition {
  key: string;
  label: string;
  sourceLabel: string;
  order: number;
  matchers: string[];
}

interface AffiliateJourneyFolderDefinition {
  key: string;
  label: string;
  sourceLabel: string;
  description: string;
  order: number;
  matchers: string[];
}

interface AffiliateJourneyListItem {
  id: string;
  blockId: string;
  label: string;
  taskCount: number;
  open: number;
  closed: number;
  overdue: number;
}

interface AffiliateJourneyCardData {
  key: string;
  label: string;
  sourceLabel: string;
  description: string;
  totalTasks: number;
  listCount: number;
  items: AffiliateJourneyListItem[];
}

interface AffiliateStageOverviewExpert {
  id: string;
  expertName: string;
  expertCode: string;
  status: string;
  url: string | null;
  isClosed: boolean;
  isOverdue: boolean;
}

interface AffiliateStageOverviewCard {
  key: string;
  label: string;
  sourceLabel: string;
  total: number;
  open: number;
  closed: number;
  overdue: number;
  accent: string;
  experts: AffiliateStageOverviewExpert[];
}

interface AffiliateJourneySummaryCard {
  key: string;
  label: string;
  sourceLabel: string;
  totalTasks: number;
  listCount: number;
  open: number;
  closed: number;
  overdue: number;
  accent: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const ASSIGNEE_ACCENT_PALETTE = [
  "#7dd3fc",
  "#fda4af",
  "#a78bfa",
  "#34d399",
  "#fbbf24",
  "#60a5fa",
  "#f472b6",
  "#2dd4bf",
  "#c084fc",
  "#fb7185",
  "#38bdf8",
  "#f59e0b",
  "#22c55e",
  "#818cf8",
  "#14b8a6",
  "#f97316",
  "#93c5fd",
  "#e879f9",
];

const toNumberOrNull = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeLabel = (value: string | null | undefined, fallback: string): string => {
  const normalized = String(value || "").trim();
  return normalized || fallback;
};

const normalizeStageToken = (value: string | null | undefined): string =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const stageStatusMatches = (left: string | null | undefined, right: string | null | undefined): boolean =>
  normalizeStageToken(left) === normalizeStageToken(right);

const normalizeIdLabel = (value: string): string => {
  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "sem-responsavel";
};

const resolveStablePaletteIndex = (value: string): number => {
  const source = normalizeIdLabel(value);
  let hash = 0;
  for (let index = 0; index < source.length; index += 1) {
    hash = (hash * 31 + source.charCodeAt(index)) >>> 0;
  }
  return hash % ASSIGNEE_ACCENT_PALETTE.length;
};

const AFFILIATE_HUB_LIST_NAME = "HUB: Status de Afiliados";

const AFFILIATE_STAGE_DEFINITIONS: AffiliateStageDefinition[] = [
  {
    key: "acquisition",
    label: "1.1 Aquisicao",
    sourceLabel: AFFILIATE_HUB_LIST_NAME,
    order: 10,
    matchers: ["hub: status de afiliados", "status de afiliados"],
  },
  {
    key: "compliance",
    label: "2.1 Compliance",
    sourceLabel: "2.1 Compliance",
    order: 20,
    matchers: ["2.1 compliance", "compliance"],
  },
  {
    key: "contract",
    label: "2.3 Contrato",
    sourceLabel: "2.3 Contratos - Influencers/exeperts",
    order: 30,
    matchers: ["2.3 contratos", "2.3 contrato", "contratos - influencers", "influencers/exeperts"],
  },
  {
    key: "accountCreation",
    label: "2.4a Criacao da Conta",
    sourceLabel: "2.4a Onbording Tecnico",
    order: 40,
    matchers: ["2.4a onbording tecnico", "2.4a onboarding tecnico", "criacao da conta", "onbording tecnico"],
  },
  {
    key: "creationFlow",
    label: "3.1 Esteira de Criacao",
    sourceLabel: "2.4b Planejamento estrategico",
    order: 50,
    matchers: ["2.4b planejamento estrategico", "planejamento estrategico", "esteira de criacao"],
  },
];

const AFFILIATE_STAGE_ACCENT_MAP: Record<string, string> = {
  acquisition: "#f59e0b",
  compliance: "#a78bfa",
  contract: "#f97316",
  accountCreation: "#22d3ee",
  creationFlow: "#84cc16",
};

const AFFILIATE_JOURNEY_FOLDER_DEFINITIONS: AffiliateJourneyFolderDefinition[] = [
  {
    key: "commercial",
    label: "Comercial",
    sourceLabel: "1. Comercial",
    description: "Entrada inicial do expert e aquisicao comercial.",
    order: 10,
    matchers: ["1. comercial"],
  },
  {
    key: "approvalContract",
    label: "Aprovacao e Contrato",
    sourceLabel: "2. Aprovação e Contrato",
    description: "Compliance, validacao e preparacao do expert para entrada.",
    order: 20,
    matchers: ["2. aprovacao e contrato"],
  },
  {
    key: "contractManagement",
    label: "Gestao de Contratos",
    sourceLabel: "2.3 Gestão de contratos",
    description: "Fluxo dedicado aos contratos e formalizacao da jornada.",
    order: 30,
    matchers: ["2.3 gestao de contratos", "gestao de contratos"],
  },
  {
    key: "followup",
    label: "Acompanhamento",
    sourceLabel: "3. Acompanhamento [Expert]",
    description: "Carteiras e acompanhamento continuo dos experts ativos.",
    order: 40,
    matchers: ["3. acompanhamento [expert]", "3. acompanhamento", "acompanhamento [expert]"],
  },
  {
    key: "analysis",
    label: "Analise",
    sourceLabel: "Controle",
    description: "Hub consolidado de status para leitura rapida da esteira.",
    order: 50,
    matchers: ["controle"],
  },
];

const AFFILIATE_JOURNEY_ACCENT_MAP: Record<string, string> = {
  commercial: "#f59e0b",
  approvalContract: "#a78bfa",
  contractManagement: "#f97316",
  followup: "#22d3ee",
  analysis: "#60a5fa",
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

const resolveAffiliateJourneyFolderDefinition = (
  label: string | null | undefined
): AffiliateJourneyFolderDefinition | null => {
  const normalized = normalizeLooseText(label);
  if (!normalized) return null;

  return (
    AFFILIATE_JOURNEY_FOLDER_DEFINITIONS.find((definition) =>
      definition.matchers.some((matcher) => normalized.includes(normalizeLooseText(matcher)))
    ) || null
  );
};

const buildAffiliateJourneyCards = (
  nodes: NavigationNode[],
  pipelineBlocks: PipelineBlock[]
): AffiliateJourneyCardData[] => {
  if (!Array.isArray(nodes) || !nodes.length) return [];

  const blockRegistry = new Map(pipelineBlocks.map((block) => [block.id, block]));
  const folderRegistry = new Map<string, { definition: AffiliateJourneyFolderDefinition; node: NavigationNode }>();

  const visitNode = (node: NavigationNode) => {
    if (node.scopeType === "folder") {
      const definition = resolveAffiliateJourneyFolderDefinition(node.label);
      if (definition) {
        folderRegistry.set(definition.key, { definition, node });
      }
    }

    (node.children || []).forEach((child) => visitNode(child));
  };

  nodes.forEach((node) => visitNode(node));

  return AFFILIATE_JOURNEY_FOLDER_DEFINITIONS.map((definition) => {
    const match = folderRegistry.get(definition.key);
    if (!match) return null;

    const items = (match.node.children || [])
      .filter((child) => child.scopeType === "list" && child.scopeId)
      .sort((left, right) => left.label.localeCompare(right.label, "pt-BR", { numeric: true, sensitivity: "base" }))
      .map((child): AffiliateJourneyListItem => {
        const blockId = `list:${String(child.scopeId)}`;
        const block = blockRegistry.get(blockId);
        return {
          id: child.id,
          blockId,
          label: child.label,
          taskCount: child.taskCount ?? block?.total ?? 0,
          open: block?.open ?? 0,
          closed: block?.closed ?? 0,
          overdue: block?.overdue ?? 0,
        };
      });

    return {
      key: definition.key,
      label: definition.label,
      sourceLabel: match.node.label || definition.sourceLabel,
      description: definition.description,
      totalTasks: match.node.taskCount ?? items.reduce((sum, item) => sum + item.taskCount, 0),
      listCount: items.length,
      items,
    };
  })
    .filter((card): card is AffiliateJourneyCardData => Boolean(card?.items.length))
    .sort((left, right) => {
      const leftDefinition = AFFILIATE_JOURNEY_FOLDER_DEFINITIONS.find((entry) => entry.key === left.key);
      const rightDefinition = AFFILIATE_JOURNEY_FOLDER_DEFINITIONS.find((entry) => entry.key === right.key);
      return (leftDefinition?.order || 999) - (rightDefinition?.order || 999);
    });
};

const formatDateTime = (value?: string | null): string => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("pt-BR");
};

const formatCompactDateTime = (value?: string | null): string => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const sumTrendCurrent = (trend: SparkPoint[]): number =>
  trend.reduce(
    (sum, point) => sum + (Number.isFinite(point.current) ? Number(point.current) : 0),
    0
  );

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
      pipelineLabel: identity.label,
      pipelineHierarchy: identity.hierarchy,
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
    normalized.includes("assinad") ||
    normalized.includes("finaliz") ||
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
    normalized.includes("iniciad") ||
    normalized.includes("novo expert") ||
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
        pipelineLabel: resolvePipelineIdentity(row).label,
        pipelineHierarchy: resolvePipelineIdentity(row).hierarchy,
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

const resolveChecklistToneClass = (tone: FocusChecklistItem["tone"]): string => {
  if (tone === "rose") return "border-rose-500/25 bg-rose-500/10 text-rose-200";
  if (tone === "emerald") return "border-emerald-500/25 bg-emerald-500/10 text-emerald-200";
  if (tone === "orange") return "border-amber-500/25 bg-amber-500/10 text-amber-100";
  if (tone === "cyan") return "border-cyan-500/25 bg-cyan-500/10 text-cyan-100";
  return "border-slate-500/20 bg-slate-500/10 text-slate-200";
};

const resolveStageOrderWeight = (status: string): number => {
  const normalized = String(status || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

  if (
    normalized.includes("recebid") ||
    normalized.includes("na fila") ||
    normalized.includes("fila") ||
    normalized.includes("queue") ||
    normalized.includes("backlog") ||
    normalized.includes("a fazer") ||
    normalized.includes("to do") ||
    normalized.includes("todo")
  ) {
    return 10;
  }

  if (
    normalized.includes("valida") ||
    normalized.includes("review") ||
    normalized.includes("aguard") ||
    normalized.includes("hold") ||
    normalized.includes("blocked") ||
    normalized.includes("financeir")
  ) {
    return 45;
  }

  if (
    normalized.includes("trabalhand") ||
    normalized.includes("andamento") ||
    normalized.includes("progress") ||
    normalized.includes("doing")
  ) {
    return 30;
  }

  if (
    normalized.includes("pronto") ||
    normalized.includes("aprovad") ||
    normalized.includes("liberad") ||
    normalized.includes("done") ||
    normalized.includes("closed") ||
    normalized.includes("conclu")
  ) {
    return 90;
  }

  return 60;
};

const resolveAssigneeAccent = (block: AssigneeMetricsBlock): string => {
  const paletteKey = `${block.id}:${block.assignee}`;
  return ASSIGNEE_ACCENT_PALETTE[resolveStablePaletteIndex(paletteKey)];
};

const normalizeLooseText = (value?: string | null): string =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const normalizeExpertTaskName = (value?: string | null): string =>
  String(value || "")
    .replace(/\s*\[[^\]]+\]\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();

const resolveAffiliateStageDefinition = (row: DashboardDetailRow): AffiliateStageDefinition | null => {
  const combined = `${normalizeLooseText(row.folder)} ${normalizeLooseText(row.list)}`.trim();
  if (!combined) return null;

  return (
    AFFILIATE_STAGE_DEFINITIONS.find((definition) =>
      definition.matchers.some((matcher) => combined.includes(normalizeLooseText(matcher)))
    ) || null
  );
};

const isAffiliateProcessRow = (row: DashboardDetailRow): boolean => {
  return Boolean(resolveAffiliateStageDefinition(row));
};

const resolveAffiliateRowTimestamp = (row: DashboardDetailRow): number =>
  parseDateMs(row.referenceAt) ??
  parseDateMs(row.updatedAt) ??
  parseDateMs(row.statusChangedAt) ??
  parseDateMs(row.createdAt) ??
  0;

const chooseAffiliateCurrentRow = (
  current: DashboardDetailRow | undefined,
  next: DashboardDetailRow
): DashboardDetailRow => {
  if (!current) return next;

  const currentTs = resolveAffiliateRowTimestamp(current);
  const nextTs = resolveAffiliateRowTimestamp(next);
  if (nextTs !== currentTs) return nextTs > currentTs ? next : current;

  if (current.isClosed !== next.isClosed) return next.isClosed ? current : next;
  if (current.isOverdue !== next.isOverdue) return next.isOverdue ? next : current;
  return next.id > current.id ? next : current;
};

const buildAffiliateProcessCell = (row: DashboardDetailRow): AffiliateProcessCell => ({
  taskId: row.id,
  taskName: normalizeLabel(row.name, "Sem titulo"),
  url: row.url || null,
  status: normalizeLabel(row.status, "Sem status"),
  statusType: normalizeLabel(row.statusType, "custom"),
  assignee: normalizeLabel(row.assignee, "Sem responsavel"),
  dueAt: row.dueAt || null,
  updatedAt: row.updatedAt || row.referenceAt || null,
  isClosed: Boolean(row.isClosed),
  isOverdue: Boolean(row.isOverdue),
  processLabel: normalizeLabel(row.list, "Sem lista"),
  folderLabel: normalizeLabel(row.folder, "Sem pasta"),
});

const buildAffiliateStatusBoard = (rows: DashboardDetailRow[]): AffiliateStatusBoardData => {
  if (!rows.length) {
    return {
      columns: [],
      rows: [],
      totalOpenCells: 0,
      totalClosedCells: 0,
      totalOverdueCells: 0,
    };
  }

  const candidateRows = rows.filter((row) => isAffiliateProcessRow(row));
  const hubRows = candidateRows.filter(
    (row) => normalizeLooseText(row.list) === normalizeLooseText(AFFILIATE_HUB_LIST_NAME)
  );

  if (!hubRows.length) {
    return {
      columns: [],
      rows: [],
      totalOpenCells: 0,
      totalClosedCells: 0,
      totalOverdueCells: 0,
    };
  }

  const columns = AFFILIATE_STAGE_DEFINITIONS.map((definition) => ({
    key: definition.key,
    label: definition.label,
    sourceLabel: definition.sourceLabel,
    order: definition.order,
  })).sort((left, right) => left.order - right.order);

  const expertsMap = new Map<
    string,
    {
      id: string;
      expertName: string;
      expertCode: string;
      hubUrl: string | null;
      latestAt: number;
      tasksByProcess: Map<string, DashboardDetailRow>;
    }
  >();

  hubRows.forEach((row) => {
    const expertName = normalizeExpertTaskName(row.name);
    if (!expertName) return;

    const expertKey = normalizeIdLabel(expertName);
    const expertEntry =
      expertsMap.get(expertKey) ||
      {
        id: `affiliate:${expertKey}`,
        expertName,
        expertCode: row.id,
        hubUrl: row.url || null,
        latestAt: 0,
        tasksByProcess: new Map<string, DashboardDetailRow>(),
      };

    const currentHubRow = expertEntry.tasksByProcess.get("acquisition");
    const selectedHubRow = chooseAffiliateCurrentRow(currentHubRow, row);
    expertEntry.latestAt = Math.max(expertEntry.latestAt, resolveAffiliateRowTimestamp(selectedHubRow));
    expertEntry.expertCode = selectedHubRow.id;
    expertEntry.hubUrl = selectedHubRow.url || expertEntry.hubUrl;
    expertEntry.tasksByProcess.set(
      "acquisition",
      selectedHubRow
    );

    if (!expertsMap.has(expertKey)) {
      expertsMap.set(expertKey, expertEntry);
    }
  });

  candidateRows.forEach((row) => {
    const stageDefinition = resolveAffiliateStageDefinition(row);
    if (!stageDefinition || stageDefinition.key === "acquisition") return;

    const expertName = normalizeExpertTaskName(row.name);
    if (!expertName) return;

    const expertEntry = expertsMap.get(normalizeIdLabel(expertName));
    if (!expertEntry) return;

    expertEntry.latestAt = Math.max(expertEntry.latestAt, resolveAffiliateRowTimestamp(row));
    expertEntry.tasksByProcess.set(
      stageDefinition.key,
      chooseAffiliateCurrentRow(expertEntry.tasksByProcess.get(stageDefinition.key), row)
    );
  });

  let totalOpenCells = 0;
  let totalClosedCells = 0;
  let totalOverdueCells = 0;

  const affiliateRows = Array.from(expertsMap.values())
    .map((entry): AffiliateExpertRow => {
      const cells: Record<string, AffiliateProcessCell> = {};
      let openCount = 0;
      let closedCount = 0;
      let overdueCount = 0;

      entry.tasksByProcess.forEach((row, processKey) => {
        if (row.isClosed) closedCount += 1;
        else openCount += 1;
        if (row.isOverdue) overdueCount += 1;

        cells[processKey] = buildAffiliateProcessCell(row);
      });

      totalOpenCells += openCount;
      totalClosedCells += closedCount;
      totalOverdueCells += overdueCount;

      return {
        id: entry.id,
        expertName: entry.expertName,
        expertCode: entry.expertCode,
        hubUrl: entry.hubUrl,
        latestAt: entry.latestAt,
        openCount,
        closedCount,
        overdueCount,
        cells,
      };
    })
    .sort((left, right) => {
      if (right.overdueCount !== left.overdueCount) return right.overdueCount - left.overdueCount;
      return left.expertName.localeCompare(right.expertName, "pt-BR");
    });

  return {
    columns,
    rows: affiliateRows,
    totalOpenCells,
    totalClosedCells,
    totalOverdueCells,
  };
};

const buildDailyFocusChecklist = ({
  criticalPriorityQueue,
  overdueTotal,
  backlog,
  wipTotal,
  doneToday,
}: {
  criticalPriorityQueue: number;
  overdueTotal: number;
  backlog: number;
  wipTotal: number;
  doneToday: number;
}): FocusChecklistItem[] => {
  const items: FocusChecklistItem[] = [];

  if (criticalPriorityQueue > 0) {
    items.push({
      id: "critical",
      label: `Triar ${criticalPriorityQueue} tarefas criticas (P0/P1)`,
      tone: "rose",
    });
  } else {
    items.push({
      id: "critical-clear",
      label: "Fila critica zerada",
      tone: "emerald",
    });
  }

  if (overdueTotal > 0) {
    items.push({
      id: "overdue",
      label: `Desbloquear ${overdueTotal} tarefas atrasadas`,
      tone: "orange",
    });
  } else {
    items.push({
      id: "overdue-clear",
      label: "Sem atrasos em aberto no momento",
      tone: "emerald",
    });
  }

  if (backlog === 0) {
    items.push({
      id: "backlog-empty",
      label: "Mover novas tarefas para a fila",
      tone: "cyan",
    });
  } else {
    items.push({
      id: "backlog",
      label: `Atacar ${backlog} itens na fila de entrada`,
      tone: backlog >= 12 ? "orange" : "cyan",
    });
  }

  if (wipTotal > 15) {
    items.push({
      id: "wip-high",
      label: `Atencao limite W.I.P: ${wipTotal} tarefas`,
      tone: "rose",
    });
  } else {
    items.push({
      id: "wip-ok",
      label: `W.I.P controlado: ${wipTotal} tarefas`,
      tone: "cyan",
    });
  }

  if (doneToday <= 0) {
    items.push({
      id: "done-today",
      label: "Garantir a primeira entrega do dia",
      tone: "slate",
    });
  } else {
    items.push({
      id: "done-today-ok",
      label: `${doneToday} entregas registradas hoje`,
      tone: "emerald",
    });
  }

  return items;
};

const buildKanbanColumns = (block: PipelineBlock | null, activeStage: string | null): KanbanColumn[] => {
  if (!block) return [];

  const tasks = sortPipelineTasks(block.tasks);
  const stageRegistry = new Map<string, KanbanColumn>();

  block.stages.forEach((stage) => {
    const status = normalizeLabel(stage.status, "Sem status");
    stageRegistry.set(status, {
      id: `stage:${normalizeIdLabel(status)}`,
      status,
      color: stageColor(status),
      total: stage.value,
      overdue: stage.overdue,
      tasks: [],
    });
  });

  tasks.forEach((task) => {
    const status = normalizeLabel(task.status, "Sem status");
    const current =
      stageRegistry.get(status) ||
      {
        id: `stage:${normalizeIdLabel(status)}`,
        status,
        color: stageColor(status),
        total: 0,
        overdue: 0,
        tasks: [],
      };
    current.tasks.push(task);
    current.total = Math.max(current.total, current.tasks.length);
    current.overdue = current.tasks.filter((item) => item.isOverdue).length;
    stageRegistry.set(status, current);
  });

  const columns = Array.from(stageRegistry.values()).sort((left, right) => {
    const orderDiff = resolveStageOrderWeight(left.status) - resolveStageOrderWeight(right.status);
    if (orderDiff !== 0) return orderDiff;
    if (right.total !== left.total) return right.total - left.total;
    return left.status.localeCompare(right.status);
  });

  if (!activeStage) return columns;
  return columns.filter((column) => stageStatusMatches(column.status, activeStage));
};

const applyKanbanStatusOverrides = (
  block: PipelineBlock | null,
  overrides: Record<string, KanbanTaskOverride>
): PipelineBlock | null => {
  if (!block) return null;

  let hasOverride = false;
  const tasks = block.tasks.map((task) => {
    const override = overrides[task.id];
    if (!override || stageStatusMatches(task.status, override.status)) {
      return task;
    }

    hasOverride = true;
    return {
      ...task,
      status: override.status,
    };
  });

  if (!hasOverride) return block;

  const stageRegistry = new Map<string, PipelineStagePoint>();
  block.stages.forEach((stage) => {
    const status = normalizeLabel(stage.status, "Sem status");
    stageRegistry.set(status, {
      status,
      value: 0,
      overdue: 0,
    });
  });

  tasks.forEach((task) => {
    const status = normalizeLabel(task.status, "Sem status");
    const current = stageRegistry.get(status) || { status, value: 0, overdue: 0 };
    current.value += 1;
    if (task.isOverdue) current.overdue += 1;
    stageRegistry.set(status, current);
  });

  const stages = Array.from(stageRegistry.values()).sort((left, right) => {
    const orderDiff = resolveStageOrderWeight(left.status) - resolveStageOrderWeight(right.status);
    if (orderDiff !== 0) return orderDiff;
    if (right.value !== left.value) return right.value - left.value;
    return left.status.localeCompare(right.status);
  });

  return {
    ...block,
    tasks,
    stages,
  };
};

const buildGlobalKanbanBlock = (blocks: PipelineBlock[]): PipelineBlock | null => {
  if (!blocks.length) return null;

  const total = blocks.reduce((sum, block) => sum + block.total, 0);
  const open = blocks.reduce((sum, block) => sum + block.open, 0);
  const closed = blocks.reduce((sum, block) => sum + block.closed, 0);
  const overdue = blocks.reduce((sum, block) => sum + block.overdue, 0);
  const tasks = blocks.flatMap((block) =>
    block.tasks.map((task) => ({
      ...task,
      pipelineLabel: task.pipelineLabel || block.label,
      pipelineHierarchy: task.pipelineHierarchy || block.hierarchy,
    }))
  );

  const stageMap = new Map<string, PipelineStagePoint>();
  const assigneeMap = new Map<string, PipelineAssigneePoint>();

  tasks.forEach((task) => {
    const stageKey = normalizeLabel(task.status, "Sem status");
    const stage = stageMap.get(stageKey) || { status: stageKey, value: 0, overdue: 0 };
    stage.value += 1;
    if (task.isOverdue) stage.overdue += 1;
    stageMap.set(stageKey, stage);

    const assigneeKey = normalizeLabel(task.assignee, "Sem responsavel");
    const assignee = assigneeMap.get(assigneeKey) || { assignee: assigneeKey, value: 0, overdue: 0 };
    if (!task.isClosed) assignee.value += 1;
    if (task.isOverdue) assignee.overdue += 1;
    assigneeMap.set(assigneeKey, assignee);
  });

  const stages = Array.from(stageMap.values()).sort((left, right) => {
    const orderDiff = resolveStageOrderWeight(left.status) - resolveStageOrderWeight(right.status);
    if (orderDiff !== 0) return orderDiff;
    if (right.value !== left.value) return right.value - left.value;
    return left.status.localeCompare(right.status);
  });

  const assignees = Array.from(assigneeMap.values()).sort((left, right) => {
    if (right.overdue !== left.overdue) return right.overdue - left.overdue;
    if (right.value !== left.value) return right.value - left.value;
    return left.assignee.localeCompare(right.assignee);
  });

  return {
    id: "kanban:all",
    label: "Todos os processos",
    hierarchy: `${blocks.length} processos ativos no kanban`,
    total,
    open,
    closed,
    overdue,
    completionPct: total > 0 ? Number(((closed / total) * 100).toFixed(1)) : 0,
    trend: [],
    stages,
    assignees,
    tasks,
  };
};

const resolveActionErrorMessage = (error: unknown, fallback: string): string => {
  if (error && typeof error === "object") {
    const candidate = error as {
      response?: { data?: { error?: unknown; details?: unknown } };
      message?: unknown;
    };

    const apiError = candidate.response?.data?.error;
    if (typeof apiError === "string" && apiError.trim()) {
      return apiError;
    }

    const apiDetails = candidate.response?.data?.details;
    if (typeof apiDetails === "string" && apiDetails.trim()) {
      return apiDetails;
    }

    if (typeof candidate.message === "string" && candidate.message.trim()) {
      return candidate.message;
    }
  }

  return fallback;
};

function useMobileDisclosure(isCollapsible: boolean) {
  const [isExpanded, setIsExpanded] = useState(() => !isCollapsible);

  useEffect(() => {
    if (!isCollapsible) {
      setIsExpanded(true);
    } else {
      setIsExpanded(false);
    }
  }, [isCollapsible]);

  const toggle = useCallback(() => {
    if (!isCollapsible) return;
    setIsExpanded((current) => !current);
  }, [isCollapsible]);

  return {
    isExpanded,
    toggle,
    shouldRenderBody: !isCollapsible || isExpanded,
  };
}

function MobileCollapseToggle({
  isExpanded,
  onToggle,
  label,
}: {
  isExpanded: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={isExpanded}
      aria-label={label}
      className={`mobile-collapse-toggle ${isExpanded ? "is-expanded" : ""}`}
    >
      <span>{isExpanded ? "Ocultar" : "Ver"}</span>
      <ChevronDown className="mobile-collapse-toggle-icon h-3.5 w-3.5" />
    </button>
  );
}

function NativeDashboardApp() {
  const refreshMs = FIXED_REFRESH_MS;
  const [theme, setTheme] = useState<DashboardTheme>(resolveInitialTheme);
  const [viewportProfile, setViewportProfile] = useState<ViewportProfile>(() =>
    typeof window === "undefined" ? "desktop" : resolveViewportProfile(window.innerWidth)
  );
  const [activeView, setActiveView] = useState<DashboardMainView>("resumo");
  const [assigneeSearch, setAssigneeSearch] = useState("");
  const [peopleLayoutMode, setPeopleLayoutMode] = useState<PeopleLayoutMode>("list");
  const [dashboardFilters] = useState({
    periodDays: 30,
    status: "",
    category: "",
    assignee: "",
    priority: "",
    page: 1,
    pageSize: 5000,
  });
  const [selectedPipelineId, setSelectedPipelineId] = useState("all");
  const [pipelineOverviewMode, setPipelineOverviewMode] = useState<"affiliate" | "processes">("affiliate");
  const [pipelineTaskModal, setPipelineTaskModal] = useState<PipelineTaskModalState | null>(null);
  const [kanbanTaskOverrides, setKanbanTaskOverrides] = useState<Record<string, KanbanTaskOverride>>({});
  const [draggedKanbanTaskId, setDraggedKanbanTaskId] = useState<string | null>(null);
  const [dragOverKanbanStage, setDragOverKanbanStage] = useState<string | null>(null);
  const [kanbanSyncError, setKanbanSyncError] = useState<string | null>(null);
  const [checklistState, setChecklistState] = useState<Record<string, boolean>>({});
  const [affiliateSourceRows, setAffiliateSourceRows] = useState<DashboardDetailRow[]>([]);
  const [affiliateSourceLoading, setAffiliateSourceLoading] = useState(false);

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
    changeTeam,
    refreshNow,
  } = useClickUpData(refreshMs, dashboardFilters);

  useEffect(() => {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Ignore storage restrictions.
    }
  }, [theme]);

  useEffect(() => {
    if (typeof document === "undefined") return;

    const html = document.documentElement;
    const body = document.body;
    const root = document.getElementById("root");
    const backgroundColor = theme === "light" ? "#dfe8f2" : "#161b23";
    const textColor = theme === "light" ? "#0f172a" : "#e8eef8";

    const previous = {
      htmlBackground: html.style.background,
      htmlBackgroundColor: html.style.backgroundColor,
      htmlColorScheme: html.style.colorScheme,
      bodyBackground: body.style.background,
      bodyBackgroundColor: body.style.backgroundColor,
      bodyColor: body.style.color,
      bodyMinHeight: body.style.minHeight,
      bodyOverflowX: body.style.overflowX,
      bodyOverscrollBehaviorY: body.style.overscrollBehaviorY,
      rootBackground: root?.style.background ?? "",
      rootBackgroundColor: root?.style.backgroundColor ?? "",
      rootMinHeight: root?.style.minHeight ?? "",
    };

    html.classList.add("native-dashboard-active");
    body.classList.add("native-dashboard-active");
    root?.classList.add("native-dashboard-active");

    html.style.background = backgroundColor;
    html.style.backgroundColor = backgroundColor;
    html.style.colorScheme = theme;
    body.style.background = backgroundColor;
    body.style.backgroundColor = backgroundColor;
    body.style.color = textColor;
    body.style.minHeight = "100dvh";
    body.style.overflowX = "hidden";
    body.style.overscrollBehaviorY = "none";

    if (root) {
      root.style.background = backgroundColor;
      root.style.backgroundColor = backgroundColor;
      root.style.minHeight = "100dvh";
    }

    return () => {
      html.classList.remove("native-dashboard-active");
      body.classList.remove("native-dashboard-active");
      root?.classList.remove("native-dashboard-active");

      html.style.background = previous.htmlBackground;
      html.style.backgroundColor = previous.htmlBackgroundColor;
      html.style.colorScheme = previous.htmlColorScheme;
      body.style.background = previous.bodyBackground;
      body.style.backgroundColor = previous.bodyBackgroundColor;
      body.style.color = previous.bodyColor;
      body.style.minHeight = previous.bodyMinHeight;
      body.style.overflowX = previous.bodyOverflowX;
      body.style.overscrollBehaviorY = previous.bodyOverscrollBehaviorY;

      if (root) {
        root.style.background = previous.rootBackground;
        root.style.backgroundColor = previous.rootBackgroundColor;
        root.style.minHeight = previous.rootMinHeight;
      }
    };
  }, [theme]);

  const pipelineCatalog = useMemo(() => buildPipelineCatalog(navigationTree), [navigationTree]);
  const isMobileViewport = viewportProfile === "mobile";
  const dashboardSlug = useMemo(() => {
    if (typeof window === "undefined") return "";
    return String(new URLSearchParams(window.location.search).get("slug") || "").trim();
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadAffiliateRows = async () => {
      if (!selectedTeamId && !dashboardSlug) return;

      setAffiliateSourceLoading((current) => current || affiliateSourceRows.length === 0);

      try {
        const payload = await getDashboard({
          teamId: selectedTeamId || undefined,
          scopeType: selectedScope.type,
          scopeId: selectedScope.id,
          periodDays: 3650,
          status: "",
          category: "",
          assignee: "",
          priority: "",
          page: 1,
          pageSize: 5000,
        });

        if (cancelled) return;
        setAffiliateSourceRows(payload?.details?.rows || []);
      } catch {
        if (cancelled) return;
        setAffiliateSourceRows((current) => (current.length ? current : dashboard?.details?.rows || []));
      } finally {
        if (!cancelled) setAffiliateSourceLoading(false);
      }
    };

    void loadAffiliateRows();

    return () => {
      cancelled = true;
    };
  }, [
    dashboardSlug,
    dashboard?.details?.rows,
    lastSyncAt,
    selectedScope.id,
    selectedScope.type,
    selectedTeamId,
  ]);
  const scopeKey = `${selectedScope.type}:${selectedScope.id || "all"}`;
  const checklistStorageKey = useMemo(
    () => `${CHECKLIST_STORAGE_KEY_PREFIX}:${dashboardSlug || selectedTeamId || "default"}:${scopeKey}`,
    [dashboardSlug, scopeKey, selectedTeamId]
  );

  useEffect(() => {
    setChecklistState(readChecklistState(checklistStorageKey));
  }, [checklistStorageKey]);

  useEffect(() => {
    if (typeof window === "undefined" || !checklistStorageKey) return;
    try {
      window.localStorage.setItem(checklistStorageKey, JSON.stringify(checklistState));
    } catch {
      // Ignore storage restrictions.
    }
  }, [checklistState, checklistStorageKey]);

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
  const affiliateBoardSourceRows = useMemo(
    () => (affiliateSourceRows.length ? affiliateSourceRows : detailRows),
    [affiliateSourceRows, detailRows]
  );
  const affiliateStatusBoard = useMemo(
    () => buildAffiliateStatusBoard(affiliateBoardSourceRows),
    [affiliateBoardSourceRows]
  );
  const hasAffiliateStatusBoard = affiliateSourceLoading || affiliateStatusBoard.rows.length > 0;
  const detailStatusMap = useMemo(
    () => new Map(detailRows.map((row) => [String(row.id), normalizeLabel(row.status, "Sem status")])),
    [detailRows]
  );
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
  const affiliateJourneyCards = useMemo(
    () => buildAffiliateJourneyCards(navigationTree, pipelineBlocks),
    [navigationTree, pipelineBlocks]
  );
  const affiliateStageOverview = useMemo<AffiliateStageOverviewCard[]>(
    () =>
      affiliateStatusBoard.columns.map((column) => {
        const experts = affiliateStatusBoard.rows
          .map((row) => {
            const cell = row.cells[column.key];
            if (!cell) return null;

            return {
              id: `${row.id}:${column.key}`,
              expertName: row.expertName,
              expertCode: row.expertCode,
              status: cell.status,
              url: cell.url || row.hubUrl,
              isClosed: cell.isClosed,
              isOverdue: cell.isOverdue,
            };
          })
          .filter((item): item is AffiliateStageOverviewExpert => Boolean(item))
          .sort((left, right) => {
            if (Number(right.isOverdue) !== Number(left.isOverdue)) {
              return Number(right.isOverdue) - Number(left.isOverdue);
            }
            if (Number(left.isClosed) !== Number(right.isClosed)) {
              return Number(left.isClosed) - Number(right.isClosed);
            }
            return left.expertName.localeCompare(right.expertName, "pt-BR");
          });

        const open = experts.filter((item) => !item.isClosed).length;
        const closed = experts.filter((item) => item.isClosed).length;
        const overdue = experts.filter((item) => item.isOverdue).length;
        const accentSource = experts.find((item) => item.isOverdue)?.status || experts[0]?.status || column.label;

        return {
          key: column.key,
          label: column.label,
          sourceLabel: column.sourceLabel,
          total: experts.length,
          open,
          closed,
          overdue,
          accent: AFFILIATE_STAGE_ACCENT_MAP[column.key] || stageColor(accentSource),
          experts,
        };
      }),
    [affiliateStatusBoard.columns, affiliateStatusBoard.rows]
  );
  const affiliateJourneyListCount = useMemo(
    () => affiliateJourneyCards.reduce((sum, card) => sum + card.listCount, 0),
    [affiliateJourneyCards]
  );
  const affiliateJourneyTaskTotal = useMemo(
    () => affiliateJourneyCards.reduce((sum, card) => sum + card.totalTasks, 0),
    [affiliateJourneyCards]
  );
  const affiliateJourneySummaries = useMemo<AffiliateJourneySummaryCard[]>(
    () =>
      affiliateJourneyCards.map((card) => {
        const items = [...card.items].sort((left, right) => {
          if (right.overdue !== left.overdue) return right.overdue - left.overdue;
          if (right.open !== left.open) return right.open - left.open;
          return right.taskCount - left.taskCount;
        });

        return {
          key: card.key,
          label: card.label,
          sourceLabel: card.sourceLabel,
          totalTasks: card.totalTasks,
          listCount: card.listCount,
          open: items.reduce((sum, item) => sum + item.open, 0),
          closed: items.reduce((sum, item) => sum + item.closed, 0),
          overdue: items.reduce((sum, item) => sum + item.overdue, 0),
          accent:
            AFFILIATE_JOURNEY_ACCENT_MAP[card.key] ||
            ASSIGNEE_ACCENT_PALETTE[resolveStablePaletteIndex(card.key)],
        };
      }),
    [affiliateJourneyCards]
  );

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

  const globalKanbanBlockBase = useMemo(() => buildGlobalKanbanBlock(pipelineBlocks), [pipelineBlocks]);

  const globalKanbanBlock = useMemo(
    () => applyKanbanStatusOverrides(globalKanbanBlockBase, kanbanTaskOverrides),
    [globalKanbanBlockBase, kanbanTaskOverrides]
  );

  const taskModalBlockRegistry = useMemo(() => {
    const registry = new Map<string, PipelineBlock>();
    pipelineBlocks.forEach((block) => registry.set(block.id, block));
    assigneePipelineBlocks.forEach((block) => registry.set(block.id, block));
    if (globalKanbanBlock) registry.set(globalKanbanBlock.id, globalKanbanBlock);
    return registry;
  }, [assigneePipelineBlocks, globalKanbanBlock, pipelineBlocks]);

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

  const activeKanbanBlock = globalKanbanBlock;

  const kanbanColumns = useMemo(
    () => buildKanbanColumns(activeKanbanBlock, null),
    [activeKanbanBlock]
  );

  const visibleKanbanTasks = useMemo(() => {
    if (!activeKanbanBlock) return [];
    const sorted = sortPipelineTasks(activeKanbanBlock.tasks);
    return sorted;
  }, [activeKanbanBlock]);

  const pendingKanbanTaskIds = useMemo(
    () =>
      Object.entries(kanbanTaskOverrides)
        .filter(([, override]) => override.pending)
        .map(([taskId]) => taskId),
    [kanbanTaskOverrides]
  );
  const kanbanBoardStyle = useMemo<CSSProperties>(() => {
    const columnsCount = Math.max(kanbanColumns.length, 1);
    const minColumnWidth =
      viewportProfile === "mobile" ? 272 : viewportProfile === "tv" ? 244 : 220;
    const columnGap = viewportProfile === "tv" ? 16 : 12;

    return {
      gridTemplateColumns: `repeat(${columnsCount}, minmax(${minColumnWidth}px, 1fr))`,
      minWidth: `max(100%, ${columnsCount * minColumnWidth + Math.max(columnsCount - 1, 0) * columnGap}px)`,
    };
  }, [kanbanColumns.length, viewportProfile]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const syncViewportProfile = () => {
      setViewportProfile(resolveViewportProfile(window.innerWidth));
    };

    syncViewportProfile();
    window.addEventListener("resize", syncViewportProfile);
    return () => window.removeEventListener("resize", syncViewportProfile);
  }, []);

  useEffect(() => {
    setKanbanTaskOverrides((current) => {
      let changed = false;
      const next = { ...current };

      Object.entries(current).forEach(([taskId, override]) => {
        const sourceStatus = detailStatusMap.get(taskId);
        if (sourceStatus && stageStatusMatches(sourceStatus, override.status)) {
          delete next[taskId];
          changed = true;
        }
      });

      return changed ? next : current;
    });
  }, [detailStatusMap]);

  const syncTaskToKanbanStage = useCallback(
    async (task: PipelineTaskItem, nextStatus: string) => {
      if (!task.id || stageStatusMatches(task.status, nextStatus)) return;

      const normalizedNextStatus = normalizeLabel(nextStatus, task.status);
      setKanbanSyncError(null);
      setKanbanTaskOverrides((current) => ({
        ...current,
        [task.id]: {
          status: normalizedNextStatus,
          previousStatus: task.status,
          pending: true,
          updatedAt: Date.now(),
        },
      }));

      try {
        await updateDashboardTaskStatus({
          taskId: task.id,
          status: normalizedNextStatus,
        });

        setKanbanTaskOverrides((current) => {
          const currentOverride = current[task.id];
          if (!currentOverride) return current;
          return {
            ...current,
            [task.id]: {
              ...currentOverride,
              status: normalizedNextStatus,
              pending: false,
              updatedAt: Date.now(),
            },
          };
        });

        refreshNow();
      } catch (error) {
        setKanbanTaskOverrides((current) => {
          if (!current[task.id]) return current;
          const next = { ...current };
          delete next[task.id];
          return next;
        });
        setKanbanSyncError(
          resolveActionErrorMessage(error, "Falha ao atualizar a etapa da tarefa no ClickUp.")
        );
      }
    },
    [refreshNow]
  );

  const handleKanbanTaskDragStart = useCallback(
    (event: ReactDragEvent<HTMLElement>, task: PipelineTaskItem, blockId: string) => {
      const payload: KanbanDragPayload = {
        taskId: task.id,
        blockId,
        fromStatus: task.status,
      };

      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("application/json", JSON.stringify(payload));
      event.dataTransfer.setData("text/plain", task.id);
      setDraggedKanbanTaskId(task.id);
      setKanbanSyncError(null);
    },
    []
  );

  const handleKanbanTaskDragEnd = useCallback(() => {
    setDraggedKanbanTaskId(null);
    setDragOverKanbanStage(null);
  }, []);

  const handleKanbanStageDragOver = useCallback(
    (event: ReactDragEvent<HTMLElement>, targetStatus: string) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      if (!stageStatusMatches(dragOverKanbanStage, targetStatus)) {
        setDragOverKanbanStage(targetStatus);
      }
    },
    [dragOverKanbanStage]
  );

  const handleKanbanStageDrop = useCallback(
    async (event: ReactDragEvent<HTMLElement>, targetStatus: string) => {
      event.preventDefault();
      setDragOverKanbanStage(null);
      setDraggedKanbanTaskId(null);

      const rawPayload =
        event.dataTransfer.getData("application/json") || event.dataTransfer.getData("text/plain");
      if (!rawPayload || !activeKanbanBlock) return;

      let payload: KanbanDragPayload | null = null;

      try {
        payload = rawPayload.startsWith("{")
          ? (JSON.parse(rawPayload) as KanbanDragPayload)
          : {
              taskId: rawPayload,
              blockId: activeKanbanBlock.id,
              fromStatus: "",
            };
      } catch {
        payload = null;
      }

      if (!payload?.taskId || payload.blockId !== activeKanbanBlock.id) return;

      const task = activeKanbanBlock.tasks.find((item) => item.id === payload?.taskId);
      if (!task || stageStatusMatches(task.status, targetStatus)) return;

      await syncTaskToKanbanStage(task, targetStatus);
    },
    [activeKanbanBlock, syncTaskToKanbanStage]
  );

  const peopleListDataset = useMemo(
    () =>
      visiblePeopleMetrics.map((person) => ({
        id: person.id,
        assignee: person.assignee,
        accent: resolveAssigneeAccent(person),
        completed: person.closed,
        completionPct: person.completionPct,
        open: person.open,
        overdue: person.overdue,
        trend: person.trend,
      })),
    [visiblePeopleMetrics]
  );

  const expertMovementDataset = useMemo(() => {
    if (affiliateStatusBoard.rows.length) {
      return affiliateStatusBoard.rows
        .map((row) => ({
          label: row.expertName,
          value: row.openCount,
        }))
        .filter((item) => item.value > 0)
        .slice(0, 8);
    }

    return visiblePeopleMetrics
      .map((person) => {
        const recentMovement = sumTrendCurrent(person.trend);
        return {
          label: person.assignee,
          value: recentMovement > 0 ? recentMovement : person.open,
        };
      })
      .filter((item) => item.value > 0)
      .slice(0, 8);
  }, [affiliateStatusBoard.rows, visiblePeopleMetrics]);

  const processMovementDataset = useMemo(
    () =>
      pipelineBlocks
        .map((block) => {
          const recentMovement = sumTrendCurrent(block.trend);
          return {
            label: block.label,
            value: recentMovement > 0 ? recentMovement : block.open,
          };
        })
        .filter((item) => item.value > 0)
        .slice(0, 8),
    [pipelineBlocks]
  );

  const stageMovementDataset = useMemo(
    () =>
      kanbanColumns
        .map((column) => ({
          label: column.status,
          value: column.total,
        }))
        .filter((item) => item.value > 0)
        .slice(0, 8),
    [kanbanColumns]
  );

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

  if (loading && !dashboard) {
    return (
      <div
        className={`dashboard-root min-h-screen text-slate-100 ${theme === "light" ? "theme-light" : ""}`}
        data-viewport={viewportProfile}
      >
        <div className="dashboard-shell">
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-5">
            {[1, 2, 3, 4, 5].map((item) => <MetricSkeleton key={item} />)}
          </div>
          <div className="mt-5"><ChartSkeleton /></div>
        </div>
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

  const masterProgressSegments: MasterProgressSegment[] = (() => {
    const raw = [
      {
        id: "wip",
        label: "Em andamento",
        value: Number(counters?.wipTotal || 0),
        color: "#00f3ff",
        note: "atividade atual",
      },
      {
        id: "backlog",
        label: "Fila",
        value: Number(counters?.backlog || 0),
        color: "#47a9ff",
        note: "entrada e triagem",
      },
      {
        id: "throughput",
        label: "Vazao",
        value: Number(doneWeek || 0),
        color: "#55e986",
        note: "entrega semanal",
      },
      {
        id: "overdue",
        label: "Atrasadas",
        value: Number(overdueTotal || 0),
        color: "#ff5f87",
        note: "risco aberto",
      },
    ];

    const total = raw.reduce((sum, item) => sum + item.value, 0);
    return raw.map((item) => ({
      ...item,
      pct: total > 0 ? Number(((item.value / total) * 100).toFixed(1)) : 0,
    }));
  })();

  const dailyFocusChecklist = buildDailyFocusChecklist({
    criticalPriorityQueue,
    overdueTotal,
    backlog: Number(counters?.backlog || 0),
    wipTotal: Number(counters?.wipTotal || 0),
    doneToday,
  });

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
    <div
      className={`dashboard-root min-h-screen text-slate-100 ${theme === "light" ? "theme-light" : ""}`}
      data-view={activeView}
      data-viewport={viewportProfile}
    >
      <div
        className={`pointer-events-none fixed inset-0 -z-10 ${
          theme === "light"
            ? "bg-[radial-gradient(circle_at_8%_9%,rgba(59,130,246,0.2),transparent_36%),radial-gradient(circle_at_86%_14%,rgba(15,23,42,0.11),transparent_34%),linear-gradient(180deg,#edf3fa_0%,#dde7f2_55%,#d1dce8_100%)]"
            : "bg-[radial-gradient(circle_at_15%_12%,rgba(96,165,250,0.15),transparent_36%),radial-gradient(circle_at_82%_18%,rgba(56,189,248,0.11),transparent_32%),#161b23]"
        }`}
      />
      <main className="dashboard-shell">
        <section className="dashboard-hero panel-rise border border-cyan-500/10 bg-black/40 p-3 sm:p-4 md:p-5">
          <div className="flex flex-wrap items-start justify-between gap-1.5 sm:gap-2">
            <div className="dashboard-hero-copy">
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cyan-400/70">{dashboardHeaderTag}</p>
              <h1 className="dashboard-page-title font-display">Visao Resumida e Tendencias</h1>
              <p className="dashboard-page-subtitle text-[11px] leading-snug text-slate-400 sm:text-xs md:text-sm">Esteira ClickUp em blocos visuais, com comparativo e leitura rapida.</p>
            </div>
            <div className="grid w-full grid-cols-1 gap-1 min-[420px]:grid-cols-2 sm:gap-1.5 sm:flex sm:w-auto sm:flex-wrap">
              <label className="control-card min-w-0 sm:min-w-[126px]"><span className="control-label">Equipe</span>
                <select className="control-input" value={selectedTeamId || ""} onChange={(event) => changeTeam(event.target.value)}>
                  {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
                </select>
              </label>
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

          <div className="mt-2 grid grid-cols-1 gap-1.5 min-[420px]:grid-cols-2 sm:mt-2.5 sm:gap-2 sm:flex sm:flex-wrap sm:items-center">
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
              onClick={() => setActiveView("kanban")}
              className={`w-full rounded border px-2.5 py-1 text-center font-mono text-[10px] uppercase tracking-[0.12em] transition sm:w-auto sm:py-1.5 ${
                activeView === "kanban"
                  ? "border-cyan-400/70 bg-cyan-500/15 text-cyan-200"
                  : "border-white/15 bg-white/5 text-slate-300 hover:border-cyan-500/35"
              }`}
            >
              Kanban
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

        {activeView === "resumo" && hasAffiliateStatusBoard ? (
          <AffiliateStatusBoard
            board={affiliateStatusBoard}
            isLoading={affiliateSourceLoading}
            isCompactMobile={isMobileViewport}
          />
        ) : null}

        <section className={`${activeView === "resumo" && !hasAffiliateStatusBoard ? "panel-rise" : "hidden"} border border-cyan-500/12 bg-black/25 p-4 md:p-5`}>
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
                <div className="grid w-full grid-cols-1 gap-2 min-[480px]:grid-cols-2 xl:w-auto xl:grid-cols-4">
                  {summaryCards.map((card) => (
                    <div key={card.id} className="summary-metric rounded border border-white/10 bg-black/20 px-2 py-1.5">
                      <div className="inline-flex items-center gap-1">
                        <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-slate-400">{card.label}</p>
                        <InlineHint text={card.help} />
                      </div>
                      <div className="mt-1 flex items-center justify-between gap-2">
                        <p className="font-display text-xl font-semibold text-slate-100">{card.value}</p>
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

              <div className="chart-box chart-box-blue mt-3 rounded border border-white/10 bg-black/20 p-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="inline-flex items-center gap-1">
                    <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-slate-400">Barra de acompanhamento</p>
                    <InlineHint text={HELP_TEXT.masterProgress} />
                  </div>
                  <span className="rounded border border-white/15 bg-white/5 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-slate-300">
                    cobertura {scopeCoveragePct === null ? "--" : `${scopeCoveragePct}%`}
                  </span>
                </div>
                <div className="mt-2 overflow-hidden rounded-full border border-white/10 bg-white/5">
                  <div className="flex h-3 w-full">
                    {masterProgressSegments.map((segment) => (
                      <div
                        key={segment.id}
                        style={{
                          flex: segment.value > 0 ? `${Math.max(segment.value, 1)} 1 0` : "0 0 0",
                          background: `linear-gradient(90deg, ${segment.color}, ${segment.color}cc)`,
                        }}
                        title={`${segment.label}: ${segment.value}`}
                      />
                    ))}
                  </div>
                </div>
                <div className="mt-2 grid gap-2 min-[480px]:grid-cols-2 xl:grid-cols-4">
                  {masterProgressSegments.map((segment) => (
                    <div key={segment.id} className="rounded border border-white/10 bg-black/20 px-2 py-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.1em] text-slate-400">
                          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: segment.color }} />
                          {segment.label}
                        </span>
                        <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-slate-500">{segment.pct}%</span>
                      </div>
                      <p className="mt-1 font-display text-lg font-semibold text-slate-100">{segment.value}</p>
                      <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-slate-500">{segment.note}</p>
                    </div>
                  ))}
                </div>
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
              <div className="mt-2 grid gap-2 min-[480px]:grid-cols-2">
                {executiveMetrics.map((metric) => (
                  <InfoLine key={metric.title} title={metric.title} value={metric.value} helpText={metric.help} />
                ))}
              </div>

              <div className="chart-box chart-box-amber mt-3 rounded border border-white/10 bg-black/20 p-2.5">
                <div className="inline-flex items-center gap-1">
                  <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-slate-400">Foco diario</p>
                  <InlineHint text={HELP_TEXT.dailyFocus} />
                </div>
                <div className="mt-2 space-y-1.5">
                  {dailyFocusChecklist.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() =>
                        setChecklistState((current) => ({
                          ...current,
                          [item.id]: !current[item.id],
                        }))
                      }
                      className={`flex w-full items-start gap-2 rounded border px-2 py-1.5 text-left transition hover:-translate-y-[1px] ${resolveChecklistToneClass(item.tone)} ${
                        checklistState[item.id] ? "opacity-75" : ""
                      }`}
                    >
                      <span
                        className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] ${
                          checklistState[item.id]
                            ? "border-current bg-current text-slate-950"
                            : "border-current/60 bg-transparent text-transparent"
                        }`}
                      >
                        ✓
                      </span>
                      <p className={`text-sm leading-snug ${checklistState[item.id] ? "line-through" : ""}`}>{item.label}</p>
                    </button>
                  ))}
                </div>
              </div>
            </article>
          </div>
        </section>

        <section className={`${activeView === "resumo" ? "panel-rise" : "hidden"} border border-cyan-500/12 bg-black/25 p-4 md:p-6`}>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="flex items-center gap-2"><div className="h-3 w-[2px] bg-cyan-500" /><h2 className="dashboard-section-heading font-display font-bold uppercase tracking-wider text-slate-200">Esteira por Processo</h2></div>
              <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-slate-500">entrada dos experts, acompanhamento da jornada e leitura operacional por processo</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setPipelineOverviewMode("affiliate")}
                className={`rounded border px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] transition ${
                  pipelineOverviewMode === "affiliate"
                    ? "border-cyan-400/60 bg-cyan-500/12 text-cyan-200"
                    : "border-white/15 bg-white/5 text-slate-400 hover:border-cyan-500/35 hover:text-slate-200"
                }`}
              >
                Afiliado
              </button>
              <button
                type="button"
                onClick={() => setPipelineOverviewMode("processes")}
                className={`rounded border px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] transition ${
                  pipelineOverviewMode === "processes"
                    ? "border-cyan-400/60 bg-cyan-500/12 text-cyan-200"
                    : "border-white/15 bg-white/5 text-slate-400 hover:border-cyan-500/35 hover:text-slate-200"
                }`}
              >
                Processos
              </button>
            </div>
          </div>

          {pipelineOverviewMode === "affiliate" ? (
            <>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="rounded border border-cyan-500/35 bg-cyan-500/12 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-cyan-300">
                  Pastas da jornada: {affiliateJourneyCards.length}
                </span>
                <span className="rounded border border-white/20 bg-white/5 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-slate-300">
                  Subpastas numeradas: {affiliateJourneyListCount}
                </span>
                <span className="rounded border border-white/20 bg-white/5 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-slate-300">
                  Carga total: {affiliateJourneyTaskTotal}
                </span>
              </div>

              {affiliateJourneyCards.length ? (
                <div className="mt-4 grid gap-4 xl:grid-cols-2 2xl:grid-cols-3">
                  {affiliateJourneyCards.map((card) => (
                    <AffiliateJourneyOverviewCard
                      key={card.key}
                      card={card}
                      isCompactMobile={isMobileViewport}
                      onSelectProcess={(blockId) => {
                        setSelectedPipelineId(blockId);
                        setPipelineOverviewMode("processes");
                      }}
                    />
                  ))}
                </div>
              ) : (
                <div className="mt-4"><EmptyData message="Sem estrutura de afiliado encontrada na navegacao atual do ClickUp." /></div>
              )}
            </>
          ) : (
            <>
              <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
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

                <label className="control-card w-full min-w-0 flex-1 md:w-auto md:min-w-[320px] md:flex-none">
                  <span className="control-label">Filtrar processo</span>
                  <select className="control-input" value={resolvedSelectedPipelineId} onChange={(event) => setSelectedPipelineId(event.target.value)}>
                    <option value="all">Todos os processos</option>
                    {pipelineBlocks.map((block) => <option key={block.id} value={block.id}>{block.label} ({block.open} ab / {block.overdue} atr)</option>)}
                  </select>
                </label>
              </div>

              {visiblePipelineBlocks.length ? (
                <div className="mt-4 grid gap-4 xl:grid-cols-2">
                  {visiblePipelineBlocks.map((block) => (
                    <PipelineProcessCard
                      key={block.id}
                      block={block}
                      isCompactMobile={isMobileViewport}
                      onOpenTasks={(filter) => setPipelineTaskModal({ blockId: block.id, filter })}
                      onOpenStage={(stage) => setPipelineTaskModal({ blockId: block.id, filter: "total", stage })}
                    />
                  ))}
                </div>
              ) : (
                <div className="mt-4"><EmptyData message="Sem dados detalhados de esteira para os filtros atuais." /></div>
              )}
            </>
          )}
        </section>

        {hasAffiliateStatusBoard ? (
          <section className={`${activeView === "resumo" ? "grid" : "hidden"} gap-4`}>
            <PipelineMovementMiniDashboard
              stages={affiliateStageOverview}
              processes={affiliateJourneySummaries}
            />
          </section>
        ) : (
          <section className={`${activeView === "resumo" ? "grid" : "hidden"} gap-4 lg:grid-cols-2 2xl:grid-cols-3`}>
            <Panel title="Experts em movimento" subtitle="frentes ativas na esteira" helpText={HELP_TEXT.panelExpertFlow}>
              <div className="chart-box chart-box-cyan h-[220px] sm:h-[280px] xl:h-[300px]">
                {expertMovementDataset.length ? (
                  <HorizontalBarChartKpi
                    data={expertMovementDataset}
                    barColor="#00f3ff"
                    countLabel="Experts"
                  />
                ) : (
                  <EmptyData message="Sem experts ativos na esteira" />
                )}
              </div>
            </Panel>
            <Panel title="Processos em movimento" subtitle="volume atual por frente" helpText={HELP_TEXT.panelProcessFlow}>
              <div className="chart-box chart-box-rose h-[220px] sm:h-[280px] xl:h-[300px]">
                {processMovementDataset.length ? (
                  <HorizontalBarChartKpi
                    data={processMovementDataset}
                    barColor="#ff5f87"
                    countLabel="Processos"
                  />
                ) : (
                  <EmptyData message="Sem processos ativos no momento" />
                )}
              </div>
            </Panel>
            <Panel title="Esteira por etapa" subtitle="concentracao atual do fluxo" helpText={HELP_TEXT.panelStageFlow}>
              <div className="chart-box chart-box-violet h-[220px] sm:h-[280px] xl:h-[300px]">
                {stageMovementDataset.length ? (
                  <HorizontalBarChartKpi
                    data={stageMovementDataset}
                    barColor="#a68dff"
                    countLabel="Etapas"
                  />
                ) : (
                  <EmptyData message="Sem etapas mapeadas na esteira" />
                )}
              </div>
            </Panel>
          </section>
        )}

        <section className={`${activeView === "kanban" ? "panel-rise" : "hidden"} border border-cyan-500/12 bg-black/25 p-4 md:p-6`}>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <div className="h-3 w-[2px] bg-cyan-500" />
                <h2 className="dashboard-section-heading font-display font-bold uppercase tracking-wider text-slate-200">
                  Kanban de Tarefas
                </h2>
              </div>
              <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-slate-500">
                arraste cards entre etapas para refletir a mudanca no clickup
              </p>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="rounded border border-cyan-500/35 bg-cyan-500/12 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-cyan-300">
              Processos: {pipelineBlocks.length}
            </span>
            <span className="rounded border border-white/20 bg-white/5 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-slate-300">
              Escopo kanban: {activeKanbanBlock?.label || "-"}
            </span>
            <span className="rounded border border-white/20 bg-white/5 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-slate-300">
              Itens visiveis: {visibleKanbanTasks.length}
            </span>
            <span className="rounded border border-white/20 bg-white/5 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-slate-300">
              Base carregada: {detailRows.length} / {dashboard?.details?.totalRows || detailRows.length}
            </span>
            <span className="rounded border border-amber-500/25 bg-amber-500/10 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-amber-300">
              Em sincronizacao: {pendingKanbanTaskIds.length}
            </span>
          </div>

          {kanbanSyncError ? (
            <div className="mt-3 rounded border border-rose-500/30 bg-rose-500/10 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.1em] text-rose-300">
              falha ao sincronizar clickup: {kanbanSyncError}
            </div>
          ) : null}

          {activeKanbanBlock ? (
            <>
              <div className="kanban-board-viewport mt-4">
                <div className="kanban-columns" style={kanbanBoardStyle}>
                  {kanbanColumns.length ? (
                    kanbanColumns.map((column) => (
                      <KanbanStageColumn
                        key={column.id}
                        column={column}
                        isDropTarget={Boolean(dragOverKanbanStage && stageStatusMatches(column.status, dragOverKanbanStage))}
                        onStageDragOver={handleKanbanStageDragOver}
                        onStageDrop={handleKanbanStageDrop}
                        onStageDragLeave={() => setDragOverKanbanStage((current) => (stageStatusMatches(current, column.status) ? null : current))}
                        renderTask={(task) => (
                          <KanbanTaskCard
                            key={`${column.id}-${task.id}`}
                            task={task}
                            accentColor={column.color}
                            isDragging={draggedKanbanTaskId === task.id}
                            isSyncing={Boolean(kanbanTaskOverrides[task.id]?.pending)}
                            onDragStart={(event) => handleKanbanTaskDragStart(event, task, activeKanbanBlock.id)}
                            onDragEnd={handleKanbanTaskDragEnd}
                          />
                        )}
                      />
                    ))
                  ) : (
                    <div className="w-[280px]">
                      <EmptyData message="Sem etapas disponiveis para montar o kanban." />
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="mt-4">
              <EmptyData message="Sem tarefas disponiveis para montar o kanban." />
            </div>
          )}
        </section>

        <section className={`${activeView === "pessoas" ? "panel-rise" : "hidden"} border border-cyan-500/12 bg-black/25 p-4 md:p-6`}>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <div className="h-3 w-[2px] bg-cyan-500" />
                <h2 className="dashboard-section-heading font-display font-bold uppercase tracking-wider text-slate-200">
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

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setPeopleLayoutMode("cards")}
              className={`rounded border px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] transition ${
                peopleLayoutMode === "cards"
                  ? "border-cyan-400/70 bg-cyan-500/15 text-cyan-200"
                  : "border-white/15 bg-white/5 text-slate-300 hover:border-cyan-500/35"
              }`}
            >
              Cards
            </button>
            <button
              type="button"
              onClick={() => setPeopleLayoutMode("list")}
              className={`rounded border px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] transition ${
                peopleLayoutMode === "list"
                  ? "border-cyan-400/70 bg-cyan-500/15 text-cyan-200"
                  : "border-white/15 bg-white/5 text-slate-300 hover:border-cyan-500/35"
              }`}
            >
              Lista
            </button>
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
            peopleLayoutMode === "cards" ? (
              <div className="mt-4 grid gap-3 sm:gap-4 xl:grid-cols-2 2xl:grid-cols-3">
                {visiblePeopleMetrics.map((person) => (
                  <AssigneeMetricsCard
                    key={person.id}
                    block={person}
                    isCompactMobile={isMobileViewport}
                    onOpenTasks={(filter) =>
                      setPipelineTaskModal({ blockId: person.id, filter })
                    }
                  />
                ))}
              </div>
            ) : (
              <>
                <div className="mt-4">
                  <PeopleMetricsOverviewTable
                    people={visiblePeopleMetrics}
                    onSelectAssignee={setAssigneeSearch}
                    onOpenTasks={(personId) => setPipelineTaskModal({ blockId: personId, filter: "total" })}
                  />
                </div>
                <PeopleProductivityListView people={peopleListDataset} />
              </>
            )
          ) : (
            <div className="mt-4">
              <EmptyData message="Sem responsaveis para os filtros atuais." />
            </div>
          )}
        </section>

        {error ? <div className="rounded border border-rose-500/30 bg-rose-500/10 px-3 py-2 font-mono text-xs text-rose-300">ERRO_SISTEMA: {error}</div> : null}
        <footer className="rounded border border-white/5 bg-black/30 px-3 py-2.5 font-mono text-[10px] uppercase tracking-wider text-slate-500 sm:px-4 sm:py-3">
          <div className="mb-2 flex flex-wrap gap-2">
            {compactInsights.map((item) => (
              <span
                key={`footer-${item.label}`}
                className="inline-flex items-center gap-1 rounded border border-white/15 bg-white/5 px-2 py-1 text-[9px] uppercase tracking-[0.1em] text-slate-300"
              >
                {item.label}: {item.value}
              </span>
            ))}
          </div>
          <p>escopo: {selectedScope.label} // equipe: {selectedTeam?.name || "-"}</p>
          <p className="mt-1">ultima coleta: {formatDateTime(lastSyncAt || dashboard?.generatedAt)}</p>
        </footer>
      </main>

      {pipelineTaskModal && activeModalBlock ? (
        <PipelineTasksModal
          key={`${pipelineTaskModal.blockId}:${pipelineTaskModal.filter}:${pipelineTaskModal.stage || "all"}`}
          block={activeModalBlock}
          initialFilter={pipelineTaskModal.filter}
          initialStage={pipelineTaskModal.stage || null}
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
  className,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  helpText?: string;
  className?: string;
}) {
  return (
    <section className={`panel-rise relative border border-white/5 bg-black/20 p-4 backdrop-blur-sm md:p-5 ${className || ""}`}>
      <div className="absolute right-0 top-0 h-8 w-8 border-r border-t border-cyan-500/10" />
      <div className="mb-5 flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <div className="h-3 w-[2px] bg-cyan-500" />
          <h2 className="dashboard-section-heading font-display font-bold uppercase tracking-wider text-slate-200">{title}</h2>
          {helpText ? <InlineHint text={helpText} /> : null}
        </div>
        <p className="font-mono text-[9px] uppercase tracking-[0.15em] text-slate-500">{subtitle}</p>
      </div>
      <div className="relative">{children}</div>
    </section>
  );
}

function PipelineMovementMiniDashboard({
  stages,
  processes,
}: {
  stages: AffiliateStageOverviewCard[];
  processes: AffiliateJourneySummaryCard[];
}) {
  const totalExperts = new Set(
    stages.flatMap((stage) => stage.experts.map((expert) => expert.expertCode || expert.expertName))
  ).size;
  const totalOpen = stages.reduce((sum, stage) => sum + stage.open, 0);
  const totalClosed = stages.reduce((sum, stage) => sum + stage.closed, 0);
  const totalOverdue = stages.reduce((sum, stage) => sum + stage.overdue, 0);
  const activeStageCount = stages.filter((stage) => stage.total > 0).length;
  const dominantStage = [...stages].sort((left, right) => right.open - left.open)[0] || null;
  const processOpenTotal = processes.reduce((sum, process) => sum + process.open, 0);
  const processClosedTotal = processes.reduce((sum, process) => sum + process.closed, 0);
  const processOverdueTotal = processes.reduce((sum, process) => sum + process.overdue, 0);
  const processTotalTasks = processes.reduce((sum, process) => sum + process.totalTasks, 0);
  const stageComposition = stages
    .filter((stage) => stage.open > 0)
    .map((stage) => ({
      ...stage,
      pct: totalOpen > 0 ? Number(((stage.open / totalOpen) * 100).toFixed(1)) : 0,
    }));

  return (
    <Panel
      title="Mini Dash da Esteira"
      subtitle="leitura estrategica da esteira com numeros grandes, composicao e processos da jornada"
      helpText={HELP_TEXT.miniPipelineDashboard}
    >
      <div className="flex flex-wrap gap-2">
        <span className="rounded border border-cyan-500/35 bg-cyan-500/12 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-cyan-300">
          Experts na esteira: {totalExperts}
        </span>
        <span className="rounded border border-blue-500/25 bg-blue-500/10 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-blue-300">
          Frentes abertas: {totalOpen}
        </span>
        <span className="rounded border border-rose-500/25 bg-rose-500/10 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-rose-300">
          Frentes atrasadas: {totalOverdue}
        </span>
        <span className="rounded border border-white/20 bg-white/5 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-slate-300">
          Etapas ativas: {activeStageCount} // Processos: {processes.length}
        </span>
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-[1.7fr_1fr]">
        <div>
          <div className="flex items-center gap-2">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-cyan-300/80">Etapas dos experts</p>
            <InlineHint text="Cada card mostra a quantidade aberta por etapa principal da esteira, com leitura executiva e sem listar tarefas." />
          </div>
          <div className="mt-3 grid gap-3 min-[560px]:grid-cols-2 2xl:grid-cols-3">
            {stages.map((stage) => (
              <article
                key={stage.key}
                className="min-w-0 overflow-hidden rounded border border-white/10 bg-black/30 p-4"
                style={{ boxShadow: `inset 0 2px 0 ${stage.accent}` }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-slate-500">{stage.sourceLabel}</p>
                    <h3 className="mt-1 break-words font-display text-lg font-semibold text-slate-100">{stage.label}</h3>
                  </div>
                  <span
                    className={`inline-flex rounded border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] ${
                      stage.overdue > 0
                        ? "border-rose-500/25 bg-rose-500/10 text-rose-200"
                        : "border-emerald-500/20 bg-emerald-500/10 text-emerald-200"
                    }`}
                  >
                    {stage.overdue} atr
                  </span>
                </div>

                <div className="mt-7 text-center">
                  <p className="font-display text-[56px] font-semibold leading-none text-slate-50">{stage.open}</p>
                  <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.14em] text-slate-400">experts em aberto</p>
                </div>

                <div className="mt-6 grid grid-cols-3 gap-2">
                  <div className="rounded border border-white/10 bg-black/20 px-2 py-2 text-center">
                    <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-slate-500">base</p>
                    <p className="mt-1 font-display text-lg font-semibold text-slate-100">{stage.total}</p>
                  </div>
                  <div className="rounded border border-white/10 bg-black/20 px-2 py-2 text-center">
                    <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-slate-500">fechadas</p>
                    <p className="mt-1 font-display text-lg font-semibold text-slate-100">{stage.closed}</p>
                  </div>
                  <div className="rounded border border-white/10 bg-black/20 px-2 py-2 text-center">
                    <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-slate-500">abertas</p>
                    <p className="mt-1 font-display text-lg font-semibold text-slate-100">{stage.open}</p>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>

        <article className="min-w-0 overflow-hidden rounded border border-white/10 bg-black/30 p-4">
          <div className="flex items-center gap-2">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-cyan-300/80">Composicao da esteira</p>
            <InlineHint text="Resumo consolidado das frentes abertas, base fechada e concentracao atual por etapa." />
          </div>

          <div className="mt-5 flex min-h-[168px] flex-col items-center justify-center rounded border border-white/10 bg-black/20 px-4 py-5 text-center">
            <p className="font-display text-[72px] font-semibold leading-none text-slate-50">{totalOpen}</p>
            <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.14em] text-slate-400">frentes abertas</p>
            <p className="mt-2 text-sm text-slate-500">
              {dominantStage ? `${dominantStage.label} lidera com ${dominantStage.open}` : "Sem concentracao ativa"}
            </p>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <div className="rounded border border-cyan-500/20 bg-cyan-500/10 px-3 py-2">
              <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-cyan-200">experts unicos</p>
              <p className="mt-1 font-display text-2xl font-semibold text-slate-50">{totalExperts}</p>
            </div>
            <div className="rounded border border-emerald-500/20 bg-emerald-500/10 px-3 py-2">
              <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-emerald-200">frentes fechadas</p>
              <p className="mt-1 font-display text-2xl font-semibold text-slate-50">{totalClosed}</p>
            </div>
            <div className="rounded border border-rose-500/20 bg-rose-500/10 px-3 py-2">
              <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-rose-200">frentes atrasadas</p>
              <p className="mt-1 font-display text-2xl font-semibold text-slate-50">{totalOverdue}</p>
            </div>
            <div className="rounded border border-violet-500/20 bg-violet-500/10 px-3 py-2">
              <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-violet-200">processos ativos</p>
              <p className="mt-1 font-display text-2xl font-semibold text-slate-50">{processOpenTotal}</p>
            </div>
          </div>

          <div className="mt-5 overflow-hidden rounded-full border border-white/10 bg-white/5">
            <div className="flex h-4 w-full">
              {stageComposition.length ? (
                stageComposition.map((stage) => (
                  <div
                    key={`segment-${stage.key}`}
                    title={`${stage.label}: ${stage.open}`}
                    style={{
                      flex: `${Math.max(stage.open, 1)} 1 0`,
                      background: `linear-gradient(90deg, ${stage.accent}, ${stage.accent}cc)`,
                    }}
                  />
                ))
              ) : (
                <div className="h-full w-full bg-white/5" />
              )}
            </div>
          </div>

          <div className="mt-4 space-y-2">
            {stageComposition.length ? (
              stageComposition.map((stage) => (
                <div
                  key={`legend-${stage.key}`}
                  className="journey-stage-legend flex items-center justify-between gap-3 rounded border border-white/10 bg-black/20 px-3 py-2"
                  style={
                    {
                      "--journey-stage-accent": stage.accent,
                    } as CSSProperties
                  }
                >
                  <div className="min-w-0">
                    <div className="inline-flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: stage.accent }} />
                      <p className="truncate font-mono text-[10px] uppercase tracking-[0.1em] text-slate-200">{stage.label}</p>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-display text-lg font-semibold" style={{ color: stage.accent }}>{stage.open}</p>
                    <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-slate-500">{stage.pct}%</p>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded border border-dashed border-white/10 bg-white/5 px-3 py-4 font-mono text-[10px] uppercase tracking-[0.1em] text-slate-500">
                sem distribuicao ativa agora
              </div>
            )}
          </div>
        </article>
      </div>

      <div className="mt-5">
        <div className="flex items-center gap-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-cyan-300/80">Processos da jornada</p>
          <InlineHint text="Cada card resume a pasta principal da jornada dos experts com foco em carga, concluidas e risco." />
        </div>
        <div className="mt-3 grid gap-3 min-[560px]:grid-cols-2 2xl:grid-cols-5">
          {processes.map((process) => {
            const completionPct =
              process.totalTasks > 0 ? Math.round((process.closed / process.totalTasks) * 100) : 0;
            const openPct =
              process.totalTasks > 0 ? Number(((process.open / process.totalTasks) * 100).toFixed(1)) : 0;
            const closedPct =
              process.totalTasks > 0 ? Number(((process.closed / process.totalTasks) * 100).toFixed(1)) : 0;

            return (
            <article
              key={process.key}
              className="journey-process-card min-w-0 overflow-hidden rounded border border-white/10 bg-black/30 p-4"
              style={
                {
                  "--journey-accent": process.accent,
                  boxShadow: `inset 0 2px 0 ${process.accent}`,
                } as CSSProperties
              }
            >
              <div className="journey-process-header flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-slate-500">{process.sourceLabel}</p>
                  <h3 className="journey-process-title mt-1 break-words font-display text-[1.1rem] font-semibold text-slate-100">{process.label}</h3>
                </div>
                <div className="journey-process-badge shrink-0 text-right">
                  <p className="font-display text-4xl font-semibold leading-none text-slate-50">{process.open}</p>
                  <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-slate-500">em aberto</p>
                </div>
              </div>

              <div className="journey-process-meta mt-4 flex flex-wrap gap-1.5">
                <span className="rounded border border-white/15 bg-white/5 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-slate-300">
                  {process.totalTasks} tarefas
                </span>
                <span className="rounded border border-cyan-500/20 bg-cyan-500/10 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-cyan-200">
                  {process.listCount} subpastas
                </span>
                <span
                  className={`rounded border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] ${
                    process.overdue > 0
                      ? "border-rose-500/25 bg-rose-500/10 text-rose-200"
                      : "border-emerald-500/20 bg-emerald-500/10 text-emerald-200"
                  }`}
                >
                  {process.overdue} atr
                </span>
                <span className="rounded border border-violet-500/20 bg-violet-500/10 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-violet-200">
                  {completionPct}% fechamento
                </span>
              </div>

              <div className="journey-process-hero mt-4 rounded-2xl border border-white/10 bg-black/20 px-3 py-3">
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-slate-500">Fluxo principal</p>
                    <p className="mt-2 font-display text-5xl font-semibold leading-none text-slate-50">{process.open}</p>
                    <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-slate-400">
                      frentes abertas agora
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-slate-500">Concluidas</p>
                    <p className="mt-2 font-display text-3xl font-semibold leading-none text-emerald-300">{process.closed}</p>
                  </div>
                </div>

                <div className="mt-4">
                  <div className="journey-process-progress">
                    <div
                      className="journey-process-progress-fill is-open"
                      style={{ width: `${openPct}%` }}
                    />
                    <div
                      className="journey-process-progress-fill is-closed"
                      style={{ width: `${closedPct}%` }}
                    />
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2 font-mono text-[9px] uppercase tracking-[0.1em] text-slate-500">
                    <span>Abertas {openPct}%</span>
                    <span>Concluidas {closedPct}%</span>
                  </div>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2">
                <div className="journey-process-kpi rounded border border-white/10 bg-black/20 px-2 py-2">
                  <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-slate-500">abertas</p>
                  <p className="mt-1 font-display text-lg font-semibold text-slate-100">{process.open}</p>
                </div>
                <div className="journey-process-kpi rounded border border-white/10 bg-black/20 px-2 py-2">
                  <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-slate-500">concluidas</p>
                  <p className="mt-1 font-display text-lg font-semibold text-slate-100">{process.closed}</p>
                </div>
                <div className="journey-process-kpi rounded border border-white/10 bg-black/20 px-2 py-2">
                  <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-slate-500">atrasadas</p>
                  <p className="mt-1 font-display text-lg font-semibold text-slate-100">{process.overdue}</p>
                </div>
              </div>
            </article>
          );
          })}
        </div>
        <div className="journey-summary-grid mt-4 grid gap-3 min-[560px]:grid-cols-2 xl:grid-cols-4">
          <div className="journey-summary-card rounded border border-white/10 bg-black/20 px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-slate-500">Processos em aberto</p>
            <p className="mt-2 font-display text-4xl font-semibold text-slate-50">{processOpenTotal}</p>
          </div>
          <div className="journey-summary-card rounded border border-white/10 bg-black/20 px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-slate-500">Processos atrasados</p>
            <p className="mt-2 font-display text-4xl font-semibold text-slate-50">{processOverdueTotal}</p>
          </div>
          <div className="journey-summary-card rounded border border-white/10 bg-black/20 px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-slate-500">Processos concluidos</p>
            <p className="mt-2 font-display text-4xl font-semibold text-slate-50">
              {processClosedTotal}
            </p>
          </div>
          <div className="journey-summary-card rounded border border-white/10 bg-black/20 px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-slate-500">Carga total</p>
            <p className="mt-2 font-display text-4xl font-semibold text-slate-50">
              {processTotalTasks}
            </p>
          </div>
        </div>
      </div>
    </Panel>
  );
}

function AffiliateStatusBoard({
  board,
  isLoading,
  isCompactMobile,
}: {
  board: AffiliateStatusBoardData;
  isLoading?: boolean;
  isCompactMobile?: boolean;
}) {
  return (
    <Panel
      title="Status dos Experts"
      subtitle="8 experts da esteira, com leitura direta do ClickUp por etapa principal"
      helpText="Clique no nome, codigo ou status para abrir a tarefa correspondente no ClickUp."
      className="affiliate-status-panel"
    >
      <div className="affiliate-status-summary">
        <span className="rounded border border-cyan-500/35 bg-cyan-500/12 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-cyan-300">
          Experts: {board.rows.length}
        </span>
        <span className="rounded border border-blue-500/25 bg-blue-500/10 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-blue-300">
          Etapas abertas: {board.totalOpenCells} // Concluidas: {board.totalClosedCells} // Atrasadas: {board.totalOverdueCells}
        </span>
      </div>

      {isLoading && !board.rows.length ? (
        <div className="mt-4">
          <EmptyData message="Carregando esteira dos afiliados direto do ClickUp..." />
        </div>
      ) : board.rows.length ? (
        <div className="mt-4">
          <div className="affiliate-status-table-shell hidden lg:block">
            <div className="overflow-x-auto">
              <table className="affiliate-status-table w-full min-w-[1120px] border-collapse">
                <thead>
                  <tr className="border-b border-white/10 text-left">
                    <th className="affiliate-status-th affiliate-status-th-sticky">Expert</th>
                    <th className="affiliate-status-th affiliate-status-th-code">COD</th>
                    {board.columns.map((column) => (
                      <th key={column.key} className="affiliate-status-th" title={column.sourceLabel}>
                        <span className="affiliate-status-th-label">{column.label}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {board.rows.map((row) => (
                    <tr key={row.id} className="border-b border-white/5 align-top">
                      <td className="affiliate-status-td affiliate-status-td-sticky">
                        <div className="affiliate-status-expert">
                          <a
                            href={row.hubUrl || undefined}
                            target="_blank"
                            rel="noreferrer"
                            className="affiliate-status-expert-link"
                            title={`Abrir hub do expert: ${row.expertName}`}
                          >
                            {row.expertName}
                          </a>
                          <p className="affiliate-status-expert-meta">
                            {row.openCount} abertas // {row.closedCount} concluidas // {row.overdueCount} atrasadas
                          </p>
                        </div>
                      </td>
                      <td className="affiliate-status-td affiliate-status-td-code">
                        <a
                          href={row.hubUrl || undefined}
                          target="_blank"
                          rel="noreferrer"
                          className="affiliate-status-code-link"
                          title={`Abrir codigo ${row.expertCode} no ClickUp`}
                        >
                          {row.expertCode}
                        </a>
                      </td>
                      {board.columns.map((column) => {
                        const cell = row.cells[column.key];
                        if (!cell) {
                          return (
                            <td key={`${row.id}-${column.key}`} className="affiliate-status-td">
                              <span className="affiliate-status-empty">-</span>
                            </td>
                          );
                        }

                        const accent = stageColor(cell.status);
                        const title = [
                          row.expertName,
                          column.label,
                          `status: ${cell.status}`,
                          `responsavel: ${cell.assignee}`,
                          cell.dueAt ? `prazo: ${formatDateTime(cell.dueAt)}` : null,
                        ]
                          .filter(Boolean)
                          .join(" | ");

                        return (
                          <td key={`${row.id}-${column.key}`} className="affiliate-status-td">
                            <a
                              href={cell.url || undefined}
                              target="_blank"
                              rel="noreferrer"
                              title={title}
                              className={`affiliate-stage-chip affiliate-stage-chip-full ${cell.isClosed ? "is-closed" : ""} ${cell.isOverdue ? "is-overdue" : ""}`}
                              style={{
                                borderColor: `${accent}66`,
                                backgroundColor: `${accent}18`,
                                color: accent,
                              }}
                            >
                              {cell.status}
                            </a>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-3 lg:hidden">
            {board.rows.map((row) => (
              <AffiliateStatusMobileCard
                key={`mobile-${row.id}`}
                row={row}
                columns={board.columns}
                isCollapsible={Boolean(isCompactMobile)}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-4">
          <EmptyData message="Sem esteira de afiliados detectada para o escopo atual." />
        </div>
      )}
    </Panel>
  );
}

function AffiliateStatusMobileCard({
  row,
  columns,
  isCollapsible,
}: {
  row: AffiliateExpertRow;
  columns: AffiliateProcessColumn[];
  isCollapsible: boolean;
}) {
  const { isExpanded, toggle, shouldRenderBody } = useMobileDisclosure(isCollapsible);

  return (
    <article className={`affiliate-status-mobile-card ${shouldRenderBody ? "is-expanded" : "is-collapsed"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <a
              href={row.hubUrl || undefined}
              target="_blank"
              rel="noreferrer"
              className="affiliate-status-expert-link"
            >
              {row.expertName}
            </a>
            {isCollapsible ? (
              <MobileCollapseToggle
                isExpanded={isExpanded}
                onToggle={toggle}
                label={`Alternar etapas do expert ${row.expertName}`}
              />
            ) : null}
          </div>
          <p className="affiliate-status-expert-meta">COD {row.expertCode}</p>
        </div>
      </div>

      <div className="affiliate-status-mobile-summary">
        <span>{row.openCount} abertas</span>
        <span>{row.closedCount} concluidas</span>
        <span>{row.overdueCount} atrasadas</span>
      </div>

      {shouldRenderBody ? (
        <div className="mt-3 space-y-2">
          {columns.map((column) => {
            const cell = row.cells[column.key];
            if (!cell) return null;

            const accent = stageColor(cell.status);
            return (
              <div key={`${row.id}-${column.key}-mobile`} className="affiliate-status-mobile-process">
                <div>
                  <p className="affiliate-status-mobile-process-name">{column.label}</p>
                </div>
                <div className="text-right">
                  <a
                    href={cell.url || undefined}
                    target="_blank"
                    rel="noreferrer"
                    className={`affiliate-stage-chip ${cell.isClosed ? "is-closed" : ""} ${cell.isOverdue ? "is-overdue" : ""}`}
                    style={{
                      borderColor: `${accent}66`,
                      backgroundColor: `${accent}18`,
                      color: accent,
                    }}
                  >
                    {cell.status}
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </article>
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
      <p className="dashboard-stat-value mt-0.5 font-display text-xl font-semibold text-cyan-300">{value}</p>
    </div>
  );
}

function AssigneeMetricsCard({
  block,
  isCompactMobile,
  onOpenTasks,
}: {
  block: AssigneeMetricsBlock;
  isCompactMobile?: boolean;
  onOpenTasks: (filter: PipelineTaskFilter) => void;
}) {
  const topStatuses = block.statusBreakdown.slice(0, 4);
  const paddedStatuses: Array<AssigneeStatusPoint & { placeholder?: boolean }> = [...topStatuses];
  const accentColor = resolveAssigneeAccent(block);
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
  const dominantStatus = topStatuses[0] || null;
  const productivityPct = block.completionPct <= 0 ? 0 : Math.max(6, Math.min(block.completionPct, 100));
  const loadPct =
    block.loadScore === null || block.loadScore <= 0
      ? 0
      : Math.max(6, Math.min(block.loadScore * 10, 100));

  if (isCompactMobile) {
    return (
      <article
        className="min-w-0 overflow-hidden rounded border border-white/10 bg-black/30 p-2.5"
        style={{
          boxShadow: `inset 0 2px 0 ${accentColor}`,
        }}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="inline-flex max-w-full items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: accentColor }} />
              <p className="dashboard-card-title truncate font-display text-base font-bold text-slate-50 tracking-[0.01em]">
                {block.assignee}
              </p>
            </div>
            <p className="mt-1 break-words font-mono text-[9px] uppercase tracking-[0.1em] text-slate-500">
              {block.hierarchy}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onOpenTasks("total")}
            className={`inline-flex shrink-0 rounded border px-2 py-1 font-mono text-[9px] uppercase tracking-[0.1em] ${riskClass}`}
          >
            {block.overdue ? `${block.overdue} atr` : "ver"}
          </button>
        </div>

        <div className="mt-2 grid grid-cols-2 gap-1.5">
          <InfoChip label="Abertas" value={String(block.open)} />
          <InfoChip label="Concluidas" value={String(block.closed)} />
          <InfoChip label="Atrasadas" value={String(block.overdue)} tone={block.overdue > 0 ? "danger" : "neutral"} />
          <InfoChip label="Alta prio" value={String(block.highPriority)} />
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {topStatuses.slice(0, 2).map((status) => (
            <span
              key={`${block.id}-mobile-${status.status}`}
              className="inline-flex max-w-full items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.1em]"
              style={{
                borderColor: `${stageColor(status.status)}55`,
                backgroundColor: `${stageColor(status.status)}1a`,
                color: stageColor(status.status),
              }}
            >
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: stageColor(status.status) }} />
              {status.status} ({status.value})
            </span>
          ))}
        </div>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-slate-500">
            tempo etapa {formatHoursWindow(block.avgStatusAgeHours)}
          </span>
          {dominantStatus ? (
            <span
              className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.1em]"
              style={{
                borderColor: `${stageColor(dominantStatus.status)}55`,
                backgroundColor: `${stageColor(dominantStatus.status)}1a`,
                color: stageColor(dominantStatus.status),
              }}
            >
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: stageColor(dominantStatus.status) }} />
              {dominantStatus.status}
            </span>
          ) : null}
        </div>

        <div className="chart-box chart-box-blue mt-2 rounded border border-white/10 bg-black/20 p-2">
          <div className="mb-1 flex items-center justify-between gap-2">
            <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-slate-400">Movimento diario</p>
            <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-slate-500">
              {block.completionPct}% concl.
            </span>
          </div>
          <div className="h-[68px]">
            <TrendSparkline
              data={block.trend}
              currentColor="#47a9ff"
              previousColor="#f59e0b"
            />
          </div>
        </div>

        <div className="mt-2 space-y-1.5">
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2 font-mono text-[9px] uppercase tracking-[0.08em] text-slate-500">
              <span>Produtividade</span>
              <span>{block.completionPct}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded bg-white/5">
              <div
                className="h-full rounded"
                style={{
                  width: `${productivityPct}%`,
                  background: `linear-gradient(90deg, ${accentColor}, ${accentColor}cc)`,
                }}
              />
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2 font-mono text-[9px] uppercase tracking-[0.08em] text-slate-500">
              <span>Carga</span>
              <span>{block.loadScore === null ? "-" : block.loadScore.toFixed(1)}</span>
            </div>
            <div className="h-2 overflow-hidden rounded bg-white/5">
              <div
                className="h-full rounded"
                style={{
                  width: `${loadPct}%`,
                  background: `linear-gradient(90deg, ${accentColor}, ${accentColor}cc)`,
                }}
              />
            </div>
          </div>
        </div>
      </article>
    );
  }

  return (
    <article
      className="min-w-0 overflow-hidden rounded border border-white/10 bg-black/30 p-3"
      style={{
        boxShadow: `inset 0 2px 0 ${accentColor}`,
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="inline-flex max-w-full items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: accentColor }} />
            <p className="dashboard-card-title truncate font-display text-lg font-bold text-slate-50 tracking-[0.01em]">{block.assignee}</p>
          </div>
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

      <div className="mt-3 flex flex-wrap gap-1.5">
        {topStatuses.map((status) => (
          <span
            key={`${block.id}-${status.status}`}
            className="inline-flex items-center gap-1 rounded border px-2 py-1 font-mono text-[9px] uppercase tracking-[0.1em]"
            style={{
              borderColor: `${stageColor(status.status)}55`,
              backgroundColor: `${stageColor(status.status)}1a`,
              color: stageColor(status.status),
            }}
          >
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: stageColor(status.status) }} />
            {status.status} ({status.value})
          </span>
        ))}
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

function PeopleMetricsOverviewTable({
  people,
  onSelectAssignee,
  onOpenTasks,
}: {
  people: AssigneeMetricsBlock[];
  onSelectAssignee: (assignee: string) => void;
  onOpenTasks: (personId: string) => void;
}) {
  return (
    <Panel
      title="Painel por Responsavel"
      subtitle="leitura tabular da equipe, com produtividade, carga e risco"
      helpText={HELP_TEXT.peopleRoster}
    >
      <div className="overflow-hidden rounded border border-white/10 bg-black/20">
        <div className="hidden overflow-x-auto lg:block">
          <table className="w-full min-w-[1180px] border-collapse">
            <thead className="sticky top-0 bg-black/90 backdrop-blur">
              <tr className="border-b border-white/10 text-left">
                <th className="px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-slate-500">Responsavel</th>
                <th className="px-2 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-slate-500">Hierarquia</th>
                <th className="px-2 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-slate-500">Abertas</th>
                <th className="px-2 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-slate-500">Concluidas</th>
                <th className="px-2 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-slate-500">Atrasadas</th>
                <th className="px-2 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-slate-500">Alta Prio</th>
                <th className="px-2 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-slate-500">Etapa dominante</th>
                <th className="px-2 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-slate-500">Tempo etapa</th>
                <th className="px-2 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-slate-500">Carga</th>
                <th className="px-2 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-slate-500">Produtividade</th>
                <th className="px-2 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-slate-500">Acao</th>
              </tr>
            </thead>
            <tbody>
              {people.map((person) => {
                const accent = resolveAssigneeAccent(person);
                const dominantStatus = person.statusBreakdown[0];
                const loadPct =
                  person.loadScore === null || person.loadScore <= 0
                    ? 0
                    : Math.max(6, Math.min(person.loadScore * 10, 100));
                const productivityPct =
                  person.completionPct <= 0 ? 0 : Math.max(6, Math.min(person.completionPct, 100));

                return (
                  <tr key={person.id} className="border-b border-white/5 align-top">
                    <td className="px-3 py-2.5">
                      <button
                        type="button"
                        onClick={() => onSelectAssignee(person.assignee)}
                        className="group flex max-w-[220px] items-center gap-2 text-left"
                      >
                        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: accent }} />
                        <span className="truncate font-display text-sm font-semibold transition group-hover:text-cyan-200" style={{ color: accent }}>
                          {person.assignee}
                        </span>
                      </button>
                    </td>
                    <td className="px-2 py-2.5">
                      <p className="max-w-[220px] truncate font-mono text-[10px] uppercase tracking-[0.1em] text-slate-500">
                        {person.hierarchy}
                      </p>
                    </td>
                    <td className="px-2 py-2.5 font-mono text-sm text-slate-200">{person.open}</td>
                    <td className="px-2 py-2.5 font-mono text-sm text-emerald-300">{person.closed}</td>
                    <td className="px-2 py-2.5 font-mono text-sm text-rose-300">{person.overdue}</td>
                    <td className="px-2 py-2.5 font-mono text-sm text-amber-300">{person.highPriority}</td>
                    <td className="px-2 py-2.5">
                      {dominantStatus ? (
                        <span
                          className="inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em]"
                          style={{
                            borderColor: `${stageColor(dominantStatus.status)}55`,
                            backgroundColor: `${stageColor(dominantStatus.status)}1a`,
                            color: stageColor(dominantStatus.status),
                          }}
                        >
                          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: stageColor(dominantStatus.status) }} />
                          {dominantStatus.status}
                        </span>
                      ) : (
                        <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-slate-500">sem etapa</span>
                      )}
                    </td>
                    <td className="px-2 py-2.5">
                      <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-slate-300">
                        {formatHoursWindow(person.avgStatusAgeHours)}
                      </span>
                    </td>
                    <td className="px-2 py-2.5">
                      <div className="w-[120px]">
                        <div className="h-2 overflow-hidden rounded bg-white/5">
                          <div
                            className="h-full rounded"
                            style={{
                              width: `${loadPct}%`,
                              background: `linear-gradient(90deg, ${accent}, ${accent}cc)`,
                            }}
                          />
                        </div>
                        <div className="mt-1 flex items-center justify-between gap-2 font-mono text-[9px] uppercase tracking-[0.1em] text-slate-500">
                          <span>score</span>
                          <span>{person.loadScore === null ? "-" : person.loadScore.toFixed(1)}</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-2 py-2.5">
                      <div className="w-[132px]">
                        <div className="h-2 overflow-hidden rounded bg-white/5">
                          <div
                            className="h-full rounded"
                            style={{
                              width: `${productivityPct}%`,
                              background: `linear-gradient(90deg, ${accent}, ${accent}cc)`,
                            }}
                          />
                        </div>
                        <div className="mt-1 flex items-center justify-between gap-2 font-mono text-[9px] uppercase tracking-[0.1em] text-slate-500">
                          <span>{person.closed} concl.</span>
                          <span>{person.completionPct}%</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-2 py-2.5">
                      <button
                        type="button"
                        onClick={() => onOpenTasks(person.id)}
                        className="inline-flex rounded border border-cyan-500/35 bg-cyan-500/10 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-cyan-300 transition hover:border-cyan-300/70 hover:text-cyan-100"
                      >
                        ver
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="space-y-2 p-2 lg:hidden">
          {people.map((person) => {
            const accent = resolveAssigneeAccent(person);
            const dominantStatus = person.statusBreakdown[0];

            return (
              <article
                key={`person-mobile-${person.id}`}
                className="rounded border border-white/10 bg-black/20 p-2.5"
                style={{ boxShadow: `inset 0 2px 0 ${accent}` }}
              >
                <div className="flex items-start justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => onSelectAssignee(person.assignee)}
                    className="min-w-0 text-left"
                  >
                    <div className="inline-flex max-w-full items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: accent }} />
                      <span className="truncate font-display text-sm font-semibold" style={{ color: accent }}>
                        {person.assignee}
                      </span>
                    </div>
                    <p className="mt-1 truncate font-mono text-[9px] uppercase tracking-[0.1em] text-slate-500">{person.hierarchy}</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenTasks(person.id)}
                    className="inline-flex shrink-0 rounded border border-cyan-500/35 bg-cyan-500/10 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-cyan-300"
                  >
                    ver
                  </button>
                </div>

                <div className="mt-2 grid grid-cols-2 gap-1.5">
                  <InfoChip label="Abertas" value={String(person.open)} />
                  <InfoChip label="Concluidas" value={String(person.closed)} />
                  <InfoChip label="Atrasadas" value={String(person.overdue)} tone={person.overdue > 0 ? "danger" : "neutral"} />
                  <InfoChip label="Alta prio" value={String(person.highPriority)} />
                </div>

                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-slate-500">
                    tempo etapa {formatHoursWindow(person.avgStatusAgeHours)}
                  </span>
                  {dominantStatus ? (
                    <span
                      className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.12em]"
                      style={{
                        borderColor: `${stageColor(dominantStatus.status)}55`,
                        backgroundColor: `${stageColor(dominantStatus.status)}1a`,
                        color: stageColor(dominantStatus.status),
                      }}
                    >
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: stageColor(dominantStatus.status) }} />
                      {dominantStatus.status}
                    </span>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </Panel>
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
      <p className="dashboard-stat-value mt-0.5 font-display text-xl font-semibold text-slate-100">{value}</p>
    </div>
  );
}

function AffiliateJourneyOverviewCard({
  card,
  isCompactMobile,
  onSelectProcess,
}: {
  card: AffiliateJourneyCardData;
  isCompactMobile?: boolean;
  onSelectProcess: (blockId: string) => void;
}) {
  const { isExpanded, toggle, shouldRenderBody } = useMobileDisclosure(Boolean(isCompactMobile));

  return (
    <article className="min-w-0 overflow-hidden rounded border border-white/10 bg-black/30 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-cyan-300/80">{card.sourceLabel}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <h3 className="break-words font-display text-lg font-semibold tracking-tight text-slate-100">{card.label}</h3>
            {isCompactMobile ? (
              <MobileCollapseToggle
                isExpanded={isExpanded}
                onToggle={toggle}
                label={`Alternar detalhes de ${card.label}`}
              />
            ) : null}
          </div>
          {shouldRenderBody ? <p className="mt-1 text-sm leading-6 text-slate-400">{card.description}</p> : null}
        </div>
        <div className="w-full text-left sm:w-auto sm:shrink-0 sm:text-right">
          <span className="inline-flex max-w-full rounded border border-cyan-500/30 bg-cyan-500/10 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-cyan-300">
            {card.listCount} subpastas
          </span>
          <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.12em] text-slate-500">{card.totalTasks} tarefas</p>
        </div>
      </div>

      {shouldRenderBody ? (
        <div className="mt-4 space-y-2">
          {card.items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectProcess(item.blockId)}
              className="group w-full rounded-xl border border-white/10 bg-slate-950/50 px-3 py-3 text-left transition hover:border-cyan-400/35 hover:bg-slate-950/80"
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="break-words font-mono text-[11px] uppercase tracking-[0.12em] text-slate-100">{item.label}</p>
                  <p className="mt-1 break-words font-mono text-[10px] uppercase tracking-[0.1em] text-slate-500">
                    {item.open} abertas // {item.closed} concluidas
                  </p>
                </div>
                <div className="flex w-full flex-wrap justify-start gap-1.5 sm:w-auto sm:shrink-0 sm:justify-end">
                  <span className="rounded border border-white/15 bg-white/5 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-slate-300">
                    {item.taskCount} total
                  </span>
                  <span
                    className={`rounded border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] ${
                      item.overdue > 0
                        ? "border-rose-500/35 bg-rose-500/10 text-rose-300"
                        : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                    }`}
                  >
                    {item.overdue} atr
                  </span>
                </div>
              </div>
            </button>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function PipelineProcessCard({
  block,
  isCompactMobile,
  onOpenTasks,
  onOpenStage,
}: {
  block: PipelineBlock;
  isCompactMobile?: boolean;
  onOpenTasks: (filter: PipelineTaskFilter) => void;
  onOpenStage: (stage: string) => void;
}) {
  const { isExpanded, toggle, shouldRenderBody } = useMobileDisclosure(Boolean(isCompactMobile));
  const completionClass =
    block.completionPct >= 75
      ? "border-emerald-500/35 bg-emerald-500/12 text-emerald-300"
      : block.completionPct >= 45
        ? "border-cyan-500/35 bg-cyan-500/12 text-cyan-300"
        : "border-amber-500/35 bg-amber-500/12 text-amber-300";

  return (
    <article className="min-w-0 overflow-hidden rounded border border-white/10 bg-black/30 p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="dashboard-card-title break-words font-display text-lg font-bold text-slate-50 tracking-[0.01em]">{block.label}</p>
            {isCompactMobile ? (
              <MobileCollapseToggle
                isExpanded={isExpanded}
                onToggle={toggle}
                label={`Alternar detalhes do processo ${block.label}`}
              />
            ) : null}
          </div>
          <p className="break-words font-mono text-[10px] uppercase tracking-[0.12em] text-slate-500">{block.hierarchy}</p>
        </div>
        <span className={`inline-flex w-fit items-center rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] ${completionClass}`}>
          {block.completionPct}% concluido
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5 md:hidden">
        <span className="rounded border border-cyan-500/20 bg-cyan-500/10 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-cyan-200">
          {block.total} total
        </span>
        <span className="rounded border border-blue-500/20 bg-blue-500/10 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-blue-200">
          {block.open} abertas
        </span>
        <span className="rounded border border-rose-500/20 bg-rose-500/10 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-rose-200">
          {block.overdue} atr
        </span>
      </div>

      {shouldRenderBody ? (
        <>
          <div className="mt-3 grid grid-cols-1 gap-2 min-[380px]:grid-cols-2 sm:grid-cols-4">
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
            <div className="chart-box chart-box-cyan min-w-0 rounded border border-white/10 bg-black/20 p-2">
              <div className="inline-flex items-center gap-1">
                <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-slate-400">Movimento diario</p>
                <InlineHint text={HELP_TEXT.processFlowByDay} />
              </div>
              <div className="mt-2 h-[96px]"><TrendSparkline data={block.trend} currentColor="#00f3ff" previousColor="#f59e0b" /></div>
            </div>

            <div className="chart-box chart-box-indigo min-w-0 rounded border border-white/10 bg-black/20 p-2">
              <div className="inline-flex items-center gap-1">
                <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-slate-400">Carga por responsavel</p>
                <InlineHint text={HELP_TEXT.processAssigneeLoad} />
              </div>
              <AssigneeLoadBars assignees={block.assignees} />
            </div>
          </div>

          <div className="chart-box chart-box-amber mt-3 min-w-0 rounded border border-white/10 bg-black/20 p-2">
            <div className="inline-flex items-center gap-1">
              <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-slate-400">Distribuicao por etapa</p>
              <InlineHint text={HELP_TEXT.processStageDistribution} />
            </div>
            <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.1em] text-slate-500">clique na etapa para abrir os itens correspondentes</p>
            <StageDistributionChart stages={block.stages} total={block.total} onStageClick={onOpenStage} />
          </div>
        </>
      ) : null}
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
      <p className="mt-1 inline-flex items-center gap-1 font-display text-xl font-semibold">{icon}{value}</p>
    </button>
  );
}

function PipelineTasksModal({
  block,
  initialFilter,
  initialStage,
  loadedRows,
  totalRows,
  onClose,
}: {
  block: PipelineBlock;
  initialFilter: PipelineTaskFilter;
  initialStage?: string | null;
  loadedRows: number;
  totalRows: number;
  onClose: () => void;
}) {
  const [activeFilter, setActiveFilter] = useState<PipelineTaskFilter>(initialFilter);
  const [activeStage, setActiveStage] = useState<string | null>(initialStage || null);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  const sortedTasks = useMemo(() => sortPipelineTasks(block.tasks), [block.tasks]);
  const tasksByFilter = useMemo(
    () => filterPipelineTasks(sortedTasks, activeFilter),
    [sortedTasks, activeFilter]
  );
  const visibleTasks = useMemo(() => {
    if (!activeStage) return tasksByFilter;
    return tasksByFilter.filter((task) => stageStatusMatches(task.status, activeStage));
  }, [tasksByFilter, activeStage]);

  const groupedByStage = useMemo(() => {
    const stageMap = new Map<string, { status: string; count: number; overdue: number }>();

    tasksByFilter.forEach((task) => {
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
  }, [tasksByFilter]);

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

  const activeStageLabel = useMemo(() => {
    if (!activeStage) return null;
    const matchedGroup = groupedByStage.find((stage) => stageStatusMatches(stage.status, activeStage));
    if (matchedGroup) return matchedGroup.status;
    const matchedTask = tasksByFilter.find((task) => stageStatusMatches(task.status, activeStage));
    return matchedTask?.status || activeStage;
  }, [activeStage, groupedByStage, tasksByFilter]);

  const filteredCount = visibleTasks.length;
  const resolvedTotalRows = Number.isFinite(totalRows) && totalRows > 0 ? totalRows : loadedRows;
  const hasPartialData = resolvedTotalRows > loadedRows;

  return (
    <div
      className="fixed inset-0 z-[90] grid place-items-center bg-black/65 p-3 sm:p-5"
      onClick={onClose}
    >
      <section
        className="panel-rise flex w-full max-w-[1120px] max-h-[92dvh] min-h-[340px] sm:min-h-[420px] flex-col rounded border border-cyan-500/20 bg-black/80 p-3 shadow-[0_24px_70px_rgba(0,0,0,0.5)] backdrop-blur-xl sm:p-4 md:p-5"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-300/80">Detalhe da Esteira</p>
            <h3 className="mt-1 truncate font-display text-xl font-bold text-slate-50 tracking-[0.01em]">{block.label}</h3>
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

        <div className="mt-3 grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 lg:grid-cols-4">
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
                <p className="dashboard-stat-value mt-1 font-display text-2xl font-semibold">{value}</p>
                <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-slate-400">{PIPELINE_FILTER_DESCRIPTION[filterKey]}</p>
              </button>
            );
          })}
        </div>

        <div className="mt-3 rounded border border-white/10 bg-black/25 p-2">
          <div className="mb-2 inline-flex items-center gap-1">
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-slate-400">Etapa da esteira</p>
            <InlineHint text="Filtra as tarefas dentro da etapa/status clicado no processo." />
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setActiveStage(null)}
              className={`rounded border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] transition ${
                activeStage === null
                  ? "border-cyan-400/70 bg-cyan-500/16 text-cyan-100"
                  : "border-white/15 bg-white/5 text-slate-300 hover:border-cyan-500/35 hover:bg-cyan-500/10"
              }`}
            >
              todas as etapas ({tasksByFilter.length})
            </button>
            {groupedByStage.map((stage) => {
              const isSelected = Boolean(activeStage && stageStatusMatches(stage.status, activeStage));
              return (
                <button
                  key={`stage-filter-${stage.status}`}
                  type="button"
                  onClick={() => setActiveStage(stage.status)}
                  className={`rounded border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] transition ${
                    isSelected
                      ? "border-cyan-400/70 bg-cyan-500/16 text-cyan-100"
                      : "border-white/15 bg-white/5 text-slate-300 hover:border-cyan-500/35 hover:bg-cyan-500/10"
                  }`}
                >
                  {stage.status} ({stage.count})
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-3 hidden flex-wrap items-center gap-2 lg:flex">
          <span className="rounded border border-cyan-500/35 bg-cyan-500/12 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-cyan-300">
            Exibindo: {PIPELINE_FILTER_LABEL[activeFilter]}{activeStageLabel ? ` / ${activeStageLabel}` : ""}
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

function KanbanStageColumn({
  column,
  isDropTarget,
  onStageDragOver,
  onStageDrop,
  onStageDragLeave,
  renderTask,
}: {
  column: KanbanColumn;
  isDropTarget?: boolean;
  onStageDragOver: (event: ReactDragEvent<HTMLElement>, stage: string) => void;
  onStageDrop: (event: ReactDragEvent<HTMLElement>, stage: string) => void;
  onStageDragLeave: () => void;
  renderTask: (task: PipelineTaskItem) => ReactNode;
}) {
  return (
    <article
      className={`kanban-column rounded border p-3 transition ${isDropTarget ? "kanban-column-drop-target" : "border-white/10 bg-black/30"}`}
      style={
        {
          "--kanban-accent": column.color,
        } as CSSProperties
      }
      onDragOver={(event) => onStageDragOver(event, column.status)}
      onDrop={(event) => onStageDrop(event, column.status)}
      onDragLeave={onStageDragLeave}
    >
      <div className="kanban-column-header">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: column.color }} />
            <p className="kanban-column-title truncate font-display text-slate-100">{column.status}</p>
          </div>
        </div>
        <span className="kanban-column-counter inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded border px-1.5 font-mono text-[9px] uppercase tracking-[0.12em]">
          {column.total}
        </span>
      </div>

      <div className="kanban-column-meta">
        <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-slate-500">
          {column.total} cards
        </span>
        <span className={`rounded border px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.14em] ${
          column.overdue
            ? "border-rose-500/30 bg-rose-500/10 text-rose-300"
            : "border-emerald-500/25 bg-emerald-500/10 text-emerald-300"
        }`}>
          {column.overdue ? `${column.overdue} atrasados` : "fluxo ok"}
        </span>
      </div>

      <div className="kanban-column-body">
        {column.tasks.length ? (
          column.tasks.map((task) => renderTask(task))
        ) : (
          <div className="rounded border border-dashed border-white/10 px-2 py-3 font-mono text-[10px] uppercase tracking-[0.1em] text-slate-500">
            sem cards nesta etapa
          </div>
        )}
      </div>
    </article>
  );
}

function KanbanTaskCard({
  task,
  accentColor,
  isDragging,
  isSyncing,
  onDragStart,
  onDragEnd,
}: {
  task: PipelineTaskItem;
  accentColor: string;
  isDragging?: boolean;
  isSyncing?: boolean;
  onDragStart?: (event: ReactDragEvent<HTMLElement>) => void;
  onDragEnd?: () => void;
}) {
  const lastDragAtRef = useRef(0);

  const openTask = useCallback(() => {
    if (!task.url || typeof window === "undefined") return;
    window.open(task.url, "_blank", "noopener,noreferrer");
  }, [task.url]);

  const handleCardClick = useCallback(() => {
    if (!task.url) return;
    if (Date.now() - lastDragAtRef.current < 220) return;
    openTask();
  }, [openTask, task.url]);

  const handleCardKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      if (!task.url) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      openTask();
    },
    [openTask, task.url]
  );

  return (
    <article
      className={`kanban-task-card rounded border p-2 transition ${isDragging ? "opacity-45" : ""} ${task.url ? "is-linkable" : ""}`}
      draggable={Boolean(onDragStart)}
      onDragStart={(event) => {
        lastDragAtRef.current = Date.now();
        onDragStart?.(event);
      }}
      onDragEnd={() => {
        lastDragAtRef.current = Date.now();
        onDragEnd?.();
      }}
      onClick={handleCardClick}
      onKeyDown={handleCardKeyDown}
      role={task.url ? "link" : undefined}
      tabIndex={task.url ? 0 : -1}
      aria-label={task.url ? `Abrir tarefa ${task.name} no ClickUp` : undefined}
      style={{
        boxShadow: `inset 0 2px 0 ${accentColor}`,
        borderColor: `${accentColor}26`,
      }}
    >
      <div className="flex items-start justify-between gap-1.5">
        <div className="min-w-0">
          <p className="kanban-task-title text-slate-100">{task.name}</p>
          <p className="kanban-task-assignee truncate font-mono text-slate-500">{task.assignee}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {isSyncing ? <LoaderCircle className="h-3 w-3 animate-spin text-cyan-300" /> : null}
          {task.url ? (
            <a
              href={task.url}
              target="_blank"
              rel="noreferrer"
              onClick={(event) => event.stopPropagation()}
              className="kanban-link-button rounded border p-1 text-cyan-300 transition hover:border-cyan-300/70 hover:text-cyan-100"
              title="Abrir no ClickUp"
            >
              <ExternalLink className="h-2.5 w-2.5" />
            </a>
          ) : null}
        </div>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        <span className={`inline-flex rounded border px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.14em] ${resolvePriorityClass(task.priority)}`}>
          {task.priority}
        </span>
        <span className="rounded border border-white/15 bg-white/5 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.14em] text-cyan-200">
          {task.pipelineLabel || task.category}
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        <span
          className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.14em]"
          style={{
            borderColor: `${accentColor}55`,
            backgroundColor: `${accentColor}1a`,
            color: accentColor,
          }}
        >
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: accentColor }} />
          {task.status}
        </span>
        <span className={`rounded border px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.14em] ${
          task.isOverdue
            ? "border-rose-500/30 bg-rose-500/10 text-rose-300"
            : "border-white/15 bg-white/5 text-slate-300"
        }`}>
          prazo {formatCompactDateTime(task.dueAt)}
        </span>
      </div>
      <div className="kanban-task-footer">
        <span className="font-mono text-[8px] uppercase tracking-[0.14em] text-slate-500">
          etapa
        </span>
        <span className="font-mono text-[8px] uppercase tracking-[0.14em] text-slate-400">
          {formatHoursWindow(task.statusAgeHours)}
        </span>
        <span className={`font-mono text-[8px] uppercase tracking-[0.14em] ${isSyncing ? "text-cyan-300" : "text-slate-500"}`}>
          {isSyncing ? "sync" : "clickup"}
        </span>
      </div>
    </article>
  );
}

function PeopleProductivityListView({
  people,
}: {
  people: Array<{
    id: string;
    assignee: string;
    accent: string;
    completed: number;
    completionPct: number;
    open: number;
    overdue: number;
    trend: SparkPoint[];
  }>;
}) {
  const waveSeries = useMemo(
    () =>
      people.map((person) => ({
        id: person.id,
        label: person.assignee,
        color: person.accent,
        points: person.trend.map((point) => ({
          label: point.label,
          value: point.current,
        })),
      })),
    [people]
  );

  return (
    <div className="mt-4">
      <Panel
        title="Grafico de Produtividade"
        subtitle="ondas horizontais por responsavel, cada linha seguindo a sua propria cor"
        helpText="Oscilacao temporal de entregas por responsavel ao longo do periodo filtrado."
      >
        <div className="mb-3 flex flex-wrap gap-1.5">
          {people.map((person) => (
            <span
              key={`legend-${person.id}`}
              className="inline-flex items-center gap-1 rounded border border-white/10 bg-white/5 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-slate-300"
            >
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: person.accent }} />
              <span className="truncate" style={{ color: person.accent }}>{person.assignee}</span>
            </span>
          ))}
        </div>
        <div className="h-[240px] sm:h-[280px] xl:h-[320px]">
          <MultiTrendWaveChart series={waveSeries} />
        </div>
      </Panel>
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

function StageDistributionChart({
  stages,
  total,
  onStageClick,
}: {
  stages: PipelineStagePoint[];
  total: number;
  onStageClick?: (stage: string) => void;
}) {
  if (!stages.length || !total) {
    return <div className="mt-2 rounded border border-dashed border-white/10 px-2 py-3 font-mono text-[10px] uppercase tracking-[0.1em] text-slate-500">sem etapas para este processo</div>;
  }

  const topStages = stages.slice(0, 6);
  return (
    <div className="mt-2 min-w-0">
      <div className="flex h-3 overflow-hidden rounded border border-white/10 bg-white/5">
        {topStages.map((stage) => (
          <div key={stage.status} style={{ width: `${(stage.value / total) * 100}%`, backgroundColor: stageColor(stage.status) }} title={`${stage.status}: ${stage.value}`} />
        ))}
      </div>
      <div className="mt-2 space-y-1">
        {topStages.map((stage) => {
          const pct = Number(((stage.value / total) * 100).toFixed(1));
          const content = (
            <>
              <div className="flex min-w-0 items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: stageColor(stage.status) }} />
                <span className="break-words text-xs text-slate-300">{stage.status}</span>
              </div>
              <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
                <span className="font-mono text-[10px] text-slate-400">{stage.value} ({pct}%)</span>
                {stage.overdue > 0 ? <span className="rounded border border-rose-500/30 bg-rose-500/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-rose-300">atr {stage.overdue}</span> : null}
              </div>
            </>
          );

          if (!onStageClick) {
            return (
              <div key={stage.status} className="flex flex-col items-start gap-1.5 sm:flex-row sm:items-center sm:justify-between">
                {content}
              </div>
            );
          }

          return (
            <button
              key={stage.status}
              type="button"
              onClick={() => onStageClick(stage.status)}
              className="flex w-full flex-col items-start gap-1.5 rounded border border-white/10 bg-white/5 px-1.5 py-1 text-left transition hover:border-cyan-500/35 hover:bg-cyan-500/8 sm:flex-row sm:items-center sm:justify-between"
              title={`Abrir itens da etapa ${stage.status}`}
            >
              {content}
            </button>
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
    <div className="mt-2 min-w-0 space-y-1.5">
      {topAssignees.map((item) => {
        const width = (item.value / maxValue) * 100;
        return (
          <div key={item.assignee} className="space-y-0.5">
            <div className="flex flex-col items-start gap-1 sm:flex-row sm:items-center sm:justify-between">
              <span className="break-words text-xs text-slate-300">{item.assignee}</span>
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



