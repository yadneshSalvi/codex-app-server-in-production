"""Part 9: durable streams — the build survives the refresh.

The architecture change of Act II, and it is one split: running the
turn and watching the turn stop sharing a lifetime. Since Part 2 the
consumer loop lived inside the POST /chat response — whoever sent the
message held the only pipe, and when that pipe died (a refresh, a lost
Wi-Fi beat), the events kept flowing into a queue nobody would ever
drain again. The agent never noticed; only the audience left the room.

Now POST /chat starts the turn, hands the notification queue to a
BACKGROUND consumer task (drain → translate → append to app.eventlog),
and returns a claim ticket: {turn_id, stream_url}. Watching happens
somewhere else entirely: GET /projects/{id}/stream is a dumb pipe that
replays the log past the viewer's Last-Event-ID bookmark, then follows
live appends via the project's condition. Open it twice, close it,
reopen it mid-build — the consumer never notices. Stop and approvals
were ALREADY project-scoped POSTs (Part 7's Futures, Part 8's
interrupt), so any tab can press them; the stream they answer onto is
now every tab's stream. And at startup the orphan sweep tells the
truth about turns the previous process took down with it:
backend_restarted in the log, "orphaned" in the turns table, nothing
resurrected — the workspace and the thread survived, which is
everything of value.
"""

import asyncio
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from app import approvals, eventlog, projects, turns
from app.codex_client import CodexClient, CodexError
from app.events import (approval_patch, file_change_event, history_from_turns,
                        relativize_diff, sse, translate)

MODEL = "gpt-5.4-mini"

# The fourth policy the protocol offers and Pagewright never sends:
#   {"type": "dangerFullAccess"}
# It removes the OS walls entirely. Legitimate when the box is the wall —
# a throwaway CI runner, a container you delete afterwards — never from a
# hosted product where the process shares a machine with everything else.

client = CodexClient()


def sandbox_policy(mode: str, workspace) -> dict:
    """The mode → policy mapping, the whole grid in one place. read-only
    is the look-only wristband; standard and trusted share the same bench
    (writableRoots) and differ only in whether the network door opens."""
    if mode == "read-only":
        return {"type": "readOnly"}
    return {
        "type": "workspaceWrite",
        "writableRoots": [str(workspace)],
        "networkAccess": mode == "trusted",
    }


def approval_policy(mode: str) -> str:
    """The other dial, and the grid completes: Read-only never asks
    because it never acts; Standard asks first — "on-request" lets the
    agent propose stepping past the bench (a network fetch, a write
    outside the workspace) and freezes that item until a human stamps
    it; Trusted never asks because the sandbox contains. Verified live:
    the per-turn policy overrides the thread's "never" baseline."""
    return "on-request" if mode == "standard" else "never"


def mount_preview(app: FastAPI, project_id: str) -> None:
    # One StaticFiles mount per project; html=True makes / serve
    # index.html. Sandboxing the untrusted HTML is the iframe's job
    # (the sandbox attribute, client-side) — the server just hands out
    # files.
    app.mount(f"/preview/{project_id}",
              StaticFiles(directory=projects.site_dir(project_id), html=True))


def approval_handler(kind: str):
    """One handler per request method, differing only in the kind label.
    The handler runs inside CodexClient's dispatch task, so awaiting the
    Future in approvals.ask is what holds the JSON-RPC response open —
    and the notification pump keeps running, which is why the frozen
    item's own events still flow while the question hangs."""
    async def handle(params: dict) -> dict:
        notify = client.queue_for(params["threadId"]).put
        return await approvals.ask(kind, params, notify)
    return handle


@asynccontextmanager
async def lifespan(app: FastAPI):
    eventlog.init()
    # The orphan sweep: turns still "running" in the table belonged to
    # the previous process. Say so in each project's log BEFORE serving
    # a single request — a tab that reconnects gets the tombstone as
    # its next event, exactly where the stream went quiet.
    for orphan in eventlog.sweep_orphans():
        await eventlog.publish(orphan["project_id"], {
            "type": "backend_restarted",
            "turn_id": orphan["turn_id"],
            "message": "The backend restarted while this build was running. "
                       "Everything up to the last logged event was kept; the "
                       "rest of that turn is gone. The site files and the "
                       "conversation survived — just send the next message.",
        })
    for entry in projects.load_registry():
        mount_preview(app, entry["id"])
    # The Part 2 seam, finally used: server-initiated requests get
    # handlers instead of the polite empty reply.
    client.on_server_request("item/commandExecution/requestApproval",
                             approval_handler("command"))
    client.on_server_request("item/fileChange/requestApproval",
                             approval_handler("file_change"))
    await client.start()
    yield
    eventlog.close()


app = FastAPI(lifespan=lifespan)
# Any localhost port: Next picks 3001 when 3000 is taken, and the stream
# should not die over that.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://localhost:\d+",
    allow_methods=["*"],
    allow_headers=["*"],
)


class ProjectRequest(BaseModel):
    name: str | None = None
    brief: str | None = None


class ChatRequest(BaseModel):
    message: str


class ModeRequest(BaseModel):
    mode: str


class DecisionRequest(BaseModel):
    decision: str


@app.get("/projects")
async def list_projects():
    # The registry already carries what the sidebar needs (name,
    # auto-title, updated_at) — no protocol call per request. briefs
    # rides along so the frontend's picker never hardcodes the bank.
    return {"projects": projects.load_registry(),
            "briefs": projects.available_briefs()}


@app.get("/threads")
async def list_threads():
    """Debug: the engine's own view of the job archive. The sidebar reads
    projects.json instead — one flat file, no protocol call per render —
    but this is what protocol-native listing looks like."""
    return await client.request("thread/list", {})


@app.post("/projects")
async def create_project(req: ProjectRequest):
    try:
        entry = projects.create_project(req.name, req.brief)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    mount_preview(app, entry["id"])
    return entry


@app.patch("/projects/{project_id}/mode")
async def set_mode(project_id: str, req: ModeRequest):
    """Change a project's wristband. Takes effect on the NEXT turn — the
    policy rides on turn/start, so no thread surgery is needed."""
    if req.mode not in projects.MODES:
        raise HTTPException(status_code=400,
                            detail=f"mode must be one of {list(projects.MODES)}")
    if projects.get_project(project_id) is None:
        raise HTTPException(status_code=404, detail="no such project")
    return projects.update_project(project_id, mode=req.mode)


@app.post("/projects/{project_id}/approvals/{approval_id}/decision")
async def decide_approval(project_id: str, approval_id: str, req: DecisionRequest):
    """Resolve one pending approval. Any client that can reach this
    endpoint can answer — the Future doesn't care which tab (Part 9
    collects that dividend). Answering twice, or after the timeout
    already declined it, is an honest 404: the question is gone."""
    entry = projects.get_project(project_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="no such project")
    if req.decision not in approvals.DECISIONS:
        raise HTTPException(
            status_code=400,
            detail=f"decision must be one of {list(approvals.DECISIONS)}")
    pending = approvals.get(approval_id)
    if pending is None or pending.thread_id != entry.get("thread_id"):
        raise HTTPException(status_code=404,
                            detail="no such pending approval for this project")
    if not approvals.resolve(approval_id, req.decision):
        raise HTTPException(status_code=404, detail="approval already resolved")
    return {"approval_id": approval_id, "decision": req.decision}


@app.get("/projects/{project_id}/files")
async def project_files(project_id: str):
    if not projects.site_dir(project_id).is_dir():
        raise HTTPException(status_code=404, detail="no such project")
    return {"files": projects.list_files(project_id)}


@app.get("/projects/{project_id}/history")
async def project_history(project_id: str):
    """The conversation so far, replayed from the rollout via thread/read
    — no engine turn, just the archive read back."""
    entry = projects.get_project(project_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="no such project")
    if not entry.get("thread_id"):
        return {"history": []}
    try:
        result = await client.request(
            "thread/read", {"threadId": entry["thread_id"], "includeTurns": True})
    except CodexError:
        # A dangling bookmark: the chat endpoint resets it on the next
        # message; until then the project simply has no history.
        return {"history": []}
    return {"history": history_from_turns(result["thread"].get("turns", []))}


@app.post("/projects/{project_id}/fork")
async def fork_project(project_id: str):
    src = projects.get_project(project_id)
    if src is None:
        raise HTTPException(status_code=404, detail="no such project")
    if not src.get("thread_id"):
        raise HTTPException(status_code=409,
                            detail="nothing to fork yet — chat with the project first")
    new_id = projects.fork_workspace(project_id)
    workspace = projects.site_dir(new_id).resolve()
    # thread/fork copies the conversation into a new thread; cwd points it
    # at the copied workspace so both drafts keep drawing themselves.
    forked = await client.request("thread/fork", {
        "threadId": src["thread_id"], "cwd": str(workspace)})
    entry = projects.register_fork(src, new_id, forked["thread"]["id"],
                                   forked["thread"].get("forkedFromId") or src["thread_id"])
    mount_preview(app, new_id)
    return entry


def title_from(message: str) -> str:
    """The first words of the first message, cut at a word boundary."""
    title = ""
    for word in message.split():
        if len(title) + len(word) + 1 > 48:
            break
        title = f"{title} {word}".strip()
    return title or "Untitled site"


async def ensure_thread(entry: dict, workspace) -> tuple[str, bool]:
    """Reopen the project's job folder at the bookmark, or open a fresh
    one. Returns (thread_id, reset) — reset means the saved conversation
    could not be restored and a new thread took its place."""
    thread_id = entry.get("thread_id")
    if thread_id:
        try:
            await client.request("thread/resume", {"threadId": thread_id})
            return thread_id, False
        except CodexError:
            # The rollout is gone (deleted, or CODEX_HOME moved). The
            # workspace is truth: same files, new conversation.
            pass
    # thread/start takes a mode STRING and sets the thread's baseline;
    # the structured per-mode policy rides on every turn/start instead,
    # so a mode switch never needs a new thread.
    started = await client.request("thread/start", {
        "cwd": str(workspace),
        "sandbox": "workspace-write",
        "approvalPolicy": "never",
        "model": MODEL,
    })
    new_id = started["thread"]["id"]
    projects.update_project(entry["id"], thread_id=new_id)
    return new_id, thread_id is not None


async def finish_turn(project_id: str, thread_id: str, message: str) -> None:
    """The bookkeeping after a completed turn: auto-title the thread the
    first time, and stamp the registry's updated_at."""
    entry = projects.get_project(project_id)
    if entry and entry.get("thread_name") is None:
        name = title_from(message)
        try:
            await client.request("thread/name/set",
                                 {"threadId": thread_id, "name": name})
            projects.update_project(project_id, thread_name=name)
        except CodexError:
            pass  # a failed rename must never break the turn
    projects.touch(project_id)


# Every consumer task currently in flight, keyed by turn_id. This dict
# is doing invisible, load-bearing work: asyncio keeps only WEAK
# references to tasks, so a create_task() result nobody stores can be
# garbage-collected mid-run. Holding it here is what keeps it alive.
CONSUMERS: dict[str, asyncio.Task] = {}


async def consume_turn(project_id: str, thread_id: str, turn_id: str,
                       message: str, workspace, queue: asyncio.Queue) -> None:
    """The consumer: one background task per turn, draining the thread's
    notification queue into the event log. This is Part 2's read loop
    with a different destination — every translate() call, the usage
    delta, the fileChange join, all unchanged — but nobody holds a pipe
    to it. The turn now outlives every viewer, which is the whole part."""
    # The meter. Verified live: the wire's `last` is the most recent
    # MODEL REQUEST (not the turn — a build turn makes many, and `total`
    # grows by exactly `last` on every update); `total` is the THREAD's
    # lifetime count. The honest per-turn number is therefore a delta:
    # total now minus total when this turn began — and the baseline
    # falls out of the first update (total − last).
    baseline: dict | None = None
    turn_usage: dict = {}
    usage_total: dict = {}
    # fileChange items seen this turn, by id. A fileChange approval names
    # only its itemId; the patch it is asking about arrived on the item's
    # own item/started, always before the question (verified live) —
    # this is the join table.
    file_changes: dict[str, dict] = {}
    # What the turns table will remember. Anything short of a clean
    # wire-reported ending counts as failed.
    outcome = "failed"
    try:
        while True:
            note = await queue.get()
            # One consumer drains ONE turn's events. Every turn-scoped
            # notification names its turn (`turnId`, or `turn.id` on
            # turn/completed — verified against live traces); a stalled
            # Part-8 viewer used to leave the NEXT turn a backlog, and
            # the same guard keeps a lingering consumer from logging a
            # successor's events as its own.
            named = ((note.get("params") or {}).get("turnId")
                     or ((note.get("params") or {}).get("turn") or {}).get("id"))
            if named is not None and named != turn_id:
                continue
            event = translate(note)
            if event is None:
                continue
            if event["type"] == "usage_update":
                if baseline is None:
                    baseline = {k: event["total"].get(k, 0) - event["last"].get(k, 0)
                                for k in event["total"]}
                turn_usage = {k: v - baseline.get(k, 0)
                              for k, v in event["total"].items()}
                event["turn"] = turn_usage
                usage_total = event["total"]
                turns.record_usage(project_id, {k: v for k, v in event.items()
                                                if k != "type"})
            if event["type"] == "complete":
                # The receipt: what THIS turn cost (the computed delta).
                # The thread's lifetime bill rides along under its true
                # name.
                event["usage"] = turn_usage
                event["thread_total"] = usage_total
                outcome = event["status"] or "completed"
                await finish_turn(project_id, thread_id, message)
            if event["type"] == "diff_updated":
                event["unified_diff"] = relativize_diff(event["unified_diff"], workspace)
            if event["type"] == "item_start" and event["kind"] == "fileChange":
                file_changes[event["item_id"]] = note["params"].get("item", {})
            if event["type"] == "approval_request" and event["kind"] == "file_change":
                item = file_changes.get(event["item_id"], {})
                event["files"], event["diff"] = approval_patch(item, workspace)
            await eventlog.publish(project_id, event)
            # fileChange items get a second, dedicated event with
            # workspace-relative paths — and, once the patch has landed,
            # a nudge to reload the iframe.
            if event["type"] in ("item_start", "item_done") and event["kind"] == "fileChange":
                item = note["params"].get("item", {})
                status = "started" if event["type"] == "item_start" else "done"
                await eventlog.publish(project_id,
                                       file_change_event(item, status, workspace))
                if status == "done":
                    await eventlog.publish(project_id, {
                        "type": "preview_refresh", "project_id": project_id})
            if event["type"] in ("complete", "error"):
                return
    except Exception as exc:  # noqa: BLE001 — a consumer nobody awaits
        # must turn failures into logged events, or they vanish.
        await eventlog.publish(project_id, {"type": "error", "message": str(exc)})
    finally:
        # However the turn ended — completed, interrupted, failed, or
        # the consumer itself blew up — the floor is empty again and
        # the table gets the ending. Named, so a consumer outliving its
        # turn can't erase a newer turn's ledger line.
        turns.end(project_id, turn_id)
        eventlog.finish_turn(turn_id, outcome)
        CONSUMERS.pop(turn_id, None)


@app.post("/projects/{project_id}/chat")
async def chat(project_id: str, req: ChatRequest):
    """One endpoint, two verbs, and — since Part 9 — ZERO streams. A
    message that arrives while a turn is ACTIVE becomes a steer, exactly
    as in Part 8. Otherwise it starts the turn, spawns the consumer, and
    answers with a claim ticket: {turn_id, stream_url}. What it no
    longer does is hold the events hostage in its own response body —
    the sender's tab watches the same GET /stream as every other tab."""
    if projects.get_project(project_id) is None:
        raise HTTPException(status_code=404, detail="no such project")
    active = turns.active(project_id)
    if active is not None:
        try:
            await client.request("turn/steer", {
                "threadId": active["thread_id"],
                # The precondition, not a formality: steer fails unless
                # this matches the turn that is live RIGHT NOW. That
                # failure is the race guard — see except below.
                "expectedTurnId": active["turn_id"],
                "input": [{"type": "text", "text": req.message}],
            })
        except CodexError:
            # The turn finished a beat before the message landed
            # (verified live: -32600 "no active turn to steer"). Not an
            # error a user should see — the ledger is stale, so clear
            # it and fall through to a normal turn/start.
            turns.end(project_id, active["turn_id"])
        else:
            # Tell the log a steer landed (the approvals trick: a
            # synthetic note rides the queue in arrival order). The
            # steered text will also resurface as a plain userMessage
            # item at the model's next inference boundary — but that
            # item doesn't say "steer"; this does.
            await client.queue_for(active["thread_id"]).put(
                {"method": "steer/accepted",
                 "params": {"text": req.message, "turn_id": active["turn_id"]}})
            return {"steered": True, "turn_id": active["turn_id"]}
    entry = projects.get_project(project_id)
    workspace = projects.site_dir(project_id).resolve()
    mode = entry.get("mode", "standard")
    thread_id, reset = await ensure_thread(entry, workspace)
    queue = client.queue_for(thread_id)
    started = await client.request("turn/start", {
        "threadId": thread_id,
        "input": [{"type": "text", "text": req.message}],
        # The wristband for THIS work order: the project's current mode,
        # translated to a structured policy — both dials, as in Part 8.
        "sandboxPolicy": sandbox_policy(mode, workspace),
        "approvalPolicy": approval_policy(mode),
        # Without this the model reasons silently and the drawer stays
        # empty. Part 10 turns summary (and effort) into user-facing dials.
        "summary": "detailed",
    })
    turn_id = started["turn"]["id"]
    # The response names the turn — interrupt and steer need that name
    # (in memory, this process), and the restart sweep needs the row.
    turns.begin(project_id, thread_id, turn_id)
    eventlog.begin_turn(project_id, turn_id)
    # session_start now carries the user's message: every tab is just a
    # viewer of the log — including the one that typed — so the question
    # itself has to be on the wire.
    await eventlog.publish(project_id, {
        "type": "session_start", "session_id": thread_id,
        "project_id": project_id, "mode": mode, "turn_id": turn_id,
        "message": req.message, "started_at_ms": int(time.time() * 1000)})
    if reset:
        await eventlog.publish(project_id, {
            "type": "thread_reset",
            "message": "chat history could not be restored; "
                       "the site files are intact"})
    CONSUMERS[turn_id] = asyncio.create_task(consume_turn(
        project_id, thread_id, turn_id, req.message, workspace, queue))
    return {"turn_id": turn_id, "thread_id": thread_id,
            "stream_url": f"/projects/{project_id}/stream"}


@app.get("/projects/{project_id}/stream")
async def stream(project_id: str, request: Request, after: int = 0):
    """The dumb pipe: replay-then-follow. It knows nothing about turns
    or agents — it reads a log and waits by a doorbell. A fresh viewer
    gets the whole story from seq 1; a reconnecting EventSource sends
    Last-Event-ID and gets only what it missed; `?after=` is the same
    bookmark for curl and tests. The header wins when both are present,
    because the browser's bookmark is the truer one."""
    if projects.get_project(project_id) is None:
        raise HTTPException(status_code=404, detail="no such project")
    header = request.headers.get("last-event-id", "")
    if header.isdigit():
        after = int(header)

    async def frames(last: int):
        # Replay: the past, straight from the table.
        for seq, event in eventlog.replay(project_id, last):
            last = seq
            yield sse(event, event_id=seq)
        # The seam between past and present, marked honestly. Ephemeral:
        # never logged, no id — it isn't an event that happened, it's
        # the stream saying "you're current".
        yield sse({"type": "caught_up", "last_seq": last})
        # Follow: wait by the doorbell, re-read the log, repeat. The
        # log is the source of truth; the condition only says "look
        # again". A 15s silence becomes a keepalive comment — same
        # dead-socket insurance as Part 7.
        cond = eventlog.condition_for(project_id)
        while True:
            rows = eventlog.replay(project_id, last)
            for seq, event in rows:
                last = seq
                yield sse(event, event_id=seq)
            if rows:
                continue
            async with cond:
                # Re-check under the lock: an append between our read
                # and this line must not become a missed wakeup.
                if eventlog.tail_seq(project_id) > last:
                    continue
                try:
                    await asyncio.wait_for(cond.wait(), timeout=15)
                    continue
                except TimeoutError:
                    pass
            yield ": keepalive\n\n"

    return StreamingResponse(frames(after), media_type="text/event-stream")


@app.post("/projects/{project_id}/interrupt")
async def interrupt_turn(project_id: str):
    """The Stop button. turn/interrupt names the exact turn (both params
    required) and returns almost immediately; the real answer arrives on
    the STREAM as the same turn/completed every turn ends with — status
    "interrupted". Cooperative at the AGENT level, verified live: the
    turn ends at once and the in-flight item is abandoned mid-lifecycle
    (no item/completed ever fires for it), but the OS process it started
    is NOT killed — a sleepy shell loop kept writing for 9 more seconds
    after the interrupt and every write landed. Stop halts the agent,
    not the machine; the workspace keeps whatever lands."""
    if projects.get_project(project_id) is None:
        raise HTTPException(status_code=404, detail="no such project")
    active = turns.active(project_id)
    if active is None:
        raise HTTPException(status_code=409, detail="no active turn to interrupt")
    try:
        await client.request("turn/interrupt", {
            "threadId": active["thread_id"], "turnId": active["turn_id"]})
    except CodexError as exc:
        # Same race as steer: the turn ended on its own first.
        raise HTTPException(status_code=409, detail=str(exc))
    return {"interrupted": True, "turn_id": active["turn_id"]}


@app.get("/projects/{project_id}/turn")
async def active_turn(project_id: str):
    """Debug, like GET /threads: the ledger's view of the shop floor.
    `active` is null between turns — and it can be honestly stale for a
    moment when a viewer stalls (the steer fallback exists for exactly
    that window)."""
    if projects.get_project(project_id) is None:
        raise HTTPException(status_code=404, detail="no such project")
    return {"active": turns.active(project_id)}


@app.get("/projects/{project_id}/usage")
async def project_usage(project_id: str):
    """The meter, on demand: the latest usage_update this project has
    seen (last turn + thread total), from memory. Empty until the first
    tokenUsage note — and after a restart, which is honest: durability
    is Part 9's job."""
    if projects.get_project(project_id) is None:
        raise HTTPException(status_code=404, detail="no such project")
    return {"usage": turns.usage(project_id)}


@app.get("/usage/limits")
async def usage_limits():
    """account/rateLimits/read, proxied for the grown-ups: how much of
    the account's rate windows this machine has burned. Part 13 puts
    this on a status page next to the server's own vitals."""
    try:
        return await client.request("account/rateLimits/read", {})
    except CodexError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
