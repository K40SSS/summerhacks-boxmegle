"use client";

import { Suspense, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Press_Start_2P } from "next/font/google";
import { PUNCH_STATS, type PunchType } from "game-mechanics";
import { FighterModel } from "@/components/fighter/FighterModel";
import {
  ChartFrame,
  GroupedBarChart,
  HandBalanceBar,
  LineChart,
} from "@/components/summary/charts";
import { MatchReplay } from "@/components/summary/MatchReplay";
import { Panel } from "@/components/summary/ProfilePanels";
import { CORNER_HEX, DEMO_ANALYTICS } from "@/lib/summary-analytics";
import { replayDurationMs, replayEventsFrom, sidesOf } from "@/lib/replay-view";
import { useReplay } from "@/lib/use-replay";
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

const MATCHMAKER_URL =
  process.env.NEXT_PUBLIC_MATCHMAKER_URL ?? "http://localhost:4000";

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

/** A row from /games/:id — real metadata, no per-punch stats (see below). */
interface LoggedGameDetail {
  id: string;
  completedAt: string | null;
  result: "W" | "L" | "D";
  you: { uuid: string; name: string } | null;
  opponent: { uuid: string; name: string } | null;
}

/**
 * Reopen a fight from the log. `completed_games` stores the winner, the
 * strongest punch and a replay key — but no full stat payload, so a reopened
 * fight shows its REAL identity (who, when, what result) over sample stats.
 * Storing the rest needs a `summary jsonb` column on that table.
 */
function useLoggedGame(gameId: string | null, viewer: string | null) {
  const [game, setGame] = useState<LoggedGameDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!gameId) return;
    let cancelled = false;
    const query = viewer ? `?viewer=${encodeURIComponent(viewer)}` : "";
    fetch(`${MATCHMAKER_URL}/games/${encodeURIComponent(gameId)}${query}`)
      .then((res) =>
        res.ok ? res.json() : Promise.reject(new Error(res.status === 404 ? "not found" : `status ${res.status}`)),
      )
      .then((data: { game?: LoggedGameDetail }) => {
        if (!cancelled && data.game) setGame(data.game);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [gameId, viewer]);

  return { game, error };
}

function SummaryContent() {
  const searchParams = useSearchParams();
  const gameId = searchParams.get("game");
  const viewerUuid = searchParams.get("u");
  const { game: loggedGame, error: gameError } = useLoggedGame(gameId, viewerUuid);

  // sessionStorage is an external store the server can't see: SSR/hydration
  // renders the demo fixture (server snapshot null), then React swaps in the
  // stored fight if the client snapshot differs.
  const raw = useSyncExternalStore(subscribeNever, readSnapshot, () => null);
  const stored = useMemo(() => parseMatch(raw), [raw]);
  const baseMatch = stored ?? DEMO_MATCH;
  const isDemo = stored === null && !loggedGame;

  // Overlay the reopened fight's real identity onto the fixture's stats.
  const match = useMemo(() => {
    if (!loggedGame) return baseMatch;
    return {
      ...baseMatch,
      winner:
        loggedGame.result === "D"
          ? null
          : loggedGame.result === "W"
            ? ("you" as const)
            : ("opponent" as const),
      you: { ...baseMatch.you, name: loggedGame.you?.name ?? baseMatch.you.name },
      opponent: {
        ...baseMatch.opponent,
        name: loggedGame.opponent?.name ?? baseMatch.opponent.name,
      },
    };
  }, [baseMatch, loggedGame]);

  const winner =
    match.winner === null ? null : match.winner === "you" ? match.you : match.opponent;

  // Nothing records the per-window charts yet, so the deep dive still falls
  // back to the fixture. The `analyticsAreSample` flag is what the page shows
  // the player, rather than passing sample numbers off as their fight.
  const analytics = match.analytics ?? DEMO_ANALYTICS;
  const analyticsAreSample = match.analytics === undefined;

  // The replay tape IS real whenever one exists — recorded skeletons and the
  // punch log the server wrote at the bell — even while the charts around it
  // are still sample data. It loads separately from the row because it is two
  // orders of magnitude larger and arrives seconds later.
  const { tape, status: replayStatus } = useReplay(gameId);
  const sides = useMemo(() => (tape ? sidesOf(tape, viewerUuid) : null), [tape, viewerUuid]);
  const replayEvents = useMemo(
    () => (tape && sides ? replayEventsFrom(tape, sides) : analytics.replay),
    [tape, sides, analytics.replay],
  );
  // A tape knows its own length; the stored summary's duration is the fallback.
  const replayLengthMs = tape ? replayDurationMs(tape) : match.durationMs;

  // When a real tape is loaded, derive the strongest punch from the recorded
  // event log so the seek button lands at the exact moment in the replay
  // timeline. The stored/demo summary uses a different clock origin and cannot
  // be trusted for seeking into a tape that was not recorded alongside it.
  const tapeStrongest = useMemo(() => {
    if (!tape || !sides) return null;
    let best: (typeof replayEvents)[0] | null = null;
    for (const e of replayEvents) {
      // Ties go to the later punch — a fight-ending blow of equal weight wins.
      if (e.damage > 0 && (!best || e.damage >= best.damage)) best = e;
    }
    if (!best) return null;
    return {
      type: best.punchType,
      damage: best.damage,
      atMs: best.atMs,
      speed: best.speed,
      by: best.by,
    };
  }, [tape, sides, replayEvents]);

  const effectiveStrongest = tapeStrongest ?? match.strongestPunch;
  const strongestBy =
    effectiveStrongest.by === "you" ? match.you.name : match.opponent.name;

  // The strongest-punch card seeks the shared replay instead of owning a
  // second player. Bumped through a counter so re-clicking the same punch
  // still re-seeks.
  const [seek, setSeek] = useState<{ atMs: number; nonce: number } | null>(null);

  const names = { you: match.you.name, opponent: match.opponent.name };
  const corners = { you: match.you.corner, opponent: match.opponent.corner };
  const seriesColors = {
    you: CORNER_HEX[match.you.corner],
    opponent: CORNER_HEX[match.opponent.corner],
  };
  const seriesMeta = [
    { name: names.you, color: seriesColors.you },
    { name: names.opponent, color: seriesColors.opponent },
  ];

  // When a real tape is available use zone-scaled damage straight from the
  // recorded events — each event's `damage` already has the 1.5× HEAD
  // multiplier applied by resolvePunch on the server. Without a tape fall back
  // to base PUNCH_STATS damage (no zone breakdown is stored in the summary
  // payload, so there is nothing better to use).
  const damageByType = useMemo(() => {
    if (tape && sides) {
      return {
        you: PUNCH_ORDER.map((p) =>
          replayEvents
            .filter((e) => e.by === "you" && e.punchType === p)
            .reduce((s, e) => s + e.damage, 0),
        ),
        opponent: PUNCH_ORDER.map((p) =>
          replayEvents
            .filter((e) => e.by === "opponent" && e.punchType === p)
            .reduce((s, e) => s + e.damage, 0),
        ),
      };
    }
    // Without a tape there is no per-punch zone breakdown, so base damage
    // is the best approximation available.  Scale it so the chart total
    // matches `damageDealt` (which already has zone multipliers baked in)
    // — the chart and the stat column always agree on the total even if the
    // per-type split is approximate.
    const scaleToActual = (
      fighter: FighterSummary,
      values: number[],
    ): number[] => {
      const baseSum = values.reduce((a, b) => a + b, 0);
      if (baseSum === 0) return values;
      const scale = fighter.damageDealt / baseSum;
      return values.map((v) => Math.round(v * scale * 10) / 10);
    };
    const youBase = PUNCH_ORDER.map((p) => match.you.punches[p].landed * PUNCH_STATS[p].healthDamage);
    const oppBase = PUNCH_ORDER.map(
      (p) => match.opponent.punches[p].landed * PUNCH_STATS[p].healthDamage,
    );
    return {
      you: scaleToActual(match.you, youBase),
      opponent: scaleToActual(match.opponent, oppBase),
    };
  }, [tape, sides, replayEvents, match]);
  const punchesByType = {
    you: PUNCH_ORDER.map((p) => match.you.punches[p].thrown),
    opponent: PUNCH_ORDER.map((p) => match.opponent.punches[p].thrown),
  };
  const youTotals = totals(match.you);
  const oppTotals = totals(match.opponent);

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
            <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-600">
              demo fight — your real matches will land here
            </p>
          )}
          {loggedGame && (
            <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-600">
              from your fight log · {loggedGame.id.slice(0, 8)}
            </p>
          )}
          {gameError && (
            <p role="alert" className="font-mono text-[11px] font-semibold text-red-700">
              couldn&apos;t load that fight ({gameError}) — showing the demo
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

        <p className="max-w-2xl text-center text-sm leading-6 text-zinc-600">
          {match.narrative}
        </p>

        {/* ---- headline numbers ------------------------------------------ */}
        <section className="grid w-full grid-cols-2 gap-px overflow-hidden rounded-xl border border-black/10 bg-black/10 sm:grid-cols-4">
          {[
            { label: "accuracy", value: `${youTotals.accuracy}%`, sub: `${youTotals.landed} of ${youTotals.thrown} landed` },
            { label: "damage dealt", value: `${match.you.damageDealt}`, sub: `${oppTotals.accuracy}% taken back` },
            { label: "total punches", value: `${youTotals.thrown}`, sub: `${oppTotals.thrown} thrown at you` },
            { label: "damage blocked", value: `${analytics.you.damageBlocked}`, sub: `${analytics.you.punchesBlocked} punches on the guard` },
          ].map((tile) => (
            <div key={tile.label} className="flex flex-col gap-1 bg-white p-5">
              <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-600">
                {tile.label}
              </span>
              <span className="text-3xl font-bold leading-none tabular-nums text-black">
                {tile.value}
              </span>
              <span className="font-mono text-[11px] text-zinc-600">{tile.sub}</span>
            </div>
          ))}
        </section>

        {analyticsAreSample && (
          <p className="w-full rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-center font-mono text-[11px] text-amber-900">
            {sides
              ? "the replay below is your real fight — the charts and profile around it are still sample data"
              : "sample data — the fight tape, replay and profile below are not wired to live matches yet"}
          </p>
        )}

        {/* ---- replay ----------------------------------------------------- */}
        <div className="grid w-full gap-5 lg:grid-cols-[1.6fr_1fr]">
          <MatchReplay
            tape={analytics.tape}
            events={replayEvents}
            durationMs={replayLengthMs}
            names={names}
            corners={corners}
            jumpTo={seek}
            sides={sides}
            status={replayStatus}
          />

          <Panel title="strongest punch" aside={strongestBy}>
            <div className="flex flex-col gap-1">
              <span className="text-4xl font-bold leading-none text-black">
                {effectiveStrongest.damage}
                <span className="ml-1 text-lg font-medium text-zinc-600">dmg</span>
              </span>
              <span className="font-mono text-xs text-zinc-700">
                {PUNCH_STATS[effectiveStrongest.type].label} @{" "}
                {formatClock(effectiveStrongest.atMs)} ·{" "}
                {effectiveStrongest.speed.toFixed(1)} sw/s
              </span>
            </div>
            <button
              type="button"
              onClick={() =>
                setSeek((s) => ({
                  atMs: effectiveStrongest.atMs,
                  nonce: (s?.nonce ?? 0) + 1,
                }))
              }
              className="self-start rounded-sm border-2 border-black px-5 py-2 font-mono text-xs font-semibold uppercase tracking-widest text-black transition-colors hover:bg-black hover:text-white"
            >
              Replay this punch
            </button>
            <p className="font-mono text-[11px] leading-5 text-zinc-600">
              Seeks the replay to just before impact.
            </p>
          </Panel>
        </div>

        {/* ---- fight tape charts ------------------------------------------ */}
        <div className="grid w-full gap-5 lg:grid-cols-2">
          <ChartFrame
            title="damage over time"
            series={seriesMeta}
            note="Cumulative damage dealt. The crossing point is the fight — Kai only goes ahead in the last thirty seconds."
          >
            <LineChart
              windowsMs={analytics.tape.windowsMs}
              series={analytics.tape.damageCumulative}
              names={names}
              colors={seriesColors}
              max={100}
            />
          </ChartFrame>

          <ChartFrame
            title="punches over time"
            series={seriesMeta}
            note="Punches thrown per 10-second window. One opens at double the output and fades; the other ramps the whole way."
          >
            <LineChart
              windowsMs={analytics.tape.windowsMs}
              series={analytics.tape.punchesThrown}
              names={names}
              colors={seriesColors}
              max={10}
            />
          </ChartFrame>

          <ChartFrame
            title="fatigue curve"
            series={seriesMeta}
            note="Stamina remaining. Two dips to the floor are two lockouts — at zero you cannot throw at all until the meter recovers."
          >
            <LineChart
              windowsMs={analytics.tape.windowsMs}
              series={analytics.tape.stamina}
              names={names}
              colors={seriesColors}
              max={100}
              area
            />
          </ChartFrame>

          <ChartFrame
            title="damage distribution"
            series={seriesMeta}
            note="Health damage by punch type, landed only. Jabs are cheap and frequent; uppercuts are where the damage per landed punch is."
          >
            <GroupedBarChart
              categories={PUNCH_ORDER.map((p) => PUNCH_STATS[p].label)}
              series={damageByType}
              names={names}
              colors={seriesColors}
            />
          </ChartFrame>

          <ChartFrame
            title="punch mix"
            series={seriesMeta}
            note="Everything thrown, landed or not — the shape of each fighter's offence."
          >
            <GroupedBarChart
              categories={PUNCH_ORDER.map((p) => PUNCH_STATS[p].label)}
              series={punchesByType}
              names={names}
              colors={seriesColors}
            />
          </ChartFrame>

          <Panel title="hand balance & style" aside="who throws with what">
            <div className="flex flex-col gap-5">
              <HandBalanceBar
                name={names.you}
                left={analytics.you.handBalance.left}
                right={analytics.you.handBalance.right}
                color={seriesColors.you}
              />
              <HandBalanceBar
                name={names.opponent}
                left={analytics.opponent.handBalance.left}
                right={analytics.opponent.handBalance.right}
                color={seriesColors.opponent}
              />
            </div>
            <div className="flex flex-col gap-3 border-t border-black/10 pt-4">
              {([
                { side: "you" as const, fighter: match.you, a: analytics.you },
                { side: "opponent" as const, fighter: match.opponent, a: analytics.opponent },
              ]).map(({ side, fighter, a }) => (
                <div key={side} className="flex flex-col gap-0.5">
                  <span className="flex items-center gap-1.5 font-mono text-[11px] font-semibold text-zinc-800">
                    <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: seriesColors[side] }} />
                    {fighter.name} — {a.style}
                  </span>
                  <span className="font-mono text-[11px] leading-5 text-zinc-600">
                    {a.styleNote} Guard down {fighter.guardExposurePct}% of the fight.
                  </span>
                </div>
              ))}
            </div>
          </Panel>
        </div>


        <div className="flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/"
            className="rounded-sm border-2 border-black px-10 py-3 font-mono text-sm font-semibold uppercase tracking-widest text-black transition-colors hover:bg-black hover:text-white"
          >
            Back to start
          </Link>
          <Link
            href={viewerUuid ? `/profile?u=${encodeURIComponent(viewerUuid)}` : "/profile"}
            className="rounded-sm border-2 border-black bg-black px-10 py-3 font-mono text-sm font-semibold uppercase tracking-widest text-white transition-colors hover:bg-zinc-800"
          >
            Your profile
          </Link>
        </div>
      </main>
    </div>
  );
}

export default function SummaryPage() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-1 items-center justify-center font-mono text-sm font-medium uppercase tracking-widest text-zinc-700">
          loading summary…
        </div>
      }
    >
      <SummaryContent />
    </Suspense>
  );
}
