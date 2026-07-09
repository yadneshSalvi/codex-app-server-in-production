"""Skills: the workshop's pattern book, opened on demand.

A skill is a folder with a SKILL.md — frontmatter (name, description)
plus the playbook text. The engine discovers them from CODEX_HOME/skills
(user scope; this is where `cp -r skills/brand-kit "$CODEX_HOME/skills/"`
puts ours) and answers `skills/list` with metadata INCLUDING the path
the engine wants back when the skill is invoked.

Invocation is an input item, not a config switch: turn/start's input
array takes `{type: "skill", name, path}` alongside the text, and the
skill's playbook enters that one turn. Skills load on demand — a
100-line playbook you attach when the job calls for it, not standing
instructions every turn pays tokens for (that cheaper, always-on layer
is AGENTS.md).

This module is deliberately small: list what the engine sees, and find
the one skill Pagewright ships (`brand-kit`) so the chat endpoint can
attach it. The path comes from skills/list, never hardcoded — the
engine names its own books.
"""

from app.codex_client import CodexClient

BRAND_KIT = "brand-kit"


async def list_skills(client: CodexClient) -> list[dict]:
    """Every skill the engine can see, flattened across roots. The
    response groups by cwd (repo-scoped skills differ per workspace);
    Pagewright's skills are user-scoped, so one flat list serves."""
    result = await client.request("skills/list", {})
    skills, seen = [], set()
    for entry in result.get("data", []):
        for skill in entry.get("skills", []):
            if skill["name"] in seen:
                continue
            seen.add(skill["name"])
            skills.append({"name": skill["name"],
                           "description": skill.get("description", ""),
                           "path": skill.get("path", ""),
                           "scope": skill.get("scope", ""),
                           "enabled": skill.get("enabled", True)})
    return skills


async def find(client: CodexClient, name: str) -> dict | None:
    for skill in await list_skills(client):
        if skill["name"] == name and skill["enabled"]:
            return skill
    return None


def input_item(skill: dict) -> dict:
    """The wire shape, exactly as the 0.142.4 schema requires it: type,
    name, and the engine's own path for the skill."""
    return {"type": "skill", "name": skill["name"], "path": skill["path"]}
