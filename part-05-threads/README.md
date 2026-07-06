# Part 5: Threads that persist — projects, resume, and fork

The end state of [Part 5 of the series](https://yadnesh.dev/blog/codex-5-threads):
Pagewright's projects grow memory. Every project keeps ONE thread for its
whole life — the first message starts it, every later message resumes it,
and the conversation survives backend restarts because the engine's rollout
archive (`CODEX_HOME/sessions`) is the persistence layer; projects.json
stores nothing but the bookmark. A projects sidebar lists every job folder
with its auto-title, reopening a project replays its conversation, and
**Fork** photocopies a project — `thread/fork` for the conversation,
`cp -r` for the workspace — into two drafts that diverge side by side.

📖 Read along: [Part 5: Threads that persist](https://yadnesh.dev/blog/codex-5-threads)
🎬 See it run: **[demo.mp4](demo.mp4)** — one site forked into two drafts, both remembering the same conversation.

## Run it

Backend (terminal 1):

```bash
cd backend
uv run uvicorn app.main:app --port 8000
```

Frontend (terminal 2):

```bash
cd frontend
npm install
cp .env.local.example .env.local
npm run dev
```

Open http://localhost:3000, create a project from a brief, chat once, then:

- **restart the backend** and send a follow-up — the agent still remembers
  the conversation (`thread/resume` reopens the job folder at the bookmark);
- click **Fork** on the project — a second sidebar entry appears with the
  same site and the same memory, and the two drafts diverge from there.

## What changed since Part 4

- `backend/app/projects.py` — each registry line grows `thread_id` (the
  bookmark into the rollout archive), `thread_name` (the auto-title),
  `updated_at`, and — on forks — `forked_from_id`. New helpers:
  `get_project` / `update_project` / `touch`, plus `fork_workspace`
  (the `cp -r` half of forking) and `register_fork`.
- `backend/app/main.py` — the heart of the part:
  - `ensure_thread()` — messages to a project with a `thread_id` call
    `thread/resume` first; only a project without one gets `thread/start`
    (Part 4's fresh-thread-per-message behavior is gone). If resume fails
    (rollout deleted — the error is a typed JSON-RPC `-32600`
    `"no rollout found for thread id …"`), fall back to a fresh thread,
    persist the new id, and emit `thread_reset`: the history is gone, the
    site files are not. The workspace is truth.
  - `finish_turn()` — after a project's FIRST completed turn, the thread is
    auto-titled from the first message via `thread/name/set {threadId, name}`.
  - `GET /projects/{id}/history` — the conversation replayed from the
    rollout via `thread/read {threadId, includeTurns: true}` (no engine
    load, no turn), mapped to plain `[{role, text}]`.
  - `POST /projects/{id}/fork` — `thread/fork {threadId, cwd}` + workspace
    copy; the response carries both new ids. Forking copies the
    conversation, **not** the files — the workspace is ours to copy.
  - `GET /threads` — a debug proxy for `thread/list`, protocol-native
    listing. The sidebar reads projects.json instead: one flat file, no
    protocol call per render.
- `backend/app/codex_client.py` — `CodexError` now carries the JSON-RPC
  error `code`; the resume fallback keys on a typed error, not string
  matching.
- `backend/app/events.py` — one new event in the vocabulary
  (`thread_reset`) and `history_from_turns()`, the thread/read → history
  mapper (each userMessage + each turn's final agentMessage; everything
  else already left its mark on the workspace).
- `frontend/components/ProjectsSidebar.tsx` (new, replacing
  `ProjectBar.tsx`) — the left rail: every project with its name,
  auto-title, and relative time; active highlight; a per-row **Fork**
  button; the brief picker + New project at the bottom.
- `frontend/app/page.tsx` — opening a project hydrates its conversation
  from `GET /history`; `thread_reset` renders a quiet inline notice
  ("History could not be restored. Files are intact."); a completed turn
  re-pulls the registry so the sidebar learns the auto-title; Fork adds
  the new project and switches to it.
- `frontend/lib/types.ts` — `thread_reset` on the wire; `Project` grows
  the thread fields; `HistoryMessage`; a `notice` chat-message role.

## The wire, extended

Part 2's envelope grows one event type and changes none:

| `type` | From | Payload |
|---|---|---|
| `thread_reset` | a failed `thread/resume` at the top of a turn | `message` |

## Break it on purpose

Stop the backend, delete the project's rollout file under
`CODEX_HOME/sessions/YYYY/MM/DD/rollout-*-<thread_id>.jsonl`, restart, and
send a message. `thread/resume` fails with the typed error above, the
backend falls back to `thread/start`, and the UI shows the notice — while
the preview keeps serving the site, untouched. Chat history and site files
have different owners: the engine owns one, your workspace the other.
