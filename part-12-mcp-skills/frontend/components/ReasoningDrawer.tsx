"use client";

import { useState } from "react";
import type { ItemBlock } from "@/lib/types";

// The intern's scratchpad you're allowed to read: reasoning summaries
// stream in muted and collapsed, one quiet line unless you ask for more.
// Part 10 adds the dials (effort, summary detail); here it just fills.
export function ReasoningDrawer({ block }: { block: ItemBlock }) {
  const [open, setOpen] = useState(false);
  if (!block.reasoning && block.done) return null; // nothing was shared
  return (
    <div className="my-1.5 max-w-xl">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-[12px] text-stone-400 hover:text-stone-500 dark:text-stone-500 dark:hover:text-stone-400"
      >
        {!block.done ? (
          <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-stone-400 dark:bg-stone-500" />
        ) : (
          <span className="size-1.5 shrink-0 rounded-full bg-stone-300 dark:bg-stone-600" />
        )}
        <span className="font-medium uppercase tracking-wider">Thinking</span>
        <svg
          viewBox="0 0 16 16"
          className={`size-2.5 shrink-0 fill-current transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path d="M4.4 6 8 9.6 11.6 6l.9.9L8 11.4 3.5 6.9z" />
        </svg>
      </button>
      {open && block.reasoning && (
        <p className="mt-1.5 max-h-48 overflow-y-auto whitespace-pre-wrap border-l-2 border-stone-200 pl-3 font-mono text-xs italic leading-relaxed text-stone-400 dark:border-stone-700 dark:text-stone-500">
          {block.reasoning}
        </p>
      )}
    </div>
  );
}
