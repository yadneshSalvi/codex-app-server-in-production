"use client";

// Before/after photos of the job site: the turn's aggregate unified diff
// from turn/diff/updated, rendered by hand. A unified diff is just lines
// with a one-character prefix, so the whole renderer is a classifier —
// file headers, hunk markers, +/- tinting — and no dependency. Part 7
// reuses the classifier inside the approval card (DiffLines): the same
// renderer shows the patch before it lands as after.

function lineClass(line: string): string {
  if (line.startsWith("diff --git"))
    return "mt-3 border-y border-stone-200 bg-stone-100 py-1 font-semibold text-stone-700 first:mt-0 dark:border-stone-800 dark:bg-stone-800/80 dark:text-stone-200";
  if (/^(--- |\+\+\+ |index |new file|deleted file|similarity |rename )/.test(line))
    return "text-stone-400 dark:text-stone-500";
  if (line.startsWith("@@")) return "bg-accent/10 py-0.5 text-accent";
  if (line.startsWith("+"))
    return "bg-green-50 text-green-800 dark:bg-green-950/40 dark:text-green-300";
  if (line.startsWith("-"))
    return "bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-300";
  return "text-stone-600 dark:text-stone-400";
}

export function DiffLines({ diff }: { diff: string }) {
  return (
    <>
      {diff.split("\n").map((line, i) => (
        <div
          key={i}
          className={`whitespace-pre px-4 font-mono text-xs leading-relaxed ${lineClass(line)}`}
        >
          {line || " "}
        </div>
      ))}
    </>
  );
}

export function DiffDrawer({
  diff,
  open,
  onClose,
}: {
  diff: string;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <div
      aria-hidden={!open}
      className={`absolute inset-y-0 right-0 z-20 flex w-[460px] max-w-[90%] flex-col border-l border-stone-200 bg-white shadow-2xl transition-transform duration-200 dark:border-stone-800 dark:bg-stone-950 ${
        open ? "translate-x-0" : "translate-x-full"
      }`}
    >
      <div className="flex items-center justify-between border-b border-stone-200 px-4 py-2.5 dark:border-stone-800">
        <p className="font-mono text-[11px] uppercase tracking-wider text-stone-400 dark:text-stone-500">
          This turn&apos;s diff
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close diff"
          className="text-stone-400 hover:text-stone-600 dark:hover:text-stone-200"
        >
          &#x2715;
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto py-2">
        {diff ? (
          <DiffLines diff={diff} />
        ) : (
          <p className="px-4 py-1 text-[13px] text-stone-400 dark:text-stone-500">
            No changes yet in this turn.
          </p>
        )}
      </div>
    </div>
  );
}
