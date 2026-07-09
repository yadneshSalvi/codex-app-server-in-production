"""Pending approvals: the foreman's inbox.

For approvals the direction of authority reverses: the app server sends
US a JSON-RPC request — it has an id, it demands a response — and the
item it belongs to stays frozen until we answer. Each request becomes an
asyncio.Future parked in this registry; the SSE stream announces it; a
POST from whoever is watching resolves it; returning from the handler is
literally answering the JSON-RPC request down stdio. Nobody answers in
time → auto-decline. That timeout is a product decision, made explicitly:
a hosted builder must not hold a work order (and its server-side turn)
open forever because a human closed the tab.
"""

import asyncio
import os
import time
import uuid

# The decisions Pagewright accepts, taken from the generated schema's
# CommandExecutionApprovalDecision / FileChangeApprovalDecision enums
# (minus the two execpolicy/network amendment shapes we don't surface)
# and verified live. NOT taken from the request's own availableDecisions
# field: in 0.142.4 that field is narrower than the truth — command
# requests list only accept / acceptWithExecpolicyAmendment / cancel,
# yet the server honors decline (the item completes with status
# "declined") and acceptForSession; fileChange requests carry no
# availableDecisions at all. The schema enum is the vocabulary.
DECISIONS = ("accept", "acceptForSession", "decline", "cancel")


def timeout_seconds() -> float:
    """Ten minutes by default; the tests shrink it via the env var."""
    return float(os.environ.get("PAGEWRIGHT_APPROVAL_TIMEOUT", "600"))


class PendingApproval:
    """One unanswered question. The Future is the mailbox: the JSON-RPC
    handler awaits it, the decision endpoint fills it."""

    def __init__(self, kind: str, thread_id: str, item_id: str) -> None:
        self.id = uuid.uuid4().hex[:8]
        self.kind = kind  # "command" | "file_change"
        self.thread_id = thread_id
        self.item_id = item_id
        self.timeout = timeout_seconds()
        self.expires_at_ms = int((time.time() + self.timeout) * 1000)
        self.future: asyncio.Future = asyncio.get_running_loop().create_future()


_registry: dict[str, PendingApproval] = {}


def get(approval_id: str) -> PendingApproval | None:
    return _registry.get(approval_id)


def resolve(approval_id: str, decision: str) -> bool:
    """Answer a pending approval. False when it is gone or already
    answered — the endpoint turns that into an honest 404."""
    pending = _registry.get(approval_id)
    if pending is None or pending.future.done():
        return False
    pending.future.set_result(decision)
    return True


async def ask(kind: str, params: dict, notify) -> dict:
    """The bridge, end to end: register, announce, wait, answer.

    `notify` delivers a synthetic note into the thread's notification
    queue, so the approval rides the same SSE stream as every other
    event, in arrival order — the card lands in the chat exactly where
    the turn paused.
    """
    pending = PendingApproval(kind, params.get("threadId", ""),
                              params.get("itemId", ""))
    _registry[pending.id] = pending
    await notify({"method": "approval/requested", "params": {
        "approval_id": pending.id,
        "kind": kind,
        "item_id": pending.item_id,
        # Command requests carry the command and its cwd; fileChange
        # requests carry neither (the patch arrived on the item itself —
        # main.run_turn joins them by item_id before the wire).
        "command": params.get("command"),
        "cwd": params.get("cwd"),
        "reason": params.get("reason"),
        "available_decisions": list(DECISIONS),
        "expires_at_ms": pending.expires_at_ms,
    }})
    try:
        decision = await asyncio.wait_for(pending.future, pending.timeout)
        reason = "user"
    except asyncio.TimeoutError:
        decision, reason = "decline", "timeout"
    finally:
        _registry.pop(pending.id, None)
    await notify({"method": "approval/resolved", "params": {
        "approval_id": pending.id,
        "decision": decision,
        "reason": reason,
        "resolved_at_ms": int(time.time() * 1000),
    }})
    return {"decision": decision}
