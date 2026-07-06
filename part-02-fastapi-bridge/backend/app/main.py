"""Part 2: the agent behind a URL, streaming.

POST /chat starts a fresh thread, runs one turn, and streams the envelope
events as SSE. Watch it with:  curl -N localhost:8000/chat -d '{"message":"..."}'
"""

import json
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.codex_client import CodexClient, CodexError
from app.events import sse, translate

MODEL = "gpt-5.4-mini"
SITE = Path("site")

client = CodexClient()


@asynccontextmanager
async def lifespan(app: FastAPI):
    SITE.mkdir(exist_ok=True)
    await client.start()
    yield


app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatRequest(BaseModel):
    message: str


async def run_turn(message: str):
    thread = await client.request("thread/start", {
        "cwd": str(SITE.resolve()),
        "sandbox": "workspace-write",
        "approvalPolicy": "never",
        "model": MODEL,
    })
    thread_id = thread["thread"]["id"]
    queue = client.queue_for(thread_id)
    await client.request("turn/start", {
        "threadId": thread_id,
        "input": [{"type": "text", "text": message}],
    })

    yield sse({"type": "session_start", "session_id": thread_id})
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
            yield sse(event)
            if event["type"] in ("complete", "error"):
                return
    except CodexError as exc:
        yield sse({"type": "error", "message": str(exc)})


@app.post("/chat")
async def chat(req: ChatRequest):
    return StreamingResponse(run_turn(req.message), media_type="text/event-stream")
