// The wire vocabulary from Parts 2–12, as TypeScript sees it. One
// discriminated union: switch on `type`, and the compiler knows the
// payload's shape.

// The three trust postures a project can hold (Part 6). No fourth: the
// protocol's dangerFullAccess exists, and Pagewright never sends it.
export type Mode = "read-only" | "standard" | "trusted";

// Part 10: the reasoning dials, exactly as model/list advertises them
// for gpt-5.4-mini. The composer folds both into one "care level".
export type Effort = "low" | "medium" | "high" | "xhigh";
export type Summary = "auto" | "concise" | "detailed";

// One step of the agent's own checklist (turn/plan/updated → plan_update).
export type PlanStep = {
  step: string;
  status: "pending" | "inProgress" | "completed";
};

// One question from item/tool/requestUserInput, in the protocol's own
// shape: options are optional (free-prose questions exist), isOther
// allows a typed answer beside the options, isSecret masks the input.
export type Question = {
  id: string;
  header: string;
  question: string;
  isOther?: boolean;
  isSecret?: boolean;
  options?: { label: string; description: string }[] | null;
};

// Part 7's two flavors of question, and the two ways one gets answered
// ("user" = somebody clicked; "timeout" = the clock declined it).
// Part 12 adds "mcp_tool_call": the elicitation that gates every rented
// tool's call — same inbox, same card, third kind.
export type ApprovalKind = "command" | "file_change" | "mcp_tool_call";
export type ApprovalOutcomeReason = "user" | "timeout";

// Part 11: one parsed inspection finding. The backend regexed the
// [P1]/[P2]/[P3] tags out of the reviewer's prose; the raw text rides
// review_state (phase "exited") and stays the truth.
export type Severity = "P1" | "P2" | "P3";
export type ReviewFinding = {
  severity: Severity;
  title: string;
  body: string;
  location?: string | null;
};
export type ReviewCounts = { P1: number; P2: number; P3: number };

// Part 11: the site manifest — one outputSchema turn's answer, pydantic
// validated server-side. Drives the published card and the /p/ index.
export type ManifestPage = { path: string; title: string };
export type Manifest = {
  title: string;
  description: string;
  pages: ManifestPage[];
  accent: string;
};

export type ItemDetail = {
  command?: string;
  exit_code?: number | null;
  files?: { path: string; kind: string }[];
  // Part 12: an mcpToolCall names its rented tool. The generic badge
  // renders fine without these — they exist so the wire says WHICH
  // tool ran (server:tool is how the engine namespaces it).
  server?: string;
  tool?: string;
  status?: string | null;
};

// Part 12: one row of the MCP health board (GET /mcp/servers). `state`
// is the backend's merged verdict — a server in the inventory is
// "ready" unless the startup log said "failed"; a server whose command
// never launched exists ONLY in the startup log, error and all.
export type McpServer = {
  name: string;
  tools: string[];
  version?: string | null;
  state: "ready" | "starting" | "failed" | "cancelled" | (string & {});
  startup?: { status: string; error?: string | null; at_ms: number } | null;
};

// Part 12: one pattern book, as skills/list reports it.
export type SkillInfo = {
  name: string;
  description: string;
  path: string;
  scope: string;
  enabled: boolean;
};

// One reading of the meter (Part 8). The wire's two fields carry their
// true names — `last` is the most recent MODEL REQUEST, `total` is the
// THREAD's lifetime count — and `turn` is the backend's computed
// per-turn delta, the only number that means "this turn".
export type TokenUsage = {
  totalTokens?: number;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  reasoningOutputTokens?: number;
};

export type UsageReading = {
  last?: TokenUsage;
  total?: TokenUsage;
  turn?: TokenUsage;
  context_window?: number | null;
};

export type AgentEvent =
  // Part 9: session_start carries the user's own words. Every tab is a
  // viewer of the project's log — including the one that typed — so the
  // question has to be on the wire, or a second tab renders an answer
  // to nothing. started_at_ms keeps the working timer honest across a
  // refresh.
  | {
      type: "session_start";
      session_id: string;
      project_id: string;
      mode: Mode;
      turn_id: string;
      message?: string;
      started_at_ms?: number;
      // Part 10: the turn's posture and dials ride the log, so a second
      // tab labels a blueprint turn as one and shows what it cost to ask.
      plan_first?: boolean;
      effort?: Effort;
      summary?: Summary;
      // Part 11: this turn is the inspector at work — no `message`
      // rides with it (nobody typed it), and every tab labels it so.
      review?: boolean;
      // Part 12: this turn carried the brand-kit skill as an input item.
      brand_kit?: boolean;
    }
  | { type: "text_delta"; text: string }
  | { type: "item_start"; item_id: string; kind: string; detail: ItemDetail }
  | { type: "item_done"; item_id: string; kind: string; detail: ItemDetail }
  | { type: "reasoning_delta"; item_id: string; text: string }
  | { type: "command_output_delta"; item_id: string; chunk: string }
  | {
      type: "file_change";
      item_id: string;
      files: { path: string; kind: string }[];
      status: "started" | "done";
    }
  | { type: "diff_updated"; unified_diff: string }
  | { type: "preview_refresh"; project_id: string }
  | { type: "thread_reset"; message: string }
  // Part 7: the server asked a question and the item is frozen until
  // someone answers. Command approvals carry the command + cwd; file
  // change approvals carry the patch (joined server-side by itemId).
  | {
      type: "approval_request";
      approval_id: string;
      kind: ApprovalKind;
      item_id: string;
      command?: string | null;
      cwd?: string | null;
      reason?: string | null;
      // Part 12: an mcp_tool_call approval carries the server's name and
      // the engine's own question; the other kinds carry neither.
      server?: string | null;
      message?: string | null;
      files?: { path: string; kind: string }[];
      diff?: string;
      available_decisions: string[];
      expires_at_ms: number;
    }
  | {
      type: "approval_resolved";
      approval_id: string;
      decision: string;
      reason: ApprovalOutcomeReason;
      resolved_at_ms: number;
    }
  // Part 8: the live meter and the steer's only trace on the wire.
  | ({ type: "usage_update" } & UsageReading)
  | { type: "steered"; text: string; turn_id: string }
  // Part 10: the agent's own checklist, re-sent whole as steps tick.
  // Absent on turns without a plan — including read-only blueprint
  // turns, where the plan arrives as prose (verified live; the plan
  // tool tracks progress, not proposals).
  | { type: "plan_update"; steps: PlanStep[]; explanation?: string | null }
  // In the schema, never observed live on 0.142.4; carried anyway.
  | { type: "plan_delta"; item_id: string; text: string }
  // Part 10: the agent asked a structured question and its tool call is
  // frozen until the answer sheet comes back (the approvals bridge,
  // third customer).
  | {
      type: "question_request";
      question_id: string;
      item_id: string;
      questions: Question[];
      expires_at_ms: number;
    }
  | {
      type: "question_resolved";
      question_id: string;
      answers: Record<string, string[]>;
      reason: ApprovalOutcomeReason;
      resolved_at_ms: number;
    }
  // Part 11: the inspection's bookends. "entered" opens the report
  // card; "exited" seals it with the raw findings text and the counts
  // the gate reads. Between them the reviewer's own investigation
  // streams as ordinary items.
  | {
      type: "review_state";
      phase: "entered" | "exited";
      instructions?: string;
      counts?: ReviewCounts;
      raw?: string;
      at_ms?: number;
    }
  // Part 11: one parsed finding — the report card's rows.
  | ({ type: "review_finding" } & ReviewFinding)
  // Part 11: the publish flow narrating itself. "blocked" carries the
  // gate's reasons; "forced" is the escape hatch being witnessed;
  // the manifest phases are the retry-or-surface policy on the wire.
  | {
      type: "publish_state";
      phase: "blocked" | "forced" | "manifest" | "manifest_retry" | "manifest_failed";
      reasons?: string[];
      error?: string;
    }
  // Part 11: the receipt — the site is live at /p/{slug}/.
  | {
      type: "published";
      slug: string;
      url: string;
      name: string;
      manifest: Manifest | null;
      at_ms: number;
      forced?: boolean;
    }
  | {
      type: "complete";
      status: string; // "completed" | "interrupted" | "failed"
      turn_id?: string; // Part 9: a replayed log holds many turns
      duration_ms?: number;
      usage: TokenUsage; // per-turn since Part 8 (computed delta), NOT cumulative
      thread_total?: TokenUsage;
    }
  | { type: "error"; message: string }
  // Part 12: a rented tool's power light flickered during a turn
  // (mcpServer/startupStatus/updated with a threadId). The health board
  // (GET /mcp/servers) is the durable truth; this is the live nudge.
  | { type: "mcp_status"; server: string; status: string; error?: string | null }
  // Part 9: the honest tombstone, written at startup for every turn the
  // previous backend process left "running" — that turn will never
  // finish; the workspace and the thread survived.
  | { type: "backend_restarted"; turn_id: string; message: string }
  // Part 9, ephemeral (never logged, carries no seq): the stream's own
  // marker that replay is over and what follows is live.
  | { type: "caught_up"; last_seq: number };

// What the REST side of the backend returns: the project registry, one
// project's workspace listing, and (new in Part 5) the conversation
// replayed from the rollout.
export type Project = {
  id: string;
  name: string;
  created_at: string;
  updated_at?: string;
  thread_id?: string | null;
  thread_name?: string | null;
  mode: Mode;
  forked_from_id?: string;
  // Part 11: the registry's small summaries — the gate's inputs and
  // the sidebar's "live" chip. The full report lives behind
  // GET /projects/{id}/review; the stream replays it anyway.
  review?: { at_ms: number; turn_id: string; total: number } & ReviewCounts;
  published?: { slug: string; url: string; at_ms: number };
  built_at_ms?: number;
};

export type WorkspaceFile = { path: string; size: number; seeded: boolean };

// What the UI renders. An assistant turn is a SEQUENCE OF BLOCKS: prose
// and items interleaved in the order they happened, mirroring the
// protocol's own noun. Text accumulates positionally (an agentMessage's
// tokens always follow each other); items are keyed BY ID, never by
// position — two commands can run at once.
export type TextBlock = { type: "text"; text: string };

export type ItemBlock = {
  type: "item";
  id: string;
  kind: string; // reasoning | commandExecution | fileChange | ...
  detail: ItemDetail;
  output: string; // command_output_delta accumulates here
  reasoning: string; // reasoning_delta accumulates here
  done: boolean;
};

// An approval is its own block, not an item: it renders at its arrival
// position in the conversation (exactly where the turn paused) and its
// lifecycle is question → answer, not started → done.
export type ApprovalBlock = {
  type: "approval";
  id: string; // the backend's approval_id
  kind: ApprovalKind;
  command?: string | null;
  cwd?: string | null;
  reason?: string | null;
  // Part 12: kind "mcp_tool_call" — the rented tool's server and the
  // engine's own question, rendered verbatim on the card.
  server?: string | null;
  message?: string | null;
  files: { path: string; kind: string }[];
  diff: string;
  availableDecisions: string[];
  expiresAtMs: number;
  resolved?: { decision: string; reason: ApprovalOutcomeReason; atMs: number };
};

// A question is a block for the same reason an approval is: it renders
// at its arrival position (where the tool call froze) and its lifecycle
// is question → answer sheet.
export type QuestionBlock = {
  type: "question";
  id: string; // the backend's question_id
  questions: Question[];
  expiresAtMs: number;
  resolved?: {
    answers: Record<string, string[]>;
    reason: ApprovalOutcomeReason;
    atMs: number;
  };
};

// The inspector's report card: opened by review_state "entered", rows
// added by review_finding, sealed (counts + raw text) by "exited". One
// per review turn, so events patch the LAST review block by position.
export type ReviewBlock = {
  type: "review";
  phase: "running" | "done";
  findings: ReviewFinding[];
  counts?: ReviewCounts;
  raw?: string;
};

export type Block = TextBlock | ItemBlock | ApprovalBlock | QuestionBlock | ReviewBlock;

export type ChatMessage =
  // steered (Part 8): this message was sent mid-turn and absorbed into
  // the running build. blueprint (Part 10): this message went out
  // read-only, asking for a plan. brandKit (Part 12): the pattern book
  // rode along as a skill input item. Chips make all three legible.
  | { role: "user"; text: string; steered?: boolean; blueprint?: boolean; brandKit?: boolean }
  // The quiet inline notice — Part 5 uses it when a thread reset.
  | { role: "notice"; text: string }
  // Part 11: the "it's live" card — the published event rendered at its
  // place in the conversation, with the manifest it shipped with.
  | {
      role: "published";
      slug: string;
      url: string;
      name: string;
      manifest: Manifest | null;
      forced?: boolean;
    }
  | {
      role: "assistant";
      blocks: Block[];
      // "orphaned" (Part 9): the backend restarted while this turn ran;
      // everything up to the last logged event was kept, the rest is gone.
      status: "working" | "done" | "error" | "stopped" | "orphaned";
      // Which turn this is (session_start.turn_id) — a replayed log
      // holds many turns, and the receipt patches onto the right one.
      turnId?: string;
      // Part 10: how the turn was sent (session_start again) — the
      // blueprint chip and the receipt's effort note read from here.
      planFirst?: boolean;
      effort?: Effort;
      // Part 11: this turn is an inspection. The report card carries
      // the findings; the reviewer's closing prose (which repeats them
      // verbatim) is folded away instead of rendered twice.
      review?: boolean;
      // Part 12: the turn carried the brand-kit skill (the receipt
      // names it, same as effort and posture).
      brandKit?: boolean;
      totalTokens?: number;
      durationMs?: number;
      // When the turn began, from the wire (session_start.started_at_ms)
      // — so the working timer survives a refresh instead of restarting
      // from zero.
      startedAtMs?: number;
    };
