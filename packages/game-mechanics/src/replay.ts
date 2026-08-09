/**
 * Replay tape codec — the wire/at-rest format for a recorded fight.
 *
 * A fight is a few thousand pose frames per player. As JSON that is megabytes
 * of `{"x":0.4713,...}`; as quantized landmarks it is a few hundred KB, which
 * is small enough to hand the browser in one request and decode synchronously.
 * So a tape is a binary blob: a JSON header (who fought, how long, what
 * landed) followed by two flat numeric arrays per fighter.
 *
 * ## Layout
 *
 *   uint32  magic "BXRP"
 *   uint32  header byte length
 *   ...     header JSON (utf-8), zero-padded to a 4-byte boundary
 *   ...     int32 times[frameCount]        — one block per track, in order
 *   ...     int16 coords[frameCount * 27]  — one block per track, in order
 *
 * Times come first as a group so there is exactly one alignment boundary in
 * the file rather than one per track. Every read and write goes through
 * DataView with an explicit little-endian flag, so the format does not depend
 * on the host's byte order or on a buffer happening to be aligned.
 *
 * ## What is stored, and why raw landmarks
 *
 * Per frame: the nine upper-body MediaPipe landmarks, x/y/z, in image-
 * normalized space — the detector's *input*, not its output. That is the
 * superset: a 2D skeleton draws from it directly, and `normalizeLandmarks()`
 * recovers the body-frame pose from it on read for anything that wants to
 * drive a 3D rig. Storing the normalized pose instead would be smaller by
 * nothing and would throw away the ability to re-derive it if normalization
 * ever changes.
 *
 * Visibility is deliberately not stored. A frame only reaches the recorder
 * after clearing the pipeline's visibility gates, so it would be a constant
 * third of the payload.
 *
 * ## Quantization
 *
 * Coordinates are rounded to 1/10000 and clamped to ±3.2767 (int16 at that
 * scale). Landmark x/y are image-normalized to roughly [0,1] and z is roughly
 * hip-centred in the same units, so the band is several times the range a
 * tracked body actually occupies; clamping only ever catches a limb thrown
 * well outside frame, where a pixel of precision is meaningless anyway.
 */

import { UPPER_BODY_INDICES, type Hand, type PunchType, type RawLandmark } from "./types";
import type { PunchResult } from "./combat";
import type { HitZone } from "./hitbox";

/** "BXRP", read as a little-endian uint32. */
export const REPLAY_MAGIC = 0x50525842;
export const REPLAY_VERSION = 1;

/** MediaPipe indices stored per frame, in payload order. */
export const REPLAY_JOINTS = UPPER_BODY_INDICES;
/** Numbers per frame: 9 joints × (x, y, z). */
export const REPLAY_STRIDE = REPLAY_JOINTS.length * 3;

/** Fixed-point scale. 1/10000 of a normalized unit is well below tracker noise. */
export const REPLAY_QUANT = 10_000;
const INT16_MAX = 32_767;
const INT16_MIN = -32_768;

/** Widest coordinate the format can hold; values beyond this are clamped. */
export const REPLAY_COORD_LIMIT = INT16_MAX / REPLAY_QUANT;

export function quantizeCoord(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const scaled = Math.round(value * REPLAY_QUANT);
  return scaled > INT16_MAX ? INT16_MAX : scaled < INT16_MIN ? INT16_MIN : scaled;
}

/** Slot 0 fights out of the red corner, slot 1 out of the blue. */
export type Corner = "red" | "blue";

export interface ReplayTrackMeta {
  playerUuid: string;
  slot: 0 | 1;
  name: string;
  corner: Corner;
  /** Frames recorded for this fighter. */
  frameCount: number;
  /**
   * Source video width/height. Landmark x and y are each normalized against
   * their OWN axis, so without this a 4:3 camera and a 16:9 one produce the
   * same numbers for differently-shaped bodies and anything that draws them
   * on a square canvas stretches the fighter. Null when the client did not
   * report one (tapes recorded before this field existed) — renderers should
   * fall back to a plausible webcam ratio rather than assuming square.
   */
  aspect: number | null;
}

/** One landed-or-not punch, timestamped against the same clock as the frames. */
export interface ReplayPunchRecord {
  /** Milliseconds since the opening bell. */
  atMs: number;
  /** Who threw it. */
  by: string;
  punchType: PunchType;
  hand: Hand;
  result: PunchResult;
  zone: HitZone | null;
  healthDamage: number;
  guardDamage: number;
  /** Wrist speed at impact, shoulder-widths/s. */
  speed: number;
}

export interface ReplayHeader {
  v: number;
  /** Nominal capture rate, for a player that wants a frame budget up front. */
  fps: number;
  /** Bell-to-bell length. Frame times are all <= this. */
  durationMs: number;
  quant: number;
  joints: number[];
  tracks: ReplayTrackMeta[];
  events: ReplayPunchRecord[];
  winnerUuid: string | null;
  reason: "KO" | "DECISION" | "DRAW";
  /** True when recording stopped early because the frame cap was reached. */
  truncated: boolean;
}

export interface ReplayTrack extends ReplayTrackMeta {
  /** Milliseconds since the bell, ascending, one per frame. */
  times: Int32Array;
  /** `frameCount * REPLAY_STRIDE` quantized coordinates. */
  coords: Int16Array;
}

export interface ReplayTape {
  header: ReplayHeader;
  tracks: ReplayTrack[];
}

/** What `encodeReplay` needs per fighter: metadata plus the two raw blocks. */
export interface ReplayTrackData {
  meta: ReplayTrackMeta;
  times: Int32Array;
  coords: Int16Array;
}

const align4 = (n: number) => (n + 3) & ~3;

export function encodeReplay(
  header: Omit<ReplayHeader, "v" | "quant" | "joints">,
  tracks: ReplayTrackData[],
): Uint8Array {
  const full: ReplayHeader = {
    ...header,
    v: REPLAY_VERSION,
    quant: REPLAY_QUANT,
    joints: [...REPLAY_JOINTS],
  };
  const headerBytes = new TextEncoder().encode(JSON.stringify(full));
  const headerEnd = align4(8 + headerBytes.length);

  const timesBytes = tracks.reduce((sum, t) => sum + t.times.length * 4, 0);
  const coordsBytes = tracks.reduce((sum, t) => sum + t.coords.length * 2, 0);

  const out = new Uint8Array(headerEnd + timesBytes + coordsBytes);
  const view = new DataView(out.buffer);
  view.setUint32(0, REPLAY_MAGIC, true);
  view.setUint32(4, headerBytes.length, true);
  out.set(headerBytes, 8);

  let offset = headerEnd;
  for (const track of tracks) {
    for (let i = 0; i < track.times.length; i++) {
      view.setInt32(offset, track.times[i], true);
      offset += 4;
    }
  }
  for (const track of tracks) {
    for (let i = 0; i < track.coords.length; i++) {
      view.setInt16(offset, track.coords[i], true);
      offset += 2;
    }
  }
  return out;
}

export function decodeReplay(buffer: ArrayBuffer | Uint8Array): ReplayTape {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 8 || view.getUint32(0, true) !== REPLAY_MAGIC) {
    throw new Error("not a replay tape");
  }

  const headerLength = view.getUint32(4, true);
  if (8 + headerLength > bytes.byteLength) throw new Error("replay header is truncated");
  const header = JSON.parse(
    new TextDecoder().decode(bytes.subarray(8, 8 + headerLength)),
  ) as ReplayHeader;
  if (header.v !== REPLAY_VERSION) {
    throw new Error(`unsupported replay version ${header.v}`);
  }

  const stride = header.joints.length * 3;
  let offset = align4(8 + headerLength);

  const times: Int32Array[] = [];
  for (const meta of header.tracks) {
    const block = new Int32Array(meta.frameCount);
    for (let i = 0; i < meta.frameCount; i++) {
      block[i] = view.getInt32(offset, true);
      offset += 4;
    }
    times.push(block);
  }

  const tracks: ReplayTrack[] = header.tracks.map((meta, t) => {
    const coords = new Int16Array(meta.frameCount * stride);
    for (let i = 0; i < coords.length; i++) {
      coords[i] = view.getInt16(offset, true);
      offset += 2;
    }
    return { ...meta, times: times[t], coords };
  });

  return { header, tracks };
}

/**
 * Index of the last frame at or before `atMs`, or -1 when the scrub head sits
 * before the fighter's first tracked frame. Binary search: playback calls this
 * every animation frame, and a scrub can jump anywhere in the tape.
 */
export function frameIndexAt(track: ReplayTrack, atMs: number): number {
  const times = track.times;
  if (times.length === 0 || atMs < times[0]) return -1;
  let low = 0;
  let high = times.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (times[mid] <= atMs) low = mid;
    else high = mid - 1;
  }
  return low;
}

/**
 * The frame at `index` as a landmark array indexed by MediaPipe index — so
 * `pose[LM.LEFT_WRIST]` works, and the array can be handed straight to
 * `normalizeLandmarks()`. Slots outside the stored upper-body set stay holes.
 *
 * `into` lets a caller reuse one array across frames; playback runs this every
 * frame for two fighters and has no reason to allocate 18 objects a tick.
 */
export function landmarksAtIndex(
  track: ReplayTrack,
  index: number,
  into?: RawLandmark[],
): RawLandmark[] | null {
  if (index < 0 || index >= track.frameCount) return null;
  const quant = REPLAY_QUANT;
  const stride = REPLAY_JOINTS.length * 3;
  const base = index * stride;
  const out = into ?? [];
  for (let j = 0; j < REPLAY_JOINTS.length; j++) {
    const at = REPLAY_JOINTS[j];
    const o = base + j * 3;
    const point = out[at];
    if (point) {
      point.x = track.coords[o] / quant;
      point.y = track.coords[o + 1] / quant;
      point.z = track.coords[o + 2] / quant;
    } else {
      out[at] = {
        x: track.coords[o] / quant,
        y: track.coords[o + 1] / quant,
        z: track.coords[o + 2] / quant,
        // Recorded frames already cleared the pipeline's visibility gates.
        visibility: 1,
      };
    }
  }
  return out;
}

/** `landmarksAtIndex` seeked by time. Null before the fighter's first frame. */
export function landmarksAt(
  track: ReplayTrack,
  atMs: number,
  into?: RawLandmark[],
): RawLandmark[] | null {
  return landmarksAtIndex(track, frameIndexAt(track, atMs), into);
}
