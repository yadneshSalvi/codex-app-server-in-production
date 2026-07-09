"use client";

import { useState } from "react";
import type { Question, QuestionBlock } from "@/lib/types";

// The consultation card: the agent asked, its tool call is frozen, and
// this is where the answer happens. Same visual language as the
// ApprovalCard — a header that names what is being asked, an amber
// border while the question hangs, buttons that give way to the outcome
// — but the body is the protocol's own question list: radio options
// with descriptions, plus a free-text line when isOther allows it.

function QuestionFields({
  q,
  value,
  onChange,
}: {
  q: Question;
  value: string;
  onChange: (answer: string) => void;
}) {
  // One selected answer per question; "" means unanswered. The typed
  // answer and the radio row share the value — picking one clears the
  // other, which mirrors what the agent will receive (one string).
  const options = q.options ?? [];
  const isTyped = value !== "" && !options.some((o) => o.label === value);
  return (
    <fieldset className="px-4 py-3">
      <legend className="mb-1 flex items-baseline gap-2">
        <span className="font-mono text-[11px] uppercase tracking-wider text-stone-400 dark:text-stone-500">
          {q.header}
        </span>
      </legend>
      <p className="mb-2 text-[13px] text-stone-700 dark:text-stone-200">{q.question}</p>
      <div className="flex flex-col gap-1.5">
        {options.map((o) => (
          <label
            key={o.label}
            className={`flex cursor-pointer items-baseline gap-2.5 rounded-lg border px-3 py-2 ${
              value === o.label
                ? "border-accent bg-accent/5"
                : "border-stone-200 hover:border-stone-300 dark:border-stone-800 dark:hover:border-stone-700"
            }`}
          >
            <input
              type="radio"
              name={q.id}
              checked={value === o.label}
              onChange={() => onChange(o.label)}
              className="translate-y-0.5 accent-current"
            />
            <span className="text-[13px]">
              <span className="font-medium">{o.label}</span>
              {o.description && (
                <span className="text-stone-500 dark:text-stone-400"> — {o.description}</span>
              )}
            </span>
          </label>
        ))}
        {(q.isOther || options.length === 0) && (
          <input
            type={q.isSecret ? "password" : "text"}
            value={isTyped ? value : ""}
            onChange={(e) => onChange(e.target.value)}
            placeholder={options.length === 0 ? "Type your answer…" : "Or type your own…"}
            data-testid={`question-other-${q.id}`}
            className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-[13px] outline-none placeholder:text-stone-400 focus:border-accent dark:border-stone-800 dark:bg-stone-900"
          />
        )}
      </div>
    </fieldset>
  );
}

export function QuestionCard({
  block,
  onAnswer,
}: {
  block: QuestionBlock;
  onAnswer: (questionId: string, answers: Record<string, string[]>) => Promise<void>;
}) {
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const resolved = block.resolved;
  const complete = block.questions.every((q) => (picked[q.id] ?? "") !== "");

  return (
    <div
      data-testid="question-card"
      data-question-id={block.id}
      data-resolved={resolved ? "true" : "false"}
      className={`mb-4 overflow-hidden rounded-xl border ${
        resolved
          ? "border-stone-200 dark:border-stone-800"
          : "border-amber-400 dark:border-amber-600"
      }`}
    >
      <div
        className={`flex items-center gap-2 px-4 py-2 ${
          resolved ? "bg-stone-50 dark:bg-stone-900" : "bg-amber-50 dark:bg-amber-950/40"
        }`}
      >
        {!resolved && <span className="size-2 animate-pulse rounded-full bg-amber-500" />}
        <p className="font-mono text-[11px] uppercase tracking-wider text-stone-500 dark:text-stone-400">
          The builder has a question
        </p>
      </div>

      {resolved ? (
        <div className="px-4 py-3">
          {block.questions.map((q) => (
            <p key={q.id} className="text-[13px] text-stone-600 dark:text-stone-300">
              <span className="text-stone-400 dark:text-stone-500">{q.header}: </span>
              {resolved.reason === "timeout"
                ? "unanswered (the builder chose for itself)"
                : (resolved.answers[q.id] ?? []).join(", ") || "—"}
            </p>
          ))}
          <p
            data-testid="question-outcome"
            className={`mt-1.5 text-xs ${
              resolved.reason === "timeout"
                ? "text-stone-400 dark:text-stone-500"
                : "text-green-700 dark:text-green-400"
            }`}
          >
            {resolved.reason === "timeout"
              ? "Nobody answered in time · " + new Date(resolved.atMs).toLocaleTimeString()
              : "Answered by you · " + new Date(resolved.atMs).toLocaleTimeString()}
          </p>
        </div>
      ) : (
        <>
          {block.questions.map((q) => (
            <QuestionFields
              key={q.id}
              q={q}
              value={picked[q.id] ?? ""}
              onChange={(answer) => setPicked((p) => ({ ...p, [q.id]: answer }))}
            />
          ))}
          <div className="border-t border-stone-200 px-4 py-2.5 dark:border-stone-800">
            <button
              type="button"
              data-testid="question-submit"
              disabled={!complete || sending}
              onClick={async () => {
                setSending(true);
                try {
                  // The protocol allows several answers per question;
                  // the card collects one.
                  await onAnswer(
                    block.id,
                    Object.fromEntries(
                      block.questions.map((q) => [q.id, [picked[q.id] ?? ""]]),
                    ),
                  );
                } finally {
                  setSending(false);
                }
              }}
              className="rounded-lg bg-stone-900 px-3 py-1.5 text-xs font-medium text-stone-50 transition-colors hover:bg-stone-700 disabled:opacity-40 dark:bg-stone-100 dark:text-stone-900"
            >
              Answer
            </button>
          </div>
        </>
      )}
    </div>
  );
}
