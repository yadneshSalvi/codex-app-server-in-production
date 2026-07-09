"use client";

import { useEffect, useState } from "react";
import type { ApprovalBlock } from "@/lib/types";
import { DiffLines } from "@/components/DiffDrawer";

// The foreman's stamp: one card per question, rendered inline in the
// conversation at the exact position the turn paused. A command approval
// shows the command and where it would run; a file-change approval shows
// the patch itself — the dry-cleaning ticket inspected before it's hung.
// After the answer, the buttons give way to the outcome (who, and when).

// Wire decisions → button labels. `cancel` (deny + interrupt the turn)
// stays off the card: the Stop button already owns "abandon the turn",
// and two red buttons with different blast radii is how mistakes happen.
const BUTTONS: { decision: string; label: string; deny?: boolean }[] = [
  { decision: "accept", label: "Approve" },
  { decision: "acceptForSession", label: "Approve for session" },
  { decision: "decline", label: "Deny", deny: true },
];

// Show the auto-decline clock only once it matters (under two minutes);
// a countdown from ten minutes would just be noise.
const COUNTDOWN_MS = 2 * 60 * 1000;

function Countdown({ expiresAtMs }: { expiresAtMs: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const left = expiresAtMs - now;
  if (left > COUNTDOWN_MS || left <= 0) return null;
  const s = Math.floor(left / 1000);
  return (
    <span className="font-mono text-[11px] text-red-600 dark:text-red-400">
      auto-deny in {Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")}
    </span>
  );
}

function outcomeLine(resolved: NonNullable<ApprovalBlock["resolved"]>): string {
  const verdict =
    resolved.decision === "decline" || resolved.decision === "cancel"
      ? "Denied"
      : resolved.decision === "acceptForSession"
        ? "Approved for this session"
        : "Approved";
  const who =
    resolved.reason === "timeout" ? "automatically (nobody answered in time)" : "by you";
  const at = new Date(resolved.atMs).toLocaleTimeString();
  return `${verdict} ${who} · ${at}`;
}

export function ApprovalCard({
  block,
  onDecide,
}: {
  block: ApprovalBlock;
  onDecide: (approvalId: string, decision: string) => Promise<void>;
}) {
  // Disable the buttons the moment one is clicked; the approval_resolved
  // event flips the card to its outcome state a beat later.
  const [sending, setSending] = useState(false);
  const resolved = block.resolved;
  const denied =
    resolved && (resolved.decision === "decline" || resolved.decision === "cancel");

  return (
    <div
      data-testid="approval-card"
      data-approval-id={block.id}
      data-resolved={resolved ? "true" : "false"}
      className={`mb-4 overflow-hidden rounded-xl border ${
        resolved
          ? "border-stone-200 dark:border-stone-800"
          : "border-amber-400 dark:border-amber-600"
      }`}
    >
      <div
        className={`flex items-center justify-between gap-2 px-4 py-2 ${
          resolved ? "bg-stone-50 dark:bg-stone-900" : "bg-amber-50 dark:bg-amber-950/40"
        }`}
      >
        <div className="flex items-center gap-2">
          {!resolved && <span className="size-2 animate-pulse rounded-full bg-amber-500" />}
          <p className="font-mono text-[11px] uppercase tracking-wider text-stone-500 dark:text-stone-400">
            {block.kind === "command" ? "Approval needed — command" : "Approval needed — file change"}
          </p>
        </div>
        {!resolved && <Countdown expiresAtMs={block.expiresAtMs} />}
      </div>

      {block.reason && (
        <p className="px-4 pt-3 text-[13px] text-stone-600 dark:text-stone-300">{block.reason}</p>
      )}

      {block.kind === "command" ? (
        <div className="px-4 py-3">
          <pre className="overflow-x-auto rounded-lg bg-stone-900 px-3 py-2.5 font-mono text-xs leading-relaxed text-stone-100 dark:bg-stone-900 dark:ring-1 dark:ring-stone-800">
            {block.command}
          </pre>
          {block.cwd && (
            <p className="mt-1.5 truncate font-mono text-[11px] text-stone-400 dark:text-stone-500">
              in {block.cwd}
            </p>
          )}
        </div>
      ) : (
        <div className="py-2">
          <div className="max-h-64 overflow-auto">
            {block.diff ? (
              <DiffLines diff={block.diff} />
            ) : (
              // Honest fallback: the request named an item we never saw
              // (backend restarted mid-turn, say). Approving blind is
              // still the reader's call — but it is named as blind.
              <p className="px-4 py-1 text-[13px] text-stone-400 dark:text-stone-500">
                The patch for this change was not captured — approving is approving unseen.
              </p>
            )}
          </div>
          {block.files.length > 0 && (
            <p className="truncate px-4 pt-2 font-mono text-[11px] text-stone-400 dark:text-stone-500">
              {block.files.map((f) => `${f.kind}: ${f.path}`).join(" · ")}
            </p>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 border-t border-stone-200 px-4 py-2.5 dark:border-stone-800">
        {resolved ? (
          <p
            data-testid="approval-outcome"
            className={`text-[13px] ${
              denied ? "text-red-700 dark:text-red-400" : "text-green-700 dark:text-green-400"
            }`}
          >
            {outcomeLine(resolved)}
          </p>
        ) : (
          BUTTONS.filter((b) => block.availableDecisions.includes(b.decision)).map((b) => (
            <button
              key={b.decision}
              type="button"
              disabled={sending}
              onClick={async () => {
                setSending(true);
                try {
                  await onDecide(block.id, b.decision);
                } finally {
                  setSending(false);
                }
              }}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-40 ${
                b.deny
                  ? "border border-stone-300 text-stone-600 hover:border-red-400 hover:text-red-600 dark:border-stone-700 dark:text-stone-300"
                  : b.decision === "accept"
                    ? "bg-stone-900 text-stone-50 hover:bg-stone-700 dark:bg-stone-100 dark:text-stone-900"
                    : "border border-stone-300 text-stone-600 hover:border-accent hover:text-accent dark:border-stone-700 dark:text-stone-300"
              }`}
            >
              {b.label}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
