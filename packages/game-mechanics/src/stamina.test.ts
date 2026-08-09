/**
 * Stamina: punch costs, the tired/winded states, and the two-tier recovery
 * delay (0.5s normally, 1.2s after emptying the tank).
 */

import { describe, expect, it } from "vitest";
import { resolvePunch } from "./combat";
import { GAME_RULES, PUNCH_STATS, tiredDamage } from "./rules";
import { regenerateStamina, spendStamina, staminaRecoveryDelayMs } from "./stamina";

describe("stamina costs", () => {
  it("scale with punch weight: jab < cross < hook < uppercut", () => {
    expect(PUNCH_STATS.JAB.staminaCost).toBeLessThan(PUNCH_STATS.CROSS.staminaCost);
    expect(PUNCH_STATS.CROSS.staminaCost).toBeLessThan(PUNCH_STATS.HOOK.staminaCost);
    expect(PUNCH_STATS.HOOK.staminaCost).toBeLessThan(PUNCH_STATS.UPPERCUT.staminaCost);
  });

  it("keeps a steady punch rhythm sustainable despite the regen-delay restart", () => {
    // Each spend restarts the regen clock, so a punch every T seconds nets
    // regen × (T − delay) − cost. Break-even rate = regen / (cost + regen × delay).
    const sustainableRate = (cost: number) =>
      GAME_RULES.staminaRegenPerSecond /
      (cost + (GAME_RULES.staminaRegenPerSecond * GAME_RULES.staminaRegenDelayMs) / 1000);

    const jabsPerSecond = sustainableRate(PUNCH_STATS.JAB.staminaCost);
    const hooksPerSecond = sustainableRate(PUNCH_STATS.HOOK.staminaCost);
    expect(jabsPerSecond).toBeGreaterThanOrEqual(0.9);
    expect(jabsPerSecond).toBeLessThanOrEqual(1.8);
    expect(hooksPerSecond).toBeGreaterThanOrEqual(0.6);
    expect(hooksPerSecond).toBeLessThanOrEqual(1.2);
  });

  it("makes pacing out-damage permanent flailing, for every punch type", () => {
    // The failure mode stamina exists to prevent: a player who never stops
    // punching sits at zero and throws tired punches at the cooldown ceiling
    // forever. That must not out-damage a player who paces at the
    // sustainable rate, or the whole meter is a decoration to be ignored.
    const spamPerSecond = 1000 / GAME_RULES.globalAttackCooldownMs;

    for (const stats of Object.values(PUNCH_STATS)) {
      const pacedRate =
        GAME_RULES.staminaRegenPerSecond /
        (stats.staminaCost +
          (GAME_RULES.staminaRegenPerSecond * GAME_RULES.staminaRegenDelayMs) / 1000);
      const pacedDps = pacedRate * stats.healthDamage;
      const flailDps = spamPerSecond * tiredDamage(stats.healthDamage);
      expect(flailDps, `${stats.label} flailing must not beat pacing`).toBeLessThan(
        pacedDps,
      );
    }
  });

  it("recovers an empty tank in a beat, not an era", () => {
    const emptyToFullMs =
      GAME_RULES.staminaWindedDelayMs +
      (GAME_RULES.maxStamina / GAME_RULES.staminaRegenPerSecond) * 1000;
    expect(emptyToFullMs).toBeLessThanOrEqual(7000);
    expect(emptyToFullMs).toBeGreaterThanOrEqual(3000);
  });
});

describe("spendStamina", () => {
  it("deducts the punch's cost at full power", () => {
    const out = spendStamina(100, "HOOK");
    expect(out.stamina).toBe(100 - PUNCH_STATS.HOOK.staminaCost);
    expect(out.tired).toBe(false);
    expect(out.winded).toBe(false);
  });

  it("spending exactly to zero is winded but not tired", () => {
    const out = spendStamina(PUNCH_STATS.JAB.staminaCost, "JAB");
    expect(out.stamina).toBe(0);
    expect(out.tired).toBe(false);
    expect(out.winded).toBe(true);
  });

  it("an unaffordable punch is tired, floors at zero, and is winded", () => {
    const out = spendStamina(5, "HOOK");
    expect(out.stamina).toBe(0);
    expect(out.tired).toBe(true);
    expect(out.winded).toBe(true);
  });

  it("punching on an already-empty tank stays tired but does not re-wind", () => {
    const out = spendStamina(0, "JAB");
    expect(out.stamina).toBe(0);
    expect(out.tired).toBe(true);
    expect(out.winded).toBe(false);
  });
});

describe("recovery", () => {
  it("takes longer to start when the tank is empty", () => {
    expect(staminaRecoveryDelayMs(0)).toBe(GAME_RULES.staminaWindedDelayMs);
    expect(staminaRecoveryDelayMs(1)).toBe(GAME_RULES.staminaRegenDelayMs);
    expect(staminaRecoveryDelayMs(0)).toBeGreaterThan(staminaRecoveryDelayMs(50));
  });

  it("regenerates at staminaRegenPerSecond and clamps at max", () => {
    expect(regenerateStamina(50, 1000)).toBe(50 + GAME_RULES.staminaRegenPerSecond);
    expect(regenerateStamina(95, 1000)).toBe(GAME_RULES.maxStamina);
  });
});

describe("tired punches in resolution", () => {
  const openDefender = {
    health: 100,
    block: 100,
    blocking: false,
    stunned: false,
    dodging: false,
    dodgeOffsetX: 0,
    dodgeOffsetY: 0,
  };

  it("land as taps on health", () => {
    const out = resolvePunch("HOOK", { x: 0, y: -0.7 }, openDefender, { tired: true });
    expect(out.result).toBe("HIT");
    expect(out.healthDamage).toBe(tiredDamage(PUNCH_STATS.HOOK.healthDamage));
    expect(out.healthDamage).toBeLessThan(PUNCH_STATS.HOOK.healthDamage);
  });

  it("still count for at least 1 damage — the player really swung", () => {
    for (const type of ["JAB", "CROSS", "HOOK", "UPPERCUT"] as const) {
      const out = resolvePunch(type, { x: 0, y: -0.7 }, openDefender, { tired: true });
      expect(out.healthDamage).toBeGreaterThanOrEqual(1);
    }
  });

  it("chip the guard, but barely", () => {
    const out = resolvePunch(
      "CROSS",
      { x: 0, y: -0.7 },
      { ...openDefender, blocking: true },
      { tired: true },
    );
    expect(out.result).toBe("BLOCKED");
    expect(out.guardDamage).toBe(tiredDamage(PUNCH_STATS.CROSS.guardDamage));
    expect(out.guardDamage).toBeGreaterThanOrEqual(1);
  });

  it("a rested attacker is unaffected by the optional parameter", () => {
    const out = resolvePunch("JAB", { x: 0, y: -0.7 }, openDefender, { tired: false });
    expect(out.healthDamage).toBe(PUNCH_STATS.JAB.healthDamage);
  });
});
