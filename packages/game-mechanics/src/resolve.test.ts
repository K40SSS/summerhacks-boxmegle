/**
 * applyPunch is where the reference server's written-down rules become code,
 * so these tests are mostly about the ones easiest to get wrong: what still
 * spends stamina, what a guard break costs each side, and that damageDealt
 * counts the nominal figure rather than the health actually removed.
 */

import { describe, expect, it } from "vitest";
import { applyPunch, MAX_IMPACT_REACH, type PunchAction } from "./resolve";
import { initialPlayerState, type PlayerState } from "./playerState";
import { GAME_RULES, PUNCH_STATS, ZONE_MULTIPLIERS } from "./rules";
import type { NormalizedPose } from "./types";

function fighter(overrides: Partial<PlayerState> = {}): PlayerState {
  return { ...initialPlayerState("p", 0, 0), ...overrides };
}

/** Square-on stance: head at (0, -0.55), torso box roughly y ∈ [-0.5, 1.5]. */
function pose(overrides: Partial<NormalizedPose> = {}): NormalizedPose {
  return {
    timestamp: 0,
    nose: { x: 0, y: -0.55, z: 0 },
    leftShoulder: { x: -0.5, y: 0, z: 0 },
    rightShoulder: { x: 0.5, y: 0, z: 0 },
    leftElbow: { x: -0.6, y: 0.35, z: 0 },
    rightElbow: { x: 0.6, y: 0.35, z: 0 },
    leftWrist: { x: -0.28, y: -0.35, z: 0 },
    rightWrist: { x: 0.28, y: -0.35, z: 0 },
    leftHip: { x: -0.35, y: 1.4, z: 0 },
    rightHip: { x: 0.35, y: 1.4, z: 0 },
    confidence: 0.95,
    shoulderWidthImage: 0.2,
    ...overrides,
  };
}

function punch(overrides: Partial<PunchAction> = {}): PunchAction {
  return {
    type: "PUNCH",
    punchType: "JAB",
    hand: "RIGHT",
    confidence: 0.9,
    impactX: 0,
    impactY: -0.55, // on the nose
    timestamp: 0,
    ...overrides,
  };
}

const HEAD_AIM = { impactX: 0, impactY: -0.55 };
const BODY_AIM = { impactX: 0, impactY: 0.8 };
const AIR_AIM = { impactX: 2.0, impactY: 0 };

describe("applyPunch — landing", () => {
  it("lands on the head for zone-scaled damage", () => {
    const a = fighter();
    const b = fighter({ userUuid: "q", slot: 1 });
    const result = applyPunch(a, b, pose(), punch(HEAD_AIM), 1000);

    const expected = PUNCH_STATS.JAB.healthDamage * ZONE_MULTIPLIERS.HEAD;
    expect(result.outcome.result).toBe("HIT");
    expect(result.outcome.zone).toBe("HEAD");
    expect(b.health).toBeCloseTo(GAME_RULES.maxHealth - expected, 6);
    expect(a.damageDealt).toBeCloseTo(expected, 6);
  });

  it("lands on the body unscaled", () => {
    const a = fighter();
    const b = fighter({ userUuid: "q", slot: 1 });
    applyPunch(a, b, pose(), punch(BODY_AIM), 1000);

    expect(b.health).toBeCloseTo(GAME_RULES.maxHealth - PUNCH_STATS.JAB.healthDamage, 6);
  });

  it("counts overkill toward damageDealt, not just the health removed", () => {
    const a = fighter();
    const b = fighter({ userUuid: "q", slot: 1, health: 2 });
    applyPunch(a, b, pose(), punch({ ...HEAD_AIM, punchType: "HOOK" }), 1000);

    const nominal = PUNCH_STATS.HOOK.healthDamage * ZONE_MULTIPLIERS.HEAD;
    expect(b.health).toBe(0);
    expect(a.damageDealt).toBeCloseTo(nominal, 6);
    expect(a.damageDealt).toBeGreaterThan(2);
  });
});

describe("applyPunch — evasion", () => {
  it("misses when the endpoint finds air", () => {
    const a = fighter();
    const b = fighter({ userUuid: "q", slot: 1 });
    const result = applyPunch(a, b, pose(), punch(AIR_AIM), 1000);

    expect(result.outcome.result).toBe("MISS");
    expect(b.health).toBe(GAME_RULES.maxHealth);
  });

  it("misses when the defender has no pose at all", () => {
    const a = fighter();
    const b = fighter({ userUuid: "q", slot: 1 });
    const result = applyPunch(a, b, null, punch(HEAD_AIM), 1000);

    expect(result.outcome.result).toBe("MISS");
    expect(b.health).toBe(GAME_RULES.maxHealth);
  });

  it("a slipped head is missable even at point-blank aim", () => {
    const a = fighter();
    const b = fighter({ userUuid: "q", slot: 1 });
    // Defender rolled their head well off the centre line.
    const slipped = pose({ nose: { x: 1.4, y: -0.5, z: 0 } });
    const result = applyPunch(a, b, slipped, punch(HEAD_AIM), 1000);

    expect(result.outcome.result).toBe("MISS");
  });

  it("still spends stamina on a miss", () => {
    const a = fighter();
    const b = fighter({ userUuid: "q", slot: 1 });
    applyPunch(a, b, pose(), punch(AIR_AIM), 1000);

    expect(a.stamina).toBe(GAME_RULES.maxStamina - PUNCH_STATS.JAB.staminaCost);
  });
});

describe("applyPunch — guard", () => {
  it("blocked punches eat the guard, not the health", () => {
    const a = fighter();
    const b = fighter({ userUuid: "q", slot: 1, blocking: true });
    const result = applyPunch(a, b, pose(), punch(HEAD_AIM), 1000);

    expect(result.outcome.result).toBe("BLOCKED");
    expect(b.health).toBe(GAME_RULES.maxHealth);
    expect(b.block).toBeCloseTo(GAME_RULES.maxBlock - PUNCH_STATS.JAB.guardDamage, 6);
  });

  it("guard damage restarts the regen delay", () => {
    const a = fighter();
    const b = fighter({ userUuid: "q", slot: 1, blocking: true });
    applyPunch(a, b, pose(), punch(HEAD_AIM), 1000);

    expect(b.blockRegenAt).toBe(1000 + GAME_RULES.blockRegenerationDelayMs);
  });

  it("breaking the guard stuns, clears blocking, and credits the attacker", () => {
    const a = fighter();
    const b = fighter({ userUuid: "q", slot: 1, blocking: true, block: 4 });
    const result = applyPunch(a, b, pose(), punch(HEAD_AIM), 1000);

    expect(result.outcome.result).toBe("GUARD_BREAK");
    expect(b.block).toBe(0);
    expect(b.blocking).toBe(false);
    expect(b.stunned).toBe(true);
    expect(b.stunnedUntil).toBe(1000 + GAME_RULES.stunDurationMs);
    expect(a.guardBreaks).toBe(1);
    // The break itself is the opening — it deals no health damage.
    expect(b.health).toBe(GAME_RULES.maxHealth);
    expect(a.damageDealt).toBe(0);
  });

  it("a stunned defender cannot block, so the punch lands clean", () => {
    const a = fighter();
    const b = fighter({ userUuid: "q", slot: 1, blocking: true, stunned: true, stunnedUntil: 5000 });
    const result = applyPunch(a, b, pose(), punch(HEAD_AIM), 1000);

    expect(result.outcome.result).toBe("HIT");
    expect(b.health).toBeLessThan(GAME_RULES.maxHealth);
  });
});

describe("applyPunch — stamina", () => {
  it("gates an empty attacker and changes nothing", () => {
    const a = fighter({ stamina: 0, staminaRegenAt: 9999 });
    const b = fighter({ userUuid: "q", slot: 1 });
    const result = applyPunch(a, b, pose(), punch(HEAD_AIM), 1000);

    expect(result.outcome.result).toBe("NO_STAMINA");
    expect(result.spent).toBe(false);
    expect(b.health).toBe(GAME_RULES.maxHealth);
    expect(a.stamina).toBe(0);
    expect(a.staminaRegenAt).toBe(9999); // clock untouched — no spend happened
  });

  it("resolves against the meter the punch was thrown with", () => {
    // Exactly enough for the punch to be legal; it must not gate itself.
    const a = fighter({ stamina: 1 });
    const b = fighter({ userUuid: "q", slot: 1 });
    const result = applyPunch(a, b, pose(), punch(HEAD_AIM), 1000);

    expect(result.outcome.result).toBe("HIT");
    expect(a.stamina).toBe(0);
  });

  it("uses the winded delay when the spend empties the tank", () => {
    const a = fighter({ stamina: 1 });
    const b = fighter({ userUuid: "q", slot: 1 });
    applyPunch(a, b, pose(), punch(HEAD_AIM), 1000);

    expect(a.staminaRegenAt).toBe(1000 + GAME_RULES.staminaWindedDelayMs);
  });

  it("uses the normal delay otherwise", () => {
    const a = fighter();
    const b = fighter({ userUuid: "q", slot: 1 });
    applyPunch(a, b, pose(), punch(HEAD_AIM), 1000);

    expect(a.staminaRegenAt).toBe(1000 + GAME_RULES.staminaRegenDelayMs);
  });

  it("charges the punch's own cost", () => {
    const a = fighter();
    const b = fighter({ userUuid: "q", slot: 1 });
    applyPunch(a, b, pose(), punch({ ...HEAD_AIM, punchType: "UPPERCUT" }), 1000);

    expect(a.stamina).toBe(GAME_RULES.maxStamina - PUNCH_STATS.UPPERCUT.staminaCost);
  });
});

describe("applyPunch — aim sanitizing", () => {
  it("clamps an out-of-range endpoint instead of hit-testing it", () => {
    const a = fighter();
    const b = fighter({ userUuid: "q", slot: 1 });
    const result = applyPunch(a, b, pose(), punch({ impactX: 999, impactY: -0.55 }), 1000);

    expect(result.impact.x).toBe(MAX_IMPACT_REACH);
    expect(result.outcome.result).toBe("MISS");
  });

  it("falls back to chest height for a non-finite aim", () => {
    const a = fighter();
    const b = fighter({ userUuid: "q", slot: 1 });
    const result = applyPunch(a, b, pose(), punch({ impactX: NaN, impactY: NaN }), 1000);

    expect(result.impact).toEqual({ x: 0, y: -0.7 });
    // Chest height on a square stance is inside the head ellipse's lower half.
    expect(result.outcome.result).toBe("HIT");
  });
});
