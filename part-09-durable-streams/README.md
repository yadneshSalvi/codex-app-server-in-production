# Part 9: Durable streams — the build survives the refresh

The end state of [Part 9 of the series](https://yadnesh.dev/blog/codex-9-durable-streams):
the architecture change of Act II, and it is one split — **running the turn and
watching the turn stop sharing a lifetime**. Since Part 2 the consumer loop
lived inside the `POST /chat` response: whoever sent the message held the only
pipe, and a refresh cut it (the agent never noticed; only the audience left the
room). Now `POST /chat` starts the turn, hands the notification queue to a
**background consumer task** that appends every translated event to a SQLite
event log, and returns a claim ticket — `{turn_id, stream_url}`. Watching
happens somewhere else entirely: `GET /projects/{id}/stream` replays the log
past the viewer's `Last-Event-ID` bookmark, then follows live appends. The
frontend swaps its fetch-reader for **`EventSource`** (native auto-reconnect,
the bookmark sent back for free) and builds the whole conversation from the
log — so a refreshed tab, a second tab, and the tab that typed all render the
same thing, and Stop and approval decisions work from any of them.

📖 Read along: [Part 9: Durable streams](https://yadnesh.dev/blog/codex-9-durable-streams)

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

Open http://localhost:3000, create a project, start a build — then torture it:

- **Refresh mid-build.** The conversation comes back mid-sentence (replay),
  the working timer shows the turn's true elapsed time (`started_at_ms` rides
  the wire), and the stream keeps following to the receipt.
- **Open the same project in a second tab.** Both tabs render the same log.
  Send from one, watch it appear in the other; press **Stop in the tab that
  didn't send**; answer an approval card in either tab and watch it resolve in
  both. (The Part 7 Futures and the Part 8 interrupt were already
  project-scoped POSTs — this part is where that design pays out.)
- **Watch the wire.** `curl -N localhost:8000/projects/<id>/stream` replays
  everything from seq 1; add `-H "Last-Event-ID: 120"` and you get only what
  a tab that saw 120 events missed. Every frame carries `id: <seq>`.

## The two tables

The series' first (and only) database — one SQLite file, stdlib `sqlite3`,
WAL mode, living in `backend/projects/events.db`:

| Table | Columns | Job |
|---|---|---|
| `events` | `project_id, seq, payload, created_at` — PK `(project_id, seq)` | every SSE event of every turn; `seq` is per-project and monotonic (computed as `MAX(seq)+1` **in the insert**, so a restarted backend continues the count) |
| `turns` | `turn_id, project_id, status, started_at, completed_at` | `running` → `completed` / `interrupted` / `failed` — or `orphaned`, stamped by the startup sweep |

The seq rides the SSE `id:` field, the browser echoes it back as
`Last-Event-ID` on reconnect, and "catch me up" becomes a WHERE clause. The
app-server process is *not* the durability layer — it holds threads (the
conversation, durable in the rollout), not your product's delivery
guarantees. What was already streamed, what a reconnecting tab missed, which
turn died mid-flight: those are our facts, so they get our tables.

## Break it on purpose

`kill -9` the backend mid-build, then restart it with the tab still open. No
reload, no clicks:

1. The header shows **reconnecting…** while `EventSource` retries on its own.
2. At startup the backend sweeps the `turns` table: anything still `running`
   belonged to the dead process → marked `orphaned`, and a synthetic
   **`backend_restarted`** event is appended to that project's log.
3. The tab reconnects with its bookmark, replay hands it the tombstone, and
   the UI turns honest: the hung turn's receipt says *"backend restarted
   mid-build"* and a notice explains what survived.
4. Everything of value did survive: the workspace (files on disk, byte-for-byte
   identical) and the thread (the rollout). The next message picks the
   conversation up via `thread/resume`. We deliberately do **not** resurrect
   the in-flight turn — the app-server that ran it is gone, and pretending
   otherwise would be a lie in the UI.

## What changed since Part 8

- `backend/app/eventlog.py` (new) — the event log: `publish()` (append +
  wake), `replay(project_id, after)`, per-project `asyncio.Condition` as the
  doorbell (the log is the source of truth; the wakeup is a courtesy),
  `begin_turn` / `finish_turn`, and `sweep_orphans()` for the restart
  reckoning.
- `backend/app/main.py`:
  - `consume_turn` (new) — Part 2's read loop with a different destination:
    one background task per turn, drain → translate → **append to the log**.
    The per-turn usage delta, the fileChange join, the `turnId` filter: all
    unchanged, but nobody holds a pipe to it. Held in a module-level
    `CONSUMERS` dict because asyncio keeps only weak references to tasks.
  - `chat` returns `{turn_id, stream_url}` immediately — the inline-streaming
    path is **gone**, not deprecated. One architecture. The steer router is
    unchanged; the `steered` event now lands in the log, where every tab
    (including the sender) reads it.
  - `GET /projects/{id}/stream` (new) — the dumb pipe: replay rows past
    `Last-Event-ID` (or `?after=`, for curl), emit an ephemeral `caught_up`
    marker, then follow the doorbell with a 15s keepalive comment.
  - the lifespan runs the orphan sweep before serving a single request.
- `backend/app/events.py` — `sse()` grew the `id:` line (ephemeral frames
  carry none on purpose — an id would move the browser's bookmark past events
  that were never logged); `session_start` now carries `message` +
  `started_at_ms` (every tab is a viewer of the log, INCLUDING the one that
  typed, so the user's words have to be on the wire); `complete` carries
  `turn_id`; new `backend_restarted` type.
- `frontend/app/page.tsx` — the fetch-reader is deleted (`lib/readSse.ts`
  with it). One `EventSource` per open project; events are applied
  idempotently by seq (replay-then-follow delivers at least once; the guard
  makes it exactly-once where it matters); `send()` just POSTs — the
  conversation is *built from the stream*, which is what makes N tabs agree;
  `working`, the timer, Stop, and the approval-waiting chip are all computed
  from the log, so they survive refreshes and appear in every tab; honest
  "backend restarted mid-build" state; a "reconnecting…" chip while
  EventSource retries.
- `frontend/lib/types.ts` — `session_start.message`/`started_at_ms`,
  `complete.turn_id`, `backend_restarted`, `caught_up`, the `orphaned`
  message status.
- `GET /projects/{id}/history` (thread/read) stays as the cold-history
  backstop, but the UI no longer needs it: the log replays richer history —
  badges, receipts, approval cards and all.
