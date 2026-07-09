"""Part 9: the event log — the series' first (and only) database.

Until now every event lived exactly as long as the HTTP response that
carried it: whoever POSTed /chat held the only pipe, and a refresh cut
it. The app-server process is no help here — it holds *threads* (the
conversation, durable in the rollout), not your product's delivery
guarantees. What was already streamed, what a reconnecting tab missed,
which turn was mid-flight when the process died: those are OUR facts,
so they get OUR table.

One SQLite file, stdlib sqlite3, WAL mode. Two tables:

- `events` — every SSE event of every turn, per project, numbered by a
  per-project monotonic `seq`. That seq is the whole durability story:
  it rides the SSE `id:` field, the browser echoes it back as
  `Last-Event-ID`, and "catch me up" becomes a WHERE clause.
- `turns` — one row per turn with its status. Its real job is the
  restart sweep: a row still "running" when the backend boots is a turn
  the old process took to its grave, and the sweep says so in the log.

No aiosqlite, no executor: appends are single-row inserts on a WAL
database — microseconds — and one uvicorn worker is the deal this
series made back in Part 5. The asyncio.Condition per project is the
doorbell: append, then knock; viewers re-read the log when woken. The
log is the source of truth, the wakeup is a courtesy.
"""

import asyncio
import json
import sqlite3
from pathlib import Path

# The log lives with the rest of the runtime state (projects/ is
# already gitignored): one file, no server, survives restarts — which
# is the entire point.
DB_PATH = Path("projects") / "events.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS events (
    project_id TEXT NOT NULL,
    seq        INTEGER NOT NULL,
    payload    TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (project_id, seq)
);
CREATE TABLE IF NOT EXISTS turns (
    turn_id      TEXT PRIMARY KEY,
    project_id   TEXT NOT NULL,
    status       TEXT NOT NULL,
    started_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    completed_at TEXT
);
"""

_conn: sqlite3.Connection | None = None
_conditions: dict[str, asyncio.Condition] = {}


def init() -> None:
    global _conn
    DB_PATH.parent.mkdir(exist_ok=True)
    _conn = sqlite3.connect(DB_PATH)
    _conn.execute("PRAGMA journal_mode=WAL")
    _conn.executescript(SCHEMA)
    _conn.commit()


def close() -> None:
    global _conn
    if _conn is not None:
        _conn.close()
        _conn = None


def condition_for(project_id: str) -> asyncio.Condition:
    """One doorbell per project. In-memory on purpose: conditions carry
    no state worth keeping — a viewer that missed a knock recovers by
    reading the log, same as a viewer that wasn't born yet."""
    return _conditions.setdefault(project_id, asyncio.Condition())


async def publish(project_id: str, event: dict) -> int:
    """Append one event and knock. The insert computes the next seq
    itself (MAX+1 per project), so numbering lives in the table, not in
    anyone's memory — a restarted backend continues the count instead
    of starting a second seq 1."""
    cur = _conn.execute(
        "INSERT INTO events (project_id, seq, payload) "
        "SELECT ?, COALESCE(MAX(seq), 0) + 1, ? FROM events WHERE project_id = ? "
        "RETURNING seq",
        (project_id, json.dumps(event), project_id),
    )
    seq = cur.fetchone()[0]
    _conn.commit()
    cond = condition_for(project_id)
    async with cond:
        cond.notify_all()
    return seq


def replay(project_id: str, after: int = 0) -> list[tuple[int, dict]]:
    """Everything this project's log holds past the bookmark, in order.
    `after=0` is the full story from seq 1 — what a fresh tab gets."""
    rows = _conn.execute(
        "SELECT seq, payload FROM events WHERE project_id = ? AND seq > ? ORDER BY seq",
        (project_id, after),
    ).fetchall()
    return [(seq, json.loads(payload)) for seq, payload in rows]


def tail_seq(project_id: str) -> int:
    row = _conn.execute(
        "SELECT COALESCE(MAX(seq), 0) FROM events WHERE project_id = ?",
        (project_id,),
    ).fetchone()
    return row[0]


def begin_turn(project_id: str, turn_id: str) -> None:
    _conn.execute(
        "INSERT OR REPLACE INTO turns (turn_id, project_id, status) VALUES (?, ?, 'running')",
        (turn_id, project_id),
    )
    _conn.commit()


def finish_turn(turn_id: str, status: str) -> None:
    """Stamp the turn's ending — completed, interrupted, or failed —
    with the wire's own word for it."""
    _conn.execute(
        "UPDATE turns SET status = ?, "
        "completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE turn_id = ?",
        (status, turn_id),
    )
    _conn.commit()


def sweep_orphans() -> list[dict]:
    """The restart reckoning, run once at startup: any turn still
    'running' belonged to the previous process and will never finish.
    Mark it orphaned and hand the rows back so main can write each
    project an honest backend_restarted event. We do NOT resurrect the
    turn — the app-server that ran it is gone; what survives is the
    workspace (files on disk) and the thread (the rollout), which is
    everything of value."""
    rows = _conn.execute(
        "SELECT turn_id, project_id FROM turns WHERE status = 'running'"
    ).fetchall()
    _conn.execute(
        "UPDATE turns SET status = 'orphaned', "
        "completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE status = 'running'"
    )
    _conn.commit()
    return [{"turn_id": turn_id, "project_id": project_id} for turn_id, project_id in rows]
