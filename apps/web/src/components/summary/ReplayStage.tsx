"use client";

/**
 * The watchable part of a replay: both fighters' tracked skeletons, drawn from
 * the recorded landmarks at whatever moment the scrubber is sitting on.
 *
 * ## Two panels, not one arena
 *
 * The fighters never shared a room. Each was filmed by their own webcam, in
 * their own frame, and the mechanics only ever related them through punch
 * geometry — there is no common floor to place them on. Compositing them into
 * one scene would mean inventing a spatial relationship the data does not
 * contain. Two panels on one clock is the honest arrangement, and it is also
 * the readable one: each fighter stays centred and full-size instead of
 * drifting around wherever they happened to stand.
 *
 * ## Why this doesn't re-render
 *
 * Drawing runs on its own requestAnimationFrame loop against the decoded
 * typed arrays, the same trick PoseOverlay uses for the live feed. React state
 * moves at the scrubber's cadence (a few times a second); the canvas moves at
 * the display's. Between prop updates the loop extrapolates from the last
 * known position using wall time, so playback is smooth at 60fps while the
 * event feed above it re-renders twenty times slower.
 */

import { useEffect, useMemo, useRef } from "react";
import {
  LM,
  REPLAY_JOINTS,
  REPLAY_QUANT,
  REPLAY_STRIDE,
  landmarksAt,
  type RawLandmark,
  type ReplayTrack,
} from "game-mechanics";
import { CORNER_HEX } from "@/lib/summary-analytics";
import type { ReplaySides } from "@/lib/replay-view";

const BONES: [number, number][] = [
  [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER],
  [LM.LEFT_SHOULDER, LM.LEFT_ELBOW],
  [LM.LEFT_ELBOW, LM.LEFT_WRIST],
  [LM.RIGHT_SHOULDER, LM.RIGHT_ELBOW],
  [LM.RIGHT_ELBOW, LM.RIGHT_WRIST],
  [LM.LEFT_SHOULDER, LM.LEFT_HIP],
  [LM.RIGHT_SHOULDER, LM.RIGHT_HIP],
  [LM.LEFT_HIP, LM.RIGHT_HIP],
];

const JOINT_DOTS = [LM.LEFT_WRIST, LM.RIGHT_WRIST, LM.LEFT_ELBOW, LM.RIGHT_ELBOW];

/** Webcam default for tapes recorded before the client reported its aspect. */
const FALLBACK_ASPECT = 16 / 9;

/** Breathing room around the fighter's full range of motion, as a fraction. */
const BOX_PAD = 0.14;

interface Viewport {
  aspect: number;
  minX: number;
  minY: number;
  width: number;
  height: number;
}

/**
 * The region of the source frame the fighter actually occupies, over the whole
 * tape.
 *
 * Computed once across every frame rather than per frame: a box that tracked
 * the current pose would zoom in and out as the fighter moved, which reads as
 * the camera lurching. Landmark x and y are each normalized against their own
 * axis, so x is multiplied back up by the aspect ratio first — otherwise a
 * 16:9 fighter comes out squashed to two-thirds width.
 */
function viewportFor(track: ReplayTrack): Viewport {
  const aspect = track.aspect ?? FALLBACK_ASPECT;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (let i = 0; i < track.frameCount; i++) {
    const base = i * REPLAY_STRIDE;
    for (let j = 0; j < REPLAY_JOINTS.length; j++) {
      const x = (track.coords[base + j * 3] / REPLAY_QUANT) * aspect;
      const y = track.coords[base + j * 3 + 1] / REPLAY_QUANT;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  // An empty or degenerate track falls back to the whole frame.
  if (!Number.isFinite(minX) || maxX - minX <= 0 || maxY - minY <= 0) {
    return { aspect, minX: 0, minY: 0, width: aspect, height: 1 };
  }

  const pad = Math.max(maxX - minX, maxY - minY) * BOX_PAD;
  return {
    aspect,
    minX: minX - pad,
    minY: minY - pad,
    width: maxX - minX + pad * 2,
    height: maxY - minY + pad * 2,
  };
}

function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  pose: RawLandmark[],
  view: Viewport,
  color: string,
  width: number,
  height: number,
): void {
  const scale = Math.min(width / view.width, height / view.height);
  const offsetX = (width - view.width * scale) / 2 - view.minX * scale;
  const offsetY = (height - view.height * scale) / 2 - view.minY * scale;
  const px = (lm: RawLandmark) => ({
    x: lm.x * view.aspect * scale + offsetX,
    y: lm.y * scale + offsetY,
  });

  ctx.lineWidth = Math.max(2.5, width / 90);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = color;

  for (const [a, b] of BONES) {
    const la = pose[a];
    const lb = pose[b];
    if (!la || !lb) continue;
    const pa = px(la);
    const pb = px(lb);
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.stroke();
  }

  ctx.fillStyle = color;
  for (const joint of JOINT_DOTS) {
    const lm = pose[joint];
    if (!lm) continue;
    const p = px(lm);
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(3, width / 110), 0, Math.PI * 2);
    ctx.fill();
  }

  // Head sized off the shoulders, so it scales with the fighter rather than
  // with how close they sat to the camera.
  const nose = pose[LM.NOSE];
  const left = pose[LM.LEFT_SHOULDER];
  const right = pose[LM.RIGHT_SHOULDER];
  if (nose && left && right) {
    const ls = px(left);
    const rs = px(right);
    const p = px(nose);
    const shoulders = Math.hypot(rs.x - ls.x, rs.y - ls.y);
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(6, shoulders * 0.34), 0, Math.PI * 2);
    ctx.stroke();
  }
}

interface StageClock {
  atMs: number;
  playing: boolean;
  rate: number;
  /** Wall clock when atMs was last handed to us, for extrapolation. */
  since: number;
}

export function ReplayStage({
  sides,
  names,
  corners,
  atMs,
  playing,
  rate,
  durationMs,
}: {
  sides: ReplaySides;
  names: { you: string; opponent: string };
  corners: { you: "red" | "blue"; opponent: "red" | "blue" };
  atMs: number;
  playing: boolean;
  rate: number;
  durationMs: number;
}) {
  const youCanvas = useRef<HTMLCanvasElement>(null);
  const opponentCanvas = useRef<HTMLCanvasElement>(null);
  const clock = useRef<StageClock>({ atMs, playing, rate, since: 0 });
  // Read by the draw loop rather than closed over. `corners` is a fresh
  // object on every render of the parent, so depending on it directly would
  // tear down and rebuild the loop — and blank the canvases — several times a
  // second for the whole of playback.
  const colors = useRef({ you: CORNER_HEX[corners.you], opponent: CORNER_HEX[corners.opponent] });

  const viewports = useMemo(
    () => ({ you: viewportFor(sides.you), opponent: viewportFor(sides.opponent) }),
    [sides],
  );

  useEffect(() => {
    clock.current = { atMs, playing, rate, since: performance.now() };
  }, [atMs, playing, rate]);

  useEffect(() => {
    colors.current = { you: CORNER_HEX[corners.you], opponent: CORNER_HEX[corners.opponent] };
  }, [corners.you, corners.opponent]);

  useEffect(() => {
    const panels = (["you", "opponent"] as const)
      .map((side) => {
        const canvas = side === "you" ? youCanvas.current : opponentCanvas.current;
        const ctx = canvas?.getContext("2d");
        if (!canvas || !ctx) return null;
        return {
          side,
          canvas,
          ctx,
          track: sides[side],
          view: viewports[side],
          // One scratch array per fighter, reused every frame — playback would
          // otherwise allocate eighteen landmark objects sixty times a second.
          scratch: [] as RawLandmark[],
        };
      })
      .filter((panel) => panel !== null);

    if (panels.length === 0) return;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      for (const panel of panels) {
        const rect = panel.canvas.getBoundingClientRect();
        panel.canvas.width = Math.max(1, Math.round(rect.width * dpr));
        panel.canvas.height = Math.max(1, Math.round(rect.height * dpr));
      }
    };
    resize();
    const observer = new ResizeObserver(resize);
    for (const panel of panels) observer.observe(panel.canvas);

    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const { atMs: base, playing: running, rate: speed, since } = clock.current;
      // Between React updates, carry the position forward on wall time so the
      // skeletons move at the display's rate rather than the scrubber's.
      const now = running
        ? Math.min(durationMs, base + (performance.now() - since) * speed)
        : base;

      for (const panel of panels) {
        const { ctx, canvas } = panel;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const pose = landmarksAt(panel.track, now, panel.scratch);
        if (!pose) continue;
        drawSkeleton(
          ctx,
          pose,
          panel.view,
          colors.current[panel.side],
          canvas.width,
          canvas.height,
        );
      }
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [sides, viewports, durationMs]);

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {(["you", "opponent"] as const).map((side) => (
        <figure key={side} className="flex flex-col gap-1.5">
          <div className="relative aspect-4/3 w-full overflow-hidden rounded-lg bg-zinc-50">
            <canvas
              ref={side === "you" ? youCanvas : opponentCanvas}
              aria-hidden="true"
              className="absolute inset-0 h-full w-full"
            />
            {sides[side].frameCount === 0 && (
              <p className="absolute inset-0 flex items-center justify-center px-4 text-center font-mono text-[11px] text-zinc-500">
                no tracking recorded for this fighter
              </p>
            )}
          </div>
          <figcaption className="flex items-baseline justify-between font-mono text-[11px]">
            <span className="flex items-center gap-1.5 text-zinc-800">
              <span
                aria-hidden
                className="h-2 w-2 rounded-full"
                style={{ background: CORNER_HEX[corners[side]] }}
              />
              {names[side]}
            </span>
            <span className="text-zinc-500 tabular-nums">
              {sides[side].frameCount} frames
            </span>
          </figcaption>
        </figure>
      ))}
    </div>
  );
}
