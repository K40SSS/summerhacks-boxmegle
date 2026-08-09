# game-mechanics

Camera shadowboxing mechanics extracted from the SummerBox/ShadowDuel MVP.
Framework-free TypeScript: no React, no MediaPipe, no sockets — pure data in,
pure data out. Everything is unit-tested against synthetic fixtures.

## Architecture

Clients stream **pose landmarks**; the server owns everything else. The
detection pipeline and the resolution rules are both pure functions, so they
run wherever the pose stream is consumed — under the current architecture that
is the server, which classifies actions from the landmarks it receives:

```
raw pose landmarks (MediaPipe Pose, 33 points, unmirrored feed)
  → normalizeLandmarks()   body-relative anatomical frame
  → smoothPose()           EMA jitter filter (alpha 0.35)
  → extractFeatures()      velocities, joint angles, reach, wrist depth
  → PunchDetector          per-hand FSM → JAB / CROSS / HOOK / UPPERCUT
  → BlockDetector          both wrists near the head plane, hysteresis
  → DetectedAction events  (semantic — never damage numbers)

then, per punch:
  → hitboxTest()           did it land on the defender's body at all?
  → resolvePunch()         HIT / BLOCKED / GUARD_BREAK / MISS
```

A client may run the same pipeline locally for instant feedback, but only the
server's result is authoritative.

**Authoritative resolution** (pure, deterministic):

- `hitboxTest(impact, defenderPose)` → `"HEAD" | "BODY" | null`
- `resolvePunch(punchType, zone, defenderSnapshot, { stamina? })` → HIT /
  BLOCKED / GUARD_BREAK / MISS / NO_STAMINA with resulting health/guard
  values. Pass the attacker's stamina to enforce the gate; omit it for
  client-side prediction that only asks "would this have landed?"
- `canThrow(stamina)` / `spendStamina(stamina, punchType)` — every accepted
  punch spends stamina (jab 10 … uppercut 20 from a 100 pool). After each
  spend, restart the regen clock for `staminaRecoveryDelayMs(newValue)` —
  0.5s normally, **1.2s when the spend emptied the tank** (winded) — then
  `regenerateStamina` per tick (25/s; empty → full in ~5.2s worst case;
  steady sustainable pace ≈ 1.1 jabs/s or 0.8 hooks/s since each spend
  restarts the clock)
- `drainBlock` — passive guard drain; **draining to zero IS a guard break**
  (`guardBroke: true`): stun the defender, clear their blocking flag, credit
  the opponent a guardBreak
- `regenerateBlock` — guard regen; gate it: never while STUNNED, and the
  800ms delay clock restarts on every guard-damage application (stamina
  regen, by contrast, is gated only by its own spend clock)
- `decideWinner` — end-of-match decision cascade
- `PlayerState` / `initialPlayerState` — per-match player state; structurally a
  `DefenderSnapshot` plus identity and the running totals `decideWinner` reads
- `GAME_RULES`, `PUNCH_STATS`, `ZONE_MULTIPLIERS`, Elo helpers

### Damage by zone

A headshot deals **1.5×** its punch's health damage (`ZONE_MULTIPLIERS`):

| Punch | Body | Head |
|---|---|---|
| Jab | 4 | 6 |
| Cross | 6 | 9 |
| Hook | 8 | 12 |
| Uppercut | 9 | 13.5 |

The multiplier applies to **health damage only** — guard damage is unchanged,
so head-hunting does not break a guard any faster than body work, and
guard-break pacing stays exactly as tuned. `PunchOutcome.healthDamage` is
already scaled, so `damageDealt` accounting needs no extra multiplication.
Note an uppercut to the head deals a fractional 13.5; health is not an integer
in this system (the block meter is already fractional), so round only at the
UI if you want whole numbers.

## Stamina is a gate, not a damage modifier

Stamina never scales damage. Above zero every punch lands at full power; at
zero you cannot throw at all until the meter recovers. That makes the meter
self-enforcing — a spammer cannot out-damage a paced fighter because spamming
simply stops — so there is no tired-punch multiplier needing to be balanced
against the attack cooldown.

**A gated punch must never be silent.** The player physically threw it, so if
the server swallows it the game reads as frozen. That is why `NO_STAMINA` is a
`PunchResult` rather than the absence of one: the client is forced to handle it
and can show the fighter *why* nothing happened. Predict stamina client-side so
the gassed swing reads as gassed while the arm is still moving, and let the
server's value win on the next update.

## Evasion is geometry, not a claim

There is **no dodge action and no dodge state**. Evasion is not something a
defender's client asserts about itself ("I am dodging, my offset is X") — it is
computed by `hitboxTest` from the defender's own pose. A punch either lands
inside their head/torso hitbox or it finds air.

This removes a whole class of trust problems rather than mitigating them: there
is no claimed offset to clamp, no maximum hold duration to enforce, and no
start/end events whose timestamps could be replayed or stalled. Leaning
permanently is no longer an exploit worth capping — it is just standing
somewhere, and your opponent can aim at where you actually are.

**What counts as evasion:** `normalizeLandmarks` re-centres every frame on the
shoulder midpoint, so whole-body translation across the room is erased by
construction. Evasion is therefore head movement **relative to the shoulders** —
slipping and rolling, which is what boxing evasion actually is. Bending at the
waist to duck reads correctly; squatting straight down with a rigid torso does
not move you in this frame.

Hitboxes are deliberately generous (`DEFAULT_HITBOX_OPTIONS`): a miss caused by
pose jitter feels broken, whereas a forgiving hitbox just feels like boxing.
Tune those first if evasion feels too easy or too hard. Note the head ellipse
and torso box are sized to overlap — a gap between them puts a dead zone at the
neck where punches land on nothing.

## Coordinate convention (important)

The body frame is **+x = the player's anatomical right, +y = down** (head at
negative y), in shoulder-width units, and it assumes an **unmirrored** camera
feed of a player facing the camera. That frame is a *reflection* of image
space — `normalizeLandmarks` handles this deliberately. If you re-implement
any part of the pipeline, do not "simplify" the basis to a pure rotation: it
flips y for real feeds and silently inverts ducks, uppercuts and punch
heights. (Display mirroring is CSS-only and must never touch landmark data.)

Punch aim: `impactX = -attackerWrist.x` mirrors the attacker's endpoint into
the defender's frame, because the players virtually face each other. Both
arguments to `hitboxTest` are therefore already in the same space.

## Quick start

```ts
import {
  normalizeLandmarks, smoothPose, poseFromNormalized, extractFeatures,
  PunchDetector, BlockDetector, LM,
  hitboxTest, resolvePunch, clamp, GAME_RULES,
  spendStamina, staminaRecoveryDelayMs, regenerateStamina,
} from "game-mechanics";

// per pose frame
const normalized = normalizeLandmarks(rawLandmarks, timestamp);
if (normalized) {
  smoothed = smoothed ? smoothPose(smoothed, normalized.pose) : poseFromNormalized(normalized.pose);
  const features = extractFeatures(smoothed, prevFeatures);

  const actions = [
    ...punchDetector.update(features),
    ...blockDetector.update(features, smoothed.nose),
  ];
}

// on the server — sanitize client input first (never trust aim coordinates)
const clampAim = (v: number) => clamp(v, -2.5, 2.5);
const impact = { x: clampAim(punch.impactX ?? 0), y: clampAim(punch.impactY ?? -0.7) };

// the DEFENDER's latest normalized pose decides whether it connected
const zone = hitboxTest(impact, defenderPose);

// Resolve BEFORE spending — the gate reads the stamina the punch was thrown
// with. A NO_STAMINA result must still be sent to the client.
const outcome = resolvePunch(punch.punchType, zone, defenderSnapshot, {
  stamina: attacker.stamina,
});

// Only a punch that got through spends. Blocked and missed punches DO spend.
if (outcome.result !== "NO_STAMINA") {
  const spend = spendStamina(attacker.stamina, punch.punchType);
  attacker.stamina = spend.stamina;
  attacker.staminaRegenAt = now + staminaRecoveryDelayMs(spend.stamina);
}

// per tick: if (now >= attacker.staminaRegenAt)
//   attacker.stamina = regenerateStamina(attacker.stamina, dtMs);
```

Server rules the consumer owns (the reference implementation enforced these —
skipping any diverges from authoritative behavior):

- Clamp client-supplied impact to `[-2.5, 2.5]` and default a missing aim to
  `{ x: 0, y: -0.7 }` before hit-testing.
- On any guard break (`stunsDefender` / `guardBroke`): stun for
  `GAME_RULES.stunDurationMs`, clear the defender's blocking flag (a fresh
  block-start is required afterwards), credit the attacker/opponent one
  guardBreak, restart the regen delay clock.
- No guard regeneration while STUNNED; a broken guard exits stun at 0.
- Own the stamina meter per player: pass `{ stamina }` into `resolvePunch` so
  the gate is enforced, `spendStamina` on every punch that got through
  (blocked and missed punches still spend; a `NO_STAMINA` one does not),
  restart the regen clock with `staminaRecoveryDelayMs(after)` (0.5s, or 1.2s
  when the spend emptied the tank), and `regenerateStamina` per tick once the
  clock passes. Stamina regen is gated only by its spend clock — not by stun
  or blocking.
- **Always send a `NO_STAMINA` result to the client.** Dropping it silently is
  the one failure mode this design can produce, and it reads as a frozen game.
- Enforce punch cooldowns (`perHandCooldownMs`, `globalAttackCooldownMs`),
  event rate limits and sequence-number replay protection.
- Use the returned nominal `healthDamage` for damageDealt accounting (the
  reference counts overkill), and end blocks after ~250ms of pose loss.
- Hit-test against the defender's most recent pose. Attacker and defender
  streams arrive over independent connections, so their latencies differ —
  a hitbox test is more sensitive to that skew than a coarse held-state flag
  was. Lag compensation (buffering both streams and resolving on a common
  timeline) is the fix if it becomes noticeable.

`PunchOutcome.zone` reports where a punch connected, and `healthDamage` is
already scaled by `ZONE_MULTIPLIERS` — see the damage table above.

## Test

```
pnpm --filter game-mechanics test
pnpm --filter game-mechanics typecheck
```

Consumed as TypeScript source via the pnpm workspace (`game-mechanics`:
`workspace:*`). The detectors are classes with per-instance state — create
one set per tracked player and call `reset()` on match restarts.
