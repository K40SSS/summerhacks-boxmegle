import * as THREE from "three";

/** Arena palette. The ring is the only saturated thing in a white scene. */
const CANVAS_BLUE = 0x2456c8;
const APRON_BLUE = 0x16357e;
const ROPE_RED = 0xd91f2e;
const PAD_RED = 0xb01a26;
const POST_SILVER = 0xc9ced6;

/**
 * Ring elevation, all derived from these three so the whole structure scales
 * together. Anything standing on the canvas (fighters, the referee) should
 * position off MAT_TOP rather than hard-coding a height.
 */
const APRON_H = 0.34;
const MAT_THICKNESS = 0.08;
export const MAT_TOP = APRON_H + MAT_THICKNESS;
/** Rope heights above the canvas, low to high. */
const ROPE_HEIGHTS = [0.42, 0.8, 1.18];
const POST_H = 1.5;

export function buildRing(): THREE.Group {
  const ring = new THREE.Group();

  const platformMat = new THREE.MeshStandardMaterial({
    color: APRON_BLUE,
    roughness: 0.9,
  });
  const platform = new THREE.Mesh(
    new THREE.BoxGeometry(7, APRON_H, 7),
    platformMat,
  );
  platform.position.y = APRON_H / 2;
  ring.add(platform);

  const matMat = new THREE.MeshStandardMaterial({
    color: CANVAS_BLUE,
    roughness: 0.7,
  });
  const mat = new THREE.Mesh(
    new THREE.BoxGeometry(6.3, MAT_THICKNESS, 6.3),
    matMat,
  );
  mat.position.y = APRON_H + MAT_THICKNESS / 2;
  ring.add(mat);

  const postMat = new THREE.MeshStandardMaterial({
    color: POST_SILVER,
    roughness: 0.5,
    metalness: 0.2,
  });
  const postGeo = new THREE.CylinderGeometry(0.09, 0.09, POST_H, 16);
  const postOffset = 3.05;
  const postPositions: [number, number][] = [
    [-postOffset, -postOffset],
    [postOffset, -postOffset],
    [-postOffset, postOffset],
    [postOffset, postOffset],
  ];
  for (const [x, z] of postPositions) {
    const post = new THREE.Mesh(postGeo, postMat);
    post.position.set(x, MAT_TOP + POST_H / 2, z);
    ring.add(post);
  }

  const ropeMat = new THREE.MeshStandardMaterial({
    color: ROPE_RED,
    roughness: 0.4,
  });
  for (const h of ROPE_HEIGHTS) {
    const points: THREE.Vector3[] = [];
    const corners = [
      [-postOffset, -postOffset],
      [postOffset, -postOffset],
      [postOffset, postOffset],
      [-postOffset, postOffset],
      [-postOffset, -postOffset],
    ];
    for (const [x, z] of corners) {
      points.push(new THREE.Vector3(x, MAT_TOP + h, z));
    }
    const curve = new THREE.CatmullRomCurve3(points, true, "catmullrom", 0.001);
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 100, 0.035, 8, true),
      ropeMat,
    );
    ring.add(tube);
  }

  // Turnbuckle pads: the corner posts wear a padded sleeve over the rope
  // span, turned 45 degrees so the flat faces the ring the way a real one does.
  const padMat = new THREE.MeshStandardMaterial({
    color: PAD_RED,
    roughness: 0.8,
  });
  const padLow = ROPE_HEIGHTS[0] - 0.16;
  const padHigh = ROPE_HEIGHTS[ROPE_HEIGHTS.length - 1] + 0.16;
  const padGeo = new THREE.BoxGeometry(0.34, padHigh - padLow, 0.34);
  for (const [x, z] of postPositions) {
    const pad = new THREE.Mesh(padGeo, padMat);
    pad.position.set(x, MAT_TOP + (padLow + padHigh) / 2, z);
    pad.rotation.y = Math.PI / 4;
    ring.add(pad);
  }

  const stepMat = new THREE.MeshStandardMaterial({
    color: APRON_BLUE,
    roughness: 0.9,
  });
  const stepH = APRON_H * 0.55;
  const step = new THREE.Mesh(new THREE.BoxGeometry(1.2, stepH, 1.2), stepMat);
  step.position.set(0, stepH / 2, -3.9);
  ring.add(step);

  return ring;
}

export function buildEnvironment(): THREE.Group {
  const env = new THREE.Group();

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

/**
 * The crowd is one flat grey — a silhouette mass, not individuals, so the
 * blue ring stays the only colour in the scene. Picked from the same
 * light-grey family the old skyline blocks used, but darker: the scene fogs
 * to white by 42 units and the stands sit out past 15, so a true 0xf0f0f0
 * would blend into the background and vanish entirely.
 */
const CROWD_GREY = 0xaeb5bf;
const STAND_GREY = 0xdfe3e8;

export interface Crowd {
  group: THREE.Group;
  /** Call each frame with elapsed seconds to keep them bobbing. */
  update: (t: number) => void;
  dispose: () => void;
}

/**
 * Spectators ringing the arena on all four sides, well outside the ropes.
 *
 * Each person is deliberately crude — a rectangle body under a circle head —
 * so the crowd reads as texture and motion rather than detail. They are two
 * InstancedMeshes rather than a few hundred Groups: at this count the bob is
 * just a per-frame matrix write, and one draw call for every body plus one
 * for every head is what keeps that affordable.
 *
 * Each row sits on its own tier of stands, stepping up and back so the whole
 * bank is visible from the ring. The tiers are solid boxes rather than seats:
 * from this distance the crowd is the detail and the structure only has to
 * hold them up.
 */
export function buildCrowd(): Crowd {
  const group = new THREE.Group();
  group.name = "crowd";

  const ROWS = 6;
  /** Front row of the stands, well clear of the 3.5 apron edge. */
  const INNER = 15;
  const ROW_DEPTH = 1.6;
  const SPACING = 0.95;
  /** How much each tier climbs over the one in front. */
  const TIER_RISE = 0.55;
  const FIRST_TIER_H = 0.4;

  const BODY_W = 0.36;
  const BODY_H = 0.52;
  const HEAD_R = 0.135;
  const BODY_MID = BODY_H / 2;
  const HEAD_MID = BODY_H + HEAD_R + 0.02;

  type Person = {
    x: number;
    y: number;
    z: number;
    rotY: number;
    phase: number;
    speed: number;
    amp: number;
  };
  const people: Person[] = [];

  // A plane faces +z, so each side turns to look back at the ring.
  const sides = [
    { axis: "z" as const, sign: -1, rotY: 0 },
    { axis: "z" as const, sign: 1, rotY: Math.PI },
    { axis: "x" as const, sign: -1, rotY: Math.PI / 2 },
    { axis: "x" as const, sign: 1, rotY: -Math.PI / 2 },
  ];

  const standMat = new THREE.MeshStandardMaterial({
    color: STAND_GREY,
    roughness: 1,
  });
  const standGeos: THREE.BoxGeometry[] = [];

  for (const side of sides) {
    for (let row = 0; row < ROWS; row++) {
      const depth = INNER + row * ROW_DEPTH;
      const tierTop = FIRST_TIER_H + row * TIER_RISE;

      // One solid box per tier, grounded at y=0 so the bank reads as a
      // staircase of stands rather than a stack of floating shelves. The four
      // sides overlap at the corners, which closes the ring.
      const span = depth * 2 + ROW_DEPTH;
      const geo =
        side.axis === "z"
          ? new THREE.BoxGeometry(span, tierTop, ROW_DEPTH)
          : new THREE.BoxGeometry(ROW_DEPTH, tierTop, span);
      standGeos.push(geo);
      const tier = new THREE.Mesh(geo, standMat);
      tier.position.set(
        side.axis === "z" ? 0 : side.sign * depth,
        tierTop / 2,
        side.axis === "z" ? side.sign * depth : 0,
      );
      group.add(tier);

      // Inset the x-sides so the four sides don't stack people in the corners.
      const half = side.axis === "z" ? depth : depth - SPACING;
      const count = Math.floor((half * 2) / SPACING);

      for (let i = 0; i <= count; i++) {
        const along = -half + i * SPACING + (Math.random() - 0.5) * 0.3;
        const out = depth + (Math.random() - 0.5) * 0.3;
        people.push({
          x: side.axis === "z" ? along : side.sign * out,
          y: tierTop,
          z: side.axis === "z" ? side.sign * out : along,
          rotY: side.rotY,
          phase: Math.random() * Math.PI * 2,
          speed: 1.6 + Math.random() * 2.0,
          amp: 0.05 + Math.random() * 0.09,
        });
      }
    }
  }

  const bodyGeo = new THREE.PlaneGeometry(BODY_W, BODY_H);
  const headGeo = new THREE.CircleGeometry(HEAD_R, 12);
  // One shared material, one colour — no per-instance tinting to set up.
  const crowdMat = new THREE.MeshStandardMaterial({
    color: CROWD_GREY,
    roughness: 1,
    side: THREE.DoubleSide,
  });

  const bodies = new THREE.InstancedMesh(bodyGeo, crowdMat, people.length);
  const heads = new THREE.InstancedMesh(headGeo, crowdMat, people.length);
  bodies.frustumCulled = false;
  heads.frustumCulled = false;

  group.add(bodies, heads);

  const dummy = new THREE.Object3D();

  const update = (t: number) => {
    for (let i = 0; i < people.length; i++) {
      const person = people[i];
      const bob = Math.sin(t * person.speed + person.phase) * person.amp;

      dummy.rotation.y = person.rotY;
      dummy.position.set(person.x, person.y + BODY_MID + bob, person.z);
      dummy.updateMatrix();
      bodies.setMatrixAt(i, dummy.matrix);

      dummy.position.y = person.y + HEAD_MID + bob;
      dummy.updateMatrix();
      heads.setMatrixAt(i, dummy.matrix);
    }
    bodies.instanceMatrix.needsUpdate = true;
    heads.instanceMatrix.needsUpdate = true;
  };

  // Seed the matrices so the first rendered frame is already in place.
  update(0);

  return {
    group,
    update,
    dispose: () => {
      bodyGeo.dispose();
      headGeo.dispose();
      crowdMat.dispose();
      standMat.dispose();
      for (const geo of standGeos) geo.dispose();
      bodies.dispose();
      heads.dispose();
    },
  };
}

export const COMIC_WORDS = ["POW!", "BAM!", "OOF!", "BONK!", "WHACK!", "KO!"];

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
