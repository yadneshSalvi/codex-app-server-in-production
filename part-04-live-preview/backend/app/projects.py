"""Per-project workspaces: one job site per client.

A project is a folder — projects/{id}/site/ — plus one line in a flat
projects.json registry (id, name, created_at; thread ids arrive in Part 5,
SQLite waits for Part 9). Creating a project can seed a client brief from
the repo's brief bank into the workspace under brief/, so the agent reads
the assignment the same way it reads any other file.
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


def load_registry() -> list[dict]:
    if REGISTRY.exists():
        return json.loads(REGISTRY.read_text())
    return []


def save_registry(entries: list[dict]) -> None:
    PROJECTS.mkdir(exist_ok=True)
    REGISTRY.write_text(json.dumps(entries, indent=2) + "\n")


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
    entry = {
        "id": project_id,
        "name": name or (brief.replace("-", " ").title() if brief else "Untitled site"),
        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
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
