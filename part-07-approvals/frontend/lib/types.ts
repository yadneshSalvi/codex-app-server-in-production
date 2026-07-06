// The wire vocabulary from Parts 2–7, as TypeScript sees it. One
// discriminated union: switch on `type`, and the compiler knows the
// payload's shape.

// The three trust postures a project can hold (Part 6). No fourth: the
// protocol's dangerFullAccess exists, and Pagewright never sends it.
export type Mode = "read-only" | "standard" | "trusted";

// Part 7's two flavors of question, and the two ways one gets answered
// ("user" = somebody clicked; "timeout" = the clock declined it).
export type ApprovalKind = "command" | "file_change";
export type ApprovalOutcomeReason = "user" | "timeout";

export type ItemDetail = {
  command?: string;
  exit_code?: number | null;
  files?: { path: string; kind: string }[];
};

export type AgentEvent =
  | { type: "session_start"; session_id: string; project_id: string; mode: Mode }
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
  | {
      type: "complete";
      status: string;
      duration_ms?: number;
      usage: Record<string, number>;
    }
  | { type: "error"; message: string };

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
};

export type WorkspaceFile = { path: string; size: number; seeded: boolean };

export type HistoryMessage = { role: "user" | "assistant"; text: string };

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
  files: { path: string; kind: string }[];
  diff: string;
  availableDecisions: string[];
  expiresAtMs: number;
  resolved?: { decision: string; reason: ApprovalOutcomeReason; atMs: number };
};

export type Block = TextBlock | ItemBlock | ApprovalBlock;

export type ChatMessage =
  | { role: "user"; text: string }
  // The quiet inline notice — Part 5 uses it when a thread reset.
  | { role: "notice"; text: string }
  | {
      role: "assistant";
      blocks: Block[];
      status: "working" | "done" | "error" | "stopped";
      totalTokens?: number;
      durationMs?: number;
    };
