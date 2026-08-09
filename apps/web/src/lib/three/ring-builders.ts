import * as THREE from "three";

export function buildRing(): THREE.Group {
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

  return ring;
}

export function buildEnvironment(): THREE.Group {
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

export const COMIC_WORDS = ["POW!", "BAM!", "OOF!", "BONK!", "WHAP!", "KO!"];

export function makeComicSprite(text: string): THREE.Sprite {
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

export type BaseScene = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
};

export function createBaseScene(container: HTMLElement): BaseScene {
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

  return { scene, camera, renderer };
}
