"use client";

/**
 * Career-scale panels: what this player has done across matches, and where
 * they sit in the pool. All fed from DEMO_PROFILE / DEMO_LEADERBOARD.
 *
 * Everything here is per-player rather than per-match, so it is the part that
 * needs a persisted profile before it can go live — the DB has game_sessions
 * but no per-player aggregates yet.
 */

import { PercentileBar } from "./charts";
import type {
  LeaderboardRow,
  PercentileStat,
  PersonalBest,
  RecordEntry,
} from "@/lib/summary-analytics";

const RESULT_STYLE: Record<RecordEntry["result"], string> = {
  W: "bg-black text-white",
  L: "bg-white text-zinc-500 border border-zinc-300",
  D: "bg-zinc-300 text-zinc-800",
};

export function Panel({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4 rounded-xl border border-black/10 bg-white p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="font-mono text-xs font-semibold uppercase tracking-widest text-zinc-800">
          {title}
        </h3>
        {aside && <span className="font-mono text-[11px] text-zinc-600">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

/**
 * Recent results, newest first — a scannable form line rather than a table.
 * Each chip carries its letter, so result is never colour alone.
 */
export function RecordStrip({
  results,
  longestStreak,
  currentStreak,
}: {
  results: RecordEntry[];
  longestStreak: number;
  currentStreak: number;
}) {
  const wins = results.filter((r) => r.result === "W").length;
  const losses = results.filter((r) => r.result === "L").length;
  const draws = results.length - wins - losses;

  return (
    <Panel title="record" aside={`last ${results.length} · ${wins}W ${losses}L ${draws}D`}>
      <div className="flex flex-wrap gap-1.5">
        {results.map((r, i) => (
          <span
            key={`${r.opponent}-${i}`}
            title={`${r.result} vs ${r.opponent} · ${r.method.toLowerCase()} · ${r.when}`}
            className={`flex h-8 w-8 items-center justify-center rounded-md font-mono text-xs font-bold ${RESULT_STYLE[r.result]}`}
          >
            {r.result}
          </span>
        ))}
      </div>

      <div className="flex gap-8 border-t border-black/10 pt-4">
        <div className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-600">
            longest win streak
          </span>
          <span className="text-2xl font-bold leading-none text-black">{longestStreak}</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-600">
            current streak
          </span>
          <span className="text-2xl font-bold leading-none text-black">
            {currentStreak > 0 ? `${currentStreak}W` : currentStreak < 0 ? `${-currentStreak}L` : "—"}
          </span>
        </div>
      </div>

      <ol className="flex flex-col gap-1 font-mono text-[11px] text-zinc-600">
        {results.slice(0, 3).map((r, i) => (
          <li key={i} className="flex justify-between gap-3">
            <span className="text-zinc-800">
              {r.result} vs {r.opponent}
            </span>
            <span>
              {r.method.toLowerCase()} · {r.when}
            </span>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

export function PersonalBests({ bests }: { bests: PersonalBest[] }) {
  return (
    <Panel title="personal bests" aside="career">
      <ul className="grid gap-4 sm:grid-cols-2">
        {bests.map((b) => (
          <li key={b.label} className="flex flex-col gap-1">
            <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-zinc-600">
              {b.label}
              {b.setThisMatch && (
                <span className="rounded-sm bg-amber-400 px-1.5 py-0.5 text-[9px] font-bold text-black">
                  new
                </span>
              )}
            </span>
            <span className="text-2xl font-bold leading-none tabular-nums text-black">
              {b.value}
            </span>
            <span className="font-mono text-[11px] text-zinc-600">{b.sub}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export function PercentilePanel({
  stats,
  rank,
  poolSize,
  percentile,
}: {
  stats: PercentileStat[];
  rank: number;
  poolSize: number;
  percentile: number;
}) {
  return (
    <Panel title="where you sit" aside={`#${rank} of ${poolSize.toLocaleString()}`}>
      <p className="text-sm leading-6 text-zinc-700">
        Better than{" "}
        <span className="font-bold text-black">{percentile}%</span> of the pool
        overall.
      </p>
      <div className="flex flex-col gap-5 border-t border-black/10 pt-4">
        {stats.map((s) => (
          <PercentileBar key={s.label} {...s} />
        ))}
      </div>
    </Panel>
  );
}

export function Leaderboard({ rows }: { rows: LeaderboardRow[] }) {
  return (
    <Panel title="global leaderboard" aside="top 8 by elo">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[380px] font-mono text-xs">
          <thead>
            <tr className="text-[10px] uppercase tracking-widest text-zinc-600">
              <th scope="col" className="pb-2 text-left font-medium">#</th>
              <th scope="col" className="pb-2 text-left font-medium">fighter</th>
              <th scope="col" className="pb-2 text-right font-medium">elo</th>
              <th scope="col" className="pb-2 text-right font-medium">record</th>
              <th scope="col" className="pb-2 text-right font-medium">streak</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.rank}
                className={`border-t border-black/5 ${row.isYou ? "bg-zinc-100 font-semibold text-black" : "text-zinc-700"}`}
              >
                <td className="py-2 tabular-nums">{row.rank}</td>
                <td className="py-2">
                  {row.name}
                  {row.isYou && (
                    <span className="ml-2 rounded-sm bg-black px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-white">
                      you
                    </span>
                  )}
                </td>
                <td className="py-2 text-right tabular-nums">{row.elo}</td>
                <td className="py-2 text-right tabular-nums">{row.record}</td>
                <td className="py-2 text-right tabular-nums">
                  {row.streak > 0 ? `${row.streak}W` : row.streak < 0 ? `${-row.streak}L` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
