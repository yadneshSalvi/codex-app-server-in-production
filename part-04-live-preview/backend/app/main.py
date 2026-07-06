"""Part 4: workspaces, the live preview, and the diff drawer.

Every project gets its own job site — projects/{id}/site/ — and the thread's
cwd points at it. The site is served straight out of that folder at
/preview/{project_id}/, and three new events (file_change, diff_updated,
preview_refresh) let the frontend reload the iframe, the file tree, and the
diff drawer as patches land.
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from app import projects
from app.codex_client import CodexClient, CodexError
from app.events import file_change_event, relativize_diff, sse, translate

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
    # briefs rides along so the frontend's dropdown never hardcodes the bank.
    return {"projects": projects.load_registry(),
            "briefs": projects.available_briefs()}


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


async def run_turn(project_id: str, message: str):
    workspace = projects.site_dir(project_id).resolve()
    thread = await client.request("thread/start", {
        "cwd": str(workspace),
        "sandbox": "workspace-write",
        "approvalPolicy": "never",
        "model": MODEL,
    })
    thread_id = thread["thread"]["id"]
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
    if not projects.site_dir(project_id).is_dir():
        raise HTTPException(status_code=404, detail="no such project")
    return StreamingResponse(run_turn(project_id, req.message),
                             media_type="text/event-stream")
