import { describe, expect, it } from "vitest";
import {
  REPLAY_JOINTS,
  REPLAY_QUANT,
  REPLAY_STRIDE,
  decodeReplay,
  encodeReplay,
  frameIndexAt,
  landmarksAt,
  quantizeCoord,
  type ReplayHeader,
  type ReplayTrackData,
} from "./replay";
import { LM, type RawLandmark } from "./types";
import { normalizeLandmarks } from "./normalize";

/** A frame's worth of landmarks, spread out enough to be a plausible body. */
function bodyFrame(seed: number): RawLandmark[] {
  const lm: RawLandmark[] = [];
  const drift = seed * 0.001;
  const put = (index: number, x: number, y: number, z = 0) => {
    lm[index] = { x: x + drift, y: y + drift, z, visibility: 1 };
  };
  put(LM.NOSE, 0.5, 0.2, -0.1);
  put(LM.LEFT_SHOULDER, 0.6, 0.35);
  put(LM.RIGHT_SHOULDER, 0.4, 0.35);
  put(LM.LEFT_ELBOW, 0.65, 0.5, 0.05);
  put(LM.RIGHT_ELBOW, 0.35, 0.5, 0.05);
  put(LM.LEFT_WRIST, 0.62, 0.42, -0.2);
  put(LM.RIGHT_WRIST, 0.38, 0.42, -0.2);
  put(LM.LEFT_HIP, 0.57, 0.7);
  put(LM.RIGHT_HIP, 0.43, 0.7);
  return lm;
}

function buildTrack(
  playerUuid: string,
  slot: 0 | 1,
  frames: { atMs: number; lm: RawLandmark[] }[],
): ReplayTrackData {
  const times = new Int32Array(frames.length);
  const coords = new Int16Array(frames.length * REPLAY_STRIDE);
  frames.forEach((frame, i) => {
    times[i] = frame.atMs;
    for (let j = 0; j < REPLAY_JOINTS.length; j++) {
      const point = frame.lm[REPLAY_JOINTS[j]];
      const o = i * REPLAY_STRIDE + j * 3;
      coords[o] = quantizeCoord(point.x);
      coords[o + 1] = quantizeCoord(point.y);
      coords[o + 2] = quantizeCoord(point.z);
    }
  });
  return {
    meta: {
      playerUuid,
      slot,
      name: `fighter-${slot}`,
      corner: slot === 0 ? "red" : "blue",
      frameCount: frames.length,
    },
    times,
    coords,
  };
}

const HEADER: Omit<ReplayHeader, "v" | "quant" | "joints"> = {
  fps: 30,
  durationMs: 120_000,
  tracks: [],
  events: [],
  winnerUuid: null,
  reason: "DECISION",
  truncated: false,
};

function tapeOf(counts: [number, number], name = "a") {
  const tracks = counts.map((count, slot) =>
    buildTrack(
      `${name}-${slot}`,
      slot as 0 | 1,
      Array.from({ length: count }, (_, i) => ({ atMs: i * 33, lm: bodyFrame(i) })),
    ),
  );
  return encodeReplay({ ...HEADER, tracks: tracks.map((t) => t.meta) }, tracks);
}

describe("replay codec", () => {
  it("round-trips times and coordinates exactly", () => {
    const tape = decodeReplay(tapeOf([40, 37]));

    expect(tape.tracks).toHaveLength(2);
    expect(tape.tracks[0].frameCount).toBe(40);
    expect(tape.tracks[1].frameCount).toBe(37);
    expect(tape.header.fps).toBe(30);

    for (const track of tape.tracks) {
      expect(track.times.length).toBe(track.frameCount);
      expect(track.coords.length).toBe(track.frameCount * REPLAY_STRIDE);
      for (let i = 0; i < track.frameCount; i++) {
        expect(track.times[i]).toBe(i * 33);
      }
    }

    // Coordinates survive to the quantizer's precision, not beyond it.
    const first = landmarksAt(tape.tracks[0], 0)!;
    const source = bodyFrame(0);
    for (const index of REPLAY_JOINTS) {
      expect(first[index].x).toBeCloseTo(source[index].x, 3);
      expect(first[index].y).toBeCloseTo(source[index].y, 3);
      expect(first[index].z).toBeCloseTo(source[index].z, 3);
    }
  });

  it("keeps blocks aligned across odd frame counts and header lengths", () => {
    // Odd counts make each block's byte length a non-multiple of 4, and the
    // varying name changes the header length — both are where a hand-rolled
    // binary layout drifts if the padding is wrong.
    for (const counts of [[1, 1], [3, 7], [15, 2], [101, 99]] as [number, number][]) {
      for (const name of ["a", "ab", "abc", "abcd"]) {
        const tape = decodeReplay(tapeOf(counts, name));
        expect(tape.tracks.map((t) => t.frameCount)).toEqual(counts);
        // Last coordinate of the last track is the furthest byte from the
        // header, so it only reads back correctly if every offset was right.
        const last = tape.tracks[1];
        const expected = landmarksAt(last, (counts[1] - 1) * 33)!;
        expect(expected[LM.RIGHT_HIP].y).toBeCloseTo(0.7 + (counts[1] - 1) * 0.001, 3);
      }
    }
  });

  it("indexes landmarks by MediaPipe index so poses can be normalized on read", () => {
    const tape = decodeReplay(tapeOf([10, 10]));
    const pose = landmarksAt(tape.tracks[0], 5 * 33)!;

    // Holes where legs and face detail would be — the format stores only the
    // upper-body set, but at their real indices.
    expect(pose[LM.LEFT_WRIST]).toBeDefined();
    expect(pose[25]).toBeUndefined();

    // The whole point of storing raw landmarks: the body-frame pose is still
    // recoverable, so a 3D rig can be driven from a tape.
    expect(normalizeLandmarks(pose, 165)).not.toBeNull();
  });

  it("seeks to the last frame at or before the scrub head", () => {
    const tape = decodeReplay(tapeOf([10, 10]));
    const track = tape.tracks[0];

    expect(frameIndexAt(track, -1)).toBe(-1);
    expect(frameIndexAt(track, 0)).toBe(0);
    expect(frameIndexAt(track, 32)).toBe(0);
    expect(frameIndexAt(track, 33)).toBe(1);
    expect(frameIndexAt(track, 34)).toBe(1);
    expect(frameIndexAt(track, 9 * 33)).toBe(9);
    // Past the end holds on the final frame rather than going blank.
    expect(frameIndexAt(track, 999_999)).toBe(9);
    expect(landmarksAt(track, -1)).toBeNull();
  });

  it("reuses the caller's array instead of allocating per frame", () => {
    const tape = decodeReplay(tapeOf([10, 10]));
    const scratch: RawLandmark[] = [];
    const a = landmarksAt(tape.tracks[0], 0, scratch)!;
    const b = landmarksAt(tape.tracks[0], 5 * 33, scratch)!;

    expect(a).toBe(scratch);
    expect(b).toBe(scratch);
    expect(b[LM.NOSE].x).toBeCloseTo(0.5 + 5 * 0.001, 3);
  });

  it("clamps out-of-range coordinates rather than wrapping them", () => {
    // int16 overflow would wrap a far-out limb to the opposite side of the
    // frame, which reads as a teleport rather than a clip.
    expect(quantizeCoord(99)).toBe(32_767);
    expect(quantizeCoord(-99)).toBe(-32_768);
    expect(quantizeCoord(Number.NaN)).toBe(0);
    expect(quantizeCoord(0.5)).toBe(0.5 * REPLAY_QUANT);
  });

  it("rejects foreign or truncated buffers", () => {
    expect(() => decodeReplay(new Uint8Array(4))).toThrow(/not a replay tape/);
    expect(() => decodeReplay(new TextEncoder().encode("hello world"))).toThrow(
      /not a replay tape/,
    );
    const good = tapeOf([5, 5]);
    expect(() => decodeReplay(good.subarray(0, 6))).toThrow(/not a replay tape/);
  });

  it("carries the event log through the header", () => {
    const tracks = [
      buildTrack("p1", 0, [{ atMs: 0, lm: bodyFrame(0) }]),
      buildTrack("p2", 1, [{ atMs: 0, lm: bodyFrame(0) }]),
    ];
    const tape = decodeReplay(
      encodeReplay(
        {
          ...HEADER,
          tracks: tracks.map((t) => t.meta),
          winnerUuid: "p1",
          reason: "KO",
          events: [
            {
              atMs: 1234,
              by: "p1",
              punchType: "CROSS",
              hand: "RIGHT",
              result: "HIT",
              zone: "HEAD",
              healthDamage: 9,
              guardDamage: 0,
              speed: 4.2,
            },
          ],
        },
        tracks,
      ),
    );

    expect(tape.header.winnerUuid).toBe("p1");
    expect(tape.header.reason).toBe("KO");
    expect(tape.header.events).toHaveLength(1);
    expect(tape.header.events[0]).toMatchObject({ punchType: "CROSS", zone: "HEAD" });
    expect(tape.header.tracks[1].corner).toBe("blue");
  });
});
