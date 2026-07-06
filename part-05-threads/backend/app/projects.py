"""Per-project workspaces: one job site per client.

A project is a folder — projects/{id}/site/ — plus one line in a flat
projects.json registry. Part 5 grows each line a thread: `thread_id` binds
the project to its job folder in the rollout archive, `thread_name` holds
the auto-title, and forks record `forked_from_id`. Still a flat file —
SQLite waits for Part 9. Creating a project can seed a client brief from
the repo's brief bank into the workspace under brief/.
"""

import json
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path

PROJECTS = Path("projects")
REGISTRY = PROJECTS / "projects.json"
# The brief bank ships at the repo root, one folder per fictional client.
BRIEFS = Path(__file__).resolve().parents[3] / "briefs"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def load_registry() -> list[dict]:
    if REGISTRY.exists():
        return json.loads(REGISTRY.read_text())
    return []


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
                      "seeded": rel.startswith("brief/")})
    return files
