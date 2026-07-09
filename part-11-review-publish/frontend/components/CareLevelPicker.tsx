"use client";

import type { Effort, Summary } from "@/lib/types";

// The care-level selector: two protocol dials (effort, summary) folded
// into one product question — how hard should the builder think about
// THIS message? Quick also drops the reasoning summary to "concise"
// (less to read for less thinking); the other three keep "detailed",
// the setting the reasoning drawer has depended on since Part 3.
export type CareLevel = "quick" | "standard" | "thorough" | "max";

export const CARE_LEVELS: {
  id: CareLevel;
  label: string;
  effort: Effort;
  summary: Summary;
  blurb: string;
}[] = [
  { id: "quick", label: "Quick", effort: "low", summary: "concise",
    blurb: "Cheap and fast — copy tweaks, small fixes." },
  { id: "standard", label: "Standard", effort: "medium", summary: "detailed",
    blurb: "The default. Most messages belong here." },
  { id: "thorough", label: "Thorough", effort: "high", summary: "detailed",
    blurb: "More thinking per step — layout and structure work." },
  { id: "max", label: "Max", effort: "xhigh", summary: "detailed",
    blurb: "Everything the model has — redesigns, hard briefs. Costs real tokens." },
];

export function careDials(level: CareLevel): { effort: Effort; summary: Summary } {
  const c = CARE_LEVELS.find((l) => l.id === level) ?? CARE_LEVELS[1];
  return { effort: c.effort, summary: c.summary };
}

// The same segmented control as the ModePicker, one notch smaller: this
// dial is per-message, so it lives on the composer, not in the header.
export function CareLevelPicker({
  level,
  onChange,
}: {
  level: CareLevel;
  onChange: (level: CareLevel) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Care level"
      data-testid="care-picker"
      className="flex shrink-0 rounded-lg border border-stone-200 p-0.5 dark:border-stone-800"
    >
      {CARE_LEVELS.map((c) => {
        const active = c.id === level;
        return (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={active}
            title={`${c.blurb} (effort: ${c.effort})`}
            data-testid={`care-${c.id}`}
            onClick={() => onChange(c.id)}
            className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors ${
              active
                ? "bg-stone-900 text-stone-50 dark:bg-stone-100 dark:text-stone-900"
                : "text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200"
            }`}
          >
            {c.label}
          </button>
        );
      })}
    </div>
  );
}
