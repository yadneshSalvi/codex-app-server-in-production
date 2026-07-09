# Part 12: The wider workshop — AGENTS.md, skills, and MCP servers

The end state of [Part 12 of the series](https://yadnesh.dev/blog/codex-12-mcp-skills):
Pagewright learns the three ways to extend the builder without touching a
prompt, in ascending cost:

- **Standing instructions.** Every new workspace gets an **AGENTS.md** — the
  site-rules poster. The engine reads it from the thread's cwd on its own
  (`thread/start` returns it in `instructionSources`), and an A/B build obeys
  it with zero prompt changes: no webfonts, one `<style>` block, alt text on
  every image. Rules that used to be Part 11 reviewer findings are now just
  how this workshop builds.
- **Playbooks.** The **brand-kit skill** (`skills/brand-kit/SKILL.md` +
  `checklist.md`, installed into `$CODEX_HOME/skills/`) teaches reading a
  brief's assets folder and applying logo, palette, and voice consistently.
  `skills/list` surfaces it; the composer's **Brand kit** toggle attaches it
  to a turn as a `{type: "skill", name, path}` input item — loaded into
  exactly the turns that need it, not standing instructions every turn pays
  tokens for.
- **Rented power tools.** An image-search **MCP server** (openverse, pinned
  `mcp-openverse@0.1.1` — CC-licensed imagery, anonymous API, no key) is
  declared in `config.toml` and launched **by the engine**. The agent's calls
  stream by as `mcpToolCall` items; the header's **tools** pill is the health
  board, and a misconfigured server shows up as a red row with the engine's
  own error instead of a silent absence.

📖 Read along: [Part 12: The wider workshop](https://yadnesh.dev/blog/codex-12-mcp-skills)

## Run it

One-time setup — the engine, not Pagewright, owns skills and MCP servers, so
both live in CODEX_HOME:

```bash
# the pattern book
cp -r skills/brand-kit "$CODEX_HOME/skills/"

# the rented tool ($CODEX_HOME/config.toml)
[mcp_servers.openverse]
command = "npx"
args = ["-y", "mcp-openverse@0.1.1"]
```

Backend (terminal 1):

```bash
cd backend
uv run uvicorn app.main:app --port 8000
```

Frontend (terminal 2):

```bash
cd frontend
npm install
cp .env.local.example .env.local
npm run dev
```

Open http://localhost:3000. Then:

- **The poster works.** Create two projects from the **beanline** brief,
  delete `AGENTS.md` from one workspace, and send the same prompt asking for
  "a nice serif webfont". The bare workspace ships Google Fonts and an
  external stylesheet; the postered one ships Georgia, one `<style>` block,
  and alt text on every image.
- **The pattern book pays off.** On a **harbor-and-vine** project, toggle
  **Brand kit** and send *"Read brief/brief.md and build the site it
  describes."* The brief demands forest green; the client's own logo is navy.
  Without the skill the builder paints the site green and says nothing; with
  it, the artwork wins, the palette lands as `--brand/--ink/--paper/--accent`,
  and the final message names the contradiction out loud.
- **The rented tool.** Ask for a hero photo: *"…use the openverse MCP tools
  to find ONE CC-licensed photograph of latte art, then download it into
  assets/ with curl."* Two approval cards arrive, and they are not the same
  kind: the **rented tool** card is the MCP elicitation (approvalPolicy has
  no say — see below), and the **command** card is the `curl` hitting the
  Part 6/7 network wall. Approve both and the photo lands in the workspace,
  on the page, with alt text.
- **Break it.** Change the server's `command` to something that doesn't
  exist, restart the backend, send any message. The **tools** pill turns red:
  `failed — MCP client for `openverse` failed to start: … No such file or
  directory`. The failure exists only in the startup notifications —
  `mcpServerStatus/list` has no failure vocabulary at all.

## The protocol truths this part rests on (verified live, 0.142.4)

- **AGENTS.md** is read from the thread's `cwd` by the engine itself:
  `thread/start` names it in `instructionSources` (and returns `[]` for a
  workspace without one). No prompt changes, no per-turn token cost from us.
- **Skills** are folders with a `SKILL.md` (name + description frontmatter).
  `skills/list` groups them by cwd and reports the **path to SKILL.md** —
  which is exactly what the engine wants back in the invocation:
  `{"type": "skill", "name": …, "path": …}` as a `turn/start` input item (all
  three fields required by the schema). It also lists `~/.agents/skills/*`
  and CLI-bundled `.system` skills, so look yours up by name. Curiously, the
  skill leaves **no trace in the thread record** — `thread/read` shows only
  the text item; the wire evidence is whatever your own envelope adds.
- **MCP tool calls are approval-gated per call, and `approvalPolicy` has no
  say in it.** Every call raises a `mcpServer/elicitation/request` server
  request (`_meta.codex_approval_kind: "mcp_tool_call"`) — even under
  `approvalPolicy: "never"`. A client that doesn't answer it (or answers
  with the polite empty `{}` unhandled requests get) has silently disabled
  MCP: the engine scores it **"user rejected MCP tool call"** and the item
  fails in zero seconds, the server never called. The answer is
  `{"action": "accept" | "decline" | "cancel", "content": {}}`;
  `_meta: {"persist": "session"}` quiets that tool for the rest of the
  engine process (one ask covered both `search_images` calls of our live
  turn), and `"always"` writes `[mcp_servers.<name>.tools.<tool>]
  approval_mode = "approve"` into config.toml — a table an operator can also
  declare up front. Per-tool only: a server-level `approval_mode` is ignored.
- **MCP servers live outside the turn sandbox.** Once allowed, the call
  reaches the internet even in standard mode (`networkAccess: false`) — the
  server is the operator's own child process of `codex app-server`, not a
  sandboxed command. What stays governed is the agent's hands: downloading
  the found image is a `curl`, and that still raises a Part 7 command
  approval in standard mode.
- **Health is two sources merged.** `mcpServerStatus/list` reports what is
  up (name, tools, serverInfo) and has **no failure field**; failures arrive
  as `mcpServer/startupStatus/updated` notifications (starting → ready |
  failed + error string), often with `threadId: null` — which is why
  CodexClient grew `on_notification`. And the engine launches servers
  lazily: a broken command sits "ready, zero tools" on the list until the
  first `thread/start` actually tries to launch it.
- The `mcpToolCall` **item** flows through the Part 2 vocabulary untouched —
  `item_start`/`item_done` with a `{server, tool, status}` detail. No new
  frontend lane; the badge just names the tool the namespaced way
  (`openverse:search_images`).

## What changed since Part 11

- `backend/app/codex_client.py` — `on_notification(method, handler)`: the
  last seam. Until now every notification either named a thread or was
  dropped; MCP startup status is the first the product needs that can arrive
  with `threadId: null`. Method handlers run in addition to thread routing.
- `backend/app/projects.py` — every new workspace gets the AGENTS.md poster
  (and the file lists as `seeded`, like `brief/`); `publish.py` excludes it
  from shipping, same as the client's paperwork.
- `backend/app/skills.py` (new) — `skills/list` flattened, `find()` by name,
  and the `{type: "skill", name, path}` input item (path from the engine,
  never hardcoded).
- `backend/app/mcp.py` (new) — the health board: startup-notification store
  merged with `mcpServerStatus/list`, plus the `warm_up()` nudge at startup.
- `backend/app/main.py` — `GET /skills`, `GET /mcp/servers`; `brand_kit` on
  the chat body (409 with the fix if the skill isn't installed); and
  `elicitation_handler` — the approvals seam's fourth customer, routing every
  MCP tool call's elicitation through the Part 7 inbox (accept /
  acceptForSession via `_meta` persist / decline / timeout auto-decline).
- `backend/app/events.py` — `mcp_status` event (thread-riding startup
  flickers), `mcpToolCall` item detail, `approval_request` kind
  `"mcp_tool_call"` (with `server` + the engine's own `message`), and
  `session_start.brand_kit`.
- `skills/brand-kit/` (new) — the pattern book itself: SKILL.md + the
  checklist it makes the builder run before reporting done.
- `frontend/components/McpStatusPanel.tsx` (new) — the tools pill + panel:
  green/amber/red rows, tool inventories, and the engine's error verbatim on
  a failed row.
- `frontend/components/ApprovalCard.tsx` — the third kind: "Approval needed —
  rented tool", rendering the elicitation's own question.
- `frontend/components/ItemBadge.tsx` — mcpToolCall badges name the rented
  tool (`server:tool`) from the item detail.
- `frontend/app/page.tsx` — the Brand kit toggle (sticky, armed only when
  `skills/list` names the skill), brand-kit chips on user message and turn
  receipt, and `mcp_status` events re-pulling the board live.
