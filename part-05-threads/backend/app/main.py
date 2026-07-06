"""Part 5: threads that persist — projects, resume, and fork.

Every project now keeps ONE thread for its whole life. The first message
starts it and persists the id in projects.json; every later message calls
thread/resume first, so the conversation has memory — across messages AND
across backend restarts (the rollout archive under CODEX_HOME/sessions is
the engine's own persistence; we store nothing but the bookmark). If the
bookmark dangles (rollout deleted), we fall back to a fresh thread and say
so honestly with a thread_reset event: the history is gone, the site files
are not. Forking photocopies both halves — thread/fork for the
conversation, cp -r for the workspace.
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from app import projects
from app.codex_client import CodexClient, CodexError
from app.events import (file_change_event, history_from_turns, relativize_diff,
                        sse, translate)

MODEL = "gpt-5.4-mini"

client = CodexClient()


def mount_preview(app: FastAPI, project_id: str) -> None:
    # One StaticFiles mount per project; html=True makes / serve
    # index.html. Sandboxing the untrusted HTML is the iframe's job
    # (the sandbox attribute, client-side) — the server just hands out
    # files.
    app.mount(f"/preview/{project_id}",
              StaticFiles(directory=projects.site_dir(project_id), html=True))


@asynccontextmanager
async def lifespan(app: FastAPI):
    for entry in projects.load_registry():
        mount_preview(app, entry["id"])
    await client.start()
    yield


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


async def run_turn(project_id: str, message: str):
    entry = projects.get_project(project_id)
    workspace = projects.site_dir(project_id).resolve()
    thread_id, reset = await ensure_thread(entry, workspace)
    queue = client.queue_for(thread_id)
    await client.request("turn/start", {
        "threadId": thread_id,
        "input": [{"type": "text", "text": message}],
        # Without this the model reasons silently and the drawer stays
        # empty. Part 10 turns summary (and effort) into user-facing dials.
        "summary": "detailed",
    })

    yield sse({"type": "session_start", "session_id": thread_id,
               "project_id": project_id})
    if reset:
        yield sse({"type": "thread_reset",
                   "message": "chat history could not be restored; "
                              "the site files are intact"})
    usage: dict = {}
    try:
        while True:
            note = await queue.get()
            if note["method"] == "thread/tokenUsage/updated":
                usage = note["params"].get("tokenUsage", {}).get("total", {})
                continue
            event = translate(note)
            if event is None:
                continue
            if event["type"] == "complete":
                event["usage"] = usage
                await finish_turn(project_id, thread_id, message)
            if event["type"] == "diff_updated":
                event["unified_diff"] = relativize_diff(event["unified_diff"], workspace)
            yield sse(event)
            # fileChange items get a second, dedicated event with
            # workspace-relative paths — and, once the patch has landed,
            # a nudge to reload the iframe.
            if event["type"] in ("item_start", "item_done") and event["kind"] == "fileChange":
                item = note["params"].get("item", {})
                status = "started" if event["type"] == "item_start" else "done"
                yield sse(file_change_event(item, status, workspace))
                if status == "done":
                    yield sse({"type": "preview_refresh", "project_id": project_id})
            if event["type"] in ("complete", "error"):
                return
    except CodexError as exc:
        yield sse({"type": "error", "message": str(exc)})


@app.post("/projects/{project_id}/chat")
async def chat(project_id: str, req: ChatRequest):
    if projects.get_project(project_id) is None:
        raise HTTPException(status_code=404, detail="no such project")
    return StreamingResponse(run_turn(project_id, req.message),
                             media_type="text/event-stream")
