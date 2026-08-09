/**
 * Fight recorder — the tape half of replay.
 *
 * Step 1 of the match loop already receives every pose frame and throws the
 * landmarks away once features are extracted. This keeps a copy: one push per
 * accepted frame into a per-player ring of pre-allocated typed arrays, then a
 * single pack at the bell.
 *
 * ## Why pre-allocated
 *
 * This sits in the hot path — two players, ~30 frames a second each, for the
 * length of a match. Growing an array of small objects would allocate ~8000
 * times per fight and hand the GC a long-lived pointer graph to trace on every
 * collection *during* the fight, where a pause shows up as a dropped punch.
 * Two typed arrays sized from the rules up front cost ~260KB per fighter and
 * allocate exactly once, so the per-frame cost is a bounds check and 27 stores.
 *
 * ## Frame rate
 *
 * Capture is gated to `RECORD_FPS`, not to whatever the camera happens to run
 * at. Ingest accepts up to ~125fps (see poseIngest's `minFrameDtMs`), so an
 * ungated recorder would let a high-frame-rate webcam quadruple the tape for
 * detail no one can see at playback speed. The gate carries a small tolerance
 * so a nominally-30fps camera with normal jitter is not decimated to 15.
 */

import {
  GAME_RULES,
  REPLAY_STRIDE,
  encodeReplay,
  quantizeCoord,
  type Corner,
  type RawLandmark,
  type ReplayHeader,
  type ReplayPunchRecord,
  type ReplayTrackData,
  type ReplayTrackMeta,
  REPLAY_JOINTS,
} from 'game-mechanics';

/** Capture rate, matched to the rate playback runs at. */
export const RECORD_FPS = 30;

const MIN_FRAME_GAP_MS = 1000 / RECORD_FPS - 4;

/**
 * Hard per-player frame cap. Sized from the rules with headroom, so a session
 * that never reaches the bell (a wedged client streaming into a match that
 * already ended) stops growing instead of eating the process.
 */
const MATCH_LENGTH_MS =
  GAME_RULES.firstHalfDurationMs +
  GAME_RULES.halftimeDurationMs +
  GAME_RULES.secondHalfDurationMs;
const MAX_FRAMES = Math.ceil(((MATCH_LENGTH_MS + 15_000) / 1000) * RECORD_FPS);

/** Slot 0 fights out of the red corner, slot 1 out of the blue. */
const CORNER: Corner[] = ['red', 'blue'];

class TrackRecorder {
  readonly times = new Int32Array(MAX_FRAMES);
  readonly coords = new Int16Array(MAX_FRAMES * REPLAY_STRIDE);
  count = 0;
  truncated = false;
  /** First aspect the client reported; cameras don't change shape mid-fight. */
  aspect: number | null = null;
  private lastAtMs = -Infinity;

  constructor(
    readonly playerUuid: string,
    readonly slot: 0 | 1,
  ) {}

  push(atMs: number, landmarks: RawLandmark[], aspect?: number): void {
    if (aspect !== undefined && this.aspect === null) this.aspect = aspect;
    if (atMs - this.lastAtMs < MIN_FRAME_GAP_MS) return;
    if (this.count >= MAX_FRAMES) {
      this.truncated = true;
      return;
    }
    this.lastAtMs = atMs;

    const base = this.count * REPLAY_STRIDE;
    for (let j = 0; j < REPLAY_JOINTS.length; j++) {
      const lm = landmarks[REPLAY_JOINTS[j]];
      const o = base + j * 3;
      this.coords[o] = quantizeCoord(lm.x);
      this.coords[o + 1] = quantizeCoord(lm.y);
      this.coords[o + 2] = quantizeCoord(lm.z);
    }
    this.times[this.count] = Math.round(atMs);
    this.count += 1;
  }
}

export interface PackOptions {
  durationMs: number;
  winnerUuid: string | null;
  reason: ReplayHeader['reason'];
  /** playerUuid -> display name, resolved once at the bell. */
  names: Map<string, string>;
}

export class ReplayRecorder {
  private readonly tracks = new Map<string, TrackRecorder>();
  private readonly events: ReplayPunchRecord[] = [];

  /**
   * Record one frame. `atMs` is milliseconds since the opening bell — callers
   * must not pass a pre-bell frame, since the tape's whole timeline (and every
   * event on it) is anchored there.
   */
  capture(
    playerUuid: string,
    slot: 0 | 1,
    atMs: number,
    landmarks: RawLandmark[],
    aspect?: number,
  ): void {
    let track = this.tracks.get(playerUuid);
    if (!track) {
      track = new TrackRecorder(playerUuid, slot);
      this.tracks.set(playerUuid, track);
    }
    track.push(atMs, landmarks, aspect);
  }

  logPunch(record: ReplayPunchRecord): void {
    this.events.push(record);
  }

  /** Punches recorded so far — the summary's strongest-punch pick reads this. */
  get punches(): readonly ReplayPunchRecord[] {
    return this.events;
  }

  get frameCount(): number {
    let total = 0;
    for (const track of this.tracks.values()) total += track.count;
    return total;
  }

  /**
   * Concatenate the buffers into a single tape. Returns null when no fighter
   * produced a frame — an empty tape is not worth an upload or a storage key.
   */
  pack({ durationMs, winnerUuid, reason, names }: PackOptions): Uint8Array | null {
    if (this.frameCount === 0) return null;

    const ordered = [...this.tracks.values()].sort((a, b) => a.slot - b.slot);
    const data: ReplayTrackData[] = ordered.map((track) => {
      const meta: ReplayTrackMeta = {
        playerUuid: track.playerUuid,
        slot: track.slot,
        name: names.get(track.playerUuid) ?? 'Unknown',
        corner: CORNER[track.slot],
        frameCount: track.count,
        aspect: track.aspect,
      };
      // subarray, not slice: encodeReplay only reads these, so a view costs
      // nothing where a copy would double the tape's peak memory.
      return {
        meta,
        times: track.times.subarray(0, track.count),
        coords: track.coords.subarray(0, track.count * REPLAY_STRIDE),
      };
    });

    return encodeReplay(
      {
        fps: RECORD_FPS,
        durationMs: Math.round(durationMs),
        tracks: data.map((d) => d.meta),
        events: this.events,
        winnerUuid,
        reason,
        truncated: ordered.some((t) => t.truncated),
      },
      data,
    );
  }
}
