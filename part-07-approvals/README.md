# Part 7: Approvals — the foreman's stamp

The end state of [Part 7 of the series](https://yadnesh.dev/blog/codex-7-approvals):
the protocol's most interesting mechanic, wired end to end. For approvals **the
server sends *us* a JSON-RPC request** — it has an id, it demands a response —
and the item it belongs to freezes until we answer. The Part 2 client grew a
server-request seam for exactly this moment; each question now becomes an
`asyncio.Future` in a registry, an `approval_request` event on the SSE stream,
an approval card inline in the chat, and a `POST /approvals/{id}/decision` that
resolves the Future so the answer can travel back down stdio. Command approvals
show the command and its cwd; **file-change approvals show the patch itself** —
Part 4's diff renderer, reused inside the card, inspecting the dry-cleaning
ticket before it's hung.

📖 Read along: [Part 7: Approvals](https://yadnesh.dev/blog/codex-7-approvals)
🎬 See it run: **[demo.mp4](demo.mp4)** — a Standard-mode turn pausing on a real
approval card, approved from the card, and the build continuing.

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

Open http://localhost:3000, create a project, keep **Standard** mode, then ask
for something the bench won't allow:

- **A command approval**: *"Run exactly this command: `curl -sI
  https://example.com | head -3` . The sandbox blocks network access, so
  request escalated permissions to run it."* The turn pauses on a card with the
  real command, its cwd, and the agent's stated reason. Approve → the command
  runs and the turn reports the status line. Deny → the agent adapts and says
  so.
- **A file-change approval**: ask it to write a file *outside* the workspace
  using a patch (apply_patch). The card shows the patch itself before a byte
  lands.
- **Walk away**: an unanswered approval auto-declines after
  `PAGEWRIGHT_APPROVAL_TIMEOUT` seconds (default 600) and the wire says so
  honestly — `approval_resolved` with reason `"timeout"`. A countdown appears
  on the card once fewer than two minutes remain.

## The grid completes

Two dials, now both wired. Part 6 set the sandbox column; this part turns the
approval column.

| Mode | `sandboxPolicy` | `approvalPolicy` | Why |
|---|---|---|---|
| Read-only | `readOnly` | `never` | never asks because it never acts |
| Standard | `workspaceWrite`, network off | `on-request` | asks before stepping past the bench |
| Trusted | `workspaceWrite`, network on | `never` | never asks because the sandbox contains |

Verified live: the per-turn `approvalPolicy` overrides the thread's `never`
baseline, so the mode picker still needs no thread surgery.

## What actually triggers an approval (verified, codex-cli 0.142.4)

- `item/commandExecution/requestApproval` fires under `on-request` when the
  agent wants past the sandbox: a network command under network-off (`curl …` —
  the request carries a human-readable `reason`), or a write outside
  `writableRoots` (`cp index.html ~/…`). Under `untrusted`, nearly everything
  non-read asks (`git init` reliably).
- `item/fileChange/requestApproval` fires for patches the sandbox would refuse:
  an apply_patch **outside `writableRoots`** under Standard/on-request (the
  product case here), any patch under a `readOnly` sandbox with `on-request`,
  and any patch under `untrusted`. An approved patch really does land outside
  the sandbox walls — approval is escalation, not just consent.
- The fileChange request params carry **no diff and no file list** — only
  `{threadId, turnId, itemId, startedAtMs, reason, grantRoot}`. The patch
  arrived moments earlier on `item/started` for the same `itemId` (always
  before the question, in every trace); `run_turn` keeps a per-turn join table
  and attaches `files` + a rendered unified diff to the SSE event.
- Decisions: the response schema's enums are
  `accept | acceptForSession | decline | cancel` for both kinds (plus two
  execpolicy/network amendment shapes we don't surface). The live requests'
  own `availableDecisions` field is *narrower than the truth* in 0.142.4 —
  command requests list only `accept` / `acceptWithExecpolicyAmendment` /
  `cancel`, and fileChange requests carry no such field — yet the server
  honors `decline` (the item completes with status `"declined"`, exitCode
  null, and the agent adapts) and `acceptForSession` (approve `git init .`
  once, the *identical* command re-runs next turn with no re-ask; a slightly
  different spelling — `git init` — asks again, so the session cache is
  exact-command-scoped, not command-class-scoped). We validate decisions
  against the schema enum and say so in `app/approvals.py`.

## What changed since Part 6

- `backend/app/approvals.py` (new) — the Future bridge: a `PendingApproval`
  registry keyed by our own `approval_id`, `ask()` (register → announce over
  the thread queue → await the Future with a timeout → announce the outcome →
  return the JSON-RPC response), `resolve()` for the endpoint. Timeout is a
  named product decision: auto-`decline` with reason `"timeout"` on the wire.
- `backend/app/main.py`:
  - `approval_policy(mode)` beside `sandbox_policy(mode)` — the grid's second
    column; `turn/start` now sends both.
  - the Part 2 seam finally used: `client.on_server_request(...)` handlers for
    both approval methods, registered in `lifespan`.
  - `POST /projects/{id}/approvals/{approval_id}/decision` — validates the
    decision, resolves the Future, 404s honestly when the question is gone
    (answered twice, timed out, or another project's).
  - `run_turn` keeps the fileChange join table and enriches `file_change`
    approval events with `files` + `diff`.
- `backend/app/events.py` — two new event types (the first since Part 5):
  `approval_request` and `approval_resolved`; `approval_patch()` builds the
  card's diff from the joined item (update diffs pass through; add diffs — raw
  new content on the wire — get dressed as one insert hunk).
- `frontend/components/ApprovalCard.tsx` (new) — the card, rendered inline at
  the exact position the turn paused: mono command + cwd (command kind) or the
  patch via the shared diff renderer (file_change kind); Approve / Approve for
  session / Deny from `available_decisions`; a red countdown once <2 minutes
  remain; after resolution, the outcome replaces the buttons ("Approved by
  you · 1:14:09 AM", "Denied automatically (nobody answered in time)").
  `cancel` (deny + interrupt) is deliberately not a button — Stop already owns
  "abandon the turn".
- `frontend/components/DiffDrawer.tsx` — the line classifier is now exported
  as `DiffLines` and shared between the drawer and the card.
- `frontend/app/page.tsx` — approval blocks in `applyEvent` (appended at
  arrival position, patched in place by `approval_resolved`); a `decide()`
  POST with no optimistic flip (the stream stays the source of truth); the
  composer stays usable while a question hangs, with a chip saying why the
  build is paused.
- `frontend/lib/types.ts` — the two events, `ApprovalBlock`, `ApprovalKind`.

## Break it on purpose

Deny a patch and watch the turn *continue* — `decline` is "no, but keep
working": the agent proposes an alternative (in our trace: "The home-directory
write was denied, so I'm saving the same notes in the workspace instead") and
finishes the turn honestly. Then leave a card unanswered with
`PAGEWRIGHT_APPROVAL_TIMEOUT=20` and watch the wire: `approval_resolved` with
`reason: "timeout"`, decision `decline`, and the agent adapts the same way.
One known wrinkle worth seeing: a denied fileChange item still finishes its
lifecycle (item/completed fires — the generic badge shows its ✓ — but the file
never lands; denied *commands* complete with an explicit status `"declined"`).
The card's red "Denied" line right below the badge is the state that tells
the truth.
