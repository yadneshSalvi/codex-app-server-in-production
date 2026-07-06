# Part 2: The FastAPI bridge and the event vocabulary

The end state of [Part 2 of the series](https://yadnesh.dev/blog/codex-2-fastapi-bridge):
the throwaway script from Part 1 becomes a reusable async client
(`app/codex_client.py`), and the agent goes behind a URL. `POST /chat` starts a
thread, runs one turn, and streams a neutral SSE event vocabulary that the rest
of the series only ever extends.

📖 Read along: [Part 2: The FastAPI bridge and the event vocabulary](https://yadnesh.dev/blog/codex-2-fastapi-bridge)
🎬 See it run: **[demo.mp4](demo.mp4)**, a real streamed run watched with `curl -N`.

## Run it

```bash
cd backend
uv run uvicorn app.main:app --port 8000
```

Then, in another terminal:

```bash
curl -N localhost:8000/chat \
  -H 'content-type: application/json' \
  -d '{"message":"Create hello.html: one heading that says Hello from Pagewright, inline CSS."}'
```

Watch `session_start`, `item_start`/`item_done` (reasoning, commands, file
changes), `text_delta` tokens, and the final `complete` event with real token
usage scroll past. The agent works in `backend/site/`.

## What changed since Part 1

- `app/codex_client.py`: the one-process-many-threads client. Request/response
  correlation by id, per-thread notification queues, a server-request handler
  seam (empty until Part 7), a stderr ring buffer for honest crash reports.
- `app/events.py`: the SSE envelope and the notification translator. Six event
  types: `session_start`, `text_delta`, `item_start`, `item_done`, `complete`,
  `error`.
- `app/main.py`: FastAPI, CORS for localhost:3000, `POST /chat` streaming.
