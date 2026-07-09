"use client";

import { useEffect, useState } from "react";
import type { ReviewCounts } from "@/lib/types";

// The publish flow's dashboard, pinned above the composer: one row that
// always tells the truth about where this project stands on the road to
// /p/. The Publish button only ARMS when the gate would let it through
// — the backend still checks (any client can curl the endpoint), but
// the UI never offers a click it knows will 409.

function Elapsed({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const s = Math.max(0, Math.round((now - startedAt) / 1000));
  return (
    <span className="font-mono text-[11px] text-stone-400 dark:text-stone-500">
      {Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")}
    </span>
  );
}

export function PublishBar({
  hasSite,
  working,
  reviewRunning,
  reviewStartedAt,
  gate,
  publishing,
  publishedUrl,
  onInspect,
  onPublish,
}: {
  hasSite: boolean;
  working: boolean;
  reviewRunning: boolean;
  reviewStartedAt: number | null;
  // The latest inspection's counts — null means "no inspection vouches
  // for the site right now" (never ran, or a turn ran after it).
  gate: ReviewCounts | null;
  publishing: boolean;
  publishedUrl: string | null;
  onInspect: () => void;
  onPublish: () => void;
}) {
  if (!hasSite) return null;

  const blocked = gate !== null && gate.P1 > 0;
  const armed = gate !== null && gate.P1 === 0 && !working && !publishing;

  return (
    <div
      data-testid="publish-bar"
      className="border-t border-stone-200 bg-stone-50 px-5 py-2.5 dark:border-stone-800 dark:bg-stone-900/60"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2 text-[12px]">
          {reviewRunning ? (
            <>
              <span className="size-1.5 animate-pulse rounded-full bg-sky-500" />
              <span className="truncate text-stone-500 dark:text-stone-400">
                The inspector is reading the site — this takes a minute or two.
              </span>
              {reviewStartedAt && <Elapsed startedAt={reviewStartedAt} />}
            </>
          ) : publishing ? (
            <>
              <span className="size-1.5 animate-pulse rounded-full bg-accent" />
              <span className="text-stone-500 dark:text-stone-400">
                Writing the manifest and copying the site…
              </span>
            </>
          ) : blocked ? (
            <span data-testid="gate-blocked" className="text-red-700 dark:text-red-400">
              Publish is blocked — {gate.P1} blocker finding{gate.P1 === 1 ? "" : "s"} to fix.
            </span>
          ) : gate !== null ? (
            <span data-testid="gate-clean" className="text-green-700 dark:text-green-400">
              Inspection clean — ready to publish.
            </span>
          ) : (
            <span className="text-stone-500 dark:text-stone-400">
              Publishing starts with an inspection — fresh eyes, then the button.
            </span>
          )}
          {publishedUrl && !reviewRunning && !publishing && (
            <span className="truncate font-mono text-[11px] text-stone-400 dark:text-stone-500">
              · live at {publishedUrl}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            data-testid="inspect-button"
            disabled={working || reviewRunning || publishing}
            onClick={onInspect}
            className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs font-medium text-stone-600 transition-colors hover:border-accent hover:text-accent disabled:opacity-40 dark:border-stone-700 dark:text-stone-300"
          >
            {gate !== null || reviewRunning ? "Re-inspect" : "Inspect site"}
          </button>
          <button
            type="button"
            data-testid="publish-button"
            disabled={!armed}
            onClick={onPublish}
            className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors disabled:opacity-40"
          >
            Publish
          </button>
        </div>
      </div>
    </div>
  );
}
