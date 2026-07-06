"""Part 1, step one: shake hands with the engine.

Spawns `codex app-server`, sends the mandatory initialize request, reads the
response, and confirms the handshake. Nothing else. If this runs, everything
in the series can run.
"""

import asyncio
import json


async def main() -> None:
    proc = await asyncio.create_subprocess_exec(
        "codex", "app-server",
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
    )

    def send(msg: dict) -> None:
        proc.stdin.write((json.dumps(msg) + "\n").encode())

    send({
        "jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": {
            "clientInfo": {"name": "pagewright", "title": "Pagewright", "version": "0.1"},
            "capabilities": {},
        },
    })
    await proc.stdin.drain()

    line = await proc.stdout.readline()
    reply = json.loads(line)
    print("engine says:", json.dumps(reply["result"], indent=2))

    send({"jsonrpc": "2.0", "method": "initialized", "params": {}})
    await proc.stdin.drain()

    proc.terminate()
    await proc.wait()


asyncio.run(main())
