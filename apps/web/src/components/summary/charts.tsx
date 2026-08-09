"use client";

/**
 * Hand-authored SVG chart primitives for the summary page.
 *
 * No chart library — the app already ships three.js and these are four simple
 * forms, so a dependency would cost more than it saves. Every chart here is
 * two series at most: the two corners are the only categorical hues on the
 * page (docs/fight-data-catalog.html), and that pair is validated for
 * colour-vision separation, so nothing may introduce a third.
 *
 * Shared rules, applied by every component below:
 *  - one y-axis, never two
 *  - a legend whenever there are two series, so identity is never colour alone
 *  - recessive grid and axes; thin marks
 *  - a hover layer, because an SVG chart in a browser is interactive whether
 *    or not you plan for it
 *  - text wears ink colours, never the series hue; a colour chip carries identity
 */

import { useId, useMemo, useState } from "react";
import {
  CHART_AXIS,
  CHART_GRID,
  CHART_MUTED,
  CORNER_HEX,
  type Series,
} from "@/lib/summary-analytics";

export interface SeriesMeta {
  /** Display name for the legend and tooltip. */
  name: string;
  color: string;
}

function formatClockShort(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** Shared frame: title, optional note, legend, then the plot. */
export function ChartFrame({
  title,
  note,
  series,
  children,
}: {
  title: string;
  note?: string;
  series?: SeriesMeta[];
  children: React.ReactNode;
}) {
  return (
    <figure className="flex flex-col gap-3 rounded-xl border border-black/10 bg-white p-5">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="font-mono text-xs font-semibold uppercase tracking-widest text-zinc-800">
          {title}
        </h3>
        {series && series.length > 1 && (
          <ul className="flex items-center gap-4">
            {series.map((s) => (
              <li key={s.name} className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="h-2 w-2 rounded-full"
                  style={{ background: s.color }}
                />
                <span className="font-mono text-[11px] text-zinc-700">{s.name}</span>
              </li>
            ))}
          </ul>
        )}
      </figcaption>
      {children}
      {note && <p className="text-xs leading-5 text-zinc-600">{note}</p>}
    </figure>
  );
}

interface LineChartProps {
  windowsMs: number[];
  series: Series;
  names: { you: string; opponent: string };
  colors: { you: string; opponent: string };
  /** Y-axis upper bound; defaults to the data max rounded up. */
  max?: number;
  yLabel?: string;
  /** Fill under the line — reads better for a single depleting meter. */
  area?: boolean;
  unit?: string;
}

/**
 * Two-series time chart with a crosshair tooltip.
 *
 * Both series share one y-axis by construction — the props take a single
 * `max`. A second scale is the most common way a chart of two measures ends
 * up lying about their relationship, so there is deliberately no way to ask
 * for one here.
 */
export function LineChart({
  windowsMs,
  series,
  names,
  colors,
  max,
  yLabel,
  area = false,
  unit = "",
}: LineChartProps) {
  const gradientId = useId();
  const [hover, setHover] = useState<number | null>(null);

  const W = 560;
  const H = 200;
  const PAD = { top: 12, right: 14, bottom: 26, left: 34 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const yMax = useMemo(() => {
    if (max !== undefined) return max;
    const peak = Math.max(...series.you, ...series.opponent);
    return Math.ceil(peak / 10) * 10 || 10;
  }, [max, series]);

  const n = windowsMs.length;
  const x = (i: number) => PAD.left + (i / (n - 1)) * plotW;
  const y = (v: number) => PAD.top + plotH - (v / yMax) * plotH;

  const path = (values: number[]) =>
    values.map((v, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(v)}`).join(" ");
  const areaPath = (values: number[]) =>
    `${path(values)} L ${x(n - 1)} ${PAD.top + plotH} L ${x(0)} ${PAD.top + plotH} Z`;

  const ticks = [0, 0.5, 1].map((f) => Math.round(yMax * f));

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label={`${names.you} versus ${names.opponent} over the match${yLabel ? `, ${yLabel}` : ""}`}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={`${gradientId}-you`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={colors.you} stopOpacity="0.22" />
            <stop offset="100%" stopColor={colors.you} stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`${gradientId}-opp`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={colors.opponent} stopOpacity="0.22" />
            <stop offset="100%" stopColor={colors.opponent} stopOpacity="0" />
          </linearGradient>
        </defs>

        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(t)}
              y2={y(t)}
              stroke={CHART_GRID}
              strokeWidth="1"
            />
            <text
              x={PAD.left - 7}
              y={y(t) + 3.5}
              textAnchor="end"
              fill={CHART_MUTED}
              fontSize="9"
              fontFamily="ui-monospace, monospace"
            >
              {t}
            </text>
          </g>
        ))}

        <line
          x1={PAD.left}
          x2={W - PAD.right}
          y1={PAD.top + plotH}
          y2={PAD.top + plotH}
          stroke={CHART_AXIS}
          strokeWidth="1"
        />

        {[0, Math.floor((n - 1) / 2), n - 1].map((i) => (
          <text
            key={i}
            x={x(i)}
            y={H - 8}
            textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
            fill={CHART_MUTED}
            fontSize="9"
            fontFamily="ui-monospace, monospace"
          >
            {formatClockShort(windowsMs[i])}
          </text>
        ))}

        {area && (
          <>
            <path d={areaPath(series.opponent)} fill={`url(#${gradientId}-opp)`} />
            <path d={areaPath(series.you)} fill={`url(#${gradientId}-you)`} />
          </>
        )}

        <path d={path(series.opponent)} fill="none" stroke={colors.opponent} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <path d={path(series.you)} fill="none" stroke={colors.you} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

        {hover !== null && (
          <g>
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={PAD.top}
              y2={PAD.top + plotH}
              stroke={CHART_AXIS}
              strokeWidth="1"
              strokeDasharray="3 3"
            />
            {/* 2px surface ring keeps the marker legible over the line it sits on. */}
            <circle cx={x(hover)} cy={y(series.opponent[hover])} r="4" fill={colors.opponent} stroke="#fff" strokeWidth="2" />
            <circle cx={x(hover)} cy={y(series.you[hover])} r="4" fill={colors.you} stroke="#fff" strokeWidth="2" />
          </g>
        )}

        {/* Hit targets are full-height columns, far bigger than the marks. */}
        {windowsMs.map((_, i) => (
          <rect
            key={i}
            x={PAD.left + (i - 0.5) * (plotW / (n - 1))}
            y={PAD.top}
            width={plotW / (n - 1)}
            height={plotH}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          />
        ))}
      </svg>

      {hover !== null && (
        <div
          className="pointer-events-none absolute top-2 rounded-md border border-black/10 bg-white/95 px-2.5 py-1.5 shadow-sm"
          style={{
            left: `${(x(hover) / W) * 100}%`,
            transform: hover > n / 2 ? "translateX(-105%)" : "translateX(5%)",
          }}
        >
          <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
            {formatClockShort(windowsMs[hover])}
          </p>
          {(["you", "opponent"] as const).map((side) => (
            <p key={side} className="flex items-center gap-1.5 font-mono text-[11px] text-zinc-800">
              <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: colors[side] }} />
              {names[side]} <span className="font-semibold">{series[side][hover]}{unit}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

/** Grouped bars for a small category axis — damage or punches by type. */
export function GroupedBarChart({
  categories,
  series,
  names,
  colors,
  unit = "",
}: {
  categories: string[];
  series: Series;
  names: { you: string; opponent: string };
  colors: { you: string; opponent: string };
  unit?: string;
}) {
  const [hover, setHover] = useState<{ i: number; side: "you" | "opponent" } | null>(null);

  const W = 560;
  const H = 200;
  const PAD = { top: 12, right: 14, bottom: 30, left: 34 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const yMax = Math.ceil(Math.max(...series.you, ...series.opponent, 1) / 5) * 5;
  const group = plotW / categories.length;
  // 2px of surface between the paired bars, per the mark spec.
  const barW = (group - 14) / 2;
  const y = (v: number) => PAD.top + plotH - (v / yMax) * plotH;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label={`${names.you} versus ${names.opponent} by ${categories.join(", ")}`}
        onMouseLeave={() => setHover(null)}
      >
        {[0, Math.round(yMax / 2), yMax].map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke={CHART_GRID} strokeWidth="1" />
            <text x={PAD.left - 7} y={y(t) + 3.5} textAnchor="end" fill={CHART_MUTED} fontSize="9" fontFamily="ui-monospace, monospace">
              {t}
            </text>
          </g>
        ))}
        <line x1={PAD.left} x2={W - PAD.right} y1={PAD.top + plotH} y2={PAD.top + plotH} stroke={CHART_AXIS} strokeWidth="1" />

        {categories.map((cat, i) => {
          const gx = PAD.left + i * group;
          return (
            <g key={cat}>
              {(["you", "opponent"] as const).map((side, s) => {
                const v = series[side][i];
                const bx = gx + 5 + s * (barW + 4);
                const isHot = hover?.i === i && hover?.side === side;
                return (
                  <rect
                    key={side}
                    x={bx}
                    y={y(v)}
                    width={barW}
                    height={Math.max(0, PAD.top + plotH - y(v))}
                    rx="3"
                    fill={colors[side]}
                    opacity={hover && !isHot ? 0.45 : 1}
                    onMouseEnter={() => setHover({ i, side })}
                  />
                );
              })}
              <text x={gx + group / 2} y={H - 10} textAnchor="middle" fill={CHART_MUTED} fontSize="9" fontFamily="ui-monospace, monospace">
                {cat}
              </text>
            </g>
          );
        })}
      </svg>

      {hover && (
        <div className="pointer-events-none absolute top-2 left-1/2 -translate-x-1/2 rounded-md border border-black/10 bg-white/95 px-2.5 py-1.5 shadow-sm">
          <p className="flex items-center gap-1.5 font-mono text-[11px] text-zinc-800">
            <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: colors[hover.side] }} />
            {names[hover.side]} · {categories[hover.i]}{" "}
            <span className="font-semibold">{series[hover.side][hover.i]}{unit}</span>
          </p>
        </div>
      )}
    </div>
  );
}

/** Left/right split for one fighter — a single 100% bar, two segments. */
export function HandBalanceBar({
  left,
  right,
  color,
  name,
}: {
  left: number;
  right: number;
  color: string;
  name: string;
}) {
  const total = left + right || 1;
  const leftPct = Math.round((left / total) * 100);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between font-mono text-[11px]">
        <span className="text-zinc-700">{name}</span>
        <span className="text-zinc-600">
          {leftPct}% L · {100 - leftPct}% R
        </span>
      </div>
      <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full" role="img" aria-label={`${name}: ${left} left-hand, ${right} right-hand punches`}>
        <div className="rounded-l-full" style={{ width: `${leftPct}%`, background: color, opacity: 0.45 }} />
        <div className="flex-1 rounded-r-full" style={{ background: color }} />
      </div>
      <div className="flex justify-between font-mono text-[10px] text-zinc-600">
        <span>left {left}</span>
        <span>right {right}</span>
      </div>
    </div>
  );
}

/** A value's standing in the pool: a 0–100 track with the player's marker. */
export function PercentileBar({
  label,
  value,
  percentile,
  median,
}: {
  label: string;
  value: string;
  percentile: number;
  median: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-mono text-[11px] uppercase tracking-widest text-zinc-700">
          {label}
        </span>
        <span className="font-mono text-sm font-bold text-black">{value}</span>
      </div>
      <div className="relative h-2.5 w-full rounded-full bg-zinc-200">
        <div
          className="h-full rounded-full"
          style={{ width: `${percentile}%`, background: CORNER_HEX.blue }}
        />
        <div
          className="absolute top-1/2 h-4 w-1 -translate-y-1/2 rounded-full bg-black"
          style={{ left: `calc(${percentile}% - 2px)` }}
          aria-hidden
        />
      </div>
      <div className="flex justify-between font-mono text-[10px] text-zinc-600">
        <span>beats {percentile}% of players</span>
        <span>median {median}</span>
      </div>
    </div>
  );
}
