"use client";

import { useState } from "react";
import type { ReviewBlock, ReviewFinding, Severity } from "@/lib/types";

// The inspector's report card: findings grouped by severity, each with
// its location as the reviewer wrote it (path:line). The parsed rows
// exist for scanning; the raw findings text — the truth the rows were
// regexed from — folds out at the bottom. "Fix findings" hands the raw
// text back to the builder as an ordinary turn: the inspector and the
// builder never share a clipboard, only the site.

const SEVERITIES: {
  severity: Severity;
  label: string;
  chip: string;
  border: string;
}[] = [
  {
    severity: "P1",
    label: "Blockers — must fix before publishing",
    chip: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
    border: "border-red-300 dark:border-red-800",
  },
  {
    severity: "P2",
    label: "Should fix",
    chip: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
    border: "border-amber-300 dark:border-amber-800",
  },
  {
    severity: "P3",
    label: "Nice to have",
    chip: "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300",
    border: "border-stone-200 dark:border-stone-700",
  },
];

function FindingRow({ finding, chip }: { finding: ReviewFinding; chip: string }) {
  return (
    <li
      data-testid={`review-finding-${finding.severity}`}
      className="flex items-start gap-2.5 px-4 py-2.5"
    >
      <span
        className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold ${chip}`}
      >
        {finding.severity}
      </span>
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-stone-800 dark:text-stone-200">
          {finding.title}
        </p>
        {finding.body && (
          <p className="mt-0.5 text-[12px] leading-relaxed text-stone-500 dark:text-stone-400">
            {finding.body}
          </p>
        )}
        {finding.location && (
          <code className="mt-1 inline-block rounded bg-stone-100 px-1.5 py-0.5 font-mono text-[11px] text-stone-600 dark:bg-stone-800 dark:text-stone-300">
            {finding.location}
          </code>
        )}
      </div>
    </li>
  );
}

export function ReviewReportCard({
  block,
  working,
  onFix,
}: {
  block: ReviewBlock;
  // The turn that could absorb a fix right now — while one runs, the
  // button waits its turn.
  working: boolean;
  onFix: (raw: string) => void;
}) {
  const [sent, setSent] = useState(false);
  const running = block.phase === "running";
  const clean = !running && block.findings.length === 0;
  const p1 = block.counts?.P1 ?? 0;

  return (
    <div
      data-testid="review-report-card"
      data-phase={block.phase}
      className={`mb-4 overflow-hidden rounded-xl border ${
        running
          ? "border-sky-300 dark:border-sky-800"
          : clean
            ? "border-green-300 dark:border-green-800"
            : p1 > 0
              ? "border-red-300 dark:border-red-800"
              : "border-amber-300 dark:border-amber-800"
      }`}
    >
      <div
        className={`flex items-center justify-between gap-2 px-4 py-2 ${
          running
            ? "bg-sky-50 dark:bg-sky-950/40"
            : clean
              ? "bg-green-50 dark:bg-green-950/30"
              : "bg-stone-50 dark:bg-stone-900"
        }`}
      >
        <div className="flex items-center gap-2">
          {running && <span className="size-2 animate-pulse rounded-full bg-sky-500" />}
          <p className="font-mono text-[11px] uppercase tracking-wider text-stone-500 dark:text-stone-400">
            {running ? "Inspection in progress" : "Inspector's report"}
          </p>
        </div>
        {!running && block.counts && (
          <p className="font-mono text-[11px] text-stone-400 dark:text-stone-500">
            {block.counts.P1} blocker · {block.counts.P2} should-fix · {block.counts.P3} minor
          </p>
        )}
      </div>

      {running && (
        <p className="px-4 py-3 text-[13px] text-stone-500 dark:text-stone-400">
          Fresh eyes are reading the site against the brief. This is a real
          investigation — commands below are the inspector working — and it
          takes a minute or two.
        </p>
      )}

      {clean && (
        <p
          data-testid="review-clean"
          className="px-4 py-3 text-[13px] text-green-700 dark:text-green-400"
        >
          No findings. The site matches the brief, the references resolve,
          and nothing blocks publishing.
        </p>
      )}

      {!running &&
        SEVERITIES.map(({ severity, label, chip }) => {
          const rows = block.findings.filter((f) => f.severity === severity);
          if (rows.length === 0) return null;
          return (
            <div key={severity} className="border-t border-stone-100 dark:border-stone-800">
              <p className="px-4 pt-2.5 text-[11px] font-medium uppercase tracking-wider text-stone-400 dark:text-stone-500">
                {label}
              </p>
              <ul className="divide-y divide-stone-100 dark:divide-stone-800">
                {rows.map((finding, i) => (
                  <FindingRow key={i} finding={finding} chip={chip} />
                ))}
              </ul>
            </div>
          );
        })}

      {!running && block.raw && (
        <details className="border-t border-stone-100 px-4 py-2 dark:border-stone-800">
          <summary className="cursor-pointer font-mono text-[11px] text-stone-400 dark:text-stone-500">
            the reviewer&apos;s words, unparsed
          </summary>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-stone-50 p-3 text-[12px] leading-relaxed text-stone-600 dark:bg-stone-900 dark:text-stone-300">
            {block.raw}
          </pre>
        </details>
      )}

      {!running && block.findings.length > 0 && (
        <div className="border-t border-stone-200 px-4 py-2.5 dark:border-stone-800">
          <button
            type="button"
            data-testid="fix-findings"
            disabled={working || sent}
            onClick={() => {
              setSent(true);
              onFix(block.raw ?? "");
            }}
            className="rounded-lg bg-stone-900 px-3 py-1.5 text-xs font-medium text-stone-50 transition-colors hover:bg-stone-700 disabled:opacity-40 dark:bg-stone-100 dark:text-stone-900"
          >
            {sent ? "Findings sent to the builder" : "Fix findings"}
          </button>
        </div>
      )}
    </div>
  );
}
