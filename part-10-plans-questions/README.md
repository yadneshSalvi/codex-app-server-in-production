# Part 10: Plans, reasoning depth, and questions — the consultative builder

The end state of [Part 10 of the series](https://yadnesh.dev/blog/codex-10-plans-questions):
Act III opens, and the builder grows opinions it shares **before** acting. A
"Plan first" toggle sends a turn out read-only — `sandboxPolicy
{type: "readOnly"}`, the OS enforcing what a prompt can only request — and the
agent proposes a numbered plan instead of building (`collaborationMode` is gone
from 0.142.4; a blueprint is just a turn that cannot touch the disk). Build
turns tick a **living checklist**: the engine's plan tool (`update_plan`),
enabled per-thread and nudged via `developerInstructions`, emits
`turn/plan/updated` with `{plan: [{step, status}], explanation}` as the agent
works. The agent can now hand you a **structured question** mid-job —
`item/tool/requestUserInput`, the third server request on the Part 2 seam,
bridged by the same Future pattern as approvals — three palettes, radio
buttons, a free-text "or type your own". And the reasoning dials stop being
constants: every message may carry `effort` and `summary` (a "care level"
selector on the composer), so a copy tweak thinks cheap and a redesign thinks
hard, with Part 8's meter showing exactly what the choice cost.

📖 Read along: [Part 10: Plans, reasoning depth, and questions](https://yadnesh.dev/blog/codex-10-plans-questions)

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

Open http://localhost:3000, create a project from the beanline brief, then:

- **Blueprint first.** Arm the "Plan first" toggle and send *"Read
  brief/brief.md and tell me how you would build this site."* The turn runs
  read-only (chip on the message says so), the plan arrives as numbered prose,
  and the file tree does not move. Send *"Build it."* — a normal turn at the
  project's own mode — and the site lands.
- **Watch the checklist tick.** During the build turn, "The builder's plan"
  panel appears above the composer: the agent's own steps, pending →
  in-progress → done, re-sent whole on every update. It replays into a second
  tab like everything else (Part 9's log).
- **Get asked.** Send *"Before building anything, ask me which of three color
  palettes I prefer for a small cafe site. Then build index.html using my
  answer."* A question card freezes the turn: options with descriptions, a
  free-text line, an Answer button. Answer in any tab; the agent builds with
  your choice.
- **Turn the dials.** Set the care level to Max and rebuild the same brief;
  compare the receipts. From a live A/B on the beanline brief (gpt-5.4-mini):
  effort `low` finished in 39s / 154k tokens (458 of them reasoning); `xhigh`
  took 132s / 231k tokens (11.4k reasoning) — 25× the thinking for the same
  one-page brief. The dial is real, and so is the bill.

## The protocol truths this part rests on (verified live, 0.142.4)

- `item/tool/requestUserInput` does **not** fire on a default thread. The
  thread must opt in: `thread/start` with
  `config: {"features.default_mode_request_user_input": true}`. The engine
  answers with a `warning` notification — the feature is under development,
  and the wire says so. Params: `{threadId, turnId, itemId, questions: [{id,
  header, question, isOther, isSecret, options: [{label, description}]}],
  autoResolutionMs}`. The JSON-RPC response maps ids to answer lists:
  `{answers: {palette_choice: {answers: ["Fresh Sage"]}}}`.
- The plan tool is also opt-in **and** opt-in isn't enough:
  `config: {"include_plan_tool": true}` alone changes nothing. Add a standing
  ask in `developerInstructions` and build turns emit `turn/plan/updated`.
  On read-only blueprint turns it usually stays silent (the tool tracks
  progress, not proposals — though one live run tracked the planning legwork
  itself). `item/plan/delta` exists in the schema; it never fired in any
  trace.
- `turn/start` accepts `effort` (whatever `model/list` advertises —
  low/medium/high/xhigh for gpt-5.4-mini) and `summary`
  (auto/concise/detailed) per turn. No thread surgery, no new thread.

## What changed since Part 9

- `backend/app/questions.py` (new) — the foreman's inbox, second drawer:
  `PendingQuestion` + `ask()` + `resolve()`, the exact `approvals.py` rhythm
  (register → announce on the stream → await the Future → answer down stdio).
  A timeout answers with an empty sheet — there is no "decline" for a
  question; the agent proceeds on its own judgment.
- `backend/app/main.py`:
  - `thread/start` gains the two feature switches (`include_plan_tool`,
    `features.default_mode_request_user_input`) and the
    `developerInstructions` plan nudge.
  - `ChatRequest` grows `plan_first`, `effort`, `summary`. A `plan_first`
    turn ships `sandboxPolicy {type: "readOnly"}` + `approvalPolicy "never"`
    + a nudge appended to the message; `effort`/`summary` ride `turn/start`
    per-turn (defaults: medium/detailed).
  - `item/tool/requestUserInput` handler registered on the Part 2 seam;
    `POST /projects/{id}/questions/{question_id}/answer` resolves the Future.
  - `session_start` carries `plan_first`/`effort`/`summary` — every tab
    labels the turn the same way.
- `backend/app/events.py` — three new event types: `plan_update`
  (`{steps, explanation}`), `plan_delta` (schema-only; carried just in
  case), and `question_request`/`question_resolved` (synthetic, from
  app.questions, same trick as approvals).
- `frontend/components/QuestionCard.tsx` (new) — the consultation card in
  the ApprovalCard's visual language: per-question radio options with
  descriptions, free text when `isOther`, masked when `isSecret`; flips to
  the outcome on `question_resolved` in every tab.
- `frontend/components/PlanChecklist.tsx` (new) — "The builder's plan",
  pinned above the composer while the newest turn has one: ticks pending →
  in-progress → done, with the agent's own `explanation` under it.
- `frontend/components/CareLevelPicker.tsx` (new) — Quick / Standard /
  Thorough / Max, folding the two protocol dials into one product question
  (Quick = low effort + concise summaries; Max = xhigh + detailed).
- `frontend/app/page.tsx` — the "Plan first" toggle (one-shot: arms a single
  blueprint turn, then disarms), blueprint chip on the message, effort on the
  receipt (`blueprint (read-only) · effort xhigh · 62,085 tokens this turn`),
  question cards wired through `applyEvent`, and a waiting chip while a
  question hangs.
