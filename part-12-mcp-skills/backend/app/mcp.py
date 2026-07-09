"""MCP servers: the rented power tools, and their board on the wall.

The engine owns the servers. They are declared in `config.toml` inside
CODEX_HOME — one `[mcp_servers.<name>]` table each, command + args —
and `codex app-server` launches them as its own child processes. Three
consequences worth stating plainly, all verified live on 0.142.4:

- Pagewright never talks to an MCP server. The agent calls the tool
  mid-turn, the call streams by as an `mcpToolCall` item, and the
  existing item vocabulary renders it — the {server, tool} detail is
  a label on the badge, not a new lane.
- MCP servers live OUTSIDE the turn sandbox. The sandbox wraps commands
  the agent runs; a tool call is served by a process the OPERATOR
  configured, so an allowed `search_images` reaches the internet even
  with networkAccess: false. What stays governed is the agent's own
  hands: pulling the found image into the workspace is a `curl`, and
  THAT hits the Part 6/7 grid like any other command. Rented tools
  widen what the agent can see; the walls still decide what it can do.
- "Allowed" is its own gate, and approvalPolicy has no say in it. Every
  MCP tool call raises a `mcpServer/elicitation/request` approval
  (codex_approval_kind "mcp_tool_call") — per call, even under
  approvalPolicy "never". A client that doesn't answer it has silently
  disabled MCP: the engine scores the non-answer as "user rejected MCP
  tool call". main.elicitation_handler routes it through the Part 7
  inbox; an operator can pre-approve a tool for good with
  `[mcp_servers.<name>.tools.<tool>] approval_mode = "approve"` in
  config.toml (per-tool only — a server-level approval_mode is
  ignored, also verified).

Health is two sources merged. `mcpServerStatus/list` reports what is
UP: name, tools, serverInfo — but has no failure field at all. Failures
arrive the other way, as `mcpServer/startupStatus/updated` notifications
(starting → ready | failed, with an error string), often with
`threadId: null` — which is why CodexClient grew on_notification. This
module keeps the latest startup state per server and merges it with the
list, so a botched command shows up as a red row instead of a silent
absence.
"""

import time

from app.codex_client import CodexClient, CodexError

# name → the latest mcpServer/startupStatus/updated for that server:
# {"status": "starting"|"ready"|"failed"|"cancelled", "error", "at_ms"}.
STARTUP: dict[str, dict] = {}


async def note_startup(params: dict) -> None:
    """The on_notification handler: remember the newest startup state.
    A server can restart per thread; last write wins on purpose."""
    name = params.get("name")
    if not name:
        return
    STARTUP[name] = {"status": params.get("status", "unknown"),
                     "error": params.get("error"),
                     "at_ms": int(time.time() * 1000)}


async def list_servers(client: CodexClient) -> list[dict]:
    """The health board: every server the engine knows, one row each.

    Rows come from mcpServerStatus/list (the up-and-inventoried view,
    `detail` left at its Full default) plus any server that ONLY exists
    in the startup log — a server whose command never launched has no
    inventory row, and that absence is exactly the failure worth
    surfacing."""
    rows: dict[str, dict] = {}
    result = await client.request("mcpServerStatus/list", {})
    for status in result.get("data", []):
        name = status["name"]
        info = status.get("serverInfo") or {}
        startup = STARTUP.get(name)
        rows[name] = {
            "name": name,
            "tools": sorted(status.get("tools", {})),
            "version": info.get("version"),
            "startup": startup,
            # Inventoried = up. The startup log's job here is only to
            # contradict that when it says failed; "starting" without a
            # later failure resolves into this list (verified live —
            # a healthy launch never sends a "ready" note).
            "state": ("failed" if startup and startup["status"] == "failed"
                      else "ready"),
        }
    for name, startup in STARTUP.items():
        rows.setdefault(name, {"name": name, "tools": [], "version": None,
                               "startup": startup,
                               "state": startup["status"]})
    return sorted(rows.values(), key=lambda row: row["name"])


async def warm_up(client: CodexClient) -> None:
    """Ask for the list once at startup so server launches begin (and
    failures land in STARTUP) before the first build turn needs them.
    Best-effort: a broken MCP setup must not stop Pagewright serving."""
    try:
        await client.request("mcpServerStatus/list", {}, timeout=30)
    except CodexError:
        pass
