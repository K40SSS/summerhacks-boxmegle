# game-mechanics

Camera shadowboxing mechanics extracted from the SummerBox/ShadowDuel MVP.
Framework-free TypeScript: no React, no MediaPipe, no sockets — pure data in,
pure data out. Everything is unit-tested against synthetic fixtures.

## What's inside

**Client-side detection pipeline** (runs per camera frame, e.g. in a worker):

```
raw pose landmarks (MediaPipe Pose, 33 points, unmirrored feed)
  → normalizeLandmarks()   body-relative anatomical frame
  → smoothPose()           EMA jitter filter (alpha 0.35)
  → extractFeatures()      velocities, joint angles, reach, wrist depth
  → PunchDetector          per-hand FSM → JAB / CROSS / HOOK / UPPERCUT
  → BlockDetector          both wrists near the head plane, hysteresis
  → DodgeDetector          whole-body slip/duck vs a slow neutral anchor
  → DetectedAction events
```

**Server-side authoritative resolution** (pure, deterministic):

- `resolvePunch(punchType, impact, defenderSnapshot, { tired? })` → HIT /
  BLOCKED / GUARD_BREAK / MISS with resulting health/guard values; a tired
  attacker's punch is reduced to `tiredDamage(...)`
- `spendStamina(stamina, punchType)` — every accepted punch spends stamina
  (jab 10 … uppercut 20 from a 100 pool). Punches are NEVER rejected for
  low stamina: `tired: true` means the punch lands as a tap instead. That
  tap is deliberately weak (20%, floored, minimum 1) — a gassed player can
  punch at the 4/s cooldown ceiling forever while a paced one is capped
  near 1/s, so anything more generous makes ignoring stamina optimal.
  After each spend, restart the regen clock for
  `staminaRecoveryDelayMs(newValue)` — 0.5s normally, **1.2s when the spend
  emptied the tank** (winded) — then `regenerateStamina` per tick (25/s;
  empty → full in ~5.2s worst case; steady sustainable pace ≈ 1.1 jabs/s
  or 0.8 hooks/s since each spend restarts the clock)
- `drainBlock` — passive guard drain; **draining to zero IS a guard break**
  (`guardBroke: true`): stun the defender, clear their blocking/dodging
  flags, credit the opponent a guardBreak
- `regenerateBlock` — guard regen; gate it: never while STUNNED, and the
  800ms delay clock restarts on every guard-damage application (stamina
  regen, by contrast, is gated only by its own spend clock)
- `decideWinner` — end-of-match decision cascade
- `GAME_RULES`, `PUNCH_STATS`, `punchMisses`, Elo helpers

Clients emit semantic actions and **never** damage numbers; the server calls
`resolvePunch` so both sides can never disagree about outcomes.

## Coordinate convention (important)

The body frame is **+x = the player's anatomical right, +y = down** (head at
negative y), in shoulder-width units, and it assumes an **unmirrored** camera
feed of a player facing the camera. That frame is a *reflection* of image
space — `normalizeLandmarks` handles this deliberately. If you re-implement
any part of the pipeline, do not "simplify" the basis to a pure rotation: it
flips y for real feeds and silently inverts ducks, uppercuts and punch
heights. (Display mirroring is CSS-only and must never touch landmark data.)

Punch aim: `impactX = -attackerWrist.x` mirrors the attacker's endpoint into
the defender's frame, because the players virtually face each other.

## Quick start

```ts
import {
  normalizeLandmarks, smoothPose, poseFromNormalized, extractFeatures,
  PunchDetector, BlockDetector, DodgeDetector, LM,
  resolvePunch, spendStamina, staminaRecoveryDelayMs, regenerateStamina,
  GAME_RULES,
} from "game-mechanics";

// per frame, client side
const normalized = normalizeLandmarks(rawLandmarks, timestamp);
if (normalized) {
  smoothed = smoothed ? smoothPose(smoothed, normalized.pose) : poseFromNormalized(normalized.pose);
  const features = extractFeatures(smoothed, prevFeatures);

  // Dodge input is the RAW image-space shoulder midpoint — normalization
  // recenters on the shoulders, which erases exactly the whole-body motion
  // the dodge detector measures. Never feed it normalized points.
  const rawMidX = (rawLandmarks[LM.LEFT_SHOULDER].x + rawLandmarks[LM.RIGHT_SHOULDER].x) / 2;
  const rawMidY = (rawLandmarks[LM.LEFT_SHOULDER].y + rawLandmarks[LM.RIGHT_SHOULDER].y) / 2;

  const actions = [
    ...punchDetector.update(features),
    ...blockDetector.update(features, smoothed.nose),
    ...dodgeDetector.update(rawMidX, rawMidY, normalized.pose.shoulderWidthImage, timestamp, features.confidence),
  ];
  // send actions to the server
}

// on the server — sanitize client input first (never trust aim coordinates)
const impact = {
  x: clampAim(punch.impactX ?? 0),
  y: clampAim(punch.impactY ?? -0.7),
}; // clampAim = clamp(v, -2.5, 2.5); clamp dodge offsets the same way at dodge-start

// Every ACCEPTED punch spends stamina — even ones that end up BLOCKED or
// MISS — and its tired flag scales THIS punch's damage.
const spend = spendStamina(attacker.stamina, punch.punchType);
attacker.stamina = spend.stamina;
attacker.staminaRegenAt = now + staminaRecoveryDelayMs(spend.stamina);

const outcome = resolvePunch(punch.punchType, impact, defenderSnapshot, { tired: spend.tired });

// per tick: if (now >= attacker.staminaRegenAt)
//   attacker.stamina = regenerateStamina(attacker.stamina, dtMs);
```

Server rules the consumer owns (the reference implementation enforced all of
these — skipping any diverges from authoritative behavior):

- Clamp client-supplied impact and dodge offsets to `[-2.5, 2.5]` and default
  missing aim to `{ x: 0, y: -0.7 }` before resolution.
- On any guard break (`stunsDefender` / `guardBroke`): stun for
  `GAME_RULES.stunDurationMs`, clear the defender's blocking AND dodging
  flags (they must send fresh block-start/dodge-start afterwards), credit
  the attacker/opponent one guardBreak, restart the regen delay clock.
- No guard regeneration while STUNNED; a broken guard exits stun at 0.
- Own the stamina meter per player: `spendStamina` on every accepted punch
  (blocked and missed punches still spend), thread `tired` into the same
  punch's `resolvePunch`, restart the regen clock with
  `staminaRecoveryDelayMs(after)` (0.5s, or 1.2s when the spend emptied the
  tank), and `regenerateStamina` per tick once the clock passes. Stamina
  regen is gated only by its spend clock — not by stun or blocking.
- Enforce `GAME_RULES.dodgeMaxHoldMs` server-side (clients can lie), punch
  cooldowns (`perHandCooldownMs`, `globalAttackCooldownMs`), event rate
  limits and sequence-number replay protection.
- Use the returned nominal `healthDamage` for damageDealt accounting (the
  reference counts overkill), and end blocks/dodges after ~250ms of pose
  loss.

## Test

```
pnpm --filter game-mechanics test
pnpm --filter game-mechanics typecheck
```

Consumed as TypeScript source via the pnpm workspace (`game-mechanics`:
`workspace:*`). The detectors are classes with per-instance state — create
one set per tracked player and call `reset()` on match restarts.
