# Part 8: Stop, steer, and the meter — live control

The end state of [Part 8 of the series](https://yadnesh.dev/blog/codex-8-stop-steer-usage):
live control over a running turn. Three controls, all keyed by one fact the
backend now remembers — WHICH turn is live on each project (`app/turns.py`,
written when `turn/start` answers with `turn.id`). **Stop**:
`POST /projects/{id}/interrupt` sends `turn/interrupt {threadId, turnId}` and
the stream answers with the same `turn/completed` every turn ends with, status
`"interrupted"` — the receipt says "stopped by you". **Steer**: the composer
stays live during a run; a message sent mid-turn routes to `turn/steer
{threadId, expectedTurnId, input}` and the running build absorbs it without
restarting — shouting through the workshop hatch without downing tools. And
**the meter**: every `thread/tokenUsage/updated` becomes a `usage_update`
event feeding a header gauge (this turn · this thread), and the receipt under
each turn now shows what *that turn* cost instead of the thread's lifetime
bill.

📖 Read along: [Part 8: Stop, steer, and the meter](https://yadnesh.dev/blog/codex-8-stop-steer-usage)

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

Open http://localhost:3000, create a project, ask for a site, and while the
build streams:

- **Stop it**: the Stop button now sits beside a Send button that never went
  away. Click it and watch the receipt — "stopped by you", with the tokens
  this turn burned before it stopped. The workspace keeps whatever landed.
- **Steer it**: start another build, then type a correction mid-turn ("also
  add a footer that says STEERED BY HUMAN") and hit Send. The message gets a
  small "steering — absorbed mid-turn" chip, the build keeps going, and the
  footer shows up in the same turn's output.
- **Watch the gauge**: the header meter counts up live — the big number is
  this turn, the quieter one is the thread's lifetime total. Click it for the
  breakdown (this turn / last request / this thread, in/cached/out columns).

## The wire truths this part is built on (verified, codex-cli 0.142.4)

- `turn/interrupt` requires **both** `threadId` and `turnId`; `turn/steer`
  requires `expectedTurnId` — a *precondition*, not a hint. Both ids come from
  the `turn/start` response, which is why the backend keeps the active-turn
  ledger at all.
- Interrupt is cooperative **at the agent level**: the turn ends at once
  (`turn/completed`, status `"interrupted"`), the in-flight item is abandoned
  mid-lifecycle (no `item/completed` ever fires for it) — but the OS process
  it started is NOT killed. In our trace a sleepy shell loop kept writing for
  9 more seconds after the interrupt and every write landed. Stop halts the
  agent, not the machine.
- Steering after the turn finished fails with JSON-RPC `-32600`
  `"no active turn to steer"`. That failure *is* the router: the chat endpoint
  catches it, clears the stale ledger line, and falls back to a normal
  `turn/start` — the user's message never bounces.
- A steered message is acknowledged in the steer response and later resurfaces
  as a plain `userMessage` item at the model's next inference boundary —
  indistinguishable from any other user message on the wire. The `steered` SSE
  event is ours (synthetic, injected onto the thread queue), because something
  has to say "this one landed mid-turn".
- `thread/tokenUsage/updated` carries `tokenUsage.total` (THREAD-cumulative —
  Part 6 watched it hit 1.09M) and `tokenUsage.last` (the most recent MODEL
  REQUEST — a build turn makes many; `total` grows by exactly `last` each
  update). **Neither field means "this turn"**; the honest per-turn number is
  a delta of totals, which `run_turn` computes and attaches as `turn` on
  `usage_update` and as `usage` on the `complete` receipt.
- `account/rateLimits/read` (proxied at `GET /usage/limits`) answers only
  under ChatGPT-plan auth; under API-key auth it errors with
  `"chatgpt authentication required to read rate limits"` (our proxy turns
  that into a 502). The success shape, from the generated schema:
  `{rateLimits: {limitId, limitName, planType, primary: {usedPercent,
  resetsAt, windowDurationMins}, secondary, credits}, rateLimitsByLimitId,
  rateLimitResetCredits}`.

## What changed since Part 7

- `backend/app/turns.py` (new) — the active-turn ledger: `begin()` when
  `turn/start` answers, `end()` on any exit (named, so a stream outliving its
  turn can't erase a newer turn's entry), plus the latest usage reading for
  `GET /projects/{id}/usage`. In-memory on purpose; durability is Part 9's
  job.
- `backend/app/main.py`:
  - `chat` is now a router: active turn → `turn/steer` (JSON answer; events
    keep riding the original stream) with the `-32600` fallback to
    `turn/start`; idle → `turn/start` streams, as it has since Part 2.
  - `POST /projects/{id}/interrupt` — the Stop button's other half.
  - `run_turn` filters the queue by `turnId` (a stalled viewer's backlog must
    not replay into the next turn's stream), computes the per-turn usage
    delta, and stamps the receipt with `usage` (this turn) + `thread_total`.
  - `GET /projects/{id}/turn` (debug), `GET /projects/{id}/usage`,
    `GET /usage/limits`.
- `backend/app/events.py` — two new event types: `usage_update` (the wire's
  `last` + `total` under their true names) and `steered` (synthetic, ours).
- `frontend/app/page.tsx` — Send never yields to Stop anymore (both render
  during a run); sending mid-turn calls `steer()`; the steer race fallback
  reads the fallback turn's stream like any other; the receipt line says
  "stopped by you" / "N tokens this turn".
- `frontend/components/TokenGauge.tsx` (new) — the header meter and its
  breakdown panel.
- `frontend/lib/types.ts` — `TokenUsage`, `UsageReading`, the two new events,
  `steered` on user messages.

## Break it on purpose

Steer *after* the turn finished: the ledger can be honestly stale for a moment
(a stalled viewer never delivered `turn/completed`), so `turn/steer` fires,
fails with `-32600 "no active turn to steer"`, and the endpoint falls back to
a fresh `turn/start` — the response is an SSE stream instead of `{steered:
true}`, the steering chip comes off, and the message lands as a normal turn.
The failure mode a user would notice most — a message silently eaten by a
race — is the one the protocol's own precondition makes impossible.
