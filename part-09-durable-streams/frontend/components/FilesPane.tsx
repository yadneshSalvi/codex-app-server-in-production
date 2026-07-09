"use client";

import type { WorkspaceFile } from "@/lib/types";

// The job-site inventory: the workspace tree, refreshed as file_change
// events land. Badges mark what the current turn did to each path;
// seeded brief files render dimmed — the client's paperwork, not the
// agent's work. Deleted paths linger as struck-through ghosts so the
// delete itself stays visible.

const BADGE_STYLE: Record<string, string> = {
  add: "bg-green-100 text-green-800 dark:bg-green-950/60 dark:text-green-300",
  update: "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
  delete: "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300",
};

const BADGE_LABEL: Record<string, string> = {
  add: "added",
  update: "updated",
  delete: "deleted",
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} kB`;
}

type Row =
  | { kind: "dir"; key: string; name: string; depth: number }
  | {
      kind: "file";
      key: string;
      name: string;
      depth: number;
      path: string;
      size: number;
      seeded: boolean;
      ghost: boolean;
    };

// Flatten paths into an indented tree: emit each directory once, in
// order, then the file beneath it.
function toRows(files: WorkspaceFile[], badges: Record<string, string>): Row[] {
  const entries = [
    ...files.map((f) => ({ ...f, ghost: false })),
    ...Object.entries(badges)
      .filter(([path, kind]) => kind === "delete" && !files.some((f) => f.path === path))
      .map(([path]) => ({ path, size: 0, seeded: false, ghost: true })),
  ].sort((a, b) => a.path.localeCompare(b.path));
  const rows: Row[] = [];
  const seenDirs = new Set<string>();
  for (const entry of entries) {
    const parts = entry.path.split("/");
    for (let i = 0; i < parts.length - 1; i++) {
      const dir = parts.slice(0, i + 1).join("/");
      if (!seenDirs.has(dir)) {
        seenDirs.add(dir);
        rows.push({ kind: "dir", key: dir, name: parts[i] + "/", depth: i });
      }
    }
    rows.push({
      kind: "file",
      key: entry.path,
      name: parts[parts.length - 1],
      depth: parts.length - 1,
      ...entry,
    });
  }
  return rows;
}

export function FilesPane({
  files,
  badges,
}: {
  files: WorkspaceFile[];
  badges: Record<string, string>;
}) {
  const rows = toRows(files, badges);
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-4 pb-1 pt-2.5">
        <p className="font-mono text-[11px] uppercase tracking-wider text-stone-400 dark:text-stone-500">
          Files
        </p>
        <p className="font-mono text-[11px] text-stone-400 dark:text-stone-500">
          {files.length}
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {rows.length === 0 && (
          <p className="px-4 py-1 text-[13px] text-stone-400 dark:text-stone-500">
            The workspace is empty.
          </p>
        )}
        {rows.map((row) =>
          row.kind === "dir" ? (
            <p
              key={row.key}
              style={{ paddingLeft: 16 + row.depth * 14 }}
              className="py-0.5 font-mono text-xs text-stone-400 dark:text-stone-500"
            >
              {row.name}
            </p>
          ) : (
            <div
              key={row.key}
              style={{ paddingLeft: 16 + row.depth * 14 }}
              className="flex items-center gap-2 py-0.5 pr-4"
            >
              <span
                className={`min-w-0 flex-1 truncate font-mono text-xs ${
                  row.ghost
                    ? "text-stone-400 line-through dark:text-stone-500"
                    : row.seeded
                      ? "text-stone-400 dark:text-stone-500"
                      : "text-stone-700 dark:text-stone-300"
                }`}
              >
                {row.name}
              </span>
              {badges[row.path] && (
                <span
                  className={`shrink-0 rounded px-1.5 py-px font-mono text-[10px] ${BADGE_STYLE[badges[row.path]] ?? ""}`}
                >
                  {BADGE_LABEL[badges[row.path]] ?? badges[row.path]}
                </span>
              )}
              {!row.ghost && (
                <span className="w-14 shrink-0 text-right font-mono text-[10px] text-stone-400 dark:text-stone-500">
                  {formatSize(row.size)}
                </span>
              )}
            </div>
          ),
        )}
      </div>
    </div>
  );
}
