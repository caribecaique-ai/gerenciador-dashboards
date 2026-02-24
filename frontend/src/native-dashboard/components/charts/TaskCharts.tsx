import { useId, useMemo } from "react";
import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  LabelList,
  Line,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface DonutDatum {
  label: string;
  value: number;
  color?: string;
}

interface DonutChartProps {
  data: DonutDatum[];
  colors?: string[];
}

interface VerticalBarDatum {
  label: string;
  value: number;
  color?: string;
}

interface VerticalBarChartProps {
  data: VerticalBarDatum[];
  barColor?: string;
}

interface HorizontalBarDatum {
  label: string;
  value: number;
}

interface HorizontalBarChartProps {
  data: HorizontalBarDatum[];
  barColor?: string;
}

interface TrendPointDatum {
  label: string;
  value: number | null;
  baselineValue: number | null;
}

interface TrendComparisonChartProps {
  data: TrendPointDatum[];
  valueLabel?: string;
  baselineLabel?: string;
  valueColor?: string;
  baselineColor?: string;
}

interface UniformDatum {
  label: string;
  value: number | null;
  baselineValue?: number | null;
}

interface UniformLineChartProps {
  data: UniformDatum[];
  valueLabel: string;
  valueColor: string;
  baselineLabel?: string;
  baselineColor?: string;
  showBaseline?: boolean;
}

interface UniformVerticalBarChartProps {
  data: UniformDatum[];
  valueLabel: string;
  valueColor: string;
}

interface TrendSparklineDatum {
  label: string;
  current: number | null;
  previous: number | null;
}

interface TrendSparklineProps {
  data: TrendSparklineDatum[];
  currentColor?: string;
  previousColor?: string;
  smooth?: boolean;
}

interface ValueTrendProps {
  current: number | null | undefined;
  previous: number | null | undefined;
  suffix?: string;
  inverse?: boolean;
  precision?: number;
}

const DEFAULT_COLORS = ["#00f3ff", "#39ff14", "#ffb020", "#ff5f87", "#47a9ff", "#a68dff"];
const DEFAULT_SHADOW_COLORS = [
  "rgba(0,243,255,0.18)",
  "rgba(57,255,20,0.18)",
  "rgba(255,176,32,0.18)",
  "rgba(255,95,135,0.18)",
  "rgba(71,169,255,0.18)",
  "rgba(166,141,255,0.18)",
];

const chartTooltipStyle = {
  backgroundColor: "rgba(3, 4, 7, 0.95)",
  border: "1px solid rgba(0, 243, 255, 0.35)",
  borderRadius: "0px",
  color: "#E7EEF8",
  fontFamily: "JetBrains Mono, monospace",
  fontSize: "10px",
  textTransform: "uppercase" as const,
  letterSpacing: "0.1em",
};

const toFiniteNumber = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const formatMetric = (value: number | null | undefined): string => {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  if (Math.abs(value) >= 1000) return value.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
  return Number(value.toFixed(2)).toString();
};

const formatCompactNumber = (value: number, decimals = 1): string => {
  if (!Number.isFinite(value)) return "-";
  if (Math.abs(value) >= 1000) {
    return value.toLocaleString("pt-BR", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  }
  return Number(value.toFixed(decimals)).toString();
};

const truncateLabel = (label: string, max = 18): string => {
  if (!label) return "-";
  return label.length > max ? `${label.slice(0, max - 3)}...` : label;
};

type TrendDirection = "up" | "down" | "stable" | "none";

const resolveTrendDirection = (firstValue: number | null, latestValue: number | null): TrendDirection => {
  if (firstValue === null || latestValue === null) return "none";
  if (latestValue > firstValue) return "up";
  if (latestValue < firstValue) return "down";
  return "stable";
};

const UniformVerticalBarChart = ({ data, valueLabel, valueColor }: UniformVerticalBarChartProps) => {
  const chartUid = useId().replace(/:/g, "");
  const barGradientId = `${chartUid}-bar-gradient`;

  const normalizedData = useMemo(
    () =>
      (data || [])
        .map((point, index) => ({
          label: String(point.label || index + 1),
          value: toFiniteNumber(point.value),
        }))
        .filter((point): point is { label: string; value: number } => typeof point.value === "number"),
    [data]
  );

  const hasData = normalizedData.length > 0;
  const totalValue = useMemo(
    () => normalizedData.reduce((sum, item) => sum + item.value, 0),
    [normalizedData]
  );
  const peakPoint = useMemo(
    () =>
      normalizedData.length
        ? normalizedData.reduce((peak, current) => (current.value > peak.value ? current : peak), normalizedData[0])
        : null,
    [normalizedData]
  );
  const averageValue = normalizedData.length ? totalValue / normalizedData.length : 0;
  const maxValue = peakPoint?.value ?? 0;
  const yDomainMax = maxValue <= 0 ? 1 : Math.max(1, Math.ceil(maxValue * 1.2));

  if (!hasData) {
    return (
      <div className="flex h-full min-h-[160px] items-center justify-center rounded border border-dashed border-white/10 font-mono text-[10px] uppercase tracking-[0.1em] text-slate-500">
        sem dados para o periodo
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-2 flex flex-wrap gap-1.5 font-mono text-[9px] uppercase tracking-[0.12em]">
        <span className="rounded border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 text-cyan-300">
          Total: {formatMetric(totalValue)}
        </span>
        <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-emerald-300">
          Pico: {peakPoint ? `${formatMetric(peakPoint.value)} @ ${truncateLabel(peakPoint.label, 10)}` : "-"}
        </span>
        <span className="rounded border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 text-violet-300">
          Media: {formatMetric(averageValue)}
        </span>
        <span className="rounded border border-white/20 bg-white/5 px-1.5 py-0.5 text-slate-300">
          Categorias: {normalizedData.length}
        </span>
      </div>

      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={normalizedData} margin={{ top: 16, right: 16, left: 4, bottom: 26 }}>
            <defs>
              <linearGradient id={barGradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={valueColor} stopOpacity={0.92} />
                <stop offset="100%" stopColor={valueColor} stopOpacity={0.45} />
              </linearGradient>
            </defs>

            <CartesianGrid strokeDasharray="2 4" stroke="rgba(0,243,255,0.12)" vertical={false} />

            <XAxis
              dataKey="label"
              tick={{ fill: "#8aa1bb", fontSize: 9, fontFamily: "JetBrains Mono" }}
              axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
              tickLine={false}
              interval={0}
              minTickGap={6}
              angle={-16}
              textAnchor="end"
              height={48}
              tickFormatter={(label) => truncateLabel(String(label), 11)}
            />

            <YAxis
              tick={{ fill: "#8aa1bb", fontSize: 9, fontFamily: "JetBrains Mono" }}
              axisLine={false}
              tickLine={false}
              domain={[0, yDomainMax]}
              allowDecimals={false}
            />

            <Tooltip
              cursor={{ fill: "rgba(0,243,255,0.08)" }}
              contentStyle={chartTooltipStyle}
              labelStyle={{ color: "#9fb6d1", marginBottom: "4px" }}
              labelFormatter={(label) => `Categoria: ${label}`}
              formatter={(rawValue: unknown) => {
                const value = toFiniteNumber(rawValue);
                if (value === null) return ["-", valueLabel.toUpperCase()];
                return [formatMetric(value), valueLabel.toUpperCase()];
              }}
            />

            <Bar
              dataKey="value"
              fill={`url(#${barGradientId})`}
              radius={[5, 5, 0, 0]}
              maxBarSize={46}
              stroke={valueColor}
              strokeWidth={1}
              style={{ filter: `drop-shadow(0 0 7px ${valueColor})` }}
            >
              <LabelList
                dataKey="value"
                position="top"
                offset={6}
                fill={valueColor}
                fontFamily="JetBrains Mono"
                fontSize={10}
                formatter={(rawValue: unknown) => {
                  const value = toFiniteNumber(rawValue);
                  if (value === null) return "-";
                  return formatCompactNumber(value, 0);
                }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

const UniformHorizontalBarChart = ({ data, valueLabel, valueColor }: UniformVerticalBarChartProps) => {
  const chartUid = useId().replace(/:/g, "");
  const barGradientId = `${chartUid}-bar-horizontal-gradient`;

  const normalizedData = useMemo(
    () =>
      (data || [])
        .map((point, index) => ({
          label: String(point.label || index + 1),
          value: toFiniteNumber(point.value),
        }))
        .filter((point): point is { label: string; value: number } => typeof point.value === "number")
        .sort((a, b) => b.value - a.value),
    [data]
  );

  const hasData = normalizedData.length > 0;
  const totalValue = useMemo(
    () => normalizedData.reduce((sum, item) => sum + item.value, 0),
    [normalizedData]
  );
  const peakPoint = useMemo(
    () =>
      normalizedData.length
        ? normalizedData.reduce((peak, current) => (current.value > peak.value ? current : peak), normalizedData[0])
        : null,
    [normalizedData]
  );
  const averageValue = normalizedData.length ? totalValue / normalizedData.length : 0;
  const maxValue = peakPoint?.value ?? 0;
  const xDomainMax = maxValue <= 0 ? 1 : Math.max(1, Math.ceil(maxValue * 1.22));
  const maxLabelChars = normalizedData.reduce((acc, item) => Math.max(acc, item.label.length), 0);
  const yAxisWidth = Math.min(200, Math.max(110, maxLabelChars * 7));

  if (!hasData) {
    return (
      <div className="flex h-full min-h-[160px] items-center justify-center rounded border border-dashed border-white/10 font-mono text-[10px] uppercase tracking-[0.1em] text-slate-500">
        sem dados para o periodo
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-2 flex flex-wrap gap-1.5 font-mono text-[9px] uppercase tracking-[0.12em]">
        <span className="rounded border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 text-cyan-300">
          Total: {formatMetric(totalValue)}
        </span>
        <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-emerald-300">
          Pico: {peakPoint ? `${formatMetric(peakPoint.value)} @ ${truncateLabel(peakPoint.label, 14)}` : "-"}
        </span>
        <span className="rounded border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 text-violet-300">
          Media: {formatMetric(averageValue)}
        </span>
        <span className="rounded border border-white/20 bg-white/5 px-1.5 py-0.5 text-slate-300">
          Responsaveis: {normalizedData.length}
        </span>
      </div>

      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={normalizedData}
            layout="vertical"
            margin={{ top: 8, right: 34, left: 6, bottom: 8 }}
            barCategoryGap="24%"
          >
            <defs>
              <linearGradient id={barGradientId} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor={valueColor} stopOpacity={0.92} />
                <stop offset="100%" stopColor={valueColor} stopOpacity={0.45} />
              </linearGradient>
            </defs>

            <CartesianGrid strokeDasharray="2 4" stroke="rgba(0,243,255,0.12)" horizontal={false} />

            <XAxis
              type="number"
              tick={{ fill: "#8aa1bb", fontSize: 9, fontFamily: "JetBrains Mono" }}
              axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
              tickLine={false}
              allowDecimals={false}
              domain={[0, xDomainMax]}
            />

            <YAxis
              type="category"
              dataKey="label"
              width={yAxisWidth}
              tick={{ fill: "#8aa1bb", fontSize: 9, fontFamily: "JetBrains Mono" }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(label) => truncateLabel(String(label), 22)}
            />

            <Tooltip
              cursor={{ fill: "rgba(0,243,255,0.08)" }}
              contentStyle={chartTooltipStyle}
              labelStyle={{ color: "#9fb6d1", marginBottom: "4px" }}
              labelFormatter={(label) => `Responsavel: ${label}`}
              formatter={(rawValue: unknown) => {
                const value = toFiniteNumber(rawValue);
                if (value === null) return ["-", valueLabel.toUpperCase()];
                return [formatMetric(value), valueLabel.toUpperCase()];
              }}
            />

            <Bar
              dataKey="value"
              fill={`url(#${barGradientId})`}
              radius={[0, 5, 5, 0]}
              maxBarSize={34}
              stroke={valueColor}
              strokeWidth={1}
              style={{ filter: `drop-shadow(0 0 7px ${valueColor})` }}
            >
              <LabelList
                dataKey="value"
                position="right"
                offset={8}
                fill={valueColor}
                fontFamily="JetBrains Mono"
                fontSize={10}
                formatter={(rawValue: unknown) => {
                  const value = toFiniteNumber(rawValue);
                  if (value === null) return "-";
                  return formatCompactNumber(value, 0);
                }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

const UniformLineChart = ({
  data,
  valueLabel,
  valueColor,
  baselineLabel = "Comparativo",
  baselineColor = "#94a3b8",
  showBaseline = false,
}: UniformLineChartProps) => {
  const chartUid = useId().replace(/:/g, "");
  const valueGradientId = `${chartUid}-value-gradient`;
  const baselineGradientId = `${chartUid}-baseline-gradient`;

  const normalizedData = useMemo(
    () =>
      (data || []).map((point, index) => ({
        label: String(point.label || index + 1),
        value: toFiniteNumber(point.value),
        baselineValue: toFiniteNumber(point.baselineValue),
      })),
    [data]
  );

  const chartData = useMemo(
    () =>
      normalizedData.length === 1
        ? [normalizedData[0], { ...normalizedData[0], label: `${normalizedData[0].label} ` }]
        : normalizedData,
    [normalizedData]
  );

  const numericSeries = useMemo(() => {
    const points: number[] = [];

    chartData.forEach((point) => {
      if (typeof point.value === "number") points.push(point.value);
      if (showBaseline && typeof point.baselineValue === "number") points.push(point.baselineValue);
    });

    if (!points.length) return { min: 0, max: 1 };
    return { min: Math.min(...points), max: Math.max(...points) };
  }, [chartData, showBaseline]);

  const yDomain = useMemo<[number, number]>(() => {
    const span = Math.max(1, numericSeries.max - numericSeries.min);
    const padding = Math.max(1, span * 0.18);
    const lower = Number((numericSeries.min - padding).toFixed(2));
    const upper = Number((numericSeries.max + padding).toFixed(2));

    if (lower === upper) {
      return [lower - 1, upper + 1];
    }

    return [lower, upper];
  }, [numericSeries]);

  const valuePoints = useMemo(
    () =>
      normalizedData
        .filter((point): point is { label: string; value: number; baselineValue: number | null } => typeof point.value === "number")
        .map((point) => ({
          label: point.label,
          value: point.value,
          baselineValue: point.baselineValue ?? null,
        })),
    [normalizedData]
  );

  const latestPoint = valuePoints.length ? valuePoints[valuePoints.length - 1] : null;
  const firstPoint = valuePoints.length ? valuePoints[0] : null;
  const peakPoint = valuePoints.length
    ? valuePoints.reduce((peak, current) => (current.value > peak.value ? current : peak), valuePoints[0])
    : null;
  const direction = resolveTrendDirection(firstPoint?.value ?? null, latestPoint?.value ?? null);
  const delta =
    latestPoint && firstPoint ? Number((latestPoint.value - firstPoint.value).toFixed(2)) : null;

  const directionLabel =
    direction === "up" ? "Subida" : direction === "down" ? "Queda" : direction === "stable" ? "Mantendo" : "Sem dados";

  const directionClass =
    direction === "up"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
      : direction === "down"
        ? "border-rose-500/30 bg-rose-500/10 text-rose-300"
        : "border-cyan-500/30 bg-cyan-500/10 text-cyan-300";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-2 flex flex-wrap gap-1.5 font-mono text-[9px] uppercase tracking-[0.12em]">
        <span className={`rounded border px-1.5 py-0.5 ${directionClass}`}>
          Direcao: {directionLabel}
        </span>
        <span className="rounded border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 text-cyan-300">
          Atual: {formatMetric(latestPoint?.value)}
        </span>
        <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-emerald-300">
          Pico: {peakPoint ? `${formatMetric(peakPoint.value)} @ ${truncateLabel(peakPoint.label, 8)}` : "-"}
        </span>
        <span className="rounded border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 text-violet-300">
          Variacao: {delta === null ? "-" : `${delta > 0 ? "+" : ""}${formatMetric(delta)}`}
        </span>
      </div>

      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 8, right: 14, left: -10, bottom: 0 }}>
            <defs>
              <linearGradient id={valueGradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={valueColor} stopOpacity={0.35} />
                <stop offset="95%" stopColor={valueColor} stopOpacity={0} />
              </linearGradient>
              <linearGradient id={baselineGradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={baselineColor} stopOpacity={0.24} />
                <stop offset="95%" stopColor={baselineColor} stopOpacity={0} />
              </linearGradient>
            </defs>

            <CartesianGrid strokeDasharray="2 4" stroke="rgba(0,243,255,0.12)" vertical={false} />

            <XAxis
              dataKey="label"
              tick={{ fill: "#8aa1bb", fontSize: 9, fontFamily: "JetBrains Mono" }}
              axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
              tickLine={false}
              minTickGap={14}
              tickFormatter={(label) => truncateLabel(String(label), 10)}
            />

            <YAxis
              tick={{ fill: "#8aa1bb", fontSize: 9, fontFamily: "JetBrains Mono" }}
              axisLine={false}
              tickLine={false}
              domain={yDomain}
            />

            <Tooltip
              cursor={{ stroke: "rgba(0,243,255,0.45)", strokeDasharray: "3 3" }}
              contentStyle={chartTooltipStyle}
              labelStyle={{ color: "#9fb6d1", marginBottom: "4px" }}
              labelFormatter={(label) => `X: ${label}`}
              formatter={(rawValue: unknown, key: string | undefined) => {
                const value = toFiniteNumber(rawValue);
                const safeKey = String(key || "");
                if (value === null) return ["-", safeKey];
                if (key === "baselineValue") return [formatMetric(value), baselineLabel.toUpperCase()];
                return [formatMetric(value), valueLabel.toUpperCase()];
              }}
            />

            {showBaseline ? (
              <>
                <Area
                  type="monotone"
                  dataKey="baselineValue"
                  stroke="none"
                  fill={`url(#${baselineGradientId})`}
                  connectNulls
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="baselineValue"
                  stroke={baselineColor}
                  strokeWidth={1.4}
                  strokeDasharray="5 4"
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
              </>
            ) : null}

            <Area
              type="monotone"
              dataKey="value"
              stroke="none"
              fill={`url(#${valueGradientId})`}
              connectNulls
            />

            <Line
              type="monotone"
              dataKey="value"
              stroke={valueColor}
              strokeWidth={2.4}
              strokeLinecap="round"
              strokeLinejoin="round"
              dot={{ r: 2.6, fill: valueColor, stroke: "#020306", strokeWidth: 0.8 }}
              activeDot={{ r: 4.2, fill: valueColor, stroke: "#ffffff", strokeWidth: 1 }}
              connectNulls
              style={{ filter: `drop-shadow(0 0 8px ${valueColor})` }}
            />

            {latestPoint ? (
              <ReferenceDot
                x={latestPoint.label}
                y={latestPoint.value}
                r={3.6}
                fill={valueColor}
                stroke="#ffffff"
                strokeWidth={1}
                ifOverflow="extendDomain"
              />
            ) : null}

            {peakPoint ? (
              <ReferenceDot
                x={peakPoint.label}
                y={peakPoint.value}
                r={3}
                fill="#39ff14"
                stroke="#020306"
                strokeWidth={1}
                ifOverflow="extendDomain"
              />
            ) : null}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export const TrendSparkline = ({
  data,
  currentColor = "#00f3ff",
  previousColor = DEFAULT_SHADOW_COLORS[0],
  smooth = true,
}: TrendSparklineProps) => {
  const chartUid = useId().replace(/:/g, "");
  const currentGradientId = `${chartUid}-spark-current-gradient`;
  const previousGradientId = `${chartUid}-spark-prev-gradient`;
  const chartType = smooth ? "monotone" : "linear";

  const normalizedData = useMemo(
    () =>
      (data || []).map((point, index) => ({
        label: String(point.label || index + 1),
        current: toFiniteNumber(point.current),
        previous: toFiniteNumber(point.previous),
      })),
    [data]
  );

  const hasAnyData = normalizedData.some(
    (point) => Number.isFinite(point.current) || Number.isFinite(point.previous)
  );

  if (!hasAnyData) {
    return (
      <div className="flex h-full min-h-[72px] items-center justify-center rounded border border-dashed border-white/10 font-mono text-[10px] text-slate-500">
        sem historico
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={normalizedData} margin={{ top: 6, right: 2, left: 2, bottom: 0 }}>
        <defs>
          <linearGradient id={currentGradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={currentColor} stopOpacity={0.38} />
            <stop offset="95%" stopColor={currentColor} stopOpacity={0} />
          </linearGradient>
          <linearGradient id={previousGradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={previousColor} stopOpacity={0.25} />
            <stop offset="95%" stopColor={previousColor} stopOpacity={0} />
          </linearGradient>
        </defs>

        <XAxis dataKey="label" hide />
        <YAxis hide domain={["auto", "auto"]} />
        <Tooltip
          cursor={false}
          contentStyle={chartTooltipStyle}
          labelStyle={{ color: "#9fb6d1", marginBottom: "2px" }}
          formatter={(value: unknown, key: string | undefined) => {
            const numeric = toFiniteNumber(value);
            const safeKey = String(key || "");
            if (numeric === null) return ["-", safeKey];
            return [formatCompactNumber(numeric, 2), key === "previous" ? "Anterior" : "Atual"];
          }}
        />

        <Area
          type={chartType}
          dataKey="previous"
          stroke="none"
          fill={`url(#${previousGradientId})`}
          isAnimationActive={false}
          connectNulls
        />
        <Line
          type={chartType}
          dataKey="previous"
          stroke={previousColor}
          strokeWidth={1.15}
          dot={false}
          strokeDasharray="4 4"
          isAnimationActive={false}
          connectNulls
        />

        <Area
          type={chartType}
          dataKey="current"
          stroke="none"
          fill={`url(#${currentGradientId})`}
          connectNulls
        />
        <Line
          type={chartType}
          dataKey="current"
          stroke={currentColor}
          strokeWidth={2}
          dot={false}
          connectNulls
          style={{ filter: `drop-shadow(0 0 6px ${currentColor})` }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
};

export const ValueTrend = ({
  current,
  previous,
  suffix = "%",
  inverse = false,
  precision = 1,
}: ValueTrendProps) => {
  const currentValue = toFiniteNumber(current);
  const previousValue = toFiniteNumber(previous);

  if (currentValue === null || previousValue === null || previousValue === 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded border border-slate-500/20 bg-slate-500/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-slate-400">
        <Minus className="h-3 w-3" /> sem base
      </span>
    );
  }

  const deltaPercent = ((currentValue - previousValue) / previousValue) * 100;
  const rounded = Number(deltaPercent.toFixed(precision));
  const effectiveDelta = inverse ? -rounded : rounded;
  const isPositive = effectiveDelta > 0;
  const isNegative = effectiveDelta < 0;

  const toneClass = isPositive
    ? "border-emerald-500/30 bg-emerald-500/12 text-emerald-300"
    : isNegative
      ? "border-rose-500/30 bg-rose-500/12 text-rose-300"
      : "border-cyan-500/30 bg-cyan-500/12 text-cyan-300";

  return (
    <span className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${toneClass}`}>
      {isPositive ? <TrendingUp className="h-3 w-3" /> : isNegative ? <TrendingDown className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
      {effectiveDelta > 0 ? "+" : ""}
      {formatCompactNumber(effectiveDelta, precision)}
      {suffix}
    </span>
  );
};

export const DonutChart = ({ data, colors = DEFAULT_COLORS }: DonutChartProps) => (
  <UniformLineChart
    data={data.map((item) => ({ label: item.label, value: item.value }))}
    valueLabel="Quantidade"
    valueColor={colors[0] || "#00f3ff"}
  />
);

export const VerticalBarChartKpi = ({
  data,
  barColor = "#00f3ff",
}: VerticalBarChartProps) => (
  <UniformVerticalBarChart
    data={data.map((item) => ({ label: item.label, value: item.value }))}
    valueLabel="Quantidade"
    valueColor={barColor}
  />
);

export const HorizontalBarChartKpi = ({
  data,
  barColor = "#00f3ff",
}: HorizontalBarChartProps) => (
  <UniformHorizontalBarChart
    data={data.map((item) => ({ label: item.label, value: item.value }))}
    valueLabel="Quantidade"
    valueColor={barColor}
  />
);

export const TrendComparisonChart = ({
  data,
  valueLabel = "Atual",
  baselineLabel = "Comparativo",
  valueColor = "#00f3ff",
  baselineColor = "#94a3b8",
}: TrendComparisonChartProps) => (
  <UniformLineChart
    data={data.map((item) => ({
      label: item.label,
      value: item.value,
      baselineValue: item.baselineValue,
    }))}
    valueLabel={valueLabel}
    valueColor={valueColor}
    baselineLabel={baselineLabel}
    baselineColor={baselineColor}
    showBaseline
  />
);

