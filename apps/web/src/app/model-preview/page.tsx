"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { FighterModel } from "@/components/fighter/FighterModel";

/**
 * Dev-only turntable for the player model. `?t=0.26` freezes the idle clock
 * at one instant (0.26 lands on full jab extension) when tuning a pose.
 */
function Preview() {
  const frozen = Number(useSearchParams().get("t"));

  return (
    <FighterModel
      withRing
      sparring
      frozenAt={Number.isNaN(frozen) || frozen === 0 ? undefined : frozen}
      className="fixed inset-0"
    />
  );
}

export default function ModelPreviewPage() {
  return (
    <Suspense>
      <Preview />
    </Suspense>
  );
}
