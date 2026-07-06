# Part 4: Workspaces, the live preview, and the diff drawer

The end state of [Part 4 of the series](https://yadnesh.dev/blog/codex-4-live-preview):
Pagewright's hero feature set. Every project gets its own workspace, the
thread's `cwd` points at it, and the site the agent builds renders in a live
iframe preview that refreshes as every patch lands — next to a file tree with
add/update/delete badges and a diff drawer showing the turn's aggregate
unified diff.

📖 Read along: [Part 4: Workspaces, the live preview, and the diff drawer](https://yadnesh.dev/blog/codex-4-live-preview)
🎬 See it run: **[demo.mp4](demo.mp4)** — a client brief becomes a website while you watch.

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

Open http://localhost:3000, pick a brief (try `beanline`), click **New
project**, and send:

> Read brief/brief.md and build the site it describes

The preview on the right refreshes as files land; the file tree fills in
underneath; the **Diff** button opens the turn's unified diff.

## What changed since Part 3

- `backend/app/projects.py` (new) — per-project workspaces: one folder per
  project under `backend/projects/{id}/site/`, a flat `projects.json`
  registry (id, name, created_at — thread ids arrive in Part 5), and brief
  seeding: creating a project can copy one of the repo's `briefs/` folders
  into the workspace under `brief/`.
- `backend/app/events.py` — one new translation and one new helper, nothing
  existing touched: `turn/diff/updated` → `diff_updated` (the turn's
  aggregate git-style unified diff), and `file_change_event()`, which turns a
  fileChange item into a dedicated `file_change` event with
  **workspace-relative** paths (the protocol sends absolute ones).
- `backend/app/main.py` — `POST /projects`, `GET /projects`,
  `GET /projects/{id}/files` (the workspace listing; seeded brief files are
  included but flagged), and `POST /projects/{id}/chat` replacing Part 3's
  `/chat` — same stream, but the thread's `cwd` is that project's site
  folder and `session_start` now carries `project_id`. Each workspace is
  served at `/preview/{project_id}/` via a `StaticFiles` mount (`html=True`,
  so `/` serves `index.html`). After each completed fileChange item the
  stream also emits `preview_refresh`.
- `frontend/app/page.tsx` — the two-pane layout: the Part 3 chat on the
  left, the workspace on the right (preview on top, file tree below, diff
  drawer sliding over both), plus the project switcher in the header.
- `frontend/components/ProjectBar.tsx` — project select + brief dropdown +
  New project.
- `frontend/components/PreviewPane.tsx` — the sandboxed iframe
  (`sandbox="allow-scripts"`, **no** `allow-same-origin`: the generated HTML
  is untrusted and runs in a null origin), cache-busted with `?v=N` on every
  `preview_refresh`.
- `frontend/components/FilesPane.tsx` — the workspace tree from
  `GET /files`, refreshed on `file_change`, with added/updated/deleted
  badges per event kind; seeded brief files render dimmed.
- `frontend/components/DiffDrawer.tsx` — the hand-rolled unified-diff
  renderer (~60 lines, no dependency): file headers, hunk markers, +/- line
  tinting.
- `frontend/lib/api.ts` — `API_BASE` in one place now that three components
  need it.
- `frontend/lib/types.ts` — three new wire events (`file_change`,
  `diff_updated`, `preview_refresh`) and the `Project` / `WorkspaceFile`
  REST shapes.

## The wire, extended

Part 2's envelope grows three event types and changes none:

| `type` | From | Payload |
|---|---|---|
| `file_change` | `item/started` + `item/completed` of fileChange items | `item_id`, `files: [{path (workspace-relative), kind}]`, `status: started\|done` |
| `diff_updated` | `turn/diff/updated` | `unified_diff` (git-style, cumulative for the turn) |
| `preview_refresh` | emitted after each completed fileChange | `project_id` |

`session_start` additionally carries `project_id`. `item_start`/`item_done`
still flow for fileChange items too, so Part 3's badges keep working.

## Break it on purpose

Ask for a Google Fonts `<link>`. The default `workspace-write` sandbox has
**no network**, so the agent can't verify or fetch anything external — watch
the reasoning drawer as it notices the constraint and falls back to system
fonts. Part 6 gives you the switch.
