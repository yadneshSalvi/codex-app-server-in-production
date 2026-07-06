"""The SSE event vocabulary: one envelope, extended forever, never changed.

Part 2 defined six event types, Part 3 added two, Part 4 three more, Part 5
one, Part 6 none. Part 7 adds two: `approval_request` (the server asked a
question and the item is frozen until someone answers) and
`approval_resolved` (the answer, who gave it — you or the clock — and
when). Both originate on OUR side of the bridge: app.approvals turns the
server's JSON-RPC request into synthetic `approval/requested` and
`approval/resolved` notes on the thread's queue, so they ride the stream
in arrival order and the card lands exactly where the turn paused.

Still notably absent: a "sandbox blocked this" event. The
protocol has no such signal (verified against the 0.142.4 schema and live
traces): a blocked `curl` is just a failed command (exitCode 6, the error
in aggregatedOutput), a blocked write usually never even runs (the model
knows its writable roots and declines up front), and a refused read-only
patch emits no item at all. The honest telemetry is the exit code we
already forward plus the agent's own narration — inventing a blocked_hint
would mean string-matching shell output and lying confidently.
"""

import json
from pathlib import Path


def sse(event: dict) -> str:
    """One envelope on the wire: data: {...}\n\n"""
    return f"data: {json.dumps(event)}\n\n"


def item_detail(item: dict) -> dict:
    """The few fields of an item worth putting on the wire, by kind."""
    kind = item.get("type", "unknown")
    if kind == "commandExecution":
        return {"command": item.get("command", ""),
                "exit_code": item.get("exitCode")}
    if kind == "fileChange":
        return {"files": [
            {"path": c.get("path", ""), "kind": c.get("kind", {}).get("type", "")}
            for c in item.get("changes", [])
        ]}
    if kind == "agentMessage":
        return {}
    return {}


def file_change_event(item: dict, status: str, workspace: Path) -> dict:
    """The dedicated file_change event: workspace-relative paths, one
    edge per item lifecycle. item_start/item_done still flow for the
    generic badges; this is what the file tree and preview consume."""
    files = []
    for change in item.get("changes", []):
        path = change.get("path", "")
        try:
            path = Path(path).relative_to(workspace).as_posix()
        except ValueError:
            pass  # outside the workspace: keep it absolute and visible
        files.append({"path": path, "kind": change.get("kind", {}).get("type", "")})
    return {"type": "file_change", "item_id": item.get("id", ""),
            "files": files, "status": status}


def approval_patch(item: dict, workspace: Path) -> tuple[list[dict], str]:
    """A fileChange approval request names only its itemId — no patch, no
    file list (verified against the 0.142.4 schema and live traces). The
    patch itself arrived moments earlier, on item/started for the same
    item. Join them here: workspace-relative paths, plus synthesized
    per-file headers so Part 4's diff renderer can show the ticket before
    it is hung. `update` diffs arrive as ready-made @@ hunks; `add` diffs
    arrive as the raw new content, so we dress them as one insert hunk."""
    files, parts = [], []
    for change in item.get("changes", []):
        raw = change.get("path", "")
        try:
            path = Path(raw).relative_to(workspace).as_posix()
        except ValueError:
            path = raw  # outside the workspace: keep it absolute and visible
        kind = change.get("kind", {}).get("type", "")
        files.append({"path": path, "kind": kind})
        diff = change.get("diff", "")
        if kind == "add":
            lines = diff.splitlines()
            diff = "\n".join([f"@@ -0,0 +1,{len(lines)} @@",
                              *("+" + line for line in lines)])
        header = path.lstrip("/")  # a//tmp/x reads worse than a/tmp/x
        parts.append(f"diff --git a/{header} b/{header}\n{diff}")
    return files, "\n".join(parts)


def relativize_diff(diff: str, workspace: Path) -> str:
    """turn/diff/updated names files the way git would — relative to the
    enclosing repo (this one, when you run from the companion checkout).
    The wire's contract is workspace-relative paths, same as file_change,
    so strip the workspace's prefix off the a/ and b/ sides."""
    for parent in (workspace, *workspace.parents):
        if (parent / ".git").exists():
            prefix = workspace.relative_to(parent).as_posix() + "/"
            return diff.replace("a/" + prefix, "a/").replace("b/" + prefix, "b/")
    return diff


def history_from_turns(turns: list[dict]) -> list[dict]:
    """thread/read returns full protocol turns; a reopened chat needs only
    what was said — each userMessage, and each turn's final agentMessage.
    Everything else that happened (commands, patches) already left its
    mark on the workspace, and the workspace is truth."""
    history = []
    for turn in turns:
        final = None
        for item in turn.get("items", []):
            if item.get("type") == "userMessage":
                text = "".join(c.get("text", "") for c in item.get("content", [])
                               if c.get("type") == "text")
                if text:
                    history.append({"role": "user", "text": text})
            elif item.get("type") == "agentMessage":
                # Later agentMessages supersede earlier commentary; the
                # last one standing is the turn's final answer.
                final = item.get("text") or final
        if final:
            history.append({"role": "assistant", "text": final})
    return history


def translate(note: dict) -> dict | None:
    """Map one app-server notification onto the envelope, or drop it."""
    method, p = note["method"], note.get("params", {})
    if method == "item/agentMessage/delta":
        return {"type": "text_delta", "text": p.get("delta", "")}
    if method == "item/reasoning/summaryTextDelta":
        return {"type": "reasoning_delta", "item_id": p.get("itemId", ""),
                "text": p.get("delta", "")}
    if method == "item/commandExecution/outputDelta":
        # The schema calls this field `chunk`; CLI 0.142.4 sends `delta`
        # (plain text, not base64). Accept either spelling.
        return {"type": "command_output_delta", "item_id": p.get("itemId", ""),
                "chunk": p.get("delta", p.get("chunk", ""))}
    if method == "item/started":
        item = p.get("item", {})
        if item.get("type") in ("userMessage",):
            return None
        return {"type": "item_start", "item_id": item.get("id", ""),
                "kind": item.get("type", ""), "detail": item_detail(item)}
    if method == "item/completed":
        item = p.get("item", {})
        if item.get("type") in ("userMessage",):
            return None
        return {"type": "item_done", "item_id": item.get("id", ""),
                "kind": item.get("type", ""), "detail": item_detail(item)}
    if method == "turn/diff/updated":
        # The turn's aggregate unified diff so far — git-style, cumulative,
        # re-sent in full after every file change. The schema names the
        # field `diff`; accept the camelCase spelling too, just in case.
        return {"type": "diff_updated",
                "unified_diff": p.get("diff", p.get("unifiedDiff", ""))}
    if method == "approval/requested":
        # Synthetic (ours, from app.approvals) — already wire-shaped.
        return {"type": "approval_request", **p}
    if method == "approval/resolved":
        return {"type": "approval_resolved", **p}
    if method == "turn/completed":
        turn = p.get("turn", {})
        return {"type": "complete", "status": turn.get("status", ""),
                "duration_ms": turn.get("durationMs")}
    if method == "error":
        return {"type": "error", "message": p.get("message", "unknown error")}
    return None
