"use client";

import { useState } from "react";
import type { PlanStep } from "@/lib/types";

// The living checklist: the agent's own plan (turn/plan/updated),
// pinned above the composer while a turn has one, ticking itself as
// statuses move pending → inProgress → completed. The estimate taped to
// the window — the workshop wrote it, not us. Not every turn has one:
// the tool tracks progress, so build turns speak and blueprint turns
// usually don't (their plan arrives as prose in the conversation). The
// panel's absence is normal, not a bug — it renders nothing rather
// than an empty frame.

function Tick({ status }: { status: PlanStep["status"] }) {
  if (status === "completed") {
    return (
      <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-accent">
        <svg viewBox="0 0 16 16" className="size-2.5 fill-white">
          <path d="M6.3 10.6 3.6 7.9l-1 1L6.3 12.6l7-7-1-1z" />
        </svg>
      </span>
    );
  }
  if (status === "inProgress") {
    return (
      <span className="flex size-4 shrink-0 items-center justify-center">
        <span className="size-2.5 animate-pulse rounded-full bg-accent" />
      </span>
    );
  }
  return (
    <span className="flex size-4 shrink-0 items-center justify-center">
      <span className="size-2.5 rounded-full border-2 border-stone-300 dark:border-stone-600" />
    </span>
  );
}

export function PlanChecklist({
  steps,
  explanation,
}: {
  steps: PlanStep[];
  explanation?: string | null;
}) {
  const [open, setOpen] = useState(true);
  if (steps.length === 0) return null;
  const done = steps.filter((s) => s.status === "completed").length;
  return (
    <div
      data-testid="plan-checklist"
      className="border-t border-stone-200 bg-stone-50 px-5 py-2.5 dark:border-stone-800 dark:bg-stone-900/60"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 text-left"
      >
        <span className="font-mono text-[11px] uppercase tracking-wider text-stone-500 dark:text-stone-400">
          The builder&apos;s plan
        </span>
        <span data-testid="plan-progress" className="font-mono text-[11px] text-stone-400 dark:text-stone-500">
          {done}/{steps.length}
        </span>
        <svg
          viewBox="0 0 16 16"
          className={`ml-auto size-2.5 shrink-0 fill-stone-400 transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path d="M4.4 6 8 9.6 11.6 6l.9.9L8 11.4 3.5 6.9z" />
        </svg>
      </button>
      {open && (
        <ul className="mt-2 flex flex-col gap-1.5">
          {steps.map((s) => (
            <li
              key={s.step}
              data-status={s.status}
              className="flex items-baseline gap-2.5 text-[13px]"
            >
              <Tick status={s.status} />
              <span
                className={
                  s.status === "completed"
                    ? "text-stone-400 line-through decoration-stone-300 dark:text-stone-500 dark:decoration-stone-600"
                    : s.status === "inProgress"
                      ? "font-medium text-stone-800 dark:text-stone-100"
                      : "text-stone-500 dark:text-stone-400"
                }
              >
                {s.step}
              </span>
            </li>
          ))}
        </ul>
      )}
      {open && explanation && (
        <p className="mt-2 text-xs italic text-stone-400 dark:text-stone-500">{explanation}</p>
      )}
    </div>
  );
}
