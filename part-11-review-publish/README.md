# Part 11: Trust but verify — review mode, structured outputs, and the Publish gate

The end state of [Part 11 of the series](https://yadnesh.dev/blog/codex-11-review-publish):
Pagewright grows the feature that makes it a product — a **Publish button that
has to be earned**. Three verification tools stand between "the agent stopped
typing" and a live URL:

- **The inspector.** `review/start` — the engine's built-in reviewer, a
  fresh-eyes pass with its own item vocabulary (`enteredReviewMode` /
  `exitedReviewMode`) — runs a pre-publish inspection against a `custom`
  target (free-form instructions, **no git required**): brief conformance
  including brand colors *and the client's own assets*, accessibility, broken
  references. Findings come back as `[P1]/[P2]/[P3]`-tagged prose; the backend
  parses the tags into a report card and keeps the raw text.
- **The manifest.** `outputSchema` on `turn/start` makes the final
  `agentMessage.text` schema-conformant JSON — a form instead of an essay.
  One short read-only turn produces `{title, description, pages, accent}`,
  validated with pydantic on our side and scrubbed of the markdown links the
  model tucks into string values. It drives the `/p/` index cards.
- **Smoke evals.** `scripts/smoke_eval.py`: three briefs × ephemeral-thread
  builds → deterministic checks (index.html exists, internal references
  resolve, manifest validates) + ONE llm-judge question through the same
  outputSchema machinery. A page, not a framework.

Then the gate: `POST /publish` refuses (409, with reasons) unless the latest
inspection found no `[P1]` blockers, the site hasn't changed since, and no
page reaches into `brief/` (the client's paperwork, which publishing strips).
A `force` flag exists — and logs loudly, stamps the registry, and shows on
the `/p/` index. Published sites are copied to `published/{slug}/` and served
at `/p/{slug}/`, with a server-rendered index at `/p/`.

📖 Read along: [Part 11: Trust but verify](https://yadnesh.dev/blog/codex-11-review-publish)

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

Open http://localhost:3000, create a project from the **harbor-and-vine**
brief, and send *"Read brief/brief.md and build the site it describes."* Then:

- **The planted flaw pays off.** Click **Inspect site**. The bar sets
  expectations (a real review takes a minute or two — the reviewer's own
  commands stream by as it works), then the report card lands: the brief
  demands deep forest green `#2F5233` as the house color, but the client's
  own `logo.svg` is navy `#1E3A5F` — a contradiction planted in the brief
  bank back in Part 4, caught by fresh eyes as a `[P1]` blocker. The Publish
  button stays disarmed; `POST /publish` answers 409 with the reasons.
- **Fix findings.** One click hands the reviewer's raw findings back to the
  builder as an ordinary turn. The build stales the gate (any turn does) —
  re-inspect, come back clean, and the Publish button arms.
- **Publish.** The manifest turn runs (watch `publish_state` on the stream),
  the site is copied to `published/harbor-and-vine/`, and the card in the
  chat links to `/p/harbor-and-vine/` — a URL you can open in any browser.
  `/p/` lists every published site, drawn from the manifests.
- **Smoke evals.** `cd backend && uv run python ../scripts/smoke_eval.py` —
  three briefs built on ephemeral threads (no rollout files land anywhere),
  checked, judged, and a table printed. Exits nonzero on any failure.

## The protocol truths this part rests on (verified live, 0.142.4)

- `review/start` params are `{threadId, target, delivery?}` and **nothing
  else** — no model, no effort (extra params are silently ignored, verified
  live). Targets: `uncommittedChanges` / `baseBranch` / `commit` (all need
  git) and `{type: "custom", instructions}` (free-form, no git — what
  Pagewright uses). Delivery `inline` (default; the review runs as a turn on
  your thread) or `detached` (new thread, returned as `reviewThreadId`).
- The reviewer's model IS steerable, one level up: `review_model` is a
  config key, and `thread/start config` overrides it per-thread. Proof: a
  bogus `review_model` makes the review turn fail with `model_not_found`.
  Pagewright pins it to the series model — one model to reason about, one
  bill. Latency on this one-page site measured 20–90s per inspection (the
  spike saw ~4 minutes on a busier workspace; set expectations in the UI).
- Findings are **tagged prose**, not JSON: `exitedReviewMode.review` carries
  a summary plus `- [P1] title — path:line detail` bullets, and the final
  `agentMessage` repeats the same text. Parse the tags, keep the raw string
  — and expect absolute paths no matter what the instructions say (the
  parser relativizes anything past the workspace's `/site/` marker).
- `outputSchema` on `turn/start` works as promised — the final
  `agentMessage.text` is the schema-conformant JSON string — with two sharp
  edges (both captured live): string *values* may contain markdown links
  (scrub them), and an **unsatisfiable schema does not error**. Hand it
  `{"impossible": {"type": "string", "enum": []}}` and the turn completes
  `status: "completed"` with JSON that violates the schema; hand it
  contradictory `minLength`/`maxLength` and the model abandons the shape
  entirely. Client-side validation is not optional — hence the
  retry-or-surface policy (exactly one retry, then a 502 with the reason).
- `thread/start ephemeral: true` really is ephemeral: `thread.path` is null,
  no rollout lands in `CODEX_HOME/sessions`, nothing to clean up — the right
  tool for eval scaffolding (and the reason smoke_eval leaves no trace).

## What changed since Part 10

- `backend/app/review.py` (new) — the inspector's instructions (the severity
  rubric is the product: judge what the site *ships* — a brand contradiction
  the page inherits is `[P1]`; one that remains only inside the client's
  paperwork after the page resolved it drops to `[P2]`), the findings parser
  (regex the tags, keep the raw), and review.json persistence + registry
  summary. The rubric was iterated against the live reviewer, and both
  failure modes are real: v1 let it hedge the planted flaw down to `[P2]`
  ("unless the client wants the blue mark"); v2 made every brief-vs-asset
  conflict `[P1]`, which no fix to the site could ever clear — the fix loop
  couldn't close. v3 is what ships.
- `backend/app/publish.py` (new) — slugs, the manifest schema (wire JSON
  Schema + pydantic twin + markdown-link scrub), the published registry,
  `gate_reasons()` (three registry checks and one grep — the grep exists
  because a live build shipped a broken logo by hotlinking `brief/`, which
  the workspace preview resolves and the published copy does not), the
  fifteen-line copy itself, and the server-rendered `/p/` index.
- `backend/app/main.py` — `POST /projects/{id}/review` (review/start with
  the custom target, streamed through the same consumer as chat);
  `consume_turn` translates the review bookends into `review_state` /
  `review_finding` events; `run_schema_turn()` (one quiet structured-output
  turn); `POST /projects/{id}/publish` (gate → manifest with one retry →
  copy → mount); `GET /p/` + `GET /published`; `thread/start config` gains
  `review_model`; `finish_turn` stamps `built_at_ms` (the gate's staleness
  check — a review turn deliberately does not stamp it).
- `scripts/smoke_eval.py` (new) — the harness described above.
- `frontend/components/ReviewReportCard.tsx` (new) — findings grouped by
  severity with location chips, the raw text behind a fold, and the "Fix
  findings" button that feeds the findings back as a normal turn.
- `frontend/components/PublishBar.tsx` (new) — inspect → gate → publish,
  derived entirely from the event log, so every tab (and a refresh) agrees
  on whether the button is earned.
- `frontend/components/PublishedCard.tsx` (new) — the "it's live" receipt:
  manifest title/description, the accent as a real swatch, the `/p/` link.
- `frontend/app/page.tsx` — the four new event types wired through
  `applyEvent`/`handleEvent`; a non-review `session_start` disarms the gate
  (mirroring the backend's staleness rule); inspection turns fold away the
  reviewer's closing prose (the card already shows it).
