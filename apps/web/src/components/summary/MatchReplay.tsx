"use client";

/**
 * Match replay — scrub or play back the fight on one clock.
 *
 * This is a DATA replay, not a video one: nothing records the camera feed. It
 * plays back what the server did record — the tracked skeletons (`sides`, from
 * a stored tape), the event log, and the per-window health tape — all driven
 * from a single `atMs`, so the fighters, the bars and the feed can never
 * disagree about when something happened.
 *
 * `sides` is optional and everything still works without it: fights recorded
 * before replays existed, or whose tape is still uploading, fall back to the
 * event-log-only view this component started as.
 *
 * `jumpTo` lets a caller (the strongest-punch card) seek the same timeline
 * rather than owning a second player. It carries a nonce as well as a time so
 * that asking for the same moment twice still seeks — comparing times alone
 * would make the second click on one punch do nothing.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PUNCH_STATS } from "game-mechanics";
import {
  CORNER_HEX,
  type FightTape,
  type ReplayEvent,
  type Side,
} from "@/lib/summary-analytics";
import { formatClock } from "@/lib/match-summary";
import type { ReplaySides } from "@/lib/replay-view";
import type { ReplayStatus } from "@/lib/use-replay";
import { ReplayStage } from "./ReplayStage";

/**
 * Without footage there is nothing to watch frame by frame, so the event log
 * plays at 6× and a 2:00 fight is over in twenty seconds. With a tape that
 * would be a blur — real movement wants real time, so a tape drops the
 * default to 1× and offers the fast scan as a choice.
 */
const PLAYBACK_RATE = 6;
const TAPE_PLAYBACK_RATE = 1;
const RATES = [1, 2, 6];
const FRAME_MS = 50;

const STATUS_NOTE: Partial<Record<ReplayStatus, string>> = {
  loading: "loading replay…",
  pending: "replay is still uploading…",
  missing: "no replay recorded for this fight",
  error: "replay could not be loaded",
};

const RESULT_STYLE: Record<ReplayEvent["result"], { label: string; cls: string }> = {
  HIT: { label: "hit", cls: "bg-black text-white" },
  BLOCKED: { label: "blocked", cls: "bg-zinc-200 text-zinc-700" },
  GUARD_BREAK: { label: "guard break", cls: "bg-amber-400 text-black" },
  MISS: { label: "miss", cls: "bg-white text-zinc-500 border border-zinc-300" },
};

function interpolate(tape: FightTape, side: Side, atMs: number): number {
  const xs = tape.windowsMs;
  const ys = tape.health[side];
  if (atMs <= xs[0]) return 100 + ((ys[0] - 100) * atMs) / xs[0];
  for (let i = 1; i < xs.length; i++) {
    if (atMs <= xs[i]) {
      const t = (atMs - xs[i - 1]) / (xs[i] - xs[i - 1]);
      return ys[i - 1] + (ys[i] - ys[i - 1]) * t;
    }
  }
  return ys[ys.length - 1];
}

/**
 * When a real tape is loaded, derive health from recorded punch events rather
 * than the mock analytics tape. `events` are sorted ascending by atMs
 * (guaranteed by replayEventsFrom), so we break as soon as we overshoot.
 * `side` is the fighter whose health we want — so we accumulate damage dealt
 * BY the opponent (e.by !== side).
 */
function healthFromEvents(events: ReplayEvent[], side: Side, atMs: number): number {
  let damageTaken = 0;
  for (const e of events) {
    if (e.atMs > atMs) break;
    if (e.by !== side && e.damage > 0) damageTaken += e.damage;
  }
  return Math.max(0, Math.round(100 - damageTaken));
}

export function MatchReplay({
  tape,
  events,
  durationMs,
  names,
  corners,
  jumpTo,
  sides = null,
  status = "idle",
}: {
  tape: FightTape;
  events: ReplayEvent[];
  durationMs: number;
  names: { you: string; opponent: string };
  corners: { you: "red" | "blue"; opponent: "red" | "blue" };
  jumpTo?: { atMs: number; nonce: number } | null;
  /** Recorded skeletons. Null until a tape loads, or when there isn't one. */
  sides?: ReplaySides | null;
  status?: ReplayStatus;
}) {
  const [atMs, setAtMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(PLAYBACK_RATE);
  const [seenNonce, setSeenNonce] = useState(jumpTo?.nonce ?? 0);
  const [hasTape, setHasTape] = useState(false);
  const feedRef = useRef<HTMLOListElement>(null);

  // Adjusting state during render when a prop changes — React's documented
  // alternative to a syncing effect, and it avoids the extra render pass an
  // effect would cost before the new position paints.
  if (jumpTo && jumpTo.nonce !== seenNonce) {
    setSeenNonce(jumpTo.nonce);
    setPlaying(false);
    // Land just before the moment, so the punch itself is the next thing
    // that happens rather than something already in the past.
    setAtMs(Math.max(0, jumpTo.atMs - 500));
  }

  // A tape arrives after mount, so the speed default has to move when it
  // lands. Only on the first one, or it would stomp a speed the viewer chose.
  if (sides && !hasTape) {
    setHasTape(true);
    setRate(TAPE_PLAYBACK_RATE);
  }

  const colors = {
    you: CORNER_HEX[corners.you],
    opponent: CORNER_HEX[corners.opponent],
  };

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setAtMs((current) => {
        const next = current + FRAME_MS * rate;
        if (next >= durationMs) {
          setPlaying(false);
          return durationMs;
        }
        return next;
      });
    }, FRAME_MS);
    return () => clearInterval(id);
  }, [playing, durationMs, rate]);

  const elapsed = useMemo(
    () => events.filter((e) => e.atMs <= atMs),
    [events, atMs],
  );

  useEffect(() => {
    const feed = feedRef.current;
    if (feed) feed.scrollTop = feed.scrollHeight;
  }, [elapsed.length]);

  // Use real event damage when a tape is loaded; fall back to the mock
  // analytics tape otherwise. The two sources use the same atMs clock, so
  // the health bars stay in sync with the event feed either way.
  const health = sides
    ? {
        you: healthFromEvents(events, "you", atMs),
        opponent: healthFromEvents(events, "opponent", atMs),
      }
    : {
        you: Math.max(0, Math.round(interpolate(tape, "you", atMs))),
        opponent: Math.max(0, Math.round(interpolate(tape, "opponent", atMs))),
      };

  const toggle = useCallback(() => {
    setAtMs((current) => (current >= durationMs ? 0 : current));
    setPlaying((p) => !p);
  }, [durationMs]);

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-black/10 bg-white p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-mono text-xs font-semibold uppercase tracking-widest text-zinc-800">
          match replay
        </h3>
        <div className="flex items-center gap-2">
          {!sides && STATUS_NOTE[status] && (
            <span className="font-mono text-[11px] text-zinc-500">{STATUS_NOTE[status]}</span>
          )}
          <div className="flex items-center gap-0.5 rounded-sm bg-zinc-100 p-0.5">
            {RATES.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setRate(option)}
                aria-pressed={rate === option}
                className={`rounded-[3px] px-2 py-0.5 font-mono text-[11px] tabular-nums transition-colors ${
                  rate === option
                    ? "bg-black text-white"
                    : "text-zinc-600 hover:text-black"
                }`}
              >
                {option}×
              </button>
            ))}
          </div>
        </div>
      </div>

      {sides && (
        <ReplayStage
          sides={sides}
          names={names}
          corners={corners}
          atMs={atMs}
          playing={playing}
          rate={rate}
          durationMs={durationMs}
        />
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {(["you", "opponent"] as const).map((side) => (
          <div key={side} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between font-mono text-[11px]">
              <span className="flex items-center gap-1.5 text-zinc-800">
                <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: colors[side] }} />
                {names[side]}
              </span>
              <span className="text-sm font-bold tabular-nums text-black">{health[side]}</span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-zinc-200">
              <div
                className="h-full rounded-full transition-[width] duration-100"
                style={{ width: `${health[side]}%`, background: colors[side] }}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={toggle}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-black text-white transition-colors hover:bg-zinc-800"
          aria-label={playing ? "Pause replay" : "Play replay"}
        >
          {playing ? (
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden fill="currentColor">
              <rect x="1.5" y="1" width="3" height="10" rx="1" />
              <rect x="7.5" y="1" width="3" height="10" rx="1" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden fill="currentColor">
              <path d="M2.5 1.2 10.4 6 2.5 10.8Z" />
            </svg>
          )}
        </button>

        <input
          type="range"
          min={0}
          max={durationMs}
          step={100}
          value={atMs}
          onChange={(e) => {
            setPlaying(false);
            setAtMs(Number(e.target.value));
          }}
          className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-zinc-200 accent-black"
          aria-label="Replay position"
        />

        <span className="shrink-0 font-mono text-xs tabular-nums text-zinc-800">
          {formatClock(atMs)} / {formatClock(durationMs)}
        </span>
      </div>

      <ol
        ref={feedRef}
        className="flex h-40 flex-col gap-1.5 overflow-y-auto rounded-lg bg-zinc-50 p-3"
      >
        {elapsed.length === 0 && (
          <li className="font-mono text-[11px] text-zinc-500">
            press play — events appear as they land
          </li>
        )}
        {elapsed.map((event, i) => {
          const style = RESULT_STYLE[event.result];
          return (
            <li key={`${event.atMs}-${i}`} className="flex items-center gap-2 font-mono text-[11px]">
              <span className="w-9 shrink-0 tabular-nums text-zinc-500">
                {formatClock(event.atMs)}
              </span>
              <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: colors[event.by] }} />
              <span className="shrink-0 text-zinc-800">{names[event.by]}</span>
              <span className="text-zinc-600">
                {PUNCH_STATS[event.punchType].label} {event.hand === "LEFT" ? "L" : "R"}
              </span>
              <span className={`shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${style.cls}`}>
                {style.label}
              </span>
              {event.damage > 0 && (
                <span className="shrink-0 font-semibold text-black">−{event.damage}</span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
