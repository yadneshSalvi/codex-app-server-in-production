"use client";

import { useState } from "react";
import type { TokenUsage, UsageReading } from "@/lib/types";

// 73_412 -> "73.4k": the gauge is a glance, not an invoice. The
// breakdown panel keeps the exact numbers.
function compact(n?: number): string {
  if (n === undefined || n === null) return "—";
  if (n < 1_000) return String(n);
  if (n < 1_000_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function Row({ label, reading }: { label: string; reading?: TokenUsage }) {
  return (
    <tr className="[&>td]:py-0.5">
      <td className="pr-3 text-stone-400 dark:text-stone-500">{label}</td>
      <td className="pr-3 text-right font-mono">{compact(reading?.inputTokens)}</td>
      <td className="pr-3 text-right font-mono">{compact(reading?.cachedInputTokens)}</td>
      <td className="pr-3 text-right font-mono">{compact(reading?.outputTokens)}</td>
      <td className="text-right font-mono font-medium">{compact(reading?.totalTokens)}</td>
    </tr>
  );
}

// The live meter in the header (Part 8). The big number is THIS TURN —
// the backend's computed delta, because neither wire field means "this
// turn" (`.last` is one model request, `.total` is the thread's life);
// the thread's cumulative total sits beside it in a quieter voice,
// under its true name. Click for the full breakdown of all three.
export function TokenGauge({ usage }: { usage: UsageReading | null }) {
  const [open, setOpen] = useState(false);
  if (!usage?.total?.totalTokens) return null;
  return (
    <div className="relative">
      <button
        type="button"
        data-testid="token-gauge"
        onClick={() => setOpen((v) => !v)}
        title="Tokens this turn · this thread (click for the breakdown)"
        className="flex items-center gap-1.5 rounded-lg border border-stone-200 px-2.5 py-1 font-mono text-xs text-stone-500 hover:border-accent hover:text-accent dark:border-stone-800 dark:text-stone-400"
      >
        <span data-testid="gauge-turn">{compact((usage.turn ?? usage.last)?.totalTokens)}</span>
        <span className="text-stone-300 dark:text-stone-600">·</span>
        <span data-testid="gauge-thread" className="text-stone-400 dark:text-stone-500">
          {compact(usage.total?.totalTokens)} thread
        </span>
      </button>
      {open && (
        <div
          data-testid="gauge-breakdown"
          className="absolute right-0 top-full z-20 mt-1.5 w-72 rounded-xl border border-stone-200 bg-white p-3 text-xs shadow-lg dark:border-stone-700 dark:bg-stone-900"
        >
          <table className="w-full">
            <thead>
              <tr className="text-[11px] text-stone-400 dark:text-stone-500 [&>th]:pb-1 [&>th]:font-normal">
                <th className="text-left">tokens</th>
                <th className="text-right">in</th>
                <th className="text-right">cached</th>
                <th className="text-right">out</th>
                <th className="text-right">total</th>
              </tr>
            </thead>
            <tbody>
              <Row label="this turn" reading={usage.turn ?? usage.last} />
              <Row label="last request" reading={usage.last} />
              <Row label="this thread" reading={usage.total} />
            </tbody>
          </table>
          {usage.context_window != null && (
            <p className="mt-2 border-t border-stone-100 pt-2 text-[11px] text-stone-400 dark:border-stone-800 dark:text-stone-500">
              context window: {compact(usage.context_window)} tokens
            </p>
          )}
        </div>
      )}
    </div>
  );
}
