"use client";

import { useEffect, useRef, useState } from "react";

const MAX_HEALTH = 100;
const MAX_STAMINA = 100;
const MAX_BLOCK = 100;
const STAMINA_SEGMENTS = 10;

const DAMAGE_VIGNETTE_MS = 450;
const BLOCK_BREAK_VIGNETTE_MS = 800;

function formatClock(totalSeconds: number) {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const PIXEL_SHADOW = "shadow-[4px_4px_0_0_rgba(0,0,0,0.9)]";
const SEGMENTED_BAR_BG = {
  backgroundImage:
    "repeating-linear-gradient(90deg, transparent 0 6px, rgba(0,0,0,0.55) 6px 8px)",
};
const SEGMENTED_BAR_BG_VERTICAL = {
  backgroundImage:
    "repeating-linear-gradient(0deg, transparent 0 6px, rgba(0,0,0,0.55) 6px 8px)",
};

function ShieldIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3z" />
    </svg>
  );
}

function LightningIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M13 2 3 14h7l-1 8 11-14h-7l1-6z" />
    </svg>
  );
}

/** Health bar - same color both sides so it reads as "the HP bar" regardless of corner. */
function HealthBar({ value, max, mirrored }: { value: number; max: number; mirrored: boolean }) {
  return (
    <div
      className="h-5 w-full overflow-hidden border-2 border-white bg-black sm:h-6"
      style={SEGMENTED_BAR_BG}
    >
      <div
        className={`h-full bg-red-500 transition-[width] duration-300 ${mirrored ? "ml-auto" : ""}`}
        style={{ width: `${(value / max) * 100}%` }}
      />
    </div>
  );
}

/** Stamina gauge as discrete lit segments (pips), not a continuous bar, so it reads as "energy" rather than a second health bar. */
function StaminaBar({ value, max, mirrored }: { value: number; max: number; mirrored: boolean }) {
  const filled = Math.round((Math.max(0, value) / max) * STAMINA_SEGMENTS);

  return (
    <div className={`flex items-center gap-1.5 ${mirrored ? "flex-row-reverse" : ""}`}>
      <LightningIcon className="h-3 w-3 shrink-0 text-lime-300 sm:h-3.5 sm:w-3.5" />
      <div className={`flex flex-1 gap-0.5 ${mirrored ? "flex-row-reverse" : ""}`}>
        {Array.from({ length: STAMINA_SEGMENTS }, (_, i) => (
          <span
            key={i}
            className={`h-2 flex-1 border border-white sm:h-2.5 ${
              i < filled ? "bg-lime-400" : "bg-black"
            }`}
          />
        ))}
      </div>
    </div>
  );
}

/** Block/guard meter, pinned to the side of the wearer's own half of the screen with a shield icon so it's unmistakably a blocking resource. */
function BlockMeter({
  value,
  max,
  side,
}: {
  value: number;
  max: number;
  side: "left" | "right";
}) {
  return (
    <div
      className={`absolute top-1/2 z-10 flex -translate-y-1/2 flex-col items-center gap-1.5 ${
        side === "left" ? "left-2 sm:left-4" : "right-2 sm:right-4"
      }`}
    >
      <div className={`border-2 border-white bg-black/80 p-1 ${PIXEL_SHADOW}`}>
        <ShieldIcon className="h-4 w-4 text-yellow-300 sm:h-5 sm:w-5" />
      </div>
      <div
        className="flex h-28 w-3 flex-col-reverse overflow-hidden border-2 border-white bg-black sm:h-36 sm:w-4"
        style={SEGMENTED_BAR_BG_VERTICAL}
      >
        <div
          className="w-full bg-yellow-400 transition-[height] duration-300"
          style={{ height: `${(value / max) * 100}%` }}
        />
      </div>
    </div>
  );
}

export interface FightHudProps {
  you: { health: number; stamina: number; block: number };
  opponent: { health: number; stamina: number; block: number };
  timeLeftMs: number;
  phase: "WAITING" | "FIRST_HALF" | "HALFTIME" | "SECOND_HALF" | "ENDED";
}

/** Top status bar (health/stamina per player, block meters on the side edges) plus damage/stamina/block-break vignettes for the fight screen, driven by real match state. */
export function FightHud({ you, opponent, timeLeftMs, phase }: FightHudProps) {
  // Locally-mirrored countdown for smooth 1Hz display between server
  // match-state snapshots. Resyncs whenever a fresh timeLeftMs prop arrives
  // (the "adjusting state on prop change during render" pattern — no effect
  // needed for the resync itself), then ticks down once a second in between.
  const [prevTimeLeftMs, setPrevTimeLeftMs] = useState(timeLeftMs);
  const [displayMs, setDisplayMs] = useState(timeLeftMs);
  if (timeLeftMs !== prevTimeLeftMs) {
    setPrevTimeLeftMs(timeLeftMs);
    setDisplayMs(timeLeftMs);
  }

  useEffect(() => {
    const id = setInterval(() => {
      setDisplayMs((ms) => Math.max(0, ms - 1000));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // One-shot vignettes: flash on the transition (damage taken, block broken)
  // rather than staying on, since those are events, not sustained states.
  const [showDamageFlash, setShowDamageFlash] = useState(false);
  const [showBlockBreakFlash, setShowBlockBreakFlash] = useState(false);
  const prevHealthRef = useRef(you.health);
  const prevBlockRef = useRef(you.block);

  useEffect(() => {
    if (you.health < prevHealthRef.current) {
      setShowDamageFlash(true);
      const id = setTimeout(() => setShowDamageFlash(false), DAMAGE_VIGNETTE_MS);
      prevHealthRef.current = you.health;
      return () => clearTimeout(id);
    }
    prevHealthRef.current = you.health;
  }, [you.health]);

  useEffect(() => {
    if (you.block <= 0 && prevBlockRef.current > 0) {
      setShowBlockBreakFlash(true);
      const id = setTimeout(() => setShowBlockBreakFlash(false), BLOCK_BREAK_VIGNETTE_MS);
      prevBlockRef.current = you.block;
      return () => clearTimeout(id);
    }
    prevBlockRef.current = you.block;
  }, [you.block]);

  // Sustained: stays up for as long as you're actually out of stamina.
  const showStaminaOut = you.stamina <= 0;

  const round = phase === "SECOND_HALF" || phase === "ENDED" ? 2 : 1;
  const roundLabel = phase === "HALFTIME" ? "halftime" : `round ${round}`;

  return (
    <>
      {/* vignettes + center callouts, layered above video/HUD */}
      <div className="pointer-events-none fixed inset-0 z-30">
        <div
          className="absolute inset-0 transition-opacity duration-150"
          style={{
            opacity: showDamageFlash ? 1 : 0,
            boxShadow: "inset 0 0 12vw 2vw rgba(220,38,38,0.65)",
          }}
        />
        <div
          className="absolute inset-0 transition-opacity duration-300"
          style={{
            opacity: showStaminaOut ? 1 : 0,
            boxShadow: "inset 0 0 12vw 2vw rgba(250,204,21,0.55)",
          }}
        />
        <div
          className="absolute inset-0 transition-opacity duration-150"
          style={{
            opacity: showBlockBreakFlash ? 1 : 0,
            boxShadow: "inset 0 0 14vw 3vw rgba(255,255,255,0.7)",
          }}
        />

        {showBlockBreakFlash && (
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 border-2 border-white bg-black/80 px-4 py-1.5 font-mono text-sm font-bold uppercase tracking-[0.3em] text-white sm:text-base">
            Block Broken
          </div>
        )}
        {showStaminaOut && (
          <div className="absolute left-1/2 top-[38%] -translate-x-1/2 -translate-y-1/2 font-mono text-sm font-bold uppercase tracking-[0.2em] text-yellow-300 drop-shadow-[2px_2px_0_rgba(0,0,0,0.9)] sm:text-base">
            You&apos;re out of stamina!
          </div>
        )}
      </div>

      <BlockMeter value={you.block} max={MAX_BLOCK} side="left" />
      <BlockMeter value={opponent.block} max={MAX_BLOCK} side="right" />

      {/* top status bar */}
      <div className="absolute top-0 left-0 right-0 z-10 px-4 pt-4 sm:px-8 sm:pt-6">
        <div className="grid grid-cols-3 items-start gap-3 font-mono">
          <div className="flex justify-start">
            <div
              className={`border-2 border-white bg-black/80 px-3 py-1.5 ${PIXEL_SHADOW}`}
            >
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 border border-white bg-blue-500" />
                <span className="text-sm font-bold tracking-[0.25em] text-blue-400 sm:text-base">
                  YOU
                </span>
              </div>
            </div>
          </div>

          <div className="flex justify-center">
            <div
              className={`flex flex-col items-center border-2 border-white bg-black/80 px-4 py-1.5 ${PIXEL_SHADOW}`}
            >
              <span className="text-2xl font-bold tabular-nums tracking-widest text-white sm:text-3xl">
                {formatClock(Math.ceil(displayMs / 1000))}
              </span>
              <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-yellow-400 sm:text-xs">
                {roundLabel}
              </span>
            </div>
          </div>

          <div className="flex justify-end">
            <div
              className={`border-2 border-white bg-black/80 px-3 py-1.5 ${PIXEL_SHADOW}`}
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold tracking-[0.25em] text-red-400 sm:text-base">
                  OPPONENT
                </span>
                <span className="h-3 w-3 border border-white bg-red-500" />
              </div>
            </div>
          </div>
        </div>

        <div className="mt-3 flex items-start gap-4">
          <div className="flex-1 space-y-1.5">
            <div>
              <HealthBar value={you.health} max={MAX_HEALTH} mirrored={false} />
              <span className="mt-1 block font-mono text-lg font-bold text-white sm:text-xl">
                {Math.round(you.health)}
              </span>
            </div>
            <StaminaBar value={you.stamina} max={MAX_STAMINA} mirrored={false} />
          </div>
          <div className="flex-1 space-y-1.5">
            <div>
              <HealthBar value={opponent.health} max={MAX_HEALTH} mirrored={true} />
              <span className="mt-1 block text-right font-mono text-lg font-bold text-white sm:text-xl">
                {Math.round(opponent.health)}
              </span>
            </div>
            <StaminaBar value={opponent.stamina} max={MAX_STAMINA} mirrored={true} />
          </div>
        </div>
      </div>
    </>
  );
}
