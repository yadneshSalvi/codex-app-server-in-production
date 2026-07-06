"""Part 1: your first thread. One prompt in, a real website out.

Speaks JSON-RPC to `codex app-server` over stdio: initialize, thread/start,
turn/start, then narrates the notification stream until the turn completes.
Run it, then open site/index.html in a browser.
"""

import asyncio
import json
import sys
from pathlib import Path

MODEL = "gpt-5.4-mini"
SITE = Path("site")

DEFAULT_PROMPT = (
    "Build a single-page site for Beanline, a specialty coffee chain: warm, "
    "editorial, a hero and a menu section. One index.html, inline CSS, no "
    "external resources."
)


class AppServer:
    """The smallest possible client: numbered notes under the door."""

    def __init__(self) -> None:
        self.proc = None
        self.next_id = 0

    async def start(self) -> None:
        self.proc = await asyncio.create_subprocess_exec(
            "codex", "app-server",
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
        )

    async def send(self, msg: dict) -> None:
        self.proc.stdin.write((json.dumps(msg) + "\n").encode())
        await self.proc.stdin.drain()

    async def request(self, method: str, params: dict) -> dict:
        """Send a numbered note, then read lines until its numbered reply."""
        self.next_id += 1
        await self.send({"jsonrpc": "2.0", "id": self.next_id,
                         "method": method, "params": params})
        while True:
            msg = json.loads(await self.proc.stdout.readline())
            if msg.get("id") == self.next_id:
                if "error" in msg:
                    raise RuntimeError(msg["error"]["message"])
                return msg["result"]

    async def notifications(self):
        """Yield every unnumbered note the server slides under the door."""
        while True:
            line = await self.proc.stdout.readline()
            if not line:
                return
            msg = json.loads(line)
            if "method" in msg and "id" not in msg:
                yield msg


def narrate(note: dict, usage: dict) -> None:
    method, p = note["method"], note.get("params", {})
    if method == "item/started":
        item = p.get("item", {})
        kind = item.get("type", "?")
        if kind == "commandExecution":
            print(f"  -> runs: {item.get('command', '')[:80]}")
        elif kind == "fileChange":
            print(f"  -> edits files")
        elif kind == "reasoning":
            print(f"  ...thinking")
    elif method == "item/agentMessage/delta":
        print(p.get("delta", ""), end="", flush=True)
    elif method == "thread/tokenUsage/updated":
        usage.update(p.get("tokenUsage", {}).get("total", {}) or p.get("tokenUsage", {}))


async def main(prompt: str) -> None:
    SITE.mkdir(exist_ok=True)
    engine = AppServer()
    await engine.start()

    await engine.request("initialize", {
        "clientInfo": {"name": "pagewright", "title": "Pagewright", "version": "0.1"},
        "capabilities": {},
    })
    await engine.send({"jsonrpc": "2.0", "method": "initialized", "params": {}})

    thread = await engine.request("thread/start", {
        "cwd": str(SITE.resolve()),
        "sandbox": "workspace-write",
        "approvalPolicy": "never",
        "model": MODEL,
    })
    print(f"[thread {thread['thread']['id']}]\n")

    await engine.request("turn/start", {
        "threadId": thread["thread"]["id"],
        "input": [{"type": "text", "text": prompt}],
    })

    usage: dict = {}
    async for note in engine.notifications():
        narrate(note, usage)
        if note["method"] == "turn/completed":
            turn = note["params"]["turn"]
            print(f"\n\n[{turn['status']} in {turn['durationMs'] / 1000:.1f}s"
                  f" · {usage.get('inputTokens', '?')} in / "
                  f"{usage.get('outputTokens', '?')} out]")
            break

    engine.proc.terminate()
    await engine.proc.wait()


if __name__ == "__main__":
    asyncio.run(main(" ".join(sys.argv[1:]) or DEFAULT_PROMPT))
