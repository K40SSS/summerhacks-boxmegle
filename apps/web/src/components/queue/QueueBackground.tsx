"use client";

import { useEffect, useRef } from "react";
import { buildEnvironment, buildRing, createBaseScene } from "@/lib/three/ring-builders";

export function QueueBackground() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const { scene, camera, renderer } = createBaseScene(container);

    scene.add(buildRing());
    scene.add(buildEnvironment());

    let frame = 0;
    const start = performance.now();
    const animate = () => {
      const t = (performance.now() - start) / 1000;
      const radius = 9.5;
      camera.position.x = Math.sin(t * 0.03) * radius;
      camera.position.z = Math.cos(t * 0.03) * radius + 2;
      camera.position.y = 3.0 + Math.sin(t * 0.1) * 0.3;
      camera.lookAt(0, 1.0, 0);

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

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 -z-10"
      aria-hidden="true"
    />
  );
}
