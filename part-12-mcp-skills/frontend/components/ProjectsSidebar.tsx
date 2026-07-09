"use client";

import { useState } from "react";
import type { Project } from "@/lib/types";

// The registry timestamps are for humans now; the sidebar shows "how
// long since this job folder was touched", not an ISO string.
function relativeTime(iso?: string): string {
  if (!iso) return "";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

// The projects sidebar: the filing wall of job folders. Each row is a
// project (auto-titled after its first turn); Fork photocopies the
// blueprints — conversation and workspace both.
export function ProjectsSidebar({
  projects,
  briefs,
  activeId,
  busy,
  onSelect,
  onCreate,
  onFork,
}: {
  projects: Project[];
  briefs: string[];
  activeId: string | null;
  busy: boolean;
  onSelect: (id: string) => void;
  onCreate: (brief: string | null) => void;
  onFork: (id: string) => void;
}) {
  const [brief, setBrief] = useState("");
  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-stone-200 dark:border-stone-800">
      <div className="flex-1 overflow-y-auto p-2" data-testid="project-list">
        {projects.length === 0 && (
          <p className="px-2 py-3 text-[13px] text-stone-400 dark:text-stone-500">
            No projects yet.
          </p>
        )}
        {projects.map((p) => {
          const active = p.id === activeId;
          return (
            <div
              key={p.id}
              className={`group mb-1 rounded-lg border px-3 py-2 ${
                active
                  ? "border-accent/40 bg-accent/5"
                  : "border-transparent hover:bg-stone-100 dark:hover:bg-stone-900"
              }`}
            >
              <button
                type="button"
                onClick={() => onSelect(p.id)}
                disabled={busy}
                className="block w-full text-left disabled:opacity-60"
              >
                <span
                  className={`block truncate text-[13px] font-medium ${
                    active ? "text-accent" : "text-stone-700 dark:text-stone-300"
                  }`}
                >
                  {p.name}
                </span>
                <span className="mt-0.5 block truncate text-xs text-stone-400 dark:text-stone-500">
                  {p.thread_name ?? "no conversation yet"}
                </span>
              </button>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-[11px] text-stone-400 dark:text-stone-500">
                  {relativeTime(p.updated_at ?? p.created_at)}
                </span>
                <button
                  type="button"
                  onClick={() => onFork(p.id)}
                  disabled={busy || !p.thread_id}
                  title={p.thread_id ? "Fork this project" : "Chat first, then fork"}
                  className={`rounded border border-stone-200 px-1.5 py-0.5 text-[11px] text-stone-500 hover:border-accent hover:text-accent disabled:opacity-30 dark:border-stone-700 dark:text-stone-400 ${
                    active ? "" : "opacity-0 focus:opacity-100 group-hover:opacity-100"
                  }`}
                >
                  Fork
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <div className="border-t border-stone-200 p-3 dark:border-stone-800">
        <select
          aria-label="Brief"
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          disabled={busy}
          className="mb-2 w-full rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-[13px] text-stone-600 outline-none focus:border-accent disabled:opacity-40 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300"
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
          className="w-full rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-40"
        >
          New project
        </button>
      </div>
    </aside>
  );
}
