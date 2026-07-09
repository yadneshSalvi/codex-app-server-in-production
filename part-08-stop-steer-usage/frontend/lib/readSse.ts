import type { AgentEvent } from "./types";

// Read a fetch Response as a stream of parsed SSE events. Frames are
// delimited by a blank line (\n\n), and a frame can arrive split across
// network chunks, so we buffer until each delimiter shows up. LangGraph
// Part 5 walks through this parsing (and the bug you get without the
// buffer) from zero; here it's four moves: read, buffer, split, parse.
export async function* readSse(res: Response): AsyncGenerator<AgentEvent> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop()!;
    for (const frame of frames) {
      const line = frame.trim();
      if (line.startsWith("data: ")) {
        yield JSON.parse(line.slice(6)) as AgentEvent;
      }
    }
  }
}
