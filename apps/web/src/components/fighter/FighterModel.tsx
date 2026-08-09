"use client";

import { useEffect, useRef } from "react";
import {
  MAT_TOP,
  buildEnvironment,
  buildRing,
  createBaseScene,
} from "@/lib/three/ring-builders";
import {
  buildFighter,
  poseFighterIdle,
  type FighterStance,
} from "@/lib/three/player-builders";


export interface FighterModelProps {
  stance?: FighterStance;
  /** Body colour — SUPERHOT red by default. */
  color?: number;
  /** Stand the fighter in the boxing ring instead of on the open floor. */
  withRing?: boolean;
  /** Add the white cityscape backdrop the landing/queue scenes use. */
  withEnvironment?: boolean;
  /** Put a southpaw opponent in front of them, squared up. */
  sparring?: boolean;
  /** Seconds per turntable revolution. 0 pins the camera to a 3/4 view. */
  spinSeconds?: number;
  /**
   * Let the user grab the model and spin it (horizontal drag orbits the
   * camera, with a little inertia). The auto-spin pauses while they're
   * interacting and resumes a few seconds after they let go.
   */
  dragToSpin?: boolean;
  /** Dev aid: freeze the idle clock at this many seconds to inspect a pose. */
  frozenAt?: number;
  className?: string;
}

const DRAG_RAD_PER_PX = 0.008;
const DRAG_IDLE_RESUME_S = 4;

/**
 * The 3D player: a SUPERHOT-style fighter shadowboxing in its own scene.
 *
 * Owns a scene the way LandingBackground/QueueBackground do — the model
 * itself is built by `buildFighter()` in lib/three/player-builders, the same
 * split as the arena (ring-builders + a component that mounts it). Drop it
 * anywhere sized by its container:
 *
 *   <FighterModel className="h-96 w-full" />
 *   <FighterModel withRing sparring stance="southpaw" />
 */
export function FighterModel({
  stance = "orthodox",
  color,
  withRing = false,
  withEnvironment = false,
  sparring = false,
  spinSeconds = 26,
  dragToSpin = false,
  frozenAt,
  className = "h-full w-full",
}: FighterModelProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const { scene, camera, renderer } = createBaseScene(container);

    const ring = withRing ? buildRing() : null;
    if (ring) scene.add(ring);
    if (withEnvironment) scene.add(buildEnvironment());
    const stage = ring ?? scene;
    const floor = ring ? MAT_TOP : 0;

    const fighter = buildFighter({ stance, color });
    fighter.position.set(0, floor, sparring ? -0.75 : 0);
    stage.add(fighter);

    const opponent = sparring
      ? buildFighter({
          stance: stance === "orthodox" ? "southpaw" : "orthodox",
          color: 0x2b2f38,
        })
      : null;
    if (opponent) {
      opponent.position.set(0, floor, 0.75);
      opponent.rotation.y = Math.PI;
      stage.add(opponent);
    }

    // Orbit inside the ropes — outside them a rope sits across the lens.
    const radius = withRing ? 2.9 : 2.6;
    const eye = floor + (withRing ? 1.22 : 1.35);
    const target = floor + (sparring ? 0.74 : 0.95);

    // Camera angle is integrated per frame (not derived from elapsed time)
    // so a drag and the auto-spin can hand the same value back and forth.
    const spin = {
      angle: 0.6,
      vel: 0, // rad/s of inertia left over from the last drag
      dragging: false,
      lastX: 0,
      lastMoveAt: 0,
      idleSince: -Infinity, // elapsed seconds when the last drag ended
    };

    const onPointerDown = (e: PointerEvent) => {
      // button !== 0: a right-click's pointerup is swallowed by the context
      // menu, which would wedge the drag on and kill the auto-spin forever.
      if (!e.isPrimary || e.button !== 0) return;
      spin.dragging = true;
      spin.vel = 0;
      spin.lastX = e.clientX;
      spin.lastMoveAt = performance.now();
      try {
        container.setPointerCapture(e.pointerId);
      } catch {
        // Synthetic or already-released pointers can't be captured; the drag
        // still works, it just loses the outside-the-element grip.
      }
      container.style.cursor = "grabbing";
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!spin.dragging || !e.isPrimary) return;
      const now = performance.now();
      const dx = e.clientX - spin.lastX;
      const dtMove = Math.max((now - spin.lastMoveAt) / 1000, 1 / 120);
      spin.lastX = e.clientX;
      spin.lastMoveAt = now;
      // Dragging right turns the model to the viewer's right, so the camera
      // orbits the other way.
      spin.angle -= dx * DRAG_RAD_PER_PX;
      spin.vel = Math.max(-6, Math.min(6, (-dx * DRAG_RAD_PER_PX) / dtMove));
    };
    const onPointerEnd = (e: PointerEvent) => {
      if (!spin.dragging || !e.isPrimary) return;
      spin.dragging = false;
      // Only hand inertia to the integrator when the release was mid-motion;
      // a flick held motionless before letting go should stay put.
      if (performance.now() - spin.lastMoveAt > 100) spin.vel = 0;
      spin.idleSince = (performance.now() - start) / 1000;
      container.style.cursor = "grab";
    };
    if (dragToSpin) {
      container.style.cursor = "grab";
      // pan-y: horizontal drags are ours, vertical swipes must keep scrolling
      // the page (the browser sends pointercancel, which ends the drag).
      container.style.touchAction = "pan-y";
      container.addEventListener("pointerdown", onPointerDown);
      container.addEventListener("pointermove", onPointerMove);
      container.addEventListener("lostpointercapture", onPointerEnd);
      // Releases land on whatever is under the pointer when capture failed,
      // so listen at the window or the drag can wedge on and never let go.
      window.addEventListener("pointerup", onPointerEnd);
      window.addEventListener("pointercancel", onPointerEnd);
    }

    let frame = 0;
    let prevElapsed = 0;
    const start = performance.now();
    const animate = () => {
      const elapsed = (performance.now() - start) / 1000;
      const dt = Math.min(elapsed - prevElapsed, 0.1);
      prevElapsed = elapsed;

      const t = frozenAt ?? elapsed;
      poseFighterIdle(fighter, t);
      if (opponent) poseFighterIdle(opponent, t + 1.6);

      if (!spin.dragging) {
        spin.angle += spin.vel * dt;
        spin.vel *= Math.exp(-3 * dt);
        const autoSpinning =
          spinSeconds > 0 &&
          (!dragToSpin || elapsed - spin.idleSince > DRAG_IDLE_RESUME_S);
        if (autoSpinning) spin.angle += (Math.PI * 2 * dt) / spinSeconds;
      }
      camera.position.set(Math.sin(spin.angle) * radius, eye, Math.cos(spin.angle) * radius);
      camera.lookAt(0, target, 0);

      renderer.render(scene, camera);
      frame = requestAnimationFrame(animate);
    };
    animate();

    const handleResize = () => {
      const { clientWidth, clientHeight } = container;
      camera.aspect = clientWidth / clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(clientWidth, clientHeight);
    };
    window.addEventListener("resize", handleResize);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", handleResize);
      if (dragToSpin) {
        container.style.cursor = "";
        container.style.touchAction = "";
        container.removeEventListener("pointerdown", onPointerDown);
        container.removeEventListener("pointermove", onPointerMove);
        container.removeEventListener("lostpointercapture", onPointerEnd);
        window.removeEventListener("pointerup", onPointerEnd);
        window.removeEventListener("pointercancel", onPointerEnd);
      }
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
  }, [stance, color, withRing, withEnvironment, sparring, spinSeconds, dragToSpin, frozenAt]);

  return <div ref={containerRef} className={className} aria-hidden="true" />;
}
