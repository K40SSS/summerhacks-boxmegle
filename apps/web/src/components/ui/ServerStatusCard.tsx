"use client";

import { useState } from "react";

type ServerStatusCardProps = {
  online: boolean | null;
};

const STYLES = {
  online:
    "border-green-200 bg-white text-green-600 dark:border-green-900 dark:bg-zinc-900 dark:text-green-400",
  offline:
    "border-red-200 bg-white text-red-600 dark:border-red-900 dark:bg-zinc-900 dark:text-red-400",
  pending:
    "border-yellow-200 bg-white text-yellow-600 dark:border-yellow-900 dark:bg-zinc-900 dark:text-yellow-400",
};

export function ServerStatusCard({ online }: ServerStatusCardProps) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const status =
    online === null ? "pending" : online ? "online" : "offline";
  const message =
    online === null
      ? "querying server"
      : online
        ? "server online"
        : "server can't be reached";

  return (
    <div
      className={`fixed bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-full border py-3 pl-5 pr-3 text-sm font-medium shadow-lg ${STYLES[status]}`}
    >
      {message}
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        className="flex h-5 w-5 items-center justify-center rounded-full text-current opacity-60 transition-opacity hover:opacity-100"
      >
        &times;
      </button>
    </div>
  );
}
