// The wire vocabulary from Parts 2–5, as TypeScript sees it. One
// discriminated union: switch on `type`, and the compiler knows the
// payload's shape.
export type ItemDetail = {
  command?: string;
  exit_code?: number | null;
  files?: { path: string; kind: string }[];
};

export type AgentEvent =
  | { type: "session_start"; session_id: string; project_id: string }
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

export type Block = TextBlock | ItemBlock;

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
