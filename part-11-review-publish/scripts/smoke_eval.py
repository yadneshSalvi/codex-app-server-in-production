#!/usr/bin/env python3
"""Smoke evals: N briefs, built from scratch, checked like CI would.

Deliberately a page, not a framework. For each brief in the bank:

1. Build the site on an EPHEMERAL thread (thread/start ephemeral:true —
   no rollout lands on disk; the thread evaporates with the process) in
   a throwaway temp workspace.
2. Deterministic checks — the kind a shell script could do, so a shell
   script does: index.html exists; every internal href/src resolves to
   a real file; the manifest turn returns JSON that validates against
   the same pydantic model production uses.
3. ONE llm-judge check: a SECOND ephemeral thread — fresh eyes, read
   only — answers "does this page honor the brief?" through a two-field
   outputSchema ({pass, reason}). One judge question, not a rubric:
   the moment this grows cases, runners and regression discipline, it
   stops being a smoke test (that methodology is a series of its own —
   see the Agent SDK series, Part 13).

Run it from the part's backend folder (it borrows the backend's client
and manifest model, and the backend's venv has pydantic):

    cd part-11-review-publish/backend
    uv run python ../scripts/smoke_eval.py            # all 3 briefs
    uv run python ../scripts/smoke_eval.py beanline   # just one

Prints a table, exits nonzero if anything failed — cron-able, CI-able.
"""

import asyncio
import json
import re
import shutil
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.codex_client import CodexClient  # noqa: E402
from app.publish import MANIFEST_SCHEMA, parse_manifest  # noqa: E402

BRIEFS_DIR = Path(__file__).resolve().parents[2] / "briefs"
MODEL = "gpt-5.4-mini"

BUILD_PROMPT = (
    "Read brief/brief.md and build the site it describes. Copy any "
    "assets you use (the logo, images) into the site's own folders and "
    "reference those copies — the brief/ folder is the client's "
    "paperwork and does not ship with the published site.")

MANIFEST_PROMPT = (
    "Read the site in this workspace — index.html and any other pages, "
    "ignoring the brief/ folder — and fill in its manifest: title, a "
    "one-sentence description, the list of pages, and the dominant "
    "accent color as a hex value.")

JUDGE_PROMPT = (
    "You are judging someone else's work, fresh eyes. Read "
    "brief/brief.md and then index.html in this workspace. Does the "
    "page honor the brief — required sections present, brand rules "
    "followed, copy voice roughly right? Judge the CONTENT: file "
    "layout and reference paths are checked by other machinery, so do "
    "not fail for those. pass=true only if a picky client would "
    "accept this page.")

JUDGE_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["pass", "reason"],
    "properties": {
        "pass": {"type": "boolean"},
        "reason": {"type": "string",
                   "description": "One sentence: why, or why not."},
    },
}

_REF = re.compile(r"""(?:href|src)\s*=\s*["']([^"']+)["']""", re.I)


def broken_refs(workspace: Path) -> list[str]:
    """Every internal href/src in every page, resolved against the file
    tree — the way the PUBLISHED copy will see it: references into
    brief/ count as broken, because publishing strips the client's
    paperwork (a live build shipped a broken logo before this check
    knew that). External schemes, anchors and protocol-relative URLs
    are not ours to vouch for."""
    broken = []
    for page in workspace.rglob("*.html"):
        if page.is_relative_to(workspace / "brief"):
            continue
        for target in _REF.findall(page.read_text(errors="replace")):
            if re.match(r"^[a-z][a-z0-9+.-]*:", target, re.I):
                continue
            if target.startswith(("#", "//")):
                continue
            path = target.split("#")[0].split("?")[0]
            if not path:
                continue
            if path.lstrip("./").startswith("brief/"):
                broken.append(f"{page.relative_to(workspace)} -> {target}"
                              " (brief/ does not ship)")
                continue
            base = workspace if path.startswith("/") else page.parent
            if not (base / path.lstrip("/")).exists():
                broken.append(f"{page.relative_to(workspace)} -> {target}")
    return broken


async def run_turn(client: CodexClient, thread_id: str, text: str, *,
                   schema: dict | None = None, read_only: bool = False,
                   timeout: float = 600) -> tuple[str, str | None]:
    """One turn, drained to completion. Returns (status, final agent
    message text) — with outputSchema set, that text IS the JSON."""
    params: dict = {"threadId": thread_id,
                    "input": [{"type": "text", "text": text}],
                    "summary": "auto"}
    if schema is not None:
        params["outputSchema"] = schema
        params["effort"] = "low"  # a form to fill, not a site to build
    if read_only:
        params["sandboxPolicy"] = {"type": "readOnly"}
    started = await client.request("turn/start", params)
    turn_id = started["turn"]["id"]
    queue = client.queue_for(thread_id)
    final = None
    while True:
        note = await asyncio.wait_for(queue.get(), timeout)
        p = note.get("params") or {}
        named = p.get("turnId") or (p.get("turn") or {}).get("id")
        if named is not None and named != turn_id:
            continue
        if (note["method"] == "item/completed"
                and (p.get("item") or {}).get("type") == "agentMessage"):
            final = p["item"].get("text")
        if note["method"] == "turn/completed":
            return (p.get("turn") or {}).get("status", "failed"), final


async def eval_brief(client: CodexClient, name: str) -> list[tuple[str, bool, str]]:
    """Build one brief in a temp workspace and run every check.
    Returns (check, passed, note) rows."""
    rows: list[tuple[str, bool, str]] = []
    workspace = Path(tempfile.mkdtemp(prefix=f"smoke-{name}-"))
    try:
        shutil.copytree(BRIEFS_DIR / name, workspace / "brief")
        started = await client.request("thread/start", {
            "cwd": str(workspace),
            "sandbox": "workspace-write",
            "approvalPolicy": "never",
            "model": MODEL,
            # The whole point: this thread is scaffolding. No rollout
            # file, nothing to clean up, nothing to resume.
            "ephemeral": True,
        })
        thread_id = started["thread"]["id"]
        rows.append(("ephemeral thread (no rollout path)",
                     started["thread"].get("path") in (None, ""),
                     str(started["thread"].get("path"))))

        t0 = time.monotonic()
        status, _ = await run_turn(client, thread_id, BUILD_PROMPT)
        rows.append(("build turn completed", status == "completed",
                     f"{time.monotonic() - t0:.0f}s"))

        rows.append(("index.html exists",
                     (workspace / "index.html").exists(), ""))

        broken = broken_refs(workspace)
        rows.append(("internal references resolve", not broken,
                     "; ".join(broken[:3])))

        status, text = await run_turn(client, thread_id, MANIFEST_PROMPT,
                                      schema=MANIFEST_SCHEMA, read_only=True)
        try:
            manifest = parse_manifest(text or "")
            rows.append(("manifest validates", True,
                         f"{manifest.title!r} · accent {manifest.accent}"))
        except Exception as exc:  # noqa: BLE001 — any failure is the finding
            rows.append(("manifest validates", False,
                         f"{type(exc).__name__}: {exc}"))

        # The judge gets its own ephemeral thread: the builder grading
        # its own homework is the failure mode, not the check.
        judge = await client.request("thread/start", {
            "cwd": str(workspace), "sandbox": "read-only",
            "approvalPolicy": "never", "model": MODEL, "ephemeral": True,
        })
        status, text = await run_turn(client, judge["thread"]["id"],
                                      JUDGE_PROMPT, schema=JUDGE_SCHEMA,
                                      read_only=True)
        try:
            verdict = json.loads(text or "")
            rows.append(("llm judge: page matches brief",
                         verdict.get("pass") is True,
                         verdict.get("reason", "")))
        except json.JSONDecodeError as exc:
            rows.append(("llm judge: page matches brief", False,
                         f"judge answer unparsable: {exc}"))
    finally:
        shutil.rmtree(workspace, ignore_errors=True)
    return rows


async def main() -> int:
    names = sys.argv[1:] or sorted(
        p.name for p in BRIEFS_DIR.iterdir() if (p / "brief.md").is_file())
    client = CodexClient()
    await client.start()
    failures = 0
    t0 = time.monotonic()
    print(f"smoke eval · {len(names)} brief(s) · model {MODEL}\n")
    for name in names:
        print(f"── {name} " + "─" * max(0, 50 - len(name)))
        for check, passed, note in await eval_brief(client, name):
            failures += 0 if passed else 1
            mark = "PASS" if passed else "FAIL"
            print(f"  {mark}  {check:<36} {note}")
    print(f"\n{'all green' if failures == 0 else f'{failures} check(s) FAILED'}"
          f" · {time.monotonic() - t0:.0f}s total")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
