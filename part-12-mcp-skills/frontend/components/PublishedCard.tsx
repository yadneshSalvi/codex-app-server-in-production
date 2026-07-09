"use client";

import type { Manifest } from "@/lib/types";
import { API_BASE } from "@/lib/api";

// The receipt: the site is live, here is its address, and here is the
// manifest it shipped with — the outputSchema turn's answer doing its
// one job (this card, and the /p/ index it also drives). The accent
// swatch is the manifest's own reading of the site's dominant color.

const HEX = /^#[0-9a-fA-F]{3,8}$/;

export function PublishedCard({
  slug,
  url,
  name,
  manifest,
  forced,
}: {
  slug: string;
  url: string;
  name: string;
  manifest: Manifest | null;
  forced?: boolean;
}) {
  const accent = manifest && HEX.test(manifest.accent) ? manifest.accent : "#57534e";
  const href = `${API_BASE}${url}`;
  return (
    <div
      data-testid="published-card"
      data-slug={slug}
      className="mb-4 overflow-hidden rounded-xl border border-stone-200 dark:border-stone-800"
      style={{ borderTopWidth: 4, borderTopColor: accent }}
    >
      <div className="flex items-center justify-between gap-2 px-4 py-2">
        <p className="font-mono text-[11px] uppercase tracking-wider text-green-700 dark:text-green-400">
          Published
        </p>
        {forced && (
          <p className="font-mono text-[11px] text-amber-700 dark:text-amber-400">
            forced past the gate
          </p>
        )}
      </div>
      <div className="px-4 pb-3">
        <p className="text-[15px] font-semibold text-stone-800 dark:text-stone-100">
          {manifest?.title ?? name}
        </p>
        {manifest?.description && (
          <p className="mt-0.5 text-[13px] text-stone-500 dark:text-stone-400">
            {manifest.description}
          </p>
        )}
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            data-testid="published-link"
            className="rounded-lg bg-stone-900 px-3 py-1.5 font-mono text-xs text-stone-50 transition-colors hover:bg-stone-700 dark:bg-stone-100 dark:text-stone-900"
          >
            {url}
          </a>
          {manifest?.pages?.map((page) => (
            <span
              key={page.path}
              className="rounded border border-stone-200 px-2 py-1 font-mono text-[11px] text-stone-500 dark:border-stone-700 dark:text-stone-400"
            >
              {page.path}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
