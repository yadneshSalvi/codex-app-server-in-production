"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AgentEvent,
  Block,
  ChatMessage,
  HistoryMessage,
  Mode,
  Project,
  WorkspaceFile,
} from "@/lib/types";
import { API_BASE } from "@/lib/api";
import { readSse } from "@/lib/readSse";
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

const SAMPLE_PROMPTS = [
  "Read brief/brief.md and build the site it describes",
  "Build a one-page site for a small bakery: hero, menu, contact",
  "Make the hero headline bigger and add a footer",
];

// A flooding command can outrun the reader; keep the tail, which is the
// part a terminal would be showing anyway.
const OUTPUT_CAP = 8_000;

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
  return blocks;
}

function BlockView({
  block,
  onDecide,
}: {
  block: Block;
  onDecide: (approvalId: string, decision: string) => Promise<void>;
}) {
  if (block.type === "text") return <Markdown text={block.text} />;
  if (block.type === "approval") return <ApprovalCard block={block} onDecide={onDecide} />;
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
  const [working, setWorking] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

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

  const loadFiles = useCallback(async (id: string) => {
    try {
      const res = await fetch(`${API_BASE}/projects/${id}/files`);
      if (res.ok) setFiles((await res.json()).files);
    } catch {
      // A dead backend surfaces as a toast from send(); stay quiet here.
    }
  }, []);

  // The conversation lives with the thread now: reopening a project
  // replays it from the rollout via GET /history. Each past turn arrives
  // as plain text — what was said, not how it streamed.
  const loadHistory = useCallback(async (id: string) => {
    try {
      const res = await fetch(`${API_BASE}/projects/${id}/history`);
      if (!res.ok) return;
      const data: { history: HistoryMessage[] } = await res.json();
      setMessages(
        data.history.map((m) =>
          m.role === "user"
            ? { role: "user", text: m.text }
            : { role: "assistant", blocks: [{ type: "text", text: m.text }], status: "done" },
        ),
      );
    } catch {
      // Same deal as loadFiles: the toast comes from send().
    }
  }, []);

  const selectProject = useCallback(
    (id: string) => {
      setActiveId(id);
      setMessages([]);
      setBadges({});
      setDiff("");
      setDiffOpen(false);
      setFiles([]);
      setPreviewVersion((v) => v + 1);
      loadFiles(id);
      loadHistory(id);
    },
    [loadFiles, loadHistory],
  );

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

  function patchLastTurn(patch: Partial<Extract<ChatMessage, { role: "assistant" }>>) {
    setMessages((all) => {
      const last = all[all.length - 1];
      if (last?.role !== "assistant") return all;
      return [...all.slice(0, -1), { ...last, ...patch }];
    });
  }

  async function send(text: string) {
    const prompt = text.trim();
    if (!prompt || working || !activeId) return;
    setInput("");
    setWorking(true);
    setStartedAt(Date.now());
    // The badges and the diff describe ONE turn; a new turn starts clean.
    setBadges({});
    setDiff("");
    setMessages((all) => [
      ...all,
      { role: "user", text: prompt },
      { role: "assistant", blocks: [], status: "working" },
    ]);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch(`${API_BASE}/projects/${activeId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: prompt }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new Error(`The server said ${res.status}.`);
      let gotReceipt = false;
      for await (const event of readSse(res)) {
        if (event.type === "complete") {
          patchLastTurn({
            status: event.status === "completed" ? "done" : "error",
            totalTokens: event.usage?.totalTokens,
            durationMs: event.duration_ms,
          });
          setWorking(false); // the receipt is in; don't keep offering Stop
          setStartedAt(null);
          gotReceipt = true;
          // Commands (cp, rm) change the workspace without fileChange
          // items; one refresh at the end catches whatever they did.
          loadFiles(activeId);
          setPreviewVersion((v) => v + 1);
          // The first completed turn auto-titles the thread server-side;
          // re-pull the registry so the sidebar learns the name.
          refreshProjects();
        } else if (event.type === "thread_reset") {
          // The saved conversation could not be restored; a fresh thread
          // took its place. Slot a quiet notice in front of the message
          // that triggered it — the files are fine, only history is gone.
          setMessages((all) => [
            ...all.slice(0, -2),
            { role: "notice", text: "History could not be restored. Files are intact." },
            ...all.slice(-2),
          ]);
        } else if (event.type === "error") {
          patchLastTurn({ status: "error" });
          setToast(event.message);
          setWorking(false);
          setStartedAt(null);
          gotReceipt = true;
        } else if (event.type === "file_change") {
          setBadges((prev) => {
            const next = { ...prev };
            for (const f of event.files) next[f.path] = f.kind;
            return next;
          });
          if (event.status === "done") loadFiles(activeId);
        } else if (event.type === "diff_updated") {
          setDiff(event.unified_diff);
        } else if (event.type === "preview_refresh") {
          setPreviewVersion((v) => v + 1);
        } else {
          setMessages((all) => {
            const last = all[all.length - 1];
            if (last?.role !== "assistant") return all;
            return [...all.slice(0, -1), { ...last, blocks: applyEvent(last.blocks, event) }];
          });
        }
      }
      // A stream that closes without complete or error is itself a failure.
      if (!gotReceipt) {
        patchLastTurn({ status: "error" });
        setToast("The stream ended before the agent finished.");
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        patchLastTurn({ status: "stopped" });
      } else {
        patchLastTurn({ status: "error" });
        setToast("Lost the connection to the server. Is the backend running?");
      }
    } finally {
      setWorking(false);
      setStartedAt(null);
      abortRef.current = null;
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
        {/* The wristband rack for the open project. Per project, applied
            per turn — switching needs no new thread. */}
        {activeProject && <ModePicker mode={mode} busy={working} onChange={changeMode} />}
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
                  <div key={i} className="mb-5 flex justify-end">
                    <p className="max-w-[85%] rounded-2xl rounded-br-md bg-stone-900 px-4 py-2.5 text-[15px] text-stone-50 dark:bg-stone-100 dark:text-stone-900">
                      {message.text}
                    </p>
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
                      />
                    ))}
                    {message.status === "working" && startedAt !== null && (
                      <WorkingTimer startedAt={startedAt} />
                    )}
                    {message.status !== "working" && (
                      <p className="mt-2 font-mono text-xs text-stone-400 dark:text-stone-500">
                        {[
                          message.status === "stopped" ? "stopped" : null,
                          message.status === "error" ? "ended with an error" : null,
                          message.totalTokens !== undefined
                            ? `${message.totalTokens.toLocaleString()} tokens`
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
            {mode === "read-only" && activeProject && (
              <p
                data-testid="planning-hint"
                className="mb-2.5 text-xs text-sky-700 dark:text-sky-400"
              >
                Planning mode — the builder can read and plan, but the OS refuses every write.
              </p>
            )}
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
                placeholder={activeId ? "Describe the site you want…" : "Create a project first"}
                className="min-w-0 flex-1 rounded-xl border border-stone-200 bg-white px-4 py-2.5 text-[15px] outline-none placeholder:text-stone-400 focus:border-accent disabled:opacity-50 dark:border-stone-800 dark:bg-stone-900"
              />
              {working ? (
                <button
                  type="button"
                  onClick={() => abortRef.current?.abort()}
                  className="rounded-xl border border-stone-300 px-5 text-sm font-medium text-stone-600 hover:border-red-400 hover:text-red-600 dark:border-stone-700 dark:text-stone-300"
                >
                  Stop
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!input.trim() || !activeId}
                  className="rounded-xl bg-accent px-5 text-sm font-medium text-white disabled:opacity-40"
                >
                  Send
                </button>
              )}
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
