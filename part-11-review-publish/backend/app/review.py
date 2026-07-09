"""The inspector: review/start, and what to do with tagged prose.

`review/start` is the engine's built-in reviewer — a fresh-eyes pass with
its own item vocabulary (`enteredReviewMode` / `exitedReviewMode`) that
runs as a turn on the thread. Pagewright uses the `custom` target:
free-form instructions, no git required (the other targets — working
tree, base branch, commit — all assume a repo; a client workspace has
none). The instructions below are the product: what "ready to publish"
means for a small static site, written once, applied to every project.

The findings come back as PROSE, not JSON — a summary plus bullets
tagged [P1]/[P2]/[P3] with path:line references (verified live, 0.142.4;
the final agentMessage repeats the same text). The parser here is
deliberately humble: regex the tags, split on them, pull the first
path-looking token — and keep the raw text, because the raw text is the
truth and the structure is a convenience for the report card.
"""

import json
import re
import time

from app import projects

# What the inspector is told to inspect. Three areas, one severity
# rubric — and the rubric is a PRODUCT decision, iterated against the
# live reviewer (both failure modes were observed before this wording):
# judge what the site SHIPS. A brand contradiction the page inherits
# blocks publishing (v1 of the rubric let the reviewer hedge it down to
# [P2] "unless the client wants the blue mark"); a contradiction that
# remains only inside the client's paperwork after the page resolved it
# one way does NOT block forever (v2 made every brief-vs-asset conflict
# [P1], which no fix to the site could ever clear). Note what is NOT
# here: nothing about any specific client, color, or file. The
# inspector earns its findings.
INSTRUCTIONS = """\
You are the pre-publish inspector for a small static website built from
a client brief. The workspace contains the site files (index.html at
the root, possibly more pages and assets) and the client's paperwork
under brief/ — brief.md plus whatever the client supplied in
brief/assets/.

Inspect the CURRENT files and report every problem a publisher would
want fixed before the site goes live, in three areas:

1. Brief conformance. Compare the site against brief/brief.md: required
   sections, copy voice, and every explicit brand rule. Check the brand
   colors the brief names against the colors the site's CSS actually
   uses — AND against the client's own assets: open each file in
   brief/assets/ and read its real contents (for an SVG, the actual
   fill and stroke colors inside it). If the brief, an asset, and the
   implementation disagree with each other, that contradiction is a
   finding — name all sides of it.
2. Accessibility. Missing alt text, missing document language,
   unlabeled controls, broken heading structure, obviously poor color
   contrast.
3. Broken references. Internal links or asset paths (href/src) that do
   not resolve to a file in this workspace. Treat any reference into
   brief/ as broken too: that folder is the client's paperwork, not
   part of the site, and it does not ship when the site is published —
   assets the site uses must be the site's own copies.

Severity — tag every finding [P1], [P2], or [P3]. Judge what the SITE
ships; the gate exists to protect the live page:
- [P1] blocks publishing: broken pages or references, accessibility
  failures on required content, and any brand contradiction the site
  ships — the page using colors the brief forbids, or an asset the
  page actually displays (a logo, an image) clashing with the brief's
  stated brand. When the brief and a client-supplied asset contradict
  each other AND the page inherits that contradiction, that is [P1] —
  do not downgrade it on the guess that the client might have intended
  it; the entire point of [P1] is that the client must decide before
  this goes live.
- [P2] should be fixed soon: conformance gaps and defects that mislead
  or annoy but do not block — including a contradiction that remains
  only in the client's paperwork (brief.md versus its own assets
  folder) when the page itself has consistently resolved it one way.
- [P3] nice to have.

Format each finding as its own bullet, exactly:
- [P1] Short title — path:line — what is wrong and what to do about it.
Locations must be workspace-relative with a line number, like
index.html:12 or brief/assets/logo.svg:3 — never absolute paths. If
everything is genuinely fine, say so plainly instead of inventing
findings.
"""

# One finding = a [P*] tag and everything until the next tag (re.S so a
# finding may span lines). The reviewer writes markdown bullets; the
# stray "- " left at a segment's end belongs to the NEXT bullet.
_FINDING = re.compile(r"\[(P[123])\]\s*(.*?)(?=\[P[123]\]|\Z)", re.S)
# A path-looking token, optionally with :line. Anchored to known static
# site extensions so prose like "e.g." never becomes a location.
_LOCATION = re.compile(
    r"\b((?:[\w.-]+/)*[\w.-]+\.(?:html?|css|js|svg|md|png|jpe?g|webp|ico|txt))"
    r"(?::(\d+))?\b")
# The title/body seam the format asks for (an em dash), with fallbacks
# for the hyphens models substitute when they improvise.
_TITLE_SPLIT = re.compile(r"\s+[—–-]{1,2}\s+")
# Reviewers write absolute paths no matter what the instructions say
# (observed live). Everything up to the workspace's /site/ marker is
# machine-local noise in DISPLAY text — the raw findings stay untouched.
_ABS_WORKSPACE = re.compile(r"(?:/[\w.-]+)+/site/")


def parse_findings(text: str) -> list[dict]:
    """Tagged prose in, structured findings out — raw text stays king.

    Each finding: {severity, title, body, location}. The parser never
    fails: unparseable segments become a finding with the whole segment
    as its body, so nothing the reviewer said can silently vanish.
    """
    findings = []
    for match in _FINDING.finditer(text or ""):
        severity = match.group(1)
        segment = match.group(2).strip().rstrip("-*• \n").strip()
        segment = _ABS_WORKSPACE.sub("", segment)
        if not segment:
            continue
        parts = _TITLE_SPLIT.split(segment, maxsplit=1)
        title = parts[0].strip().lstrip("*").strip()
        body = parts[1].strip() if len(parts) > 1 else ""
        if "\n" in title:  # no dash seam: first line is the title
            title, _, rest = title.partition("\n")
            body = (rest + "\n" + body).strip()
        if len(title) > 90:
            title, body = title[:90].rsplit(" ", 1)[0] + "…", segment
        location_match = _LOCATION.search(segment)
        location = None
        if location_match:
            location = location_match.group(1)
            if location_match.group(2):
                location += f":{location_match.group(2)}"
            # Reviewers sometimes answer in absolute paths no matter
            # what the instructions say (observed live). Every project
            # workspace ends in /site/, so anything past that marker is
            # the workspace-relative truth.
            if "/site/" in location:
                location = location.split("/site/", 1)[1]
        findings.append({"severity": severity, "title": title,
                         "body": body, "location": location})
    return findings


def counts(findings: list[dict]) -> dict:
    return {sev: sum(1 for f in findings if f["severity"] == sev)
            for sev in ("P1", "P2", "P3")}


def report_path(project_id: str):
    return projects.PROJECTS / project_id / "review.json"


def save(project_id: str, turn_id: str, raw: str, findings: list[dict]) -> dict:
    """Persist the full report next to the workspace, and stamp the
    registry with the small summary the gate reads. Two homes on
    purpose: the gate needs four numbers, the report card wants
    everything."""
    tally = counts(findings)
    at_ms = int(time.time() * 1000)
    report = {"at_ms": at_ms, "turn_id": turn_id,
              "raw": raw, "findings": findings, "counts": tally}
    report_path(project_id).write_text(json.dumps(report, indent=2) + "\n")
    projects.update_project(project_id, review={
        "at_ms": at_ms, "turn_id": turn_id, "total": len(findings), **tally})
    return report


def load(project_id: str) -> dict | None:
    path = report_path(project_id)
    if not path.exists():
        return None
    return json.loads(path.read_text())
