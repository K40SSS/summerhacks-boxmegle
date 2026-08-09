/**
 * Stamina: punch costs, the hard zero-stamina gate, the winded state, and the
 * two-tier recovery delay (0.5s normally, 1.2s after emptying the tank).
 *
 * Stamina gates output and never scales damage — every punch that is allowed
 * through lands at full power.
 */

import { describe, expect, it } from "vitest";
import { resolvePunch } from "./combat";
import { GAME_RULES, PUNCH_STATS } from "./rules";
import {
  canThrow,
  regenerateStamina,
  spendStamina,
  staminaRecoveryDelayMs,
} from "./stamina";

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

  it("makes spamming self-limiting: a full bar funds a flurry, then nothing", () => {
    // The failure mode stamina exists to prevent is a player who never stops
    // punching. The hard gate handles it without any damage tuning — the
    // flurry simply ends. (This is why there is no tired-punch multiplier to
    // balance against the attack cooldown.)
    for (const [type, stats] of Object.entries(PUNCH_STATS)) {
      let stamina: number = GAME_RULES.maxStamina;
      let thrown = 0;
      while (canThrow(stamina)) {
        stamina = spendStamina(stamina, type as keyof typeof PUNCH_STATS).stamina;
        thrown += 1;
      }
      expect(thrown, `${stats.label} flurry length`).toBe(
        Math.ceil(GAME_RULES.maxStamina / stats.staminaCost),
      );
      expect(canThrow(stamina), `${stats.label} must run dry`).toBe(false);
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

describe("canThrow", () => {
  it("gates on empty, not on affording the specific punch", () => {
    // Your last few points always buy one more punch, whatever it costs —
    // then you are locked out until the meter recovers.
    expect(canThrow(GAME_RULES.maxStamina)).toBe(true);
    expect(canThrow(1)).toBe(true);
    expect(canThrow(0)).toBe(false);
  });
});

describe("spendStamina", () => {
  it("deducts the punch's cost", () => {
    const out = spendStamina(100, "HOOK");
    expect(out.stamina).toBe(100 - PUNCH_STATS.HOOK.staminaCost);
    expect(out.winded).toBe(false);
  });

  it("spending exactly to zero is winded", () => {
    const out = spendStamina(PUNCH_STATS.JAB.staminaCost, "JAB");
    expect(out.stamina).toBe(0);
    expect(out.winded).toBe(true);
  });

  it("an expensive punch may overdraw to zero, and that is winded", () => {
    const out = spendStamina(5, "HOOK");
    expect(out.stamina).toBe(0);
    expect(out.winded).toBe(true);
  });

  it("an already-empty tank does not re-wind", () => {
    const out = spendStamina(0, "JAB");
    expect(out.stamina).toBe(0);
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

describe("the zero-stamina gate in resolution", () => {
  const openDefender = {
    health: 100,
    block: 100,
    blocking: false,
    stunned: false,
  };

  it("an empty attacker cannot throw — NO_STAMINA, nothing changes", () => {
    const out = resolvePunch("HOOK", "HEAD", openDefender, { stamina: 0 });
    expect(out.result).toBe("NO_STAMINA");
    expect(out.healthDamage).toBe(0);
    expect(out.guardDamage).toBe(0);
    expect(out.defenderHealthAfter).toBe(openDefender.health);
    expect(out.defenderBlockAfter).toBe(openDefender.block);
    expect(out.stunsDefender).toBe(false);
  });

  it("answers the punch rather than dropping it silently", () => {
    // The player physically threw it; a result the client must handle is the
    // whole point of NO_STAMINA existing as a PunchResult.
    const out = resolvePunch("JAB", "BODY", openDefender, { stamina: 0 });
    expect(out.result).toBeDefined();
    expect(out.result).not.toBe("MISS");
  });

  it("the gate outranks everything else — even a punch that would have missed", () => {
    const out = resolvePunch("JAB", null, openDefender, { stamina: 0 });
    expect(out.result).toBe("NO_STAMINA");
  });

  it("does not scale damage: one stamina point punches at full power", () => {
    const full = resolvePunch("HOOK", "BODY", openDefender, { stamina: 100 });
    const nearlyEmpty = resolvePunch("HOOK", "BODY", openDefender, { stamina: 1 });
    expect(nearlyEmpty.healthDamage).toBe(PUNCH_STATS.HOOK.healthDamage);
    expect(nearlyEmpty.healthDamage).toBe(full.healthDamage);
  });

  it("does not scale guard damage either", () => {
    const blocking = { ...openDefender, blocking: true };
    const full = resolvePunch("CROSS", "BODY", blocking, { stamina: 100 });
    const nearlyEmpty = resolvePunch("CROSS", "BODY", blocking, { stamina: 1 });
    expect(nearlyEmpty.guardDamage).toBe(PUNCH_STATS.CROSS.guardDamage);
    expect(nearlyEmpty.guardDamage).toBe(full.guardDamage);
  });

  it("omitting the attacker resolves ungated — for client-side prediction", () => {
    const out = resolvePunch("JAB", "BODY", openDefender);
    expect(out.result).toBe("HIT");
    expect(out.healthDamage).toBe(PUNCH_STATS.JAB.healthDamage);
  });
});
