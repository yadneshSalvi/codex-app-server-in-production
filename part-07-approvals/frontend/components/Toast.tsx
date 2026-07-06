"use client";

import { useEffect } from "react";

// The app's one notification surface: a small self-dismissing banner for
// failures that deserve attention but not a modal. No library needed.
export function Toast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 6000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <div
      role="status"
      className="fixed bottom-6 right-6 z-50 flex max-w-sm items-start gap-3 rounded-lg border border-red-200 bg-white px-4 py-3 shadow-lg dark:border-red-900/60 dark:bg-stone-900"
    >
      <svg viewBox="0 0 20 20" className="mt-0.5 size-4 shrink-0 fill-red-600 dark:fill-red-400">
        <path d="M10 1.5 19 18H1L10 1.5zm-.9 6v5h1.8v-5H9.1zm0 6.4v1.8h1.8v-1.8H9.1z" />
      </svg>
      <p className="min-w-0 flex-1 break-words text-sm text-stone-700 dark:text-stone-200">{message}</p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="shrink-0 text-stone-400 hover:text-stone-600 dark:hover:text-stone-200"
      >
        &#x2715;
      </button>
    </div>
  );
}
