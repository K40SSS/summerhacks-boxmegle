"use client";

import { useMemo, useSyncExternalStore } from "react";
import Link from "next/link";
import { Press_Start_2P } from "next/font/google";
import { PUNCH_STATS, type PunchType } from "game-mechanics";
import { FighterModel } from "@/components/fighter/FighterModel";
import {
  DEMO_MATCH,
  LAST_MATCH_KEY,
  formatClock,
  parseMatch,
  type FighterSummary,
} from "@/lib/match-summary";

const pixelFont = Press_Start_2P({
  weight: "400",
  subsets: ["latin"],
});

/** Corner hues from docs/fight-data-catalog.html (--corner-b / --corner-a). */
const CORNER_COLORS = { red: 0xe34948, blue: 0x2a78d6 } as const;

const PUNCH_ORDER: PunchType[] = ["JAB", "CROSS", "HOOK", "UPPERCUT"];

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-400">
        {label}
      </span>
      <span className="text-2xl font-bold leading-none text-black">{value}</span>
      {sub && (
        <span className="font-mono text-xs text-zinc-500">{sub}</span>
      )}
    </div>
  );
}

function totals(f: FighterSummary) {
  const thrown = PUNCH_ORDER.reduce((n, p) => n + f.punches[p].thrown, 0);
  const landed = PUNCH_ORDER.reduce((n, p) => n + f.punches[p].landed, 0);
  return { thrown, landed, accuracy: thrown ? Math.round((landed / thrown) * 100) : 0 };
}

function FighterColumn({
  fighter,
  align,
}: {
  fighter: FighterSummary;
  align: "left" | "right";
}) {
  const { thrown, landed, accuracy } = totals(fighter);
  const eloDelta = fighter.eloAfter - fighter.eloBefore;
  const alignCls = align === "right" ? "items-end text-right" : "items-start text-left";

  return (
    <div className={`flex flex-col gap-6 ${alignCls}`}>
      <div className={`flex flex-col gap-1 ${alignCls}`}>
        <span
          className="font-mono text-[10px] uppercase tracking-widest"
          style={{ color: fighter.corner === "red" ? "#e34948" : "#2a78d6" }}
        >
          {fighter.corner} corner
        </span>
        <span className="text-3xl font-bold uppercase tracking-tight text-black">
          {fighter.name}
        </span>
        <span className="font-mono text-xs text-zinc-500">
          {fighter.record.wins}–{fighter.record.losses} · elo{" "}
          {fighter.eloAfter}{" "}
          <span className={eloDelta >= 0 ? "text-green-600" : "text-red-600"}>
            ({eloDelta >= 0 ? "+" : ""}
            {eloDelta})
          </span>
        </span>
      </div>

      <Stat label="health remaining" value={`${fighter.healthAfter}`} />
      <Stat label="damage dealt" value={`${fighter.damageDealt}`} />
      <Stat
        label="punches landed"
        value={`${landed}/${thrown}`}
        sub={`${accuracy}% accuracy`}
      />
      <Stat
        label="guard breaks"
        value={`${fighter.guardBreaks}`}
        sub={`guard down ${fighter.guardExposurePct}% of the fight`}
      />
      <Stat
        label="peak punch speed"
        value={fighter.peakSpeed.toFixed(1)}
        sub="shoulder-widths / s"
      />
      <Stat
        label="times winded"
        value={`${fighter.timesWinded}`}
        sub={fighter.timesWinded > 0 ? "emptied the tank" : "paced the whole fight"}
      />

      <table className="font-mono text-xs text-zinc-600">
        <tbody>
          {PUNCH_ORDER.map((p) => (
            <tr key={p}>
              <td className={`pb-1 uppercase tracking-widest text-zinc-400 ${align === "right" ? "pl-6 text-right" : "pr-6"}`}>
                {PUNCH_STATS[p].label}
              </td>
              <td className={align === "right" ? "text-right" : ""}>
                {fighter.punches[p].landed}/{fighter.punches[p].thrown}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The fight page writes once before navigating here; no updates to hear. */
const subscribeNever = () => () => {};

/** Touching sessionStorage throws under blocked-storage settings — that must
 *  mean "demo fight", not a crashed route. */
const readSnapshot = () => {
  try {
    return sessionStorage.getItem(LAST_MATCH_KEY);
  } catch {
    return null;
  }
};

export default function SummaryPage() {
  // sessionStorage is an external store the server can't see: SSR/hydration
  // renders the demo fixture (server snapshot null), then React swaps in the
  // stored fight if the client snapshot differs.
  const raw = useSyncExternalStore(subscribeNever, readSnapshot, () => null);
  const stored = useMemo(() => parseMatch(raw), [raw]);
  const match = stored ?? DEMO_MATCH;
  const isDemo = stored === null;

  const winner =
    match.winner === null ? null : match.winner === "you" ? match.you : match.opponent;
  const strongestBy =
    match.strongestPunch.by === "you" ? match.you.name : match.opponent.name;

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden bg-white font-sans">
      <header className="absolute left-0 right-0 top-0 z-10 flex items-center justify-between px-6 py-5 sm:px-10">
        <span
          className={`${pixelFont.className} text-[10px] text-black [image-rendering:pixelated]`}
        >
          boxmegle
        </span>
        <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
          match summary
        </span>
      </header>

      <main className="relative z-10 mx-auto flex w-full max-w-6xl flex-1 flex-col items-center gap-10 px-6 pb-12 pt-24">
        <div className="flex flex-col items-center gap-3 text-center">
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-zinc-500">
            {"// final bell — "}
            {match.method.toLowerCase()} · {formatClock(match.durationMs)}
          </p>
          <h1 className="text-4xl font-bold uppercase leading-tight tracking-tight text-black sm:text-6xl">
            {winner ? `${winner.name} wins` : "Draw"}
          </h1>
          {isDemo && (
            <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-400">
              demo fight — your real matches will land here
            </p>
          )}
        </div>

        <div className="grid w-full grid-cols-1 items-center gap-10 lg:grid-cols-[1fr_minmax(300px,420px)_1fr]">
          <FighterColumn fighter={match.you} align="left" />

          <div className="order-first flex flex-col items-center gap-2 lg:order-none">
            <FighterModel
              color={winner ? CORNER_COLORS[winner.corner] : CORNER_COLORS.red}
              withRing
              withEnvironment
              dragToSpin
              spinSeconds={40}
              className="h-[420px] w-full sm:h-[480px]"
            />
            <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-400">
              drag to spin
            </p>
          </div>

          <FighterColumn fighter={match.opponent} align="right" />
        </div>

        <div className="flex items-center gap-10 font-mono text-xs uppercase tracking-widest text-zinc-500">
          <div className="flex flex-col gap-1 text-center">
            <span className="text-zinc-400">strongest punch</span>
            <span className="text-black">
              {PUNCH_STATS[match.strongestPunch.type].label} —{" "}
              {match.strongestPunch.damage} dmg
            </span>
            <span className="text-zinc-500">
              {strongestBy} @ {formatClock(match.strongestPunch.atMs)} ·{" "}
              {match.strongestPunch.speed.toFixed(1)} sw/s
            </span>
          </div>
        </div>

        <p className="max-w-2xl text-center text-sm leading-6 text-zinc-600">
          {match.narrative}
        </p>

        <div className="flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/"
            className="rounded-sm border border-black px-10 py-3 font-mono text-sm uppercase tracking-widest text-black transition-colors hover:bg-black hover:text-white"
          >
            Back to start
          </Link>
          <button
            disabled
            className="cursor-not-allowed rounded-sm border border-zinc-300 px-10 py-3 font-mono text-sm uppercase tracking-widest text-zinc-400"
          >
            Watch replay {"// soon"}
          </button>
        </div>
      </main>
    </div>
  );
}
