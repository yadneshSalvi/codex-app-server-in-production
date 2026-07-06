"use client";

import { useState } from "react";
import type { Project } from "@/lib/types";

const selectStyle =
  "rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-[13px] text-stone-600 outline-none focus:border-accent disabled:opacity-40 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300";

// The project switcher: pick a job site, or open a new one — optionally
// seeded with a client brief from the repo's brief bank.
export function ProjectBar({
  projects,
  briefs,
  activeId,
  busy,
  onSelect,
  onCreate,
}: {
  projects: Project[];
  briefs: string[];
  activeId: string | null;
  busy: boolean;
  onSelect: (id: string) => void;
  onCreate: (brief: string | null) => void;
}) {
  const [brief, setBrief] = useState("");
  return (
    <div className="flex items-center gap-2">
      {projects.length > 0 && (
        <select
          aria-label="Project"
          value={activeId ?? ""}
          onChange={(e) => onSelect(e.target.value)}
          disabled={busy}
          className={selectStyle}
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      )}
      <select
        aria-label="Brief"
        value={brief}
        onChange={(e) => setBrief(e.target.value)}
        disabled={busy}
        className={selectStyle}
      >
        <option value="">blank workspace</option>
        {briefs.map((b) => (
          <option key={b} value={b}>
            {b} brief
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => onCreate(brief || null)}
        disabled={busy}
        className="rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-40"
      >
        New project
      </button>
    </div>
  );
}
