"use client";

import { useEffect, useRef, useState } from "react";
import type { ItemBlock } from "@/lib/types";
import { commandLabel, unwrapShell } from "@/lib/commandLabel";

function StatusIcon({ block }: { block: ItemBlock }) {
  if (!block.done) {
    return (
      <span className="size-3.5 shrink-0 animate-spin rounded-full border-2 border-stone-300 border-t-accent dark:border-stone-600" />
    );
  }
  if (failed(block)) {
    return <span className="shrink-0 text-sm leading-none text-red-600 dark:text-red-400">&#x2715;</span>;
  }
  return <span className="shrink-0 text-sm leading-none text-green-700 dark:text-green-400">&#x2713;</span>;
}

function failed(block: ItemBlock): boolean {
  const code = block.detail.exit_code;
  return block.done && code !== null && code !== undefined && code !== 0;
}

// The live terminal inside a badge. max-h + overflow keep a chatty
// command from flooding the chat, and the pane follows its own tail the
// way a terminal does.
function OutputPane({ text, tone }: { text: string; tone?: "error" }) {
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [text]);
  return (
    <pre
      ref={ref}
      className={`max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md bg-stone-100 p-2.5 font-mono text-xs leading-relaxed dark:bg-stone-800/80 ${
        tone === "error" ? "text-red-700 dark:text-red-400" : "text-stone-700 dark:text-stone-300"
      }`}
    >
      {text}
    </pre>
  );
}

// A command as a badge: friendly label collapsed, the real shell line on
// expand, and — while it runs — its stdout scrolling live underneath.
export function CommandBadge({ block }: { block: ItemBlock }) {
  const [open, setOpen] = useState(false);
  const command = unwrapShell(block.detail.command ?? "");
  const isError = failed(block);
  // Streaming output stays visible without a click; once the command
  // settles, it tucks behind the expander.
  const showLive = !block.done && block.output.length > 0;
  return (
    <div
      className={`my-1.5 max-w-xl overflow-hidden rounded-lg border bg-white dark:bg-stone-900 ${
        isError ? "border-red-300 dark:border-red-900/70" : "border-stone-200 dark:border-stone-800"
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-stone-50 dark:hover:bg-stone-800/60"
      >
        <StatusIcon block={block} />
        <span className="min-w-0 flex-1 truncate text-[13px] text-stone-600 dark:text-stone-300">
          {commandLabel(block.detail.command ?? "")}
        </span>
        {isError && (
          <span className="shrink-0 font-mono text-[11px] text-red-600 dark:text-red-400">
            exit {block.detail.exit_code}
          </span>
        )}
        <span className="shrink-0 font-mono text-[11px] uppercase tracking-wider text-stone-400 dark:text-stone-500">
          command
        </span>
        <svg
          viewBox="0 0 16 16"
          className={`size-3 shrink-0 fill-stone-400 transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path d="M4.4 6 8 9.6 11.6 6l.9.9L8 11.4 3.5 6.9z" />
        </svg>
      </button>
      {(open || showLive) && (
        <div className="space-y-2.5 border-t border-stone-200 px-3 py-2.5 dark:border-stone-800">
          {open && (
            <div>
              <p className="mb-1 font-mono text-[11px] uppercase tracking-wider text-stone-400 dark:text-stone-500">
                command
              </p>
              <pre className="overflow-x-auto rounded-md bg-stone-100 p-2.5 font-mono text-xs leading-relaxed text-stone-700 dark:bg-stone-800/80 dark:text-stone-300">
                {command}
              </pre>
            </div>
          )}
          {block.output.length > 0 && (
            <div>
              <p className="mb-1 font-mono text-[11px] uppercase tracking-wider text-stone-400 dark:text-stone-500">
                output
              </p>
              <OutputPane text={block.output} tone={isError ? "error" : undefined} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
