/**
 * Turning a stored tape into the shapes the summary page already renders.
 *
 * A tape is viewer-neutral: it records two fighters by uuid, because the same
 * fight is watched by both of them and by nobody in particular from the fight
 * log. The summary is written in terms of "you" and "opponent". This is the
 * one place that resolution happens, so no component has to care.
 */

import type { ReplayTape, ReplayTrack } from "game-mechanics";
import type { ReplayEvent, ReplayResult, Side } from "./summary-analytics";

export interface ReplaySides {
  you: ReplayTrack;
  opponent: ReplayTrack;
}

/**
 * Split a tape's two tracks into viewer-relative sides.
 *
 * Falls back to slot order when the viewer is unknown or wasn't in the fight
 * — someone opening a stranger's fight from a shared link still gets a
 * coherent replay, just with the red corner arbitrarily cast as "you", which
 * is the same convention the fight-log endpoint uses.
 */
export function sidesOf(tape: ReplayTape, viewerUuid: string | null): ReplaySides | null {
  const [first, second] = [...tape.tracks].sort((a, b) => a.slot - b.slot);
  if (!first || !second) return null;
  return viewerUuid && second.playerUuid === viewerUuid
    ? { you: second, opponent: first }
    : { you: first, opponent: second };
}

/**
 * NO_STAMINA is a real outcome — the fighter's arm came up but there was
 * nothing behind it — that the summary's vocabulary has no word for. It reads
 * as a miss, which is what it looked like.
 */
function toReplayResult(result: string): ReplayResult {
  switch (result) {
    case "HIT":
    case "BLOCKED":
    case "GUARD_BREAK":
      return result;
    default:
      return "MISS";
  }
}

/** The tape's punch log as the event feed the replay component renders. */
export function replayEventsFrom(tape: ReplayTape, sides: ReplaySides): ReplayEvent[] {
  const sideOf = (uuid: string): Side => (uuid === sides.you.playerUuid ? "you" : "opponent");
  return tape.header.events
    .map((event) => ({
      atMs: event.atMs,
      by: sideOf(event.by),
      punchType: event.punchType,
      hand: event.hand,
      result: toReplayResult(event.result),
      zone: event.zone,
      damage: Math.round(event.healthDamage * 10) / 10,
      speed: event.speed,
    }))
    .sort((a, b) => a.atMs - b.atMs);
}

/**
 * How long the replay's scrubber should run for.
 *
 * The header's `durationMs` is bell-to-bell, but a fighter whose camera cut
 * out early leaves frames that stop short — and a tape can also outlast the
 * clock by a frame or two, since the last frames arrive on the same tick the
 * match ends. Take whichever is longer so the scrubber never ends before the
 * footage does.
 */
export function replayDurationMs(tape: ReplayTape): number {
  let last = tape.header.durationMs;
  for (const track of tape.tracks) {
    if (track.times.length > 0) last = Math.max(last, track.times[track.times.length - 1]);
  }
  return Math.max(1, Math.round(last));
}
