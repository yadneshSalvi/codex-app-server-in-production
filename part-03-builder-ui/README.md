# Part 3: The builder UI

The end state of [Part 3 of the series](https://yadnesh.dev/blog/codex-3-builder-ui):
the Part 2 event stream gets its real client. A Next.js chat UI where the
answer types itself out, every command the agent runs appears as a live badge
with its output scrolling inside it, and the model's reasoning summaries
stream into a muted drawer you can open when you're curious.

📖 Read along: [Part 3: The builder UI](https://yadnesh.dev/blog/codex-3-builder-ui)
🎬 See it run: **[demo.mp4](demo.mp4)**, a real build watched from the browser.

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

Open http://localhost:3000 and click one of the sample prompts. The agent
works in `backend/site/` — open the files it creates and watch them change
between turns.

## What changed since Part 2

- `backend/app/events.py`: two new event types, added without touching the
  six that exist — `reasoning_delta` (from `item/reasoning/summaryTextDelta`)
  and `command_output_delta` (from `item/commandExecution/outputDelta`) —
  plus an `exit_code` on command detail for success/error styling. curl from
  Part 2 still works unchanged.
- `backend/app/main.py`: `turn/start` now asks for `summary: "detailed"` so
  reasoning summaries stream at all (Part 10 makes that a user-facing dial),
  and CORS accepts any localhost port.
- `frontend/lib/types.ts` — the wire events and the block model: an assistant
  turn is a sequence of text and item blocks, items keyed by `item_id`
- `frontend/lib/readSse.ts` — fetch-reader SSE parsing as an async generator
- `frontend/lib/commandLabel.ts` — unwraps `/bin/zsh -lc '...'` and turns
  common commands into friendly labels
- `frontend/components/CommandBadge.tsx` — the terminal-in-a-badge: friendly
  label, spinner while running, live capped output pane, exit-status styling
- `frontend/components/ReasoningDrawer.tsx` — collapsed, muted "Thinking"
  drawer fed by `reasoning_delta`
- `frontend/components/ItemBadge.tsx` — `fileChange` and any future item
  kinds render without edits (their real treatment is Part 4)
- `frontend/components/Markdown.tsx` — `react-markdown` + `remark-gfm`,
  styled for the app
- `frontend/app/page.tsx` — the chat page: block rendering, working timer,
  Stop via `AbortController`, auto-scroll, empty state with sample prompts
