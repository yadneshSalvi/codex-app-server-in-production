"""The active-turn ledger: who is on the shop floor right now.

Live control names a specific turn. `turn/interrupt` wants
`{threadId, turnId}`; `turn/steer` wants `{threadId, expectedTurnId}` —
a required precondition, not a hint: the request FAILS when the id does
not match the currently active turn. So the backend remembers, per
project, which turn is live: written when turn/start answers (the
response carries `turn.id`), erased when turn/completed arrives — or
when steer discovers the turn is already gone.

The same ledger keeps the latest token-usage note, so GET /usage
answers from memory instead of replaying the thread. In-memory on
purpose: a restart forgets both, and that is honest — the active turn
really is gone, and the meter re-fills on the next
thread/tokenUsage/updated. Durability is Part 9's job.
"""

import time

_active: dict[str, dict] = {}
_usage: dict[str, dict] = {}


def begin(project_id: str, thread_id: str, turn_id: str) -> None:
    _active[project_id] = {
        "thread_id": thread_id,
        "turn_id": turn_id,
        "started_at": time.time(),
    }


def end(project_id: str, turn_id: str | None = None) -> None:
    """Clear the ledger line — but only if it still names the turn the
    caller thinks it does. A stream that lingered past its turn (a slow
    viewer, a race fallback) must not wipe the entry a NEWER turn just
    wrote."""
    if turn_id is None or _active.get(project_id, {}).get("turn_id") == turn_id:
        _active.pop(project_id, None)


def active(project_id: str) -> dict | None:
    """The live turn on this project, or None between turns."""
    return _active.get(project_id)


def record_usage(project_id: str, usage: dict) -> None:
    """Keep the newest usage_update payload (last + total + window)."""
    _usage[project_id] = usage


def usage(project_id: str) -> dict:
    return _usage.get(project_id, {})
