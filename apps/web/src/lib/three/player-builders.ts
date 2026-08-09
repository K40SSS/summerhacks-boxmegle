import * as THREE from "three";

/**
 * SUPERHOT-style player model: a faceted low-poly humanoid in translucent
 * crystal red, flat-shaded with dark edge lines so every facet reads against
 * the white arena.
 *
 * Built as a container like buildRing() — `scene.add(buildFighter())` — but
 * the returned group also carries `.joints`, a rig of empty pivots named
 * after the NormalizedPose fields in `game-mechanics` (leftShoulder,
 * rightElbow, …) so the fight page and the replay page can drive the same
 * model from tracked landmarks.
 *
 * The fighter faces +Z with feet on y = 0. Because it faces the viewer, its
 * anatomical RIGHT is at -X (same reflection the mechanics package warns
 * about) — SIDE below is the only place that convention is written down.
 */

const SIDE = { left: 1, right: -1 } as const;

export type FighterStance = "orthodox" | "southpaw";

export interface FighterOptions {
  stance?: FighterStance;
  /** Body colour — SUPERHOT red by default; tint the opponent to tell them apart. */
  color?: number;
}

/** Pivot groups. Rotate these; never rotate the meshes hanging off them. */
export interface FighterJoints {
  /** Whole body above the floor — carries the bladed stance and the bob. */
  body: THREE.Group;
  hips: THREE.Group;
  /** Torso pivot at the waist: lean and rotate the upper body here. */
  chest: THREE.Group;
  head: THREE.Group;
  /** Arm swing: rotate .x to throw. */
  leftShoulder: THREE.Group;
  /** Humeral twist: .y rolls the glove in toward the chin or out to punch. */
  leftShoulderRoll: THREE.Group;
  leftElbow: THREE.Group;
  leftFist: THREE.Group;
  rightShoulder: THREE.Group;
  rightShoulderRoll: THREE.Group;
  rightElbow: THREE.Group;
  rightFist: THREE.Group;
  leftHip: THREE.Group;
  leftKnee: THREE.Group;
  rightHip: THREE.Group;
  rightKnee: THREE.Group;
}

export type Fighter = THREE.Group & {
  joints: FighterJoints;
  stance: FighterStance;
};

/** Neutral guard pose, in radians. poseFighterIdle animates around these. */
const GUARD = {
  blade: 0.42,
  /** Elbows squeezed toward the ribs. */
  shoulderAbduct: 0.1,
  /** Elbows carried forward, peek-a-boo style — the only way the forearm
   *  can bring a glove up to cheek height from a shoulder this low. */
  shoulderPitch: -0.6,
  /** Humeral twist: rolls the folded forearm in toward the centre line so
   *  the gloves sit in front of the chin instead of out beside the ears. */
  shoulderRoll: -0.6,
  elbowFold: -2.3,
};

type Kit = {
  body: THREE.MeshStandardMaterial;
  glove: THREE.MeshStandardMaterial;
  edge: THREE.LineBasicMaterial;
};

function makeKit(color: number): Kit {
  return {
    body: new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.22,
      roughness: 0.28,
      metalness: 0.05,
      transparent: true,
      opacity: 0.92,
      flatShading: true,
    }),
    glove: new THREE.MeshStandardMaterial({
      color: 0xff5460,
      emissive: 0xff2233,
      emissiveIntensity: 0.35,
      roughness: 0.2,
      flatShading: true,
    }),
    edge: new THREE.LineBasicMaterial({
      color: 0x5c0710,
      transparent: true,
      opacity: 0.55,
    }),
  };
}

/** A mesh plus its facet wireframe, so the low-poly cuts stay readable. */
function shard(geo: THREE.BufferGeometry, mat: THREE.Material, kit: Kit): THREE.Group {
  const group = new THREE.Group();
  group.add(new THREE.Mesh(geo, mat));
  group.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), kit.edge));
  return group;
}

/**
 * Hang a tapered limb segment along -Y from `pivot` and return the pivot at
 * its far end (elbow, knee, ankle).
 */
function segment(
  pivot: THREE.Group,
  length: number,
  top: number,
  bottom: number,
  kit: Kit,
): THREE.Group {
  const piece = shard(new THREE.CylinderGeometry(top, bottom, length, 5), kit.body, kit);
  piece.position.y = -length / 2;
  pivot.add(piece);

  const end = new THREE.Group();
  end.position.y = -length;
  pivot.add(end);
  return end;
}

// A stance flips which side leads, never which side a limb is on: `side`
// stays anatomical, only the blade and the lead foot swap.
//
// One axis per pivot, nested. Stacking two axes on one Euler makes the limb
// sweep a cone instead of doing what each angle reads like it does.
function buildArm(
  chest: THREE.Group,
  side: number,
  kit: Kit,
): [THREE.Group, THREE.Group, THREE.Group, THREE.Group] {
  const socket = new THREE.Group();
  socket.position.set(side * 0.26, 0.46, 0);
  socket.rotation.z = side * -GUARD.shoulderAbduct;
  chest.add(socket);

  // Deltoid sunk into the shoulder so the arm flows out of the torso
  // instead of hanging off a floating ball.
  const deltoid = shard(new THREE.OctahedronGeometry(0.105, 0), kit.body, kit);
  deltoid.scale.set(0.9, 0.75, 0.8);
  deltoid.position.set(side * -0.02, -0.02, 0);
  socket.add(deltoid);

  const shoulder = new THREE.Group();
  shoulder.rotation.x = GUARD.shoulderPitch;
  socket.add(shoulder);

  const roll = new THREE.Group();
  roll.rotation.y = side * GUARD.shoulderRoll;
  shoulder.add(roll);

  const elbow = segment(roll, 0.3, 0.09, 0.055, kit);
  elbow.rotation.x = GUARD.elbowFold;

  const wrist = segment(elbow, 0.27, 0.055, 0.05, kit);

  const fist = new THREE.Group();
  fist.position.y = -0.05;
  wrist.add(fist);
  const glove = shard(new THREE.IcosahedronGeometry(0.095, 0), kit.glove, kit);
  glove.scale.set(1, 1.05, 1.1);
  fist.add(glove);

  return [shoulder, roll, elbow, fist];
}

function buildLeg(
  body: THREE.Group,
  side: number,
  lead: boolean,
  kit: Kit,
): [THREE.Group, THREE.Group] {
  const hip = new THREE.Group();
  hip.position.set(side * 0.115, 0.88, lead ? 0.1 : -0.1);
  hip.rotation.x = lead ? -0.24 : 0.3;
  body.add(hip);

  const knee = segment(hip, 0.42, 0.1, 0.07, kit);
  knee.rotation.x = lead ? 0.46 : -0.5;

  const ankle = segment(knee, 0.4, 0.07, 0.055, kit);

  const foot = shard(new THREE.BoxGeometry(0.13, 0.06, 0.26), kit.body, kit);
  foot.position.set(0, -0.02, 0.06);
  // Rear foot rolls onto the ball of the foot, the way a boxer's does.
  foot.rotation.x = lead ? 0.06 : -0.26;
  ankle.add(foot);

  return [hip, knee];
}

export function buildFighter(options: FighterOptions = {}): Fighter {
  const stance = options.stance ?? "orthodox";
  const mirror = stance === "orthodox" ? 1 : -1;
  const kit = makeKit(options.color ?? 0xe01834);

  const root = new THREE.Group() as Fighter;
  root.name = "fighter";

  const body = new THREE.Group();
  body.rotation.y = -GUARD.blade * mirror;
  root.add(body);

  const hips = new THREE.Group();
  hips.position.y = 0.82;
  body.add(hips);
  const pelvis = shard(new THREE.CylinderGeometry(0.18, 0.15, 0.2, 6), kit.body, kit);
  pelvis.position.y = 0.06;
  pelvis.rotation.y = Math.PI / 6;
  pelvis.scale.z = 0.75;
  hips.add(pelvis);

  const chest = new THREE.Group();
  chest.position.y = 0.16;
  hips.add(chest);
  // A wedge, not a barrel: broad across the shoulders, cut in at the waist.
  const ribs = shard(new THREE.CylinderGeometry(0.27, 0.16, 0.5, 6), kit.body, kit);
  ribs.position.y = 0.25;
  ribs.rotation.y = Math.PI / 6;
  ribs.scale.z = 0.62;
  chest.add(ribs);

  const neck = shard(new THREE.CylinderGeometry(0.06, 0.08, 0.07, 5), kit.body, kit);
  neck.position.y = 0.51;
  chest.add(neck);

  const head = new THREE.Group();
  head.position.y = 0.53;
  head.rotation.y = GUARD.blade * mirror * 0.55;
  chest.add(head);
  const skull = shard(new THREE.IcosahedronGeometry(0.145, 0), kit.body, kit);
  skull.position.y = 0.12;
  skull.scale.set(1, 1.1, 0.9);
  head.add(skull);

  const [leftShoulder, leftShoulderRoll, leftElbow, leftFist] = buildArm(
    chest,
    SIDE.left,
    kit,
  );
  const [rightShoulder, rightShoulderRoll, rightElbow, rightFist] = buildArm(
    chest,
    SIDE.right,
    kit,
  );
  const [leftHip, leftKnee] = buildLeg(body, SIDE.left, stance === "orthodox", kit);
  const [rightHip, rightKnee] = buildLeg(body, SIDE.right, stance === "southpaw", kit);

  // Drop the whole body so the feet rest on y = 0 whatever the stance tuning.
  root.updateMatrixWorld(true);
  body.position.y -= new THREE.Box3().setFromObject(root).min.y;
  body.userData.baseY = body.position.y;

  root.stance = stance;
  root.joints = {
    body,
    hips,
    chest,
    head,
    leftShoulder,
    leftShoulderRoll,
    leftElbow,
    leftFist,
    rightShoulder,
    rightShoulderRoll,
    rightElbow,
    rightFist,
    leftHip,
    leftKnee,
    rightHip,
    rightKnee,
  };
  return root;
}

const ease = (u: number) => u * u * (3 - 2 * u);

/**
 * Shadowboxing idle: bob, guard sway, and a straight punch every few
 * seconds, alternating between the lead jab and the rear cross.
 * Call once per frame with seconds since the scene started.
 */
export function poseFighterIdle(fighter: Fighter, t: number): void {
  const j = fighter.joints;
  const mirror = fighter.stance === "orthodox" ? 1 : -1;
  const lead = fighter.stance === "orthodox" ? "left" : "right";
  const leadSide = SIDE[lead];
  const leadShoulder = lead === "left" ? j.leftShoulder : j.rightShoulder;
  const leadRoll = lead === "left" ? j.leftShoulderRoll : j.rightShoulderRoll;
  const leadElbow = lead === "left" ? j.leftElbow : j.rightElbow;
  const rearShoulder = lead === "left" ? j.rightShoulder : j.leftShoulder;
  const rearRoll = lead === "left" ? j.rightShoulderRoll : j.leftShoulderRoll;
  const rearElbow = lead === "left" ? j.rightElbow : j.leftElbow;

  const bounce = Math.sin(t * 2.6);
  j.body.position.y = (j.body.userData.baseY as number) + bounce * 0.022;
  j.body.rotation.y = -GUARD.blade * mirror + Math.sin(t * 1.1) * 0.09;
  j.chest.rotation.x = Math.sin(t * 2.6 + 0.4) * 0.03;
  j.head.rotation.x = bounce * -0.04;

  // Hands float in the guard, a beat behind the feet.
  leadShoulder.rotation.x = GUARD.shoulderPitch + Math.sin(t * 2.6 - 0.5) * 0.06;
  rearShoulder.rotation.x = GUARD.shoulderPitch + Math.sin(t * 2.6 - 0.9) * 0.05;
  leadElbow.rotation.x = GUARD.elbowFold + Math.sin(t * 2.6 - 0.3) * 0.05;
  leadRoll.rotation.y = leadSide * GUARD.shoulderRoll;

  // Punch on a 3.2s cycle: snap out over a quarter of a second, drift back.
  // Odd cycles throw the lead jab; even cycles the rear cross.
  const cycle = Math.floor(t / 3.2);
  const phase = (t % 3.2) / 3.2;
  const punch =
    phase < 0.08 ? ease(phase / 0.08) : phase < 0.34 ? 1 - ease((phase - 0.08) / 0.26) : 0;
  if (punch > 0) {
    const isLead = cycle % 2 === 0;
    const shoulder = isLead ? leadShoulder : rearShoulder;
    const elbow = isLead ? leadElbow : rearElbow;
    const roll = isLead ? leadRoll : rearRoll;
    const side = isLead ? leadSide : -leadSide;
    shoulder.rotation.x = GUARD.shoulderPitch - punch * 0.72;
    elbow.rotation.x = GUARD.elbowFold * (1 - punch * 0.94);
    // Unwind the inward roll, or the punch curls across the body.
    roll.rotation.y = side * GUARD.shoulderRoll * (1 - punch);
    // The rear cross digs in with the hips; the lead jab just tags.
    j.body.rotation.y -= mirror * punch * (isLead ? 0.22 : 0.4);
    j.chest.rotation.x -= punch * 0.06;
  }
}
