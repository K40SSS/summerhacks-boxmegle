import type { PunchType } from "game-mechanics";

/**
 * The payload the summary page renders. The fight page will write one of
 * these to sessionStorage under LAST_MATCH_KEY when a match ends (it holds
 * the full event log client-side — see docs/fight-data-catalog.html); until
 * that flow exists the page falls back to DEMO_MATCH, the catalog's own
 * synthetic fixture fight.
 *
 * Field names follow the catalog's vocabulary (peakSpeed, guard exposure,
 * landed vs thrown) plus the game-mechanics decision stats (health,
 * damage dealt, guard breaks).
 */

export type Corner = "red" | "blue";

export interface FighterSummary {
  name: string;
  corner: Corner;
  /** Health left at the final bell (0 when KO'd). */
  healthAfter: number;
  damageDealt: number;
  guardBreaks: number;
  /** Times this fighter emptied the stamina tank. */
  timesWinded: number;
  /** Fastest wrist speed of the match, shoulder-widths/s. */
  peakSpeed: number;
  /** Share of the fight spent with the guard down, 0..100. */
  guardExposurePct: number;
  punches: Record<PunchType, { thrown: number; landed: number }>;
  eloBefore: number;
  eloAfter: number;
  /** Record after this match. */
  record: { wins: number; losses: number };
}

export interface MatchSummary {
  durationMs: number;
  method: "KO" | "DECISION" | "DRAW";
  /** null on a draw. */
  winner: "you" | "opponent" | null;
  strongestPunch: {
    type: PunchType;
    damage: number;
    atMs: number;
    /** Wrist speed at impact, shoulder-widths/s. */
    speed: number;
    by: "you" | "opponent";
  };
  you: FighterSummary;
  opponent: FighterSummary;
  /** One-paragraph story of the fight, written by whoever ends the match. */
  narrative: string;
}

export const LAST_MATCH_KEY = "boxmegle:last-match";

const PUNCH_TYPES = ["JAB", "CROSS", "HOOK", "UPPERCUT"] as const;

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isFighter(f: unknown): f is FighterSummary {
  const s = f as FighterSummary;
  return (
    !!s &&
    typeof s.name === "string" &&
    (s.corner === "red" || s.corner === "blue") &&
    isNum(s.healthAfter) &&
    isNum(s.damageDealt) &&
    isNum(s.guardBreaks) &&
    isNum(s.timesWinded) &&
    isNum(s.peakSpeed) &&
    isNum(s.guardExposurePct) &&
    isNum(s.eloBefore) &&
    isNum(s.eloAfter) &&
    !!s.record &&
    isNum(s.record.wins) &&
    isNum(s.record.losses) &&
    !!s.punches &&
    PUNCH_TYPES.every(
      (p) => isNum(s.punches[p]?.thrown) && isNum(s.punches[p]?.landed),
    )
  );
}

/**
 * Parse a stored payload; null for junk, so the page falls back to demo.
 * Validates every field the page dereferences — a payload written by an
 * older deploy must degrade to the demo, never crash the route.
 */
export function parseMatch(raw: string | null): MatchSummary | null {
  if (!raw) return null;
  try {
    const m = JSON.parse(raw) as MatchSummary;
    const valid =
      !!m &&
      isNum(m.durationMs) &&
      (m.method === "KO" || m.method === "DECISION" || m.method === "DRAW") &&
      (m.winner === "you" || m.winner === "opponent" || m.winner === null) &&
      typeof m.narrative === "string" &&
      !!m.strongestPunch &&
      PUNCH_TYPES.includes(m.strongestPunch.type) &&
      isNum(m.strongestPunch.damage) &&
      isNum(m.strongestPunch.atMs) &&
      isNum(m.strongestPunch.speed) &&
      (m.strongestPunch.by === "you" || m.strongestPunch.by === "opponent") &&
      isFighter(m.you) &&
      isFighter(m.opponent);
    return valid ? m : null;
  } catch {
    return null;
  }
}

/**
 * Adapted from the synthetic fight in docs/fight-data-catalog.html (Andrew,
 * blue, doubles Kai's output early and leads most of the fight; Kai takes
 * his guard apart late and flips it), re-timed from the catalog's 90 s to
 * the 2×60 s match GAME_RULES actually produces. Numbers reconcile:
 * damageDealt = Σ landed × PUNCH_STATS healthDamage, healthAfter = 100 −
 * the other's damage, elo ±16 is K=32 at even ratings, speeds are on the
 * catalog's sw/s scale (~31 mph ≈ 4.2), and the speed record deliberately
 * belongs to the LOSER — the catalog forces this so "hardest ever recorded"
 * boards aren't just winner lists.
 */
export const DEMO_MATCH: MatchSummary = {
  durationMs: 120_000,
  method: "DECISION",
  winner: "you",
  strongestPunch: { type: "UPPERCUT", damage: 9, atMs: 105_000, speed: 4.0, by: "you" },
  you: {
    name: "Kai",
    corner: "red",
    healthAfter: 41,
    damageDealt: 73,
    guardBreaks: 2,
    timesWinded: 2,
    peakSpeed: 4.2,
    guardExposurePct: 26,
    punches: {
      JAB: { thrown: 31, landed: 9 },
      CROSS: { thrown: 16, landed: 2 },
      HOOK: { thrown: 9, landed: 2 },
      UPPERCUT: { thrown: 5, landed: 1 },
    },
    eloBefore: 1000,
    eloAfter: 1016,
    record: { wins: 4, losses: 1 },
  },
  opponent: {
    name: "Andrew",
    corner: "blue",
    healthAfter: 27,
    damageDealt: 59,
    guardBreaks: 1,
    timesWinded: 0,
    peakSpeed: 4.6,
    guardExposurePct: 46,
    punches: {
      JAB: { thrown: 24, landed: 3 },
      CROSS: { thrown: 14, landed: 5 },
      HOOK: { thrown: 10, landed: 1 },
      UPPERCUT: { thrown: 4, landed: 1 },
    },
    eloBefore: 1000,
    eloAfter: 984,
    record: { wins: 2, losses: 3 },
  },
  narrative:
    "Andrew opened at double the output — and the fight's fastest hands, a " +
    "4.6 sw/s peak — and led on health for 91 of the fight's 120 seconds. " +
    "Then his guard started staying down (exposed 46% of the match by the " +
    "end), and Kai spent the last twenty seconds taking it apart: two guard " +
    "breaks and a 9-damage uppercut at 1:45 erased a 47-point lead to take " +
    "the decision 41–27.",
};

export function formatClock(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
