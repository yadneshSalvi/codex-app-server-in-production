# Part 6: The sandbox — what the builder may touch

The end state of [Part 6 of the series](https://yadnesh.dev/blog/codex-6-sandbox):
every project carries a **trust mode** — Read-only (look and plan, the OS
refuses every write), Standard (write inside the workspace, no network), or
Trusted (same bench, plus the network door). The mode is one line in
`projects.json` and one structured `sandboxPolicy` on `turn/start` — applied
per turn, so switching needs no new thread. The walls are OS-enforced
(Seatbelt on macOS, Landlock + seccomp on Linux): a blocked write is the
kernel saying no, not the model agreeing to behave. `approvalPolicy` stays
`"never"` in every mode — Part 7 wires the asking.

📖 Read along: [Part 6: The sandbox](https://yadnesh.dev/blog/codex-6-sandbox)
🎬 See it run: **[demo.mp4](demo.mp4)** — the same font-download request bouncing off Standard mode and succeeding in Trusted.

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

Open http://localhost:3000, create a project, build a small site, then work
the mode picker in the header:

- **Standard** (the default): ask it to save a note at
  `~/pagewright-escape-test.txt` — Seatbelt/Landlock refuses the write
  (`zsh: operation not permitted`), the agent reports the exact error, and
  the file never appears;
- **Read-only**: ask for a site change — the agent reads the files, proposes
  the exact edit, and applies nothing;
- **Trusted**: "download the Playfair Display woff2 files with curl into
  fonts/ and wire @font-face" — the same request that dies with
  `curl: (6) Could not resolve host` under Standard now succeeds.

## The grid

Two dials. This part wires the sandbox dial; the approval dial stays
`"never"` until Part 7.

| Mode | `sandboxPolicy` on turn/start | Writes | Network | Reads |
|---|---|---|---|---|
| Read-only | `{type: "readOnly"}` | blocked | blocked | allowed |
| Standard | `{type: "workspaceWrite", writableRoots: [workspace], networkAccess: false}` | workspace only | blocked | allowed |
| Trusted | `{type: "workspaceWrite", writableRoots: [workspace], networkAccess: true}` | workspace only | allowed | allowed |

Reads are never sandboxed by `workspaceWrite` — watch the Standard-mode
font turn sweep `/Library/Fonts`, the caches, and the npm cache looking for
a local copy before reporting the blocker. That asymmetry (and what to do
about it) is the part's honest footnote. The protocol's fourth policy,
`dangerFullAccess`, exists and Pagewright never sends it — see the comment
in `backend/app/main.py`.

## What changed since Part 5

- `backend/app/projects.py` — each registry line grows `mode`
  (`"read-only" | "standard" | "trusted"`, default `"standard"`; older
  registries are defaulted on read). Forks inherit the original's mode.
- `backend/app/main.py`:
  - `sandbox_policy(mode, workspace)` — the whole mode → policy grid in one
    function; `turn/start` now carries the structured `sandboxPolicy` plus
    an explicit `approvalPolicy: "never"`. (`thread/start` keeps its
    `workspace-write` mode-string baseline — per the protocol, the string
    form belongs to thread/start, the structured form to turn/start.)
  - `PATCH /projects/{id}/mode` — persists the mode; it takes effect on the
    next turn, no thread surgery.
  - `session_start` on the SSE stream now carries `mode`.
- `backend/app/events.py` — **no new event types**, deliberately. There is
  no "sandbox blocked this" signal in the protocol (verified against the
  0.142.4 schema and live traces): a blocked `curl` is an ordinary failed
  command (`exitCode: 6`, the error text in `aggregatedOutput`), a blocked
  write usually never even executes (the model knows its writable roots and
  declines up front), and a refused read-only patch emits no item at all.
  The honest telemetry is the exit code we already forward plus the agent's
  own narration; the docstring records the investigation.
- `frontend/components/ModePicker.tsx` (new) — the three-segment picker
  with one-line descriptions, and the `ModeChip` for the chat header.
- `frontend/app/page.tsx` — the picker lives in the app header (optimistic
  PATCH with rollback); the chat column gains a slim header with the
  project name and mode chip; Read-only shows a quiet "planning mode" hint
  above the composer.
- `frontend/lib/types.ts` — the `Mode` union; `Project.mode`;
  `session_start` carries `mode`.

## Break it on purpose

Standard mode, then: *"Save a note at `~/pagewright-escape-test.txt`. If
the write fails, run it anyway and show me the exact error output."* The
command really runs; the kernel refuses the write outside `writableRoots`:

```
zsh:1: operation not permitted: /Users/you/pagewright-escape-test.txt
```

That message is Seatbelt (macOS) or Landlock (Linux) speaking — the agent
just quotes it. Two things worth noticing while you watch: the sandbox
still allows reads everywhere (that is the `workspaceWrite` deal — writes
and network are walled, reads are not), and `/tmp` stays writable unless
you set the policy's `excludeSlashTmp` flag — the Trusted-mode font turn
stages its npm tarball there.
