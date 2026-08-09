/**
 * Step 1 of the match loop: the trust boundary in front of the pose pipeline.
 *
 * `PosePipeline` (game-mechanics) is pure and assumes its input is sane. This
 * module is what makes that assumption true for landmarks arriving off a
 * websocket: it validates the wire message, decides what timestamp the frame
 * runs at, and holds one pipeline per player for the life of the session.
 *
 * ## Why the timestamp needs a policy
 *
 * Two clocks are in play and neither works alone. `extractFeatures` derives
 * wrist velocity by dividing displacement by the gap between frames, and the
 * punch FSM triggers on a 1.4 shoulder-widths/second threshold — so the gap
 * has to reflect when the frames were *captured*. Server receive time carries
 * network jitter of ±10ms on a 33ms frame, which is a 30% error on every
 * velocity and would make punches fire and miss at random.
 *
 * Client capture time has the right spacing but is attacker-controlled: a
 * fabricated clock running slow drains your guard slower, and one running
 * fast regenerates it sooner.
 *
 * So: take the client's *deltas*, never its absolute values, clamp each one,
 * and pin the running total inside a band around monotonic server time. The
 * result is a per-player clock that is smooth enough for velocities, cannot
 * be dragged away from real time, and never runs backwards — which the
 * detector FSMs require, since they compare timestamps against cooldowns.
 */

import {
  PosePipeline,
  UPPER_BODY_INDICES,
  type DetectedAction,
  type FrameFeatures,
  type RawLandmark,
  type SmoothedPose,
} from 'game-mechanics';

export const POSE_INGEST_LIMITS = {
  /**
   * Frames closer together than this are dropped (~125fps ceiling). Also
   * catches replayed and non-monotonic timestamps, since both produce a
   * delta below the floor.
   */
  minFrameDtMs: 8,
  /**
   * A longer gap counts as only this much elapsed time. Caps what a stall can
   * fabricate: a huge velocity on the resuming frame, or a jump forward in
   * the match clock.
   */
  maxFrameDtMs: 200,
  /** How far the client-paced clock may drift from server time before it is pinned. */
  maxClockDriftMs: 750,
  /** Upper bound on the landmark array — MediaPipe Pose emits 33. */
  maxLandmarks: 64,
} as const;

export interface PoseFrameMessage {
  type: 'pose';
  /** Client capture time in ms. Only its deltas are used — see the note above. */
  t: number;
  lm: RawLandmark[];
}

export interface IngestedFrame {
  /** Match-clock time this frame resolved at. Monotonic, server-anchored. */
  timestamp: number;
  pose: SmoothedPose;
  features: FrameFeatures;
  actions: DetectedAction[];
}

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

function parseLandmark(value: unknown): RawLandmark | null {
  if (typeof value !== 'object' || value === null) return null;
  const { x, y, z, visibility } = value as Record<string, unknown>;
  if (!finite(x) || !finite(y) || !finite(z)) return null;
  return { x, y, z, visibility: finite(visibility) ? visibility : 0 };
}

/**
 * Returns the message only if it is a well-formed pose frame, so callers can
 * use it as the discriminator too. Anything else — including a `pose` with a
 * NaN coordinate or a missing joint — comes back null and falls through to
 * the session's other message handling.
 */
export function parsePoseMessage(value: unknown): PoseFrameMessage | null {
  if (typeof value !== 'object' || value === null) return null;
  const message = value as Record<string, unknown>;
  if (message.type !== 'pose' || !finite(message.t)) return null;
  if (!Array.isArray(message.lm) || message.lm.length > POSE_INGEST_LIMITS.maxLandmarks) {
    return null;
  }

  const lm: RawLandmark[] = [];
  for (const raw of message.lm) {
    const point = parseLandmark(raw);
    if (!point) return null;
    lm.push(point);
  }
  // normalizeLandmarks also guards this, but rejecting here keeps a truncated
  // array from counting as an accepted frame in the stats.
  for (const index of UPPER_BODY_INDICES) {
    if (!lm[index]) return null;
  }

  return { type: 'pose', t: message.t, lm };
}

/**
 * Client-paced but server-bounded match clock, one per player.
 *
 * Advances by the client's own frame deltas (clamped), then pins the total to
 * within `maxClockDriftMs` of server time. Monotonic by construction: the
 * lower pin only ever moves it forward, and the upper pin can only hold it
 * still while server time catches up.
 */
class FrameClock {
  private lastClientTs: number | null = null;
  private clock = 0;

  /** The timestamp to run this frame at, or null to drop the frame. */
  stamp(clientTs: number, serverNow: number): number | null {
    if (this.lastClientTs === null) {
      this.lastClientTs = clientTs;
      this.clock = serverNow;
      return this.clock;
    }

    const rawDt = clientTs - this.lastClientTs;
    if (rawDt < POSE_INGEST_LIMITS.minFrameDtMs) return null;
    this.lastClientTs = clientTs;

    const advanced = this.clock + Math.min(rawDt, POSE_INGEST_LIMITS.maxFrameDtMs);
    const drift = POSE_INGEST_LIMITS.maxClockDriftMs;
    this.clock = Math.min(Math.max(advanced, serverNow - drift), serverNow + drift);
    return this.clock;
  }
}

export interface IngestStats {
  accepted: number;
  /** Rejected by the clock (too fast, replayed) or unusable to normalize. */
  dropped: number;
}

/**
 * One player's ingestion state for one match. Holds the pipeline, so it must
 * outlive individual sockets — a reconnect within the grace window has to
 * find the same instance or the guard hysteresis and punch cooldowns reset.
 */
export class PlayerIngest {
  private readonly pipeline = new PosePipeline();
  private readonly clock = new FrameClock();
  private accepted = 0;
  private dropped = 0;
  private lastFrameAt = 0;

  constructor(readonly playerUuid: string) {}

  /** Latest smoothed pose — the resolve step hit-tests punches against this. */
  get pose(): SmoothedPose | null {
    return this.pipeline.pose;
  }

  get blocking(): boolean {
    return this.pipeline.blocking;
  }

  get stats(): IngestStats {
    return { accepted: this.accepted, dropped: this.dropped };
  }

  /** Server time of the last accepted frame; the pose-loss timer reads this. */
  get lastFrameServerTime(): number {
    return this.lastFrameAt;
  }

  handle(message: PoseFrameMessage, serverNow: number): IngestedFrame | null {
    const timestamp = this.clock.stamp(message.t, serverNow);
    if (timestamp === null) {
      this.dropped += 1;
      return null;
    }

    const frame = this.pipeline.update(message.lm, timestamp);
    if (!frame) {
      this.dropped += 1;
      return null;
    }

    this.accepted += 1;
    this.lastFrameAt = serverNow;
    return { timestamp, ...frame };
  }

  forceEndBlock(timestamp: number): DetectedAction[] {
    return this.pipeline.forceEndBlock(timestamp);
  }

  reset(): void {
    this.pipeline.reset();
  }
}

/** Compact one-line rendering of an action, for session logs. */
export function describeAction(action: DetectedAction): string {
  if (action.type === 'PUNCH') {
    return `PUNCH ${action.punchType} ${action.hand} conf=${action.confidence.toFixed(2)} impact=(${action.impactX.toFixed(2)}, ${action.impactY.toFixed(2)})`;
  }
  return action.type;
}
