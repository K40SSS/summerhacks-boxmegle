/**
 * Deep-dive stats for the summary page — fight tape, replay log, player
 * profile, and where the player sits in the pool.
 *
 * ALL OF THIS IS MOCK. Live fights do not produce any of it yet: the server
 * broadcasts meters and events (see apps/server/ws/matchState.ts) but nothing
 * records a tape or persists a profile. The shapes here are written the way
 * the real payloads should arrive so wiring them up later is a swap, not a
 * rewrite — which is why `MatchSummary.analytics` is optional rather than
 * required: a real match simply omits it and the page falls back to these
 * fixtures with a visible "sample data" marker.
 *
 * Vocabulary and palette follow docs/fight-data-catalog.html. Numbers below
 * are kept consistent with DEMO_MATCH — per-window punches sum to the punch
 * table's `thrown`, cumulative damage ends on `damageDealt`, and health is
 * 100 minus the other fighter's cumulative damage.
 */

import type { PunchType } from "game-mechanics";

/** The two corner hues are the only categorical colours on the page. */
export const CORNER_HEX = {
  red: "#e34948",
  blue: "#2a78d6",
} as const;

/** Chart neutrals, from the catalog's light tokens. */
export const CHART_INK = "#0e121b";
export const CHART_MUTED = "#6f7784";
export const CHART_GRID = "#e3e6eb";
export const CHART_AXIS = "#c4c9d2";

export type Side = "you" | "opponent";

export interface Series {
  you: number[];
  opponent: number[];
}

/**
 * Per-window fight tape. One entry per 10-second window; `windowsMs` holds
 * each window's END time so a value reads as "by 0:30, this had happened".
 */
export interface FightTape {
  windowsMs: number[];
  /** Punches thrown in each window. */
  punchesThrown: Series;
  /** Cumulative damage dealt, by the end of each window. */
  damageCumulative: Series;
  /** Stamina remaining at each window boundary, 0..100. */
  stamina: Series;
  /** Health remaining at each window boundary, 0..100. */
  health: Series;
}

export type ReplayResult = "HIT" | "BLOCKED" | "GUARD_BREAK" | "MISS";

export interface ReplayEvent {
  atMs: number;
  by: Side;
  punchType: PunchType;
  hand: "LEFT" | "RIGHT";
  result: ReplayResult;
  zone: "HEAD" | "BODY" | null;
  /** Health damage dealt (0 unless HIT). */
  damage: number;
  /** Wrist speed at impact, shoulder-widths/s. */
  speed: number;
}

export interface FighterAnalytics {
  /** Guard damage absorbed across the match. */
  damageBlocked: number;
  /** Opponent punches that landed on the guard rather than the body. */
  punchesBlocked: number;
  /** Punches thrown per hand — sums to the punch table's total thrown. */
  handBalance: { left: number; right: number };
  /** Archetype label, from the catalog's style fingerprint. */
  style: string;
  styleNote: string;
}

export interface MatchAnalytics {
  tape: FightTape;
  replay: ReplayEvent[];
  you: FighterAnalytics;
  opponent: FighterAnalytics;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WINDOWS_MS = [
  10_000, 20_000, 30_000, 40_000, 50_000, 60_000, 70_000, 80_000, 90_000,
  100_000, 110_000, 120_000,
];

export const DEMO_ANALYTICS: MatchAnalytics = {
  tape: {
    windowsMs: WINDOWS_MS,
    // Andrew opens at more than double the output; Kai ramps into the last
    // third. Sums: Kai 61, Andrew 52 — the punch table's totals.
    punchesThrown: {
      you: [2, 3, 3, 4, 4, 5, 5, 5, 6, 7, 8, 9],
      opponent: [7, 7, 6, 6, 5, 4, 4, 4, 3, 3, 2, 1],
    },
    // Ends on damageDealt: Kai 73, Andrew 59. Andrew leads until ~1:30.
    damageCumulative: {
      you: [2, 6, 10, 16, 22, 28, 34, 40, 48, 56, 64, 73],
      opponent: [8, 15, 22, 28, 34, 39, 43, 47, 51, 54, 57, 59],
    },
    // Kai empties the tank twice (the two dips near zero); Andrew paces.
    stamina: {
      you: [100, 88, 74, 55, 30, 8, 45, 62, 40, 18, 4, 22],
      opponent: [100, 76, 62, 58, 55, 60, 66, 70, 74, 78, 84, 88],
    },
    // 100 minus the other fighter's cumulative damage.
    health: {
      you: [92, 85, 78, 72, 66, 61, 57, 53, 49, 46, 43, 41],
      opponent: [98, 94, 90, 84, 78, 72, 66, 60, 52, 44, 36, 27],
    },
  },
  replay: [
    { atMs: 4_200, by: "opponent", punchType: "JAB", hand: "LEFT", result: "HIT", zone: "BODY", damage: 4, speed: 3.1 },
    { atMs: 9_800, by: "opponent", punchType: "CROSS", hand: "RIGHT", result: "HIT", zone: "BODY", damage: 6, speed: 3.8 },
    { atMs: 14_500, by: "you", punchType: "JAB", hand: "LEFT", result: "BLOCKED", zone: "HEAD", damage: 0, speed: 2.9 },
    { atMs: 21_300, by: "opponent", punchType: "CROSS", hand: "RIGHT", result: "HIT", zone: "BODY", damage: 6, speed: 4.6 },
    { atMs: 33_700, by: "you", punchType: "JAB", hand: "LEFT", result: "HIT", zone: "BODY", damage: 4, speed: 3.0 },
    { atMs: 46_100, by: "opponent", punchType: "HOOK", hand: "LEFT", result: "MISS", zone: null, damage: 0, speed: 4.1 },
    { atMs: 52_400, by: "you", punchType: "HOOK", hand: "RIGHT", result: "HIT", zone: "BODY", damage: 8, speed: 3.6 },
    { atMs: 61_900, by: "opponent", punchType: "UPPERCUT", hand: "RIGHT", result: "HIT", zone: "BODY", damage: 9, speed: 4.0 },
    { atMs: 74_600, by: "you", punchType: "CROSS", hand: "RIGHT", result: "GUARD_BREAK", zone: "HEAD", damage: 0, speed: 3.9 },
    { atMs: 78_200, by: "you", punchType: "HOOK", hand: "RIGHT", result: "HIT", zone: "BODY", damage: 8, speed: 3.7 },
    { atMs: 89_500, by: "opponent", punchType: "JAB", hand: "LEFT", result: "BLOCKED", zone: "HEAD", damage: 0, speed: 2.8 },
    { atMs: 97_100, by: "you", punchType: "CROSS", hand: "RIGHT", result: "HIT", zone: "BODY", damage: 6, speed: 4.1 },
    { atMs: 101_800, by: "you", punchType: "JAB", hand: "LEFT", result: "GUARD_BREAK", zone: "HEAD", damage: 0, speed: 3.2 },
    { atMs: 105_000, by: "you", punchType: "UPPERCUT", hand: "RIGHT", result: "HIT", zone: "BODY", damage: 9, speed: 4.0 },
    { atMs: 113_400, by: "you", punchType: "JAB", hand: "LEFT", result: "HIT", zone: "BODY", damage: 4, speed: 3.3 },
    { atMs: 118_700, by: "opponent", punchType: "JAB", hand: "LEFT", result: "MISS", zone: null, damage: 0, speed: 2.6 },
  ],
  you: {
    damageBlocked: 214,
    punchesBlocked: 18,
    handBalance: { left: 22, right: 39 },
    style: "Pressure counter-puncher",
    styleNote: "Low output early, then walks forward and doubles up once the guard drops.",
  },
  opponent: {
    damageBlocked: 156,
    punchesBlocked: 12,
    handBalance: { left: 26, right: 26 },
    style: "Volume out-boxer",
    styleNote: "Fastest hands in the match, even hand split, fades after the first half.",
  },
};

// ---------------------------------------------------------------------------
// Player profile — career-scale, not per match
// ---------------------------------------------------------------------------

export interface PersonalBest {
  label: string;
  value: string;
  sub: string;
  /** True when this match set it — the page badges these. */
  setThisMatch?: boolean;
}

export interface RecordEntry {
  result: "W" | "L" | "D";
  opponent: string;
  method: "KO" | "DECISION" | "DRAW";
  /** Relative label, e.g. "2d ago". */
  when: string;
}

export interface PercentileStat {
  label: string;
  /** The player's own value, pre-formatted. */
  value: string;
  /** 0..100 — share of the pool this beats. */
  percentile: number;
  /** Pool median, pre-formatted, for context under the bar. */
  median: string;
}

export interface LeaderboardRow {
  rank: number;
  name: string;
  elo: number;
  record: string;
  streak: number;
  isYou?: boolean;
}

export interface PlayerProfile {
  personalBests: PersonalBest[];
  /** Most recent first. */
  recentResults: RecordEntry[];
  longestWinStreak: number;
  currentStreak: number;
  percentiles: PercentileStat[];
}

export const DEMO_PROFILE: PlayerProfile = {
  personalBests: [
    { label: "fastest KO", value: "0:38", sub: "vs Mira · hook to the head", setThisMatch: false },
    { label: "hardest punch", value: "13.5", sub: "uppercut, head · 4.6 sw/s" },
    { label: "best accuracy", value: "41%", sub: "vs Dana · 17 of 41", setThisMatch: false },
    { label: "most damage", value: "88", sub: "this match: 73", setThisMatch: false },
  ],
  recentResults: [
    { result: "W", opponent: "Andrew", method: "DECISION", when: "just now" },
    { result: "W", opponent: "Mira", method: "KO", when: "2h ago" },
    { result: "W", opponent: "Dana", method: "DECISION", when: "2h ago" },
    { result: "L", opponent: "Sol", method: "KO", when: "yesterday" },
    { result: "W", opponent: "Ren", method: "DECISION", when: "yesterday" },
    { result: "D", opponent: "Yuki", method: "DRAW", when: "2d ago" },
    { result: "L", opponent: "Sol", method: "DECISION", when: "3d ago" },
    { result: "W", opponent: "Tomo", method: "KO", when: "3d ago" },
    { result: "W", opponent: "Ines", method: "DECISION", when: "4d ago" },
    { result: "L", opponent: "Andrew", method: "DECISION", when: "5d ago" },
  ],
  longestWinStreak: 6,
  currentStreak: 3,
  percentiles: [
    { label: "accuracy", value: "23%", percentile: 61, median: "19%" },
    { label: "damage / min", value: "36.5", percentile: 78, median: "27.0" },
    { label: "peak punch speed", value: "4.2 sw/s", percentile: 54, median: "4.1 sw/s" },
    { label: "guard discipline", value: "74%", percentile: 88, median: "58%" },
  ],
};

export const DEMO_LEADERBOARD: LeaderboardRow[] = [
  { rank: 1, name: "Sol", elo: 1342, record: "28–6", streak: 9 },
  { rank: 2, name: "Yuki", elo: 1298, record: "24–8", streak: 4 },
  { rank: 3, name: "Mira", elo: 1241, record: "19–7", streak: -2 },
  { rank: 4, name: "Dana", elo: 1188, record: "17–9", streak: 2 },
  { rank: 5, name: "Ren", elo: 1121, record: "14–11", streak: 1 },
  { rank: 6, name: "Kai", elo: 1016, record: "4–1", streak: 3, isYou: true },
  { rank: 7, name: "Tomo", elo: 1004, record: "9–10", streak: -1 },
  { rank: 8, name: "Andrew", elo: 984, record: "2–3", streak: -1 },
];

/** Where the player sits in the pool overall. */
export const DEMO_STANDING = {
  rank: 6,
  poolSize: 1284,
  /** Share of the pool this player is above, 0..100. */
  percentile: 72,
} as const;
