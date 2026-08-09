"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import {
  COMIC_WORDS,
  MAT_TOP,
  buildCrowd,
  buildEnvironment,
  buildRing,
  createBaseScene,
  makeComicSprite,
} from "@/lib/three/ring-builders";

/**
 * The duck's own origin sits above its feet — its vest hangs to -0.19 — so it
 * rides that far above the canvas rather than at it.
 */
const DUCK_BASE_Y = MAT_TOP + 0.19;

function buildRefereeDuck(): THREE.Group {
  const duck = new THREE.Group();
  const duckMat = new THREE.MeshStandardMaterial({
    color: 0xffd23f,
    roughness: 0.6,
  });
  const beakMat = new THREE.MeshStandardMaterial({
    color: 0xff8c00,
    roughness: 0.5,
  });

  const duckBody = new THREE.Mesh(new THREE.SphereGeometry(0.24, 16, 16), duckMat);
  duckBody.scale.set(1, 1.1, 0.95);
  duckBody.position.y = 0;
  duck.add(duckBody);

  const duckHead = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 16), duckMat);
  duckHead.position.y = 0.34;
  duck.add(duckHead);

  const duckBeak = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.12, 8), beakMat);
  duckBeak.rotation.z = Math.PI / 2;
  duckBeak.position.set(0, 0.32, 0.15);
  duck.add(duckBeak);

  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a });
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 8), eyeMat);
    eye.position.set(side * 0.07, 0.38, 0.1);
    duck.add(eye);
  }

  const wingMat = new THREE.MeshStandardMaterial({
    color: 0xf2c230,
    roughness: 0.6,
  });
  for (const side of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 12), wingMat);
    wing.scale.set(0.5, 1, 1.1);
    wing.position.set(side * 0.24, 0.02, 0);
    duck.add(wing);
  }

  // referee vest: black base with alternating white stripes
  const vestBlackMat = new THREE.MeshStandardMaterial({
    color: 0x111111,
    roughness: 0.5,
  });
  const vestWhiteMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.5,
  });
  const vestBase = new THREE.Mesh(
    new THREE.CylinderGeometry(0.19, 0.21, 0.34, 16, 1, true),
    vestBlackMat,
  );
  vestBase.position.y = -0.02;
  duck.add(vestBase);
  const stripeHeights = [-0.12, -0.02, 0.08];
  for (const h of stripeHeights) {
    const stripe = new THREE.Mesh(
      new THREE.CylinderGeometry(0.195, 0.2, 0.045, 16, 1, true),
      vestWhiteMat,
    );
    stripe.position.y = h;
    duck.add(stripe);
  }

  duck.position.set(0, DUCK_BASE_Y, 0.4);
  duck.name = "duck";
  return duck;
}

export function LandingBackground() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const { scene, camera, renderer } = createBaseScene(container);

    const ring = buildRing();
    const duck = buildRefereeDuck();
    ring.add(duck);
    scene.add(ring);
    scene.add(buildEnvironment());

    const crowd = buildCrowd();
    scene.add(crowd.group);

    const comicSprites: { sprite: THREE.Sprite; born: number }[] = [];
    let nextComicAt = 1;

    let frame = 0;
    const start = performance.now();
    const animate = () => {
      const t = (performance.now() - start) / 1000;
      const radius = 9.5;
      camera.position.x = Math.sin(t * 0.08) * radius;
      camera.position.z = Math.cos(t * 0.08) * radius + 2;
      camera.position.y = 2.8 + Math.sin(t * 0.15) * 0.4;
      // Aim at the middle of the ropes, so the shorter ring stays centred
      // instead of sitting low in frame.
      camera.lookAt(0, MAT_TOP + 0.6, 0);

      if (duck) {
        duck.position.y = DUCK_BASE_Y + Math.sin(t * 2.2) * 0.05;
        duck.rotation.y = Math.sin(t * 0.8) * 0.4;
      }

      crowd.update(t);

      if (t >= nextComicAt) {
        const word =
          COMIC_WORDS[Math.floor(Math.random() * COMIC_WORDS.length)];
        const sprite = makeComicSprite(word);
        sprite.position.set(
          (Math.random() - 0.5) * 3,
          MAT_TOP + 0.7 + Math.random() * 0.7,
          (Math.random() - 0.5) * 3,
        );
        scene.add(sprite);
        comicSprites.push({ sprite, born: t });
        nextComicAt = t + 0.8 + Math.random() * 1.0;
      }

      for (let i = comicSprites.length - 1; i >= 0; i--) {
        const entry = comicSprites[i];
        const age = t - entry.born;
        const life = 1.6;
        if (age > life) {
          scene.remove(entry.sprite);
          entry.sprite.material.map?.dispose();
          entry.sprite.material.dispose();
          comicSprites.splice(i, 1);
          continue;
        }
        const progress = age / life;
        entry.sprite.position.y += 0.012;
        entry.sprite.material.opacity = 1 - progress;
        const pop = progress < 0.15 ? progress / 0.15 : 1;
        entry.sprite.scale.set(1.6 * pop, 0.8 * pop, 1);
      }

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
      for (const entry of comicSprites) {
        entry.sprite.material.map?.dispose();
        entry.sprite.material.dispose();
      }
      crowd.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
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
