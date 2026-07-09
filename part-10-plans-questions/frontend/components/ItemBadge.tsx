"use client";

import type { ItemBlock } from "@/lib/types";

// Every item kind the UI has no special component for yet — fileChange
// gets a friendly file list (its real treatment is Part 4's preview and
// diff drawer), anything unknown shows its kind. New protocol items
// appear here without edits.
export function ItemBadge({ block }: { block: ItemBlock }) {
  const files = block.detail.files ?? [];
  const label =
    block.kind === "fileChange" && files.length > 0
      ? files.map((f) => `${verb(f.kind)} ${basename(f.path)}`).join(", ")
      : block.kind;
  return (
    <div className="my-1.5 flex max-w-xl items-center gap-2.5 rounded-lg border border-stone-200 bg-white px-3 py-2 dark:border-stone-800 dark:bg-stone-900">
      {block.done ? (
        <span className="shrink-0 text-sm leading-none text-green-700 dark:text-green-400">&#x2713;</span>
      ) : (
        <span className="size-3.5 shrink-0 animate-spin rounded-full border-2 border-stone-300 border-t-accent dark:border-stone-600" />
      )}
      <span className="min-w-0 flex-1 truncate text-[13px] text-stone-600 dark:text-stone-300">{label}</span>
      <span className="shrink-0 font-mono text-[11px] uppercase tracking-wider text-stone-400 dark:text-stone-500">
        {block.kind === "fileChange" ? "files" : "item"}
      </span>
    </div>
  );
}

function verb(kind: string): string {
  if (kind === "add") return "Creating";
  if (kind === "delete") return "Deleting";
  return "Updating";
}

function basename(path: string): string {
  return path.split("/").pop() || path;
}
