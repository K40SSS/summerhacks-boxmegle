"use client";

import { useEffect, useRef } from "react";
import { buildRing, createBaseScene } from "@/lib/three/ring-builders";
import {
  buildFighter,
  poseFighterIdle,
  type FighterStance,
} from "@/lib/three/player-builders";

const MAT_TOP = 0.68;

export interface FighterModelProps {
  stance?: FighterStance;
  /** Body colour — SUPERHOT red by default. */
  color?: number;
  /** Stand the fighter in the boxing ring instead of on the open floor. */
  withRing?: boolean;
  /** Put a southpaw opponent in front of them, squared up. */
  sparring?: boolean;
  /** Seconds per turntable revolution. 0 pins the camera to a 3/4 view. */
  spinSeconds?: number;
  /** Dev aid: freeze the idle clock at this many seconds to inspect a pose. */
  frozenAt?: number;
  className?: string;
}

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
  sparring = false,
  spinSeconds = 26,
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

    let frame = 0;
    const start = performance.now();
    const animate = () => {
      const elapsed = (performance.now() - start) / 1000;
      const t = frozenAt ?? elapsed;
      poseFighterIdle(fighter, t);
      if (opponent) poseFighterIdle(opponent, t + 1.6);

      const orbit = spinSeconds > 0 ? (elapsed / spinSeconds) * Math.PI * 2 : 0.6;
      camera.position.set(Math.sin(orbit) * radius, eye, Math.cos(orbit) * radius);
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
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
  }, [stance, color, withRing, sparring, spinSeconds, frozenAt]);

  return <div ref={containerRef} className={className} aria-hidden="true" />;
}
