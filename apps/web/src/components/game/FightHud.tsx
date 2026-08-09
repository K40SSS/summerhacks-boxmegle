"use client";

import { useEffect, useState } from "react";

const MAX_HEALTH = 100;
const MAX_STAMINA = 100;
const MAX_BLOCK = 100;

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

/** One segmented status bar (health/stamina/block), mirrored for the right-side player. */
function StatusBar({
  value,
  max,
  colorClass,
  heightClass,
  mirrored,
}: {
  value: number;
  max: number;
  colorClass: string;
  heightClass: string;
  mirrored: boolean;
}) {
  return (
    <div
      className={`${heightClass} w-full overflow-hidden border-2 border-white bg-black`}
      style={SEGMENTED_BAR_BG}
    >
      <div
        className={`h-full ${colorClass} transition-[width] duration-300 ${mirrored ? "ml-auto" : ""}`}
        style={{ width: `${(value / max) * 100}%` }}
      />
    </div>
  );
}

export interface FightHudProps {
  you: { health: number; stamina: number; block: number };
  opponent: { health: number; stamina: number; block: number };
  timeLeftMs: number;
  phase: "WAITING" | "FIRST_HALF" | "HALFTIME" | "SECOND_HALF" | "ENDED";
}

/** Top status bar (health/stamina/block per player) for the fight screen, driven by real match state. */
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

  const round = phase === "SECOND_HALF" || phase === "ENDED" ? 2 : 1;
  const roundLabel = phase === "HALFTIME" ? "halftime" : `round ${round}`;

  return (
    <>
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
              <StatusBar
                value={you.health}
                max={MAX_HEALTH}
                colorClass="bg-blue-500"
                heightClass="h-5 sm:h-6"
                mirrored={false}
              />
              <span className="mt-1 block font-mono text-lg font-bold text-white sm:text-xl">
                {Math.round(you.health)}
              </span>
            </div>
            <StatusBar
              value={you.stamina}
              max={MAX_STAMINA}
              colorClass="bg-emerald-500"
              heightClass="h-2 sm:h-2.5"
              mirrored={false}
            />
            <StatusBar
              value={you.block}
              max={MAX_BLOCK}
              colorClass="bg-yellow-400"
              heightClass="h-2 sm:h-2.5"
              mirrored={false}
            />
          </div>
          <div className="flex-1 space-y-1.5">
            <div>
              <StatusBar
                value={opponent.health}
                max={MAX_HEALTH}
                colorClass="bg-red-500"
                heightClass="h-5 sm:h-6"
                mirrored={true}
              />
              <span className="mt-1 block text-right font-mono text-lg font-bold text-white sm:text-xl">
                {Math.round(opponent.health)}
              </span>
            </div>
            <StatusBar
              value={opponent.stamina}
              max={MAX_STAMINA}
              colorClass="bg-emerald-500"
              heightClass="h-2 sm:h-2.5"
              mirrored={true}
            />
            <StatusBar
              value={opponent.block}
              max={MAX_BLOCK}
              colorClass="bg-yellow-400"
              heightClass="h-2 sm:h-2.5"
              mirrored={true}
            />
          </div>
        </div>
      </div>
    </>
  );
}
