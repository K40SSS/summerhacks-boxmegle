"use client";

import { useEffect, useRef } from "react";
import { buildRing, createBaseScene } from "@/lib/three/ring-builders";
import { buildFighter, poseFighterIdle } from "@/lib/three/player-builders";

/**
 * Dev-only turntable for the player model. Add `?t=0.26` to freeze the idle
 * clock at one instant (0.26 lands on full jab extension) when tuning a pose.
 */
export default function ModelPreviewPage() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const { scene, camera, renderer } = createBaseScene(container);
    const ring = buildRing();
    scene.add(ring);

    const you = buildFighter();
    you.position.set(0, 0.68, -0.75);
    ring.add(you);

    const foe = buildFighter({ stance: "southpaw", color: 0x2b2f38 });
    foe.position.set(0, 0.68, 0.75);
    foe.rotation.y = Math.PI;
    ring.add(foe);

    const frozen = Number(new URLSearchParams(location.search).get("t") ?? "NaN");

    let frame = 0;
    const start = performance.now();
    const animate = () => {
      const elapsed = (performance.now() - start) / 1000;
      const t = Number.isNaN(frozen) ? elapsed : frozen;
      poseFighterIdle(you, t);
      poseFighterIdle(foe, t + 1.6);

      // Inside the ropes — orbiting outside them puts a rope across the lens.
      const orbit = elapsed * 0.25;
      camera.position.set(Math.sin(orbit) * 2.9, 1.9, Math.cos(orbit) * 2.9);
      camera.lookAt(0, 1.42, 0);

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
  }, []);

  return <div ref={containerRef} className="fixed inset-0" />;
}
