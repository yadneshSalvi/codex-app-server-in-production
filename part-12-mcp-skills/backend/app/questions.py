"""Pending questions: the foreman's inbox, second drawer.

`item/tool/requestUserInput` is the third server-initiated request to
land on the Part 2 seam, and the first one that is a QUESTION rather
than a permission: the agent wants a product decision (which palette?
serif or sans?) and freezes its tool call until someone answers. The
bridge is the same Future pattern as app.approvals — register, announce
on the stream, wait, answer down stdio — with one difference in shape:
a single request carries a LIST of questions, each with an id, and the
JSON-RPC response maps every id to its answers.

Verified live on 0.142.4: the request does NOT fire on a default
thread; thread/start must opt in with
`config: {"features.default_mode_request_user_input": true}` (the flag
the reference app sets, still marked under-development — the server
says so in a `warning` notification). Real params:
`{threadId, turnId, itemId, questions: [{id, header, question, isOther,
isSecret, options: [{label, description}] | null}], autoResolutionMs}`.
Real response: `{answers: {<question_id>: {answers: ["<text>"]}}}` —
answered that way live, and the agent built with the chosen palette.
"""

import asyncio
import os
import time
import uuid


def timeout_seconds() -> float:
    """Same ten-minute product decision as approvals, same test hook."""
    return float(os.environ.get("PAGEWRIGHT_QUESTION_TIMEOUT", "600"))


class PendingQuestion:
    """One unanswered request (which may hold several questions). The
    Future is the mailbox: the JSON-RPC handler awaits it, the answer
    endpoint fills it with {question_id: [answers]}."""

    def __init__(self, thread_id: str, item_id: str, questions: list[dict]) -> None:
        self.id = uuid.uuid4().hex[:8]
        self.thread_id = thread_id
        self.item_id = item_id
        self.questions = questions
        self.timeout = timeout_seconds()
        self.expires_at_ms = int((time.time() + self.timeout) * 1000)
        self.future: asyncio.Future = asyncio.get_running_loop().create_future()


_registry: dict[str, PendingQuestion] = {}


def get(question_id: str) -> PendingQuestion | None:
    return _registry.get(question_id)


def resolve(question_id: str, answers: dict[str, list[str]]) -> bool:
    """Answer a pending request. False when it is gone or already
    answered — the endpoint turns that into an honest 404."""
    pending = _registry.get(question_id)
    if pending is None or pending.future.done():
        return False
    pending.future.set_result(answers)
    return True


async def ask(params: dict, notify) -> dict:
    """The bridge, end to end — same rhythm as approvals.ask.

    `notify` slips a synthetic note into the thread's notification
    queue, so the question card rides the same SSE stream as every
    other event, exactly where the turn paused."""
    pending = PendingQuestion(params.get("threadId", ""),
                              params.get("itemId", ""),
                              params.get("questions", []))
    _registry[pending.id] = pending
    await notify({"method": "question/requested", "params": {
        "question_id": pending.id,
        "item_id": pending.item_id,
        # The questions ride the wire as the protocol shaped them: id,
        # header, question, options ({label, description}), isOther
        # (free-text allowed), isSecret (mask the input).
        "questions": pending.questions,
        "expires_at_ms": pending.expires_at_ms,
    }})
    try:
        answers = await asyncio.wait_for(pending.future, pending.timeout)
        reason = "user"
    except asyncio.TimeoutError:
        # Nobody answered. There is no "decline" for a question; the
        # honest move is an empty answer sheet — the agent proceeds on
        # its own judgment, which is exactly what it would have done
        # had it never asked.
        answers, reason = {}, "timeout"
    finally:
        _registry.pop(pending.id, None)
    await notify({"method": "question/resolved", "params": {
        "question_id": pending.id,
        "answers": answers,
        "reason": reason,
        "resolved_at_ms": int(time.time() * 1000),
    }})
    # The protocol's answer shape wraps each id's list one level deeper:
    # {answers: {id: {answers: [...]}}} (verified live).
    return {"answers": {qid: {"answers": ans} for qid, ans in answers.items()}}
