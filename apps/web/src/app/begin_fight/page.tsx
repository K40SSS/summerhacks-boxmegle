"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { MatchFoundView } from "@/components/ui/MatchFoundView";

function BeginFightContent() {
  const searchParams = useSearchParams();
  const session = searchParams.get("session");
  const isHost = searchParams.get("host") === "true";

  return <MatchFoundView session={session} isHost={isHost} />;
}

export default function BeginFightPage() {
  return (
    <Suspense fallback={null}>
      <BeginFightContent />
    </Suspense>
  );
}
