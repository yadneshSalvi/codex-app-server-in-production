"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AgentEvent,
  Block,
  ChatMessage,
  Mode,
  PlanStep,
  Project,
  UsageReading,
  WorkspaceFile,
} from "@/lib/types";
import { API_BASE } from "@/lib/api";
import { Markdown } from "@/components/Markdown";
import { CommandBadge } from "@/components/CommandBadge";
import { ReasoningDrawer } from "@/components/ReasoningDrawer";
import { ItemBadge } from "@/components/ItemBadge";
import { Toast } from "@/components/Toast";
import { ProjectsSidebar } from "@/components/ProjectsSidebar";
import { PreviewPane } from "@/components/PreviewPane";
import { FilesPane } from "@/components/FilesPane";
import { DiffDrawer } from "@/components/DiffDrawer";
import { ApprovalCard } from "@/components/ApprovalCard";
import { ModeChip, ModePicker } from "@/components/ModePicker";
import { TokenGauge } from "@/components/TokenGauge";
import { QuestionCard } from "@/components/QuestionCard";
import { PlanChecklist } from "@/components/PlanChecklist";
import {
  CareLevelPicker,
  careDials,
  type CareLevel,
} from "@/components/CareLevelPicker";

const SAMPLE_PROMPTS = [
  "Read brief/brief.md and build the site it describes",
  "Build a one-page site for a small bakery: hero, menu, contact",
  "Make the hero headline bigger and add a footer",
];

// A flooding command can outrun the reader; keep the tail, which is the
// part a terminal would be showing anyway.
const OUTPUT_CAP = 8_000;

type AssistantMessage = Extract<ChatMessage, { role: "assistant" }>;

// One wire event goes in, a new block list comes out. text_delta appends
// to an open text block (or starts one); everything item-shaped is
// matched BY item_id, never by position — two items can be live at once.
function applyEvent(blocks: Block[], event: AgentEvent): Block[] {
  if (event.type === "text_delta") {
    const last = blocks[blocks.length - 1];
    if (last?.type === "text") {
      return [...blocks.slice(0, -1), { ...last, text: last.text + event.text }];
    }
    return [...blocks, { type: "text", text: event.text }];
  }
  if (event.type === "item_start") {
    // An agentMessage's content arrives as text_delta; no badge for it.
    if (event.kind === "agentMessage") return blocks;
    return [
      ...blocks,
      { type: "item", id: event.item_id, kind: event.kind, detail: event.detail, output: "", reasoning: "", done: false },
    ];
  }
  if (event.type === "item_done") {
    if (event.kind === "agentMessage") return blocks;
    return blocks.map((b) =>
      b.type === "item" && b.id === event.item_id ? { ...b, detail: event.detail, done: true } : b,
    );
  }
  if (event.type === "reasoning_delta") {
    return blocks.map((b) =>
      b.type === "item" && b.id === event.item_id ? { ...b, reasoning: b.reasoning + event.text } : b,
    );
  }
  if (event.type === "command_output_delta") {
    return blocks.map((b) =>
      b.type === "item" && b.id === event.item_id
        ? { ...b, output: (b.output + event.chunk).slice(-OUTPUT_CAP) }
        : b,
    );
  }
  // Part 7: an approval is appended at its arrival position — exactly
  // where the turn paused — and later patched in place by its answer.
  if (event.type === "approval_request") {
    return [
      ...blocks,
      {
        type: "approval",
        id: event.approval_id,
        kind: event.kind,
        command: event.command,
        cwd: event.cwd,
        reason: event.reason,
        files: event.files ?? [],
        diff: event.diff ?? "",
        availableDecisions: event.available_decisions,
        expiresAtMs: event.expires_at_ms,
      },
    ];
  }
  if (event.type === "approval_resolved") {
    return blocks.map((b) =>
      b.type === "approval" && b.id === event.approval_id
        ? {
            ...b,
            resolved: {
              decision: event.decision,
              reason: event.reason,
              atMs: event.resolved_at_ms,
            },
          }
        : b,
    );
  }
  // Part 10: a question is the approval pattern's third customer — same
  // arrival-position card, same patch-in-place answer.
  if (event.type === "question_request") {
    return [
      ...blocks,
      {
        type: "question",
        id: event.question_id,
        questions: event.questions,
        expiresAtMs: event.expires_at_ms,
      },
    ];
  }
  if (event.type === "question_resolved") {
    return blocks.map((b) =>
      b.type === "question" && b.id === event.question_id
        ? {
            ...b,
            resolved: {
              answers: event.answers,
              reason: event.reason,
              atMs: event.resolved_at_ms,
            },
          }
        : b,
    );
  }
  return blocks;
}

function BlockView({
  block,
  onDecide,
  onAnswer,
}: {
  block: Block;
  onDecide: (approvalId: string, decision: string) => Promise<void>;
  onAnswer: (questionId: string, answers: Record<string, string[]>) => Promise<void>;
}) {
  if (block.type === "text") return <Markdown text={block.text} />;
  if (block.type === "approval") return <ApprovalCard block={block} onDecide={onDecide} />;
  if (block.type === "question") return <QuestionCard block={block} onAnswer={onAnswer} />;
  if (block.kind === "commandExecution") return <CommandBadge block={block} />;
  if (block.kind === "reasoning") return <ReasoningDrawer block={block} />;
  return <ItemBadge block={block} />;
}

function WorkingTimer({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const seconds = Math.max(0, Math.round((now - startedAt) / 1000));
  return (
    <div className="mt-2 flex items-center gap-2 text-[13px] text-stone-400 dark:text-stone-500">
      <span className="size-2 animate-pulse rounded-full bg-accent" />
      Building… {seconds}s
    </div>
  );
}

export default function Home() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  // Whether a turn is running — no longer "am I holding a stream open"
  // but a fact read off the log: session_start raises it, the receipt
  // (complete / error / backend_restarted) lowers it. Every tab watching
  // this project computes the same answer, which is why Stop works from
  // any of them.
  const [working, setWorking] = useState(false);
  // EventSource reconnects by itself; this only keeps the header honest
  // while it does.
  const [connected, setConnected] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  // The project's stream (one EventSource per open project) and whether
  // it has reached the live edge (the caught_up marker). During replay,
  // side effects that only make sense once — refetch files, bump the
  // preview — are held back and done a single time at the seam.
  const esRef = useRef<EventSource | null>(null);
  const liveRef = useRef(false);
  // One POST /chat in flight at a time; the log renders the result.
  const sendingRef = useRef(false);

  // The workspace side of the screen: which project, its files, the
  // preview's cache-buster, and the turn's diff.
  const [projects, setProjects] = useState<Project[]>([]);
  const [briefs, setBriefs] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [badges, setBadges] = useState<Record<string, string>>({});
  const [diff, setDiff] = useState("");
  const [diffOpen, setDiffOpen] = useState(false);
  const [previewVersion, setPreviewVersion] = useState(0);
  // The meter: the latest usage_update for the open project — `.turn`
  // for the running turn (the backend's computed delta), `.total` for
  // the thread.
  const [usage, setUsage] = useState<UsageReading | null>(null);
  // Part 10, the composer's two new dials: send the next message as a
  // read-only blueprint turn, and how hard the builder should think.
  const [planFirst, setPlanFirst] = useState(false);
  const [careLevel, setCareLevel] = useState<CareLevel>("standard");
  // The agent's checklist for the newest turn (plan_update); null when
  // the turn hasn't sent one — many turns don't, and blueprint turns
  // usually don't (the plan tool tracks progress, not proposals).
  const [plan, setPlan] = useState<{
    steps: PlanStep[];
    explanation?: string | null;
  } | null>(null);

  const loadFiles = useCallback(async (id: string) => {
    try {
      const res = await fetch(`${API_BASE}/projects/${id}/files`);
      if (res.ok) setFiles((await res.json()).files);
    } catch {
      // A dead backend surfaces as a toast from send(); stay quiet here.
    }
  }, []);

  // Re-pull the registry after events that change it server-side: a
  // completed first turn (the auto-title landed) or a fork.
  const refreshProjects = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/projects`);
      if (res.ok) setProjects((await res.json()).projects);
    } catch {
      // Quiet: the sidebar just keeps its last known names.
    }
  }, []);

  const patchTurn = useCallback(
    (turnId: string | undefined, patch: Partial<AssistantMessage>) => {
      setMessages((all) => {
        // The receipt names its turn; find that message. A log replays
        // many turns, so "the last assistant message" is only the
        // fallback for events that predate turn_id on the wire.
        let i = all.findLastIndex(
          (m) => m.role === "assistant" && turnId !== undefined && m.turnId === turnId,
        );
        if (i < 0) i = all.findLastIndex((m) => m.role === "assistant");
        const target = i >= 0 ? all[i] : undefined;
        if (target?.role !== "assistant") return all;
        const next: AssistantMessage = { ...target, ...patch };
        return all.map((m, j) => (j === i ? next : m));
      });
    },
    [],
  );

  // One wire event goes in — replayed or live, this switch cannot tell
  // and must not care. It is Part 8's read-loop switch with the message
  // bookkeeping moved in: the log carries the user's words (session_start
  // and steered), so the conversation is BUILT from the stream instead of
  // typed into it. That is what makes a second tab, a refreshed tab, and
  // the tab that sent the message render the same thing.
  const handleEvent = useCallback(
    (event: AgentEvent, projectId: string) => {
      const live = liveRef.current;
      if (event.type === "session_start") {
        // A new turn enters the log. The badges, the diff and the plan
        // describe ONE turn; a new turn starts clean (this was send()'s
        // job when the sender owned the stream).
        setBadges({});
        setDiff("");
        setPlan(null);
        setWorking(true);
        setMessages((all) => {
          const next: ChatMessage[] = [...all];
          if (event.message !== undefined)
            next.push({ role: "user", text: event.message, blueprint: event.plan_first });
          next.push({
            role: "assistant",
            blocks: [],
            status: "working",
            turnId: event.turn_id,
            planFirst: event.plan_first,
            effort: event.effort,
            startedAtMs: event.started_at_ms ?? Date.now(),
          });
          return next;
        });
      } else if (event.type === "plan_update") {
        // The checklist, whole every time — the last write wins, which
        // is also what makes replay trivial.
        setPlan({ steps: event.steps, explanation: event.explanation });
      } else if (event.type === "steered") {
        // Every tab learns a steer landed the same way — including the
        // one that sent it. The chip is no longer optimistic.
        setMessages((all) => [...all, { role: "user", text: event.text, steered: true }]);
      } else if (event.type === "thread_reset") {
        // The saved conversation could not be restored; a fresh thread
        // took its place. Slot a quiet notice in front of the message
        // that triggered it — the files are fine, only history is gone.
        setMessages((all) => [
          ...all.slice(0, -2),
          { role: "notice", text: "History could not be restored. Files are intact." },
          ...all.slice(-2),
        ]);
      } else if (event.type === "complete") {
        patchTurn(event.turn_id, {
          status:
            event.status === "completed"
              ? "done"
              : event.status === "interrupted"
                ? "stopped"
                : "error",
          // Per-turn since Part 8: `usage` is the backend's computed
          // delta of totals — what THIS turn cost. Not the thread's
          // cumulative bill, and not `.last` (one model request's sliver).
          totalTokens: event.usage?.totalTokens,
          durationMs: event.duration_ms,
        });
        setWorking(false);
        if (live) {
          // Commands (cp, rm) change the workspace without fileChange
          // items; one refresh at the end catches whatever they did.
          loadFiles(projectId);
          setPreviewVersion((v) => v + 1);
          // The first completed turn auto-titles the thread server-side;
          // re-pull the registry so the sidebar learns the name.
          refreshProjects();
        }
      } else if (event.type === "backend_restarted") {
        // The tombstone from the startup sweep: the previous backend
        // took this turn down with it. Nothing is resurrected — the
        // workspace and the thread survived, and the next message picks
        // the conversation up via thread/resume.
        setWorking(false);
        setMessages((all) => {
          let i = all.findLastIndex(
            (m) => m.role === "assistant" && m.turnId === event.turn_id,
          );
          if (i < 0) i = all.findLastIndex((m) => m.role === "assistant");
          const target = i >= 0 ? all[i] : undefined;
          const orphaned: AssistantMessage | undefined =
            target?.role === "assistant" && target.status === "working"
              ? { ...target, status: "orphaned" }
              : undefined;
          const patched = orphaned ? all.map((m, j) => (j === i ? orphaned : m)) : all;
          return [
            ...patched,
            {
              role: "notice",
              text: "The backend restarted mid-build. The files and the conversation survived — send the next message to continue.",
            },
          ];
        });
      } else if (event.type === "error") {
        patchTurn(undefined, { status: "error" });
        setWorking(false);
        if (live) setToast(event.message);
      } else if (event.type === "usage_update") {
        setUsage({
          last: event.last,
          total: event.total,
          turn: event.turn,
          context_window: event.context_window,
        });
      } else if (event.type === "file_change") {
        setBadges((prev) => {
          const next = { ...prev };
          for (const f of event.files) next[f.path] = f.kind;
          return next;
        });
        if (event.status === "done" && live) loadFiles(projectId);
      } else if (event.type === "diff_updated") {
        setDiff(event.unified_diff);
      } else if (event.type === "preview_refresh") {
        if (live) setPreviewVersion((v) => v + 1);
      } else {
        // Deltas, items, approvals: they belong to the turn that is
        // open, i.e. the last assistant message.
        setMessages((all) => {
          const i = all.findLastIndex((m) => m.role === "assistant");
          if (i < 0) return all;
          const target = all[i] as AssistantMessage;
          return all.map((m, j) =>
            j === i ? { ...target, blocks: applyEvent(target.blocks, event) } : m,
          );
        });
      }
    },
    [loadFiles, refreshProjects, patchTurn],
  );

  // Attach to the project's log: replay first (everything past the
  // browser's Last-Event-ID bookmark — from seq 1 on a fresh tab), then
  // the live tail. The conversation you see IS the replay; there is no
  // separate history fetch. And on a dropped connection there are no
  // onerror theatrics: EventSource retries by itself, sends the bookmark
  // back, the server replays what was missed, and the seq guard swallows
  // any overlap.
  const followStream = useCallback(
    (projectId: string) => {
      esRef.current?.close();
      liveRef.current = false;
      const es = new EventSource(`${API_BASE}/projects/${projectId}/stream`);
      esRef.current = es;
      let lastSeq = 0;
      es.onopen = () => setConnected(true);
      es.onerror = () => setConnected(false);
      es.onmessage = (e) => {
        const event = JSON.parse(e.data) as AgentEvent;
        if (event.type === "caught_up") {
          // The seam between past and present. Side effects held back
          // during replay happen once, here: the files pane and the
          // preview catch up to everything the replay described.
          if (!liveRef.current) {
            liveRef.current = true;
            loadFiles(projectId);
            setPreviewVersion((v) => v + 1);
          }
          return;
        }
        // The dedup guard. Replay-then-follow delivers at least once;
        // the seq in the SSE id field makes it exactly-once where it
        // matters. (caught_up is handled above the guard: it carries no
        // id, so e.lastEventId would hold the PREVIOUS event's seq.)
        const seq = Number(e.lastEventId);
        if (seq) {
          if (seq <= lastSeq) return;
          lastSeq = seq;
        }
        handleEvent(event, projectId);
      };
    },
    [handleEvent, loadFiles],
  );

  // Close the stream when the page unmounts; project switches close it
  // inside followStream.
  useEffect(() => () => esRef.current?.close(), []);

  const selectProject = useCallback(
    (id: string) => {
      setActiveId(id);
      setMessages([]);
      setBadges({});
      setDiff("");
      setDiffOpen(false);
      setFiles([]);
      setUsage(null);
      setPlan(null);
      setPlanFirst(false);
      setWorking(false);
      setPreviewVersion((v) => v + 1);
      loadFiles(id);
      // The log is the conversation: no /history fetch, no /usage fetch.
      // Replay rebuilds the messages, the meter refills from the replayed
      // usage_updates, and if a turn is still running the timer and Stop
      // button come back too — that is the whole part.
      followStream(id);
    },
    [loadFiles, followStream],
  );

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/projects`);
        const data = await res.json();
        setProjects(data.projects);
        setBriefs(data.briefs);
        if (data.projects.length > 0) {
          selectProject(data.projects[data.projects.length - 1].id);
        }
      } catch {
        setToast("Could not reach the backend. Is it running?");
      }
    })();
  }, [selectProject]);

  async function createProject(brief: string | null) {
    try {
      const res = await fetch(`${API_BASE}/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(brief ? { brief } : {}),
      });
      if (!res.ok) throw new Error(`The server said ${res.status}.`);
      const entry: Project = await res.json();
      setProjects((all) => [...all, entry]);
      selectProject(entry.id);
    } catch {
      setToast("Could not create the project. Is the backend running?");
    }
  }

  // Change the active project's wristband. Optimistic: the picker moves
  // now, the PATCH persists it, and a failure rolls the registry back.
  async function changeMode(mode: Mode) {
    if (!activeId) return;
    const before = projects;
    setProjects((all) => all.map((p) => (p.id === activeId ? { ...p, mode } : p)));
    try {
      const res = await fetch(`${API_BASE}/projects/${activeId}/mode`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      if (!res.ok) throw new Error(`The server said ${res.status}.`);
    } catch {
      setProjects(before);
      setToast("Could not change the mode. Is the backend running?");
    }
  }

  // Answer one approval card. No optimistic flip: the backend resolves
  // the Future, the JSON-RPC response unfreezes the item, and the
  // approval_resolved event flips the card — the stream stays the one
  // source of truth about what was decided.
  const decide = useCallback(
    async (approvalId: string, decision: string) => {
      if (!activeId) return;
      try {
        const res = await fetch(
          `${API_BASE}/projects/${activeId}/approvals/${approvalId}/decision`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ decision }),
          },
        );
        if (!res.ok) throw new Error(`The server said ${res.status}.`);
      } catch {
        setToast("Could not send the decision. Is the backend running?");
      }
    },
    [activeId],
  );

  // Answer one question card — the decide() pattern, third customer.
  // No optimistic flip here either: the backend fills the Future, the
  // JSON-RPC response unfreezes the agent's tool call, and the
  // question_resolved event flips the card in every tab at once.
  const answer = useCallback(
    async (questionId: string, answers: Record<string, string[]>) => {
      if (!activeId) return;
      try {
        const res = await fetch(
          `${API_BASE}/projects/${activeId}/questions/${questionId}/answer`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ answers }),
          },
        );
        if (!res.ok) throw new Error(`The server said ${res.status}.`);
      } catch {
        setToast("Could not send the answer. Is the backend running?");
      }
    },
    [activeId],
  );

  // The Stop button. It does NOT abort the fetch — it asks the backend
  // to turn/interrupt the live turn, and the truth comes back on the
  // stream: turn/completed with status "interrupted", which the receipt
  // renders as "stopped by you". Closing the tap is not stopping the
  // machine; this stops the machine.
  const stopTurn = useCallback(async () => {
    if (!activeId) return;
    try {
      const res = await fetch(`${API_BASE}/projects/${activeId}/interrupt`, {
        method: "POST",
      });
      if (!res.ok) throw new Error(`The server said ${res.status}.`);
    } catch {
      setToast("Could not stop the turn — it may have just finished.");
    }
  }, [activeId]);

  async function forkProject(id: string) {
    // Both halves get photocopied server-side — thread/fork for the
    // conversation, cp -r for the workspace — and a new sidebar entry
    // comes back ready to diverge.
    try {
      const res = await fetch(`${API_BASE}/projects/${id}/fork`, { method: "POST" });
      if (!res.ok) throw new Error(`The server said ${res.status}.`);
      const entry: Project = await res.json();
      setProjects((all) => [...all, entry]);
      selectProject(entry.id);
    } catch {
      setToast("Could not fork the project.");
    }
  }

  // Follow the conversation as it grows, unless the reader scrolled up
  // to study something; then leave them alone.
  useEffect(() => {
    if (stickRef.current) {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    }
  }, [messages]);

  // Send a message. That is the whole function now: POST it and let the
  // log do the rendering. The backend answers a steer with plain JSON
  // and a new turn with a claim ticket ({turn_id, stream_url}) — and
  // either way the events arrive on the project's stream, where this
  // tab is just one subscriber among however many are open. Nothing is
  // drawn optimistically: the words appear when session_start (or
  // steered) comes back through the log, the same instant they appear
  // in every other tab.
  async function send(text: string) {
    const prompt = text.trim();
    if (!prompt || !activeId || sendingRef.current) return;
    setInput("");
    sendingRef.current = true;
    // The dials ride every message. plan_first is one-shot: the toggle
    // arms ONE blueprint turn and disarms itself, so the natural
    // follow-up ("build it") goes out at the project's own mode without
    // the user having to remember the switch.
    const { effort, summary } = careDials(careLevel);
    const blueprint = planFirst && !working;
    try {
      const res = await fetch(`${API_BASE}/projects/${activeId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: prompt,
          plan_first: blueprint,
          effort,
          summary,
        }),
      });
      if (!res.ok) throw new Error(`The server said ${res.status}.`);
      if (blueprint) setPlanFirst(false);
    } catch {
      setToast("Could not send the message. Is the backend running?");
      setInput(prompt); // hand the words back instead of eating them
    } finally {
      sendingRef.current = false;
    }
  }

  const hasSite = files.some((f) => f.path === "index.html");
  const activeProject = projects.find((p) => p.id === activeId);
  const mode: Mode = activeProject?.mode ?? "standard";
  // The turn is frozen on a question. The composer stays usable (type
  // away), but sending waits for the turn — the chip says why.
  const awaitingApproval = messages.some(
    (m) =>
      m.role === "assistant" &&
      m.status === "working" &&
      m.blocks.some((b) => b.type === "approval" && !b.resolved),
  );
  // Same freeze, different card: the agent asked a question and its
  // tool call waits on the answer sheet.
  const awaitingQuestion = messages.some(
    (m) =>
      m.role === "assistant" &&
      m.status === "working" &&
      m.blocks.some((b) => b.type === "question" && !b.resolved),
  );

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center justify-between gap-3 border-b border-stone-200 px-5 py-3 dark:border-stone-800">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="size-2.5 shrink-0 rounded-full bg-accent" />
          <h1 className="text-[15px] font-semibold tracking-tight">Pagewright</h1>
          <span className="hidden truncate font-mono text-xs text-stone-400 md:inline dark:text-stone-500">
            the site builder
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {/* EventSource is already retrying when this shows; it only
              keeps the header from pretending everything is fine. */}
          {!connected && activeId && (
            <span
              data-testid="reconnecting-chip"
              className="flex items-center gap-1.5 font-mono text-[11px] text-amber-600 dark:text-amber-400"
            >
              <span className="size-1.5 animate-pulse rounded-full bg-amber-500" />
              reconnecting…
            </span>
          )}
          {/* The meter (this turn · this thread) and the wristband rack. */}
          <TokenGauge usage={usage} />
          {activeProject && <ModePicker mode={mode} busy={working} onChange={changeMode} />}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* The filing wall: every job folder, reopenable and forkable. */}
        <ProjectsSidebar
          projects={projects}
          briefs={briefs}
          activeId={activeId}
          busy={working}
          onSelect={selectProject}
          onCreate={createProject}
          onFork={forkProject}
        />

        {/* The conversation: everything Part 3 built, now one column. */}
        <section className="flex w-[44%] min-w-[360px] max-w-2xl flex-col border-r border-stone-200 dark:border-stone-800">
          {activeProject && (
            <div className="flex items-center justify-between gap-2 border-b border-stone-200 px-5 py-2 dark:border-stone-800">
              <span className="truncate text-[13px] font-medium text-stone-600 dark:text-stone-300">
                {activeProject.name}
              </span>
              <ModeChip mode={mode} />
            </div>
          )}
          <div
            ref={scrollRef}
            onScroll={() => {
              const el = scrollRef.current;
              if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
            }}
            className="flex-1 overflow-y-auto"
          >
            <main className="px-5 py-6">
              {messages.length === 0 && (
                <div className="mt-20 flex flex-col items-center text-center">
                  <span className="mb-4 size-3 rounded-full bg-accent" />
                  {activeId ? (
                    <>
                      <h2 className="text-lg font-semibold">Describe a website</h2>
                      <p className="mt-1.5 max-w-sm text-sm text-stone-500 dark:text-stone-400">
                        Pagewright builds it in this project&apos;s workspace — and the preview on
                        the right refreshes as every file lands.
                      </p>
                      <div className="mt-6 flex flex-col gap-2">
                        {SAMPLE_PROMPTS.map((q) => (
                          <button
                            key={q}
                            type="button"
                            onClick={() => send(q)}
                            className="rounded-lg border border-stone-200 bg-white px-4 py-2 text-sm text-stone-600 hover:border-accent hover:text-accent dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300"
                          >
                            {q}
                          </button>
                        ))}
                      </div>
                    </>
                  ) : (
                    <>
                      <h2 className="text-lg font-semibold">Open a project</h2>
                      <p className="mt-1.5 max-w-sm text-sm text-stone-500 dark:text-stone-400">
                        Every project is its own workspace and its own conversation. Create one
                        in the sidebar — blank, or seeded with a client brief.
                      </p>
                    </>
                  )}
                </div>
              )}

              {messages.map((message, i) =>
                message.role === "user" ? (
                  <div key={i} className="mb-5 flex flex-col items-end">
                    <p className="max-w-[85%] rounded-2xl rounded-br-md bg-stone-900 px-4 py-2.5 text-[15px] text-stone-50 dark:bg-stone-100 dark:text-stone-900">
                      {message.text}
                    </p>
                    {message.steered && (
                      <span
                        data-testid="steering-chip"
                        className="mt-1 flex items-center gap-1.5 font-mono text-[11px] text-accent"
                      >
                        <span className="size-1.5 rounded-full bg-accent" />
                        steering — absorbed mid-turn
                      </span>
                    )}
                    {message.blueprint && (
                      <span
                        data-testid="blueprint-chip"
                        className="mt-1 flex items-center gap-1.5 font-mono text-[11px] text-sky-700 dark:text-sky-400"
                      >
                        <span className="size-1.5 rounded-full bg-sky-500" />
                        blueprint — read-only planning turn
                      </span>
                    )}
                  </div>
                ) : message.role === "notice" ? (
                  <div key={i} className="mb-5 flex justify-center">
                    <p className="rounded-full border border-amber-300 bg-amber-50 px-3.5 py-1 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
                      {message.text}
                    </p>
                  </div>
                ) : (
                  <div key={i} className="mb-6">
                    {message.blocks.map((block, j) => (
                      <BlockView
                        key={block.type === "text" ? j : block.id}
                        block={block}
                        onDecide={decide}
                        onAnswer={answer}
                      />
                    ))}
                    {message.status === "working" && message.startedAtMs !== undefined && (
                      <WorkingTimer startedAt={message.startedAtMs} />
                    )}
                    {message.status !== "working" && (
                      <p className="mt-2 font-mono text-xs text-stone-400 dark:text-stone-500">
                        {[
                          message.status === "stopped" ? "stopped by you" : null,
                          message.status === "error" ? "ended with an error" : null,
                          message.status === "orphaned" ? "backend restarted mid-build" : null,
                          // Part 10: the receipt names the turn's posture
                          // and effort — the A/B lives right here.
                          message.planFirst ? "blueprint (read-only)" : null,
                          message.effort && message.effort !== "medium"
                            ? `effort ${message.effort}`
                            : null,
                          message.totalTokens !== undefined
                            ? `${message.totalTokens.toLocaleString()} tokens this turn`
                            : null,
                          message.durationMs !== undefined
                            ? `${Math.round(message.durationMs / 1000)}s`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    )}
                  </div>
                ),
              )}
            </main>
          </div>

          {/* The living checklist: pinned above the composer while the
              newest turn has one. Most turns don't — the panel's absence
              is the honest default, not a bug. */}
          {plan && <PlanChecklist steps={plan.steps} explanation={plan.explanation} />}

          <footer className="border-t border-stone-200 px-5 py-4 dark:border-stone-800">
            {awaitingApproval && (
              <p
                data-testid="approval-waiting-chip"
                className="mb-2.5 flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400"
              >
                <span className="size-1.5 animate-pulse rounded-full bg-amber-500" />
                The build is waiting for your approval — answer the card above to continue.
              </p>
            )}
            {awaitingQuestion && (
              <p
                data-testid="question-waiting-chip"
                className="mb-2.5 flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400"
              >
                <span className="size-1.5 animate-pulse rounded-full bg-amber-500" />
                The builder is waiting for your answer — the card above has the choices.
              </p>
            )}
            {mode === "read-only" && activeProject && (
              <p
                data-testid="planning-hint"
                className="mb-2.5 text-xs text-sky-700 dark:text-sky-400"
              >
                Planning mode — the builder can read and plan, but the OS refuses every write.
              </p>
            )}
            {/* The consultative dials: arm ONE blueprint turn, and pick
                how hard the builder thinks about the next message. */}
            <div className="mb-2.5 flex items-center justify-between gap-3">
              <button
                type="button"
                role="switch"
                aria-checked={planFirst}
                data-testid="plan-first-toggle"
                disabled={!activeId || working}
                onClick={() => setPlanFirst((v) => !v)}
                title="Send the next message as a read-only planning turn: the builder proposes a numbered plan and cannot write files."
                className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-40 ${
                  planFirst
                    ? "border-sky-400 bg-sky-50 text-sky-700 dark:border-sky-700 dark:bg-sky-950/40 dark:text-sky-400"
                    : "border-stone-200 text-stone-500 hover:border-stone-300 dark:border-stone-800 dark:text-stone-400"
                }`}
              >
                <span
                  className={`size-1.5 rounded-full ${planFirst ? "bg-sky-500" : "bg-stone-300 dark:bg-stone-600"}`}
                />
                Plan first
              </button>
              <CareLevelPicker level={careLevel} onChange={setCareLevel} />
            </div>
            <form
              className="flex w-full gap-2.5"
              onSubmit={(e) => {
                e.preventDefault();
                send(input);
              }}
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={!activeId}
                placeholder={
                  !activeId
                    ? "Create a project first"
                    : working
                      ? "Steer the build — it lands mid-turn…"
                      : planFirst
                        ? "Describe the job — the builder will propose a plan, not build…"
                        : "Describe the site you want…"
                }
                className="min-w-0 flex-1 rounded-xl border border-stone-200 bg-white px-4 py-2.5 text-[15px] outline-none placeholder:text-stone-400 focus:border-accent disabled:opacity-50 dark:border-stone-800 dark:bg-stone-900"
              />
              {working && (
                <button
                  type="button"
                  data-testid="stop-button"
                  onClick={stopTurn}
                  className="rounded-xl border border-stone-300 px-5 text-sm font-medium text-stone-600 hover:border-red-400 hover:text-red-600 dark:border-stone-700 dark:text-stone-300"
                >
                  Stop
                </button>
              )}
              <button
                type="submit"
                disabled={!input.trim() || !activeId}
                className="rounded-xl bg-accent px-5 text-sm font-medium text-white disabled:opacity-40"
              >
                Send
              </button>
            </form>
          </footer>
        </section>

        {/* The workspace: live preview on top, the file tree below, and
            the diff drawer sliding over both. */}
        <section className="relative flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between gap-3 border-b border-stone-200 px-4 py-2 dark:border-stone-800">
            <span className="truncate font-mono text-xs text-stone-400 dark:text-stone-500">
              {activeId ? `/preview/${activeId}/` : "no project open"}
            </span>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => setPreviewVersion((v) => v + 1)}
                disabled={!activeId}
                className="rounded-lg border border-stone-200 px-2.5 py-1 text-xs text-stone-500 hover:border-accent hover:text-accent disabled:opacity-40 dark:border-stone-800 dark:text-stone-400"
              >
                Reload
              </button>
              <button
                type="button"
                onClick={() => setDiffOpen(true)}
                disabled={!diff}
                className="flex items-center gap-1.5 rounded-lg border border-stone-200 px-2.5 py-1 text-xs text-stone-500 hover:border-accent hover:text-accent disabled:opacity-40 dark:border-stone-800 dark:text-stone-400"
              >
                {diff && <span className="size-1.5 rounded-full bg-accent" />}
                Diff
              </button>
            </div>
          </div>
          <div className="min-h-0 flex-1 bg-stone-100 dark:bg-stone-900">
            {activeId ? (
              <PreviewPane projectId={activeId} version={previewVersion} hasSite={hasSite} />
            ) : (
              <div className="flex h-full items-center justify-center">
                <p className="text-sm text-stone-400 dark:text-stone-500">
                  The preview lives here.
                </p>
              </div>
            )}
          </div>
          <div className="h-52 shrink-0 border-t border-stone-200 dark:border-stone-800">
            <FilesPane files={files} badges={badges} />
          </div>
          <DiffDrawer diff={diff} open={diffOpen} onClose={() => setDiffOpen(false)} />
        </section>
      </div>

      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}
