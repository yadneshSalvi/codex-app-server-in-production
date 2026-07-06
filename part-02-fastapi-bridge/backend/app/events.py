"""The SSE event vocabulary: one envelope, extended forever, never changed.

Part 2 defines six event types. Later parts only ever add new ones; the
frontend parser written against this file in Part 3 survives the whole series.
"""

import json


def sse(event: dict) -> str:
    """One envelope on the wire: data: {...}\n\n"""
    return f"data: {json.dumps(event)}\n\n"


def item_detail(item: dict) -> dict:
    """The few fields of an item worth putting on the wire, by kind."""
    kind = item.get("type", "unknown")
    if kind == "commandExecution":
        return {"command": item.get("command", "")}
    if kind == "fileChange":
        return {"files": [
            {"path": c.get("path", ""), "kind": c.get("kind", {}).get("type", "")}
            for c in item.get("changes", [])
        ]}
    if kind == "agentMessage":
        return {}
    return {}


def translate(note: dict) -> dict | None:
    """Map one app-server notification onto the envelope, or drop it."""
    method, p = note["method"], note.get("params", {})
    if method == "item/agentMessage/delta":
        return {"type": "text_delta", "text": p.get("delta", "")}
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
    if method == "turn/completed":
        turn = p.get("turn", {})
        return {"type": "complete", "status": turn.get("status", ""),
                "duration_ms": turn.get("durationMs")}
    if method == "error":
        return {"type": "error", "message": p.get("message", "unknown error")}
    return None
