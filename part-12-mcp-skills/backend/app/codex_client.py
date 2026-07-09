"""The reusable app-server client: one process, many threads.

Speaks newline-delimited JSON-RPC to `codex app-server` over stdio. Requests
get numbered ids and matching futures; notifications are routed to per-thread
queues; server-initiated requests (approvals, in Part 7) go to registered
handlers. Built in Part 2, extended but never rewritten for the rest of the
series.

Part 12 adds the last seam: `on_notification` registers a handler for a
notification METHOD, regardless of thread. Until now every notification
either named a thread (and went to its queue) or was dropped; MCP server
startup status (`mcpServer/startupStatus/updated`) is the first one the
product needs that can arrive with `threadId: null` — a server booting,
or failing to, belongs to the engine, not to any one conversation.
Method handlers run IN ADDITION to thread routing, not instead of it.
"""

import asyncio
import json
from collections import deque

MAX_LINE_BYTES = 8 * 1024 * 1024


class CodexError(Exception):
    """A JSON-RPC error reply, or a dead engine. `code` carries the
    protocol's error code when there is one — typed errors, not string
    matching, are what Part 5's resume fallback keys on."""

    def __init__(self, message: str, code: int | None = None) -> None:
        super().__init__(message)
        self.code = code


class CodexClient:
    def __init__(self) -> None:
        self.proc = None
        self._next_id = 0
        self._pending: dict[int, asyncio.Future] = {}
        self._queues: dict[str, asyncio.Queue] = {}
        self._server_handlers: dict[str, callable] = {}
        self._method_handlers: dict[str, callable] = {}
        # asyncio holds only weak references to tasks; anchor handler
        # tasks here so a notification handler can't be GC'd mid-run
        # (the same trick main.CONSUMERS does for turn consumers).
        self._handler_tasks: set[asyncio.Task] = set()
        self._stderr_tail: deque[str] = deque(maxlen=40)
        self._write_lock = asyncio.Lock()

    async def start(self) -> None:
        self.proc = await asyncio.create_subprocess_exec(
            "codex", "app-server",
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            limit=MAX_LINE_BYTES,
        )
        asyncio.create_task(self._read_stdout())
        asyncio.create_task(self._read_stderr())
        await self.request("initialize", {
            "clientInfo": {"name": "pagewright", "title": "Pagewright", "version": "0.2"},
            "capabilities": {},
        })
        await self._send({"jsonrpc": "2.0", "method": "initialized", "params": {}})

    def on_server_request(self, method: str, handler) -> None:
        """Register an async handler for server-initiated requests (Part 7)."""
        self._server_handlers[method] = handler

    def on_notification(self, method: str, handler) -> None:
        """Register an async handler for one notification method (Part 12).
        Runs for every such notification — with or without a threadId —
        on top of the normal per-thread queue routing."""
        self._method_handlers[method] = handler

    def queue_for(self, thread_id: str) -> asyncio.Queue:
        """The notification mailbox for one thread."""
        return self._queues.setdefault(thread_id, asyncio.Queue())

    async def request(self, method: str, params: dict, timeout: float = 60) -> dict:
        self._next_id += 1
        rid = self._next_id
        fut = asyncio.get_running_loop().create_future()
        self._pending[rid] = fut
        await self._send({"jsonrpc": "2.0", "id": rid, "method": method, "params": params})
        try:
            msg = await asyncio.wait_for(fut, timeout)
        finally:
            self._pending.pop(rid, None)
        if "error" in msg:
            raise CodexError(msg["error"].get("message", str(msg["error"])),
                             msg["error"].get("code"))
        return msg["result"]

    async def _send(self, obj: dict) -> None:
        async with self._write_lock:
            self.proc.stdin.write((json.dumps(obj) + "\n").encode())
            await self.proc.stdin.drain()

    async def _respond(self, rid, result: dict) -> None:
        await self._send({"jsonrpc": "2.0", "id": rid, "result": result})

    async def _read_stdout(self) -> None:
        while True:
            line = await self.proc.stdout.readline()
            if not line:
                self._fail_pending("codex app-server exited: " + " | ".join(self._stderr_tail))
                return
            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                continue
            if "id" in msg and ("result" in msg or "error" in msg):
                fut = self._pending.get(msg["id"])
                if fut and not fut.done():
                    fut.set_result(msg)
            elif "id" in msg and "method" in msg:
                asyncio.create_task(self._dispatch_server_request(msg))
            elif "method" in msg:
                handler = self._method_handlers.get(msg["method"])
                if handler is not None:
                    task = asyncio.create_task(handler(msg.get("params") or {}))
                    self._handler_tasks.add(task)
                    task.add_done_callback(self._handler_tasks.discard)
                thread_id = (msg.get("params") or {}).get("threadId")
                if thread_id:
                    await self.queue_for(thread_id).put(msg)

    async def _dispatch_server_request(self, msg: dict) -> None:
        handler = self._server_handlers.get(msg["method"])
        if handler is None:
            await self._respond(msg["id"], {})
            return
        await self._respond(msg["id"], await handler(msg.get("params") or {}))

    async def _read_stderr(self) -> None:
        while True:
            line = await self.proc.stderr.readline()
            if not line:
                return
            self._stderr_tail.append(line.decode(errors="replace").strip())

    def _fail_pending(self, reason: str) -> None:
        for fut in self._pending.values():
            if not fut.done():
                fut.set_exception(CodexError(reason))
