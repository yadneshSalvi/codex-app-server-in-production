"use client";

import { API_BASE } from "@/lib/api";

// The live preview: the workspace served at /preview/{id}/ inside a
// sandboxed iframe. sandbox="allow-scripts" WITHOUT allow-same-origin
// keeps the generated — untrusted — HTML in a null origin: its scripts
// run, but they can't touch our cookies, storage, or DOM. The ?v= query
// defeats the browser cache on every preview_refresh.
export function PreviewPane({
  projectId,
  version,
  hasSite,
}: {
  projectId: string;
  version: number;
  hasSite: boolean;
}) {
  if (!hasSite) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <span className="mx-auto mb-3 block size-2.5 rounded-full bg-stone-300 dark:bg-stone-700" />
          <p className="text-sm font-medium text-stone-500 dark:text-stone-400">
            Nothing to preview yet
          </p>
          <p className="mt-1 text-[13px] text-stone-400 dark:text-stone-500">
            Ask for a site and watch it appear here.
          </p>
        </div>
      </div>
    );
  }
  return (
    <iframe
      key={`${projectId}:${version}`}
      src={`${API_BASE}/preview/${projectId}/?v=${version}`}
      sandbox="allow-scripts"
      title="Site preview"
      className="h-full w-full border-0 bg-white"
    />
  );
}
