/**
 * Running per-fighter tallies for the summary page, accumulated from the
 * `match-state` broadcasts the fight page already receives.
 *
 * The server sends one authoritative snapshot per accepted pose frame
 * (apps/server/ws/gameSession.ts step 4), carrying both fighters' meters plus
 * at most one `lastEvent`. Everything here is derived from that stream — no
 * server change, no second source of truth. Both clients see the identical
 * broadcast, so both arrive at the same numbers.
 *
 * What this CANNOT produce, and why:
 * - peak punch speed — the detector tracks a punch's `maxSpeed` internally
 *   (packages/game-mechanics/src/punch-detector.ts) but folds it into
 *   confidence and never puts it on the emitted PUNCH action, so it never
 *   reaches the wire.
 * - elo / win-loss record — nothing persists a rating; `users.record` is an
 *   unwritten jsonb column.
 */

import type { PunchType } from "game-mechanics";
import type { MatchStateMessage } from "@/vision/matchWire";
import type { FighterSummary, MatchSummary } from "./match-summary";

const PUNCH_TYPES: readonly PunchType[] = ["JAB", "CROSS", "HOOK", "UPPERCUT"];

/**
 * Which outcomes count as "landed", following boxing's convention that a
 * punch caught on the guard is not a landed punch. HIT and GUARD_BREAK are
 * the two that actually did something to the opponent, which keeps this
 * number consistent with the damage figure shown beside it. BLOCKED, MISS
 * and NO_STAMINA count only as thrown — including NO_STAMINA, since the
 * player really did throw it and being gassed should show up in accuracy.
 */
const LANDED_RESULTS: ReadonlySet<string> = new Set(["HIT", "GUARD_BREAK"]);

/**
 * A backgrounded tab or a stalled socket leaves a long hole between
 * snapshots. Billing the whole gap to whatever the guard was doing when the
 * stream went quiet would swamp the exposure figure, so cap what one sample
 * can contribute.
 */
const MAX_SAMPLE_DT_MS = 1000;

interface FighterAccumulator {
  punches: FighterSummary["punches"];
  timesWinded: number;
  /** Total time covered by samples — the denominator for exposure. */
  sampledMs: number;
  /** Of that, time spent with the guard down. */
  exposedMs: number;
  /** Previous snapshot's values, for edge detection. null before the first. */
  lastStamina: number | null;
  lastBlocking: boolean | null;
}

export interface MatchStats {
  byUuid: Map<string, FighterAccumulator>;
  /** Server clock of the last snapshot folded in. */
  lastSampleNow: number | null;
  strongest: {
    attackerUuid: string;
    type: PunchType;
    damage: number;
    atMs: number;
  } | null;
}

function emptyPunches(): FighterSummary["punches"] {
  return {
    JAB: { thrown: 0, landed: 0 },
    CROSS: { thrown: 0, landed: 0 },
    HOOK: { thrown: 0, landed: 0 },
    UPPERCUT: { thrown: 0, landed: 0 },
  };
}

export function newMatchStats(): MatchStats {
  return { byUuid: new Map(), lastSampleNow: null, strongest: null };
}

function accumulatorFor(stats: MatchStats, playerUuid: string): FighterAccumulator {
  let acc = stats.byUuid.get(playerUuid);
  if (!acc) {
    acc = {
      punches: emptyPunches(),
      timesWinded: 0,
      sampledMs: 0,
      exposedMs: 0,
      lastStamina: null,
      lastBlocking: null,
    };
    stats.byUuid.set(playerUuid, acc);
  }
  return acc;
}

/**
 * Fold one `match-state` snapshot into the tallies. Safe to call on every
 * message; snapshots before the match clock starts are ignored, since a
 * fighter warming up alone has nobody to be exposed to.
 */
export function recordMatchState(stats: MatchStats, msg: MatchStateMessage): void {
  if (msg.matchStartedAt === null) return;

  // The interval since the last snapshot is billed to the state the fighter
  // was ALREADY in, not the one this snapshot reports — that state is what
  // they held for the duration of the interval.
  const dt =
    stats.lastSampleNow === null
      ? 0
      : Math.min(Math.max(0, msg.now - stats.lastSampleNow), MAX_SAMPLE_DT_MS);
  stats.lastSampleNow = msg.now;

  for (const player of msg.players) {
    const acc = accumulatorFor(stats, player.playerUuid);

    if (dt > 0 && acc.lastBlocking !== null) {
      acc.sampledMs += dt;
      if (!acc.lastBlocking) acc.exposedMs += dt;
    }

    // Winded = the tank crossed to empty. Recovery takes at least
    // staminaWindedDelayMs (1.2s) before regen even starts, so a
    // wind-and-refill can never hide between two snapshots.
    if (acc.lastStamina !== null && acc.lastStamina > 0 && player.stamina <= 0) {
      acc.timesWinded += 1;
    }

    acc.lastStamina = player.stamina;
    acc.lastBlocking = player.blocking;
  }

  const event = msg.lastEvent;
  if (!event || event.kind !== "punch") return;

  // `punchType` is a bare string on the wire; drop anything unrecognised
  // rather than indexing the tally with it.
  const punchType = event.punchType as PunchType;
  if (!PUNCH_TYPES.includes(punchType)) return;

  const tally = accumulatorFor(stats, event.attackerUuid).punches[punchType];
  tally.thrown += 1;
  if (LANDED_RESULTS.has(event.result)) tally.landed += 1;

  if (event.healthDamage > (stats.strongest?.damage ?? 0)) {
    stats.strongest = {
      attackerUuid: event.attackerUuid,
      type: punchType,
      damage: event.healthDamage,
      // event.atMs is sinceBell (frame.timestamp - bell) — the same tape-clock
      // the replay scrubber uses. msg.now - msg.matchStartedAt diverges because
      // msg.now is performance.now() on the frame AFTER punch detection.
      atMs: event.atMs,
    };
  }
}

/** The three summary fields this module can fill in for one fighter. */
export function fighterStats(
  stats: MatchStats,
  playerUuid: string | null,
): Pick<FighterSummary, "punches" | "timesWinded" | "guardExposurePct"> {
  const acc = playerUuid === null ? undefined : stats.byUuid.get(playerUuid);
  if (!acc) {
    return { punches: emptyPunches(), timesWinded: 0, guardExposurePct: 0 };
  }
  return {
    punches: acc.punches,
    timesWinded: acc.timesWinded,
    guardExposurePct: acc.sampledMs > 0 ? Math.round((acc.exposedMs / acc.sampledMs) * 100) : 0,
  };
}

/**
 * Hardest punch of the match by nominal health damage, ties going to the
 * earlier one. `speed` stays 0 — see the module note. Falls back to a zeroed
 * jab when no punch ever dealt damage, which the page renders harmlessly.
 */
export function strongestPunch(
  stats: MatchStats,
  youUuid: string,
): MatchSummary["strongestPunch"] {
  const best = stats.strongest;
  if (!best) return { type: "JAB", damage: 0, atMs: 0, speed: 0, by: "you" };
  return {
    type: best.type,
    damage: Math.round(best.damage * 10) / 10,
    atMs: best.atMs,
    speed: 0,
    by: best.attackerUuid === youUuid ? "you" : "opponent",
  };
}
