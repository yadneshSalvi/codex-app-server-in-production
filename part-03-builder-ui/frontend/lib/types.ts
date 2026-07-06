// The wire vocabulary from Parts 2–3, as TypeScript sees it. One
// discriminated union: switch on `type`, and the compiler knows the
// payload's shape.
export type ItemDetail = {
  command?: string;
  exit_code?: number | null;
  files?: { path: string; kind: string }[];
};

export type AgentEvent =
  | { type: "session_start"; session_id: string }
  | { type: "text_delta"; text: string }
  | { type: "item_start"; item_id: string; kind: string; detail: ItemDetail }
  | { type: "item_done"; item_id: string; kind: string; detail: ItemDetail }
  | { type: "reasoning_delta"; item_id: string; text: string }
  | { type: "command_output_delta"; item_id: string; chunk: string }
  | {
      type: "complete";
      status: string;
      duration_ms?: number;
      usage: Record<string, number>;
    }
  | { type: "error"; message: string };

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
  | {
      role: "assistant";
      blocks: Block[];
      status: "working" | "done" | "error" | "stopped";
      totalTokens?: number;
      durationMs?: number;
    };
