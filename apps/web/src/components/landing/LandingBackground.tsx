"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

function buildRing(): THREE.Group {
  const ring = new THREE.Group();

  const platformMat = new THREE.MeshStandardMaterial({
    color: 0xe8e8e8,
    roughness: 0.9,
  });
  const platform = new THREE.Mesh(
    new THREE.BoxGeometry(7, 0.6, 7),
    platformMat,
  );
  platform.position.y = 0.3;
  ring.add(platform);

  const matMat = new THREE.MeshStandardMaterial({
    color: 0xf7f7f7,
    roughness: 0.7,
  });
  const mat = new THREE.Mesh(new THREE.BoxGeometry(6.3, 0.08, 6.3), matMat);
  mat.position.y = 0.64;
  ring.add(mat);

  const postMat = new THREE.MeshStandardMaterial({
    color: 0xd6d6d6,
    roughness: 0.5,
    metalness: 0.2,
  });
  const postGeo = new THREE.CylinderGeometry(0.09, 0.09, 3, 16);
  const postOffset = 3.05;
  const postPositions: [number, number][] = [
    [-postOffset, -postOffset],
    [postOffset, -postOffset],
    [-postOffset, postOffset],
    [postOffset, postOffset],
  ];
  for (const [x, z] of postPositions) {
    const post = new THREE.Mesh(postGeo, postMat);
    post.position.set(x, 0.64 + 1.5, z);
    ring.add(post);
  }

  const ropeMat = new THREE.MeshStandardMaterial({
    color: 0xcccccc,
    roughness: 0.4,
  });
  const ropeHeights = [1.0, 1.7, 2.4];
  for (const h of ropeHeights) {
    const points: THREE.Vector3[] = [];
    const corners = [
      [-postOffset, -postOffset],
      [postOffset, -postOffset],
      [postOffset, postOffset],
      [-postOffset, postOffset],
      [-postOffset, -postOffset],
    ];
    for (const [x, z] of corners) {
      points.push(new THREE.Vector3(x, 0.64 + h, z));
    }
    const curve = new THREE.CatmullRomCurve3(points, true, "catmullrom", 0.001);
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 100, 0.035, 8, true),
      ropeMat,
    );
    ring.add(tube);
  }

  const stepMat = new THREE.MeshStandardMaterial({
    color: 0xdedede,
    roughness: 0.9,
  });
  const step = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.3, 1.2), stepMat);
  step.position.set(0, 0.15, -3.9);
  ring.add(step);

  // the referee: a duck in a striped vest, standing in the middle of the ring
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

  duck.position.set(0, 0.87, 0.4);
  duck.name = "duck";
  ring.add(duck);

  return ring;
}

const COMIC_WORDS = ["POW!", "BAM!", "OOF!", "BONK!", "WHAP!", "KO!"];

function makeComicSprite(text: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  ctx.font = "bold 64px Impact, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 8;
  ctx.strokeStyle = "#000000";
  ctx.fillStyle = "#ffde59";
  ctx.strokeText(text, canvas.width / 2, canvas.height / 2);
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(1.6, 0.8, 1);
  return sprite;
}

function buildEnvironment(): THREE.Group {
  const env = new THREE.Group();

  const buildingMat = new THREE.MeshStandardMaterial({
    color: 0xf0f0f0,
    roughness: 1,
  });
  const edgeMat = new THREE.LineBasicMaterial({
    color: 0xd0d0d0,
    transparent: true,
    opacity: 0.5,
  });

  const layout: { w: number; h: number; d: number; x: number; z: number }[] =
    [
      { w: 4, h: 10, d: 4, x: -16, z: -14 },
      { w: 5, h: 14, d: 5, x: 15, z: -18 },
      { w: 3, h: 7, d: 3, x: -20, z: 6 },
      { w: 4, h: 9, d: 4, x: 20, z: 4 },
      { w: 6, h: 16, d: 4, x: -10, z: -26 },
      { w: 6, h: 12, d: 4, x: 10, z: -28 },
    ];

  for (const b of layout) {
    const geo = new THREE.BoxGeometry(b.w, b.h, b.d);
    const mesh = new THREE.Mesh(geo, buildingMat);
    mesh.position.set(b.x, b.h / 2, b.z);
    env.add(mesh);

    const edges = new THREE.EdgesGeometry(geo);
    const line = new THREE.LineSegments(edges, edgeMat);
    line.position.copy(mesh.position);
    env.add(line);
  }

  const trussMat = new THREE.LineBasicMaterial({
    color: 0xcfcfcf,
    transparent: true,
    opacity: 0.6,
  });
  for (let i = -1; i <= 1; i++) {
    const points = [
      new THREE.Vector3(-9, 8, -20 + i * 8),
      new THREE.Vector3(0, 15, -20 + i * 8),
      new THREE.Vector3(9, 8, -20 + i * 8),
    ];
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    env.add(new THREE.Line(geo, trussMat));
  }

  return env;
}

export function LandingBackground() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xffffff);
    scene.fog = new THREE.Fog(0xffffff, 8, 42);

    const camera = new THREE.PerspectiveCamera(
      50,
      container.clientWidth / container.clientHeight,
      0.1,
      100,
    );

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    const hemi = new THREE.HemisphereLight(0xffffff, 0xf0f0f0, 1.6);
    scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 0.5);
    dir.position.set(6, 10, 4);
    scene.add(dir);
    const ambient = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambient);

    const floorMat = new THREE.MeshStandardMaterial({
      color: 0xfafafa,
      roughness: 1,
    });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), floorMat);
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    const ring = buildRing();
    scene.add(ring);
    scene.add(buildEnvironment());
    const duck = ring.getObjectByName("duck");

    const comicSprites: { sprite: THREE.Sprite; born: number }[] = [];
    let nextComicAt = 1;

    let frame = 0;
    const start = performance.now();
    const animate = () => {
      const t = (performance.now() - start) / 1000;
      const radius = 9.5;
      camera.position.x = Math.sin(t * 0.08) * radius;
      camera.position.z = Math.cos(t * 0.08) * radius + 2;
      camera.position.y = 3.2 + Math.sin(t * 0.15) * 0.4;
      camera.lookAt(0, 1.2, 0);

      if (duck) {
        duck.position.y = 0.87 + Math.sin(t * 2.2) * 0.05;
        duck.rotation.y = Math.sin(t * 0.8) * 0.4;
      }

      if (t >= nextComicAt) {
        const word =
          COMIC_WORDS[Math.floor(Math.random() * COMIC_WORDS.length)];
        const sprite = makeComicSprite(word);
        sprite.position.set(
          (Math.random() - 0.5) * 3,
          1.6 + Math.random() * 0.8,
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
