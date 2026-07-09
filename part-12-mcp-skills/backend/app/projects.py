"""Per-project workspaces: one job site per client.

A project is a folder — projects/{id}/site/ — plus one line in a flat
projects.json registry. Part 5 grew each line a thread; Part 6 grows it a
`mode` — the trust posture (read-only / standard / trusted) that decides
which wristband the apprentice wears on this job site. Still a flat file —
SQLite waits for Part 9. Creating a project can seed a client brief from
the repo's brief bank into the workspace under brief/.

Part 12: every new workspace also gets an AGENTS.md — the site-rules
poster on the job-site wall. The engine reads it from the thread's cwd
on its own (verified live: thread/start's `instructionSources` names the
file, and an A/B build obeys it with no prompt changes); Pagewright just
has to hang the poster. The rules institutionalize what earlier parts
learned one incident at a time — most pointedly Part 11's broken-logo
publish, which is why "never reference brief/ paths" is now standing
policy instead of a repeated reviewer finding.
"""

import json
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path

# The three trust postures. What each one means on the wire lives in
# main.sandbox_policy — this is just the vocabulary the registry accepts.
MODES = ("read-only", "standard", "trusted")

PROJECTS = Path("projects")
REGISTRY = PROJECTS / "projects.json"
# The brief bank ships at the repo root, one folder per fictional client.
BRIEFS = Path(__file__).resolve().parents[3] / "briefs"

# The site-rules poster, written into every new workspace. The engine
# picks AGENTS.md up from the thread's cwd by itself — no prompt change,
# no per-turn cost of repeating the rules. Cheapest upgrade in the
# series. (It does NOT ship: publish_site skips it, same as brief/.)
AGENTS_MD = """\
# Site rules

Standing instructions for every build in this workspace.

- Semantic HTML: real <header>, <main>, <section>, <footer>; exactly
  one <h1> per page.
- Every <img> has meaningful alt text. No exceptions.
- All CSS lives in one <style> block per page. No inline style=""
  attributes, no external stylesheets.
- System font stacks only. Never load webfonts or anything else from
  the network — the site must be fully self-contained.
- Never reference brief/ paths from a page. That folder is the
  client's paperwork and does not ship when the site is published;
  copy any asset the site needs into the site's own folders first.
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def load_registry() -> list[dict]:
    if not REGISTRY.exists():
        return []
    entries = json.loads(REGISTRY.read_text())
    for entry in entries:
        # Registries written before Part 6 carry no mode; every project
        # holds the default posture until its owner changes it.
        entry.setdefault("mode", "standard")
    return entries


def save_registry(entries: list[dict]) -> None:
    PROJECTS.mkdir(exist_ok=True)
    REGISTRY.write_text(json.dumps(entries, indent=2) + "\n")


def get_project(project_id: str) -> dict | None:
    for entry in load_registry():
        if entry["id"] == project_id:
            return entry
    return None


def update_project(project_id: str, **fields) -> dict:
    """Patch one registry line and write the file back. A flat file has
    no transactions — one backend process is the deal until Part 9."""
    entries = load_registry()
    for entry in entries:
        if entry["id"] == project_id:
            entry.update(fields)
            save_registry(entries)
            return entry
    raise KeyError(project_id)


def touch(project_id: str) -> None:
    update_project(project_id, updated_at=_now())


def available_briefs() -> list[str]:
    if not BRIEFS.is_dir():
        return []
    return sorted(p.name for p in BRIEFS.iterdir() if (p / "brief.md").is_file())


def site_dir(project_id: str) -> Path:
    return PROJECTS / project_id / "site"


def create_project(name: str | None = None, brief: str | None = None) -> dict:
    if brief and brief not in available_briefs():
        raise ValueError(f"unknown brief: {brief!r}")
    project_id = uuid.uuid4().hex[:8]
    site = site_dir(project_id)
    site.mkdir(parents=True)
    # The poster goes up before the first worker arrives. The engine
    # reads it from cwd on every turn — standing instructions, zero
    # prompt tokens from us.
    (site / "AGENTS.md").write_text(AGENTS_MD)
    if brief:
        # The client's paperwork goes onto the job site under brief/ —
        # brief.md plus its assets folder, exactly as the bank ships it.
        shutil.copytree(BRIEFS / brief, site / "brief")
    now = _now()
    entry = {
        "id": project_id,
        "name": name or (brief.replace("-", " ").title() if brief else "Untitled site"),
        "created_at": now,
        "updated_at": now,
        # The job folder arrives with the first message; until then the
        # project is a workspace waiting for its conversation.
        "thread_id": None,
        "thread_name": None,
        "mode": "standard",
    }
    entries = load_registry()
    entries.append(entry)
    save_registry(entries)
    return entry


def fork_workspace(src_id: str) -> str:
    """Copy the job site. thread/fork copies the conversation, NOT the
    files — the workspace is ours, so the photocopier is ours too."""
    new_id = uuid.uuid4().hex[:8]
    shutil.copytree(site_dir(src_id), site_dir(new_id))
    return new_id


def register_fork(src: dict, new_id: str, thread_id: str, forked_from_id: str) -> dict:
    now = _now()
    entry = {
        "id": new_id,
        "name": src["name"] + " (fork)",
        "created_at": now,
        "updated_at": now,
        "thread_id": thread_id,
        "thread_name": src.get("thread_name"),
        # A fork keeps the original's wristband; trust is per project,
        # and the copy starts life as the same project.
        "mode": src.get("mode", "standard"),
        "forked_from_id": forked_from_id,
    }
    entries = load_registry()
    entries.append(entry)
    save_registry(entries)
    return entry


def list_files(project_id: str) -> list[dict]:
    """The workspace tree: relative paths + sizes. Seeded brief files are
    included — they really are on the job site — but flagged so the UI
    can dim them and keep the agent's own output in front."""
    site = site_dir(project_id)
    files = []
    for path in sorted(site.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(site).as_posix()
        files.append({"path": rel, "size": path.stat().st_size,
                      "seeded": rel.startswith("brief/") or rel == "AGENTS.md"})
    return files
