"use client";

import type { Mode } from "@/lib/types";

// The wristband rack: three postures, one line each. The descriptions are
// the mapping in main.sandbox_policy, said out loud.
export const MODES: { id: Mode; label: string; blurb: string }[] = [
  {
    id: "read-only",
    label: "Read-only",
    blurb: "Look and plan — the OS refuses every write.",
  },
  {
    id: "standard",
    label: "Standard",
    blurb: "Write inside this workspace; the network stays off.",
  },
  {
    id: "trusted",
    label: "Trusted",
    blurb: "Same workspace walls, with the network door open.",
  },
];

export function modeBlurb(mode: Mode): string {
  return MODES.find((m) => m.id === mode)?.blurb ?? "";
}

// The three-segment picker in the header. Switching takes effect on the
// NEXT turn — the policy rides on turn/start — so it stays enabled even
// between messages, but not while a turn is running.
export function ModePicker({
  mode,
  busy,
  onChange,
}: {
  mode: Mode;
  busy: boolean;
  onChange: (mode: Mode) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="hidden max-w-72 truncate text-xs text-stone-400 lg:inline dark:text-stone-500">
        {modeBlurb(mode)}
      </span>
      <div
        role="radiogroup"
        aria-label="Trust mode"
        data-testid="mode-picker"
        className="flex shrink-0 rounded-lg border border-stone-200 p-0.5 dark:border-stone-800"
      >
        {MODES.map((m) => {
          const active = m.id === mode;
          return (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={active}
              title={m.blurb}
              disabled={busy}
              onClick={() => onChange(m.id)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
                active
                  ? "bg-stone-900 text-stone-50 dark:bg-stone-100 dark:text-stone-900"
                  : "text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200"
              }`}
            >
              {m.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// The chip version for the chat header: just names the posture the next
// work order will carry.
export function ModeChip({ mode }: { mode: Mode }) {
  return (
    <span
      data-testid="mode-chip"
      title={modeBlurb(mode)}
      className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[11px] ${
        mode === "trusted"
          ? "border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-400"
          : mode === "read-only"
            ? "border-sky-300 text-sky-700 dark:border-sky-800 dark:text-sky-400"
            : "border-stone-200 text-stone-500 dark:border-stone-700 dark:text-stone-400"
      }`}
    >
      {mode}
    </span>
  );
}
