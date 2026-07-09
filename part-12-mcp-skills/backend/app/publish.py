"""Publishing: the copy, the manifest, and the gate.

The naive Publish button is fifteen lines: copy `site/` to
`published/{slug}/` and serve it at `/p/{slug}/`. It works, and it
feels reckless — nothing between "the agent stopped typing" and "this
is live". The rest of this module is what makes the button EARNED:

- The manifest. One `outputSchema` turn asks the engine for
  `{title, description, pages, accent}` and the final agentMessage IS
  the schema-conformant JSON string (verified live, 0.142.4). Validated
  with pydantic anyway — the schema constrains the model's grammar, not
  our trust — and scrubbed of markdown links, which the model likes to
  tuck inside string values.
- The gate. Publish refuses unless the latest inspection found no [P1]
  blockers, the site hasn't changed since that inspection, and the
  manifest validated. A `force` flag exists because products need
  escape hatches; it logs loudly because escape hatches need witnesses.
"""

import json
import re
import shutil
import time
from pathlib import Path

from pydantic import BaseModel, field_validator

from app import projects

PUBLISHED = Path("published")
REGISTRY = PUBLISHED / "published.json"

# The wire side of the manifest: JSON Schema for turn/start.outputSchema.
# Strict shape (everything required, no extras) — structured outputs
# reject looser schemas, and a form with optional fields invites the
# model to skip the hard ones.
MANIFEST_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["title", "description", "pages", "accent"],
    "properties": {
        "title": {
            "type": "string",
            "description": "The site's name, as its hero or <title> states it.",
        },
        "description": {
            "type": "string",
            "description": "One sentence describing the site, plain text, "
                           "suitable for an index card.",
        },
        "pages": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["path", "title"],
                "properties": {
                    "path": {"type": "string",
                             "description": "Workspace-relative path, e.g. index.html."},
                    "title": {"type": "string"},
                },
            },
        },
        "accent": {
            "type": "string",
            "description": "The site's dominant accent color as a CSS hex "
                           "value, e.g. #2F5233.",
        },
    },
}


class Page(BaseModel):
    path: str
    title: str


class Manifest(BaseModel):
    """The pydantic side: the same shape, validated on OUR side of the
    wire. The engine constrained the model's grammar; this is the
    receiving dock checking the crate anyway."""
    title: str
    description: str
    pages: list[Page]
    accent: str

    @field_validator("accent")
    @classmethod
    def accent_is_hex(cls, value: str) -> str:
        if not re.fullmatch(r"#[0-9a-fA-F]{3,8}", value.strip()):
            raise ValueError(f"accent must be a CSS hex color, got {value!r}")
        return value.strip()


# The one pollution structured output allows: string VALUES are free
# text, and the model likes markdown links in them ("[Beanline](...)").
# Keep the words, drop the brackets and the URL.
_MD_LINK = re.compile(r"\[([^\]]*)\]\([^)]*\)")


def _scrub(node):
    if isinstance(node, str):
        return _MD_LINK.sub(r"\1", node)
    if isinstance(node, list):
        return [_scrub(item) for item in node]
    if isinstance(node, dict):
        return {key: _scrub(value) for key, value in node.items()}
    return node


def parse_manifest(text: str) -> Manifest:
    """Final agentMessage text → validated Manifest. Raises ValueError /
    ValidationError; the caller owns the retry-or-surface policy."""
    return Manifest.model_validate(_scrub(json.loads(text)))


# href/src values, for the one deterministic scan the gate does itself.
_REF = re.compile(r"""(?:href|src)\s*=\s*["']([^"']+)["']""", re.I)


def brief_refs(site: Path) -> list[str]:
    """Pages that reach into brief/ — the client's paperwork, which
    publish_site deliberately does not copy. A workspace preview
    resolves these fine, which is exactly why they slip through: the
    break only exists on the published copy. (Found the honest way:
    a live build shipped a broken logo before this check existed.)"""
    refs = []
    for page in site.rglob("*.html"):
        for target in _REF.findall(page.read_text(errors="replace")):
            if target.lstrip("./").startswith("brief/"):
                refs.append(f"{page.relative_to(site)} -> {target}")
    return refs


def gate_reasons(entry: dict) -> list[str]:
    """Why this project may NOT publish right now — empty means go.

    Three registry checks and one grep, no protocol call: an inspection
    exists, it found no blockers, nothing ran after it, and no page
    references the brief/ folder that publishing strips away.
    (built_at_ms is stamped on every completed non-review turn —
    conservatively including turns that changed nothing, because "the
    review is older than the last turn" is cheap to check and honest,
    while "did that turn REALLY change a file" is a diff-parsing
    rabbit hole.)"""
    reasons = []
    reviewed = entry.get("review")
    if reviewed is None:
        return ["the site has never been inspected — run the review first"]
    if reviewed.get("P1"):
        reasons.append(f"the last inspection found {reviewed['P1']} "
                       f"blocker finding(s) [P1] — fix them and re-inspect")
    if (entry.get("built_at_ms") or 0) > reviewed["at_ms"]:
        reasons.append("the site changed after the last inspection — "
                       "re-run the review")
    if refs := brief_refs(projects.site_dir(entry["id"])):
        reasons.append("the site references the brief/ folder, which does "
                       f"not ship — copy those assets into the site ({refs[0]})")
    return reasons


def slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", (name or "site").lower()).strip("-")
    return slug or "site"


def load_registry() -> list[dict]:
    if not REGISTRY.exists():
        return []
    return json.loads(REGISTRY.read_text())


def save_registry(entries: list[dict]) -> None:
    PUBLISHED.mkdir(exist_ok=True)
    REGISTRY.write_text(json.dumps(entries, indent=2) + "\n")


def site_path(slug: str) -> Path:
    return PUBLISHED / slug


def publish_site(project_id: str, name: str, manifest: Manifest | None,
                 forced: bool = False) -> dict:
    """The naive Publish button, kept naive on purpose: copy the
    workspace's site (minus the client's paperwork) into published/ and
    write the registry line. Everything that makes this SAFE already
    happened — the gate — which is the part's whole argument.

    Republishing the same project reuses its slug (the copy replaces
    the old files); a DIFFERENT project claiming a taken slug gets a
    numbered suffix instead of someone else's URL."""
    entries = load_registry()
    slug = None
    for entry in entries:
        if entry["project_id"] == project_id:
            slug = entry["slug"]
    if slug is None:
        base = slugify(name)
        taken = {entry["slug"] for entry in entries}
        slug = base
        counter = 2
        while slug in taken:
            slug = f"{base}-{counter}"
            counter += 1
    target = site_path(slug)
    if target.exists():
        shutil.rmtree(target)
    # brief/ is the client's paperwork; AGENTS.md is the workshop's
    # poster (Part 12). Neither is part of the site.
    shutil.copytree(projects.site_dir(project_id), target,
                    ignore=shutil.ignore_patterns("brief", "AGENTS.md"))
    entry = {
        "slug": slug,
        "project_id": project_id,
        "name": name,
        "url": f"/p/{slug}/",
        "published_at_ms": int(time.time() * 1000),
        "manifest": manifest.model_dump() if manifest else None,
        "forced": forced,
    }
    entries = [e for e in entries if e["project_id"] != project_id] + [entry]
    save_registry(entries)
    projects.update_project(project_id, published={
        "slug": slug, "url": entry["url"], "at_ms": entry["published_at_ms"]})
    return entry


def index_html() -> str:
    """GET /p/ — the shop window. Server-rendered, zero JavaScript: a
    card per published site, drawn from each site's manifest (title,
    description, accent, page count). This page is what the manifest is
    FOR — without it the index would be a directory listing."""
    cards = []
    for entry in load_registry():
        manifest = entry.get("manifest") or {}
        accent = manifest.get("accent", "#57534e")
        if not re.fullmatch(r"#[0-9a-fA-F]{3,8}", accent):
            accent = "#57534e"  # never let stored data write CSS
        title = manifest.get("title") or entry["name"]
        description = manifest.get("description", "")
        pages = manifest.get("pages") or []
        page_note = f"{len(pages)} page{'s' if len(pages) != 1 else ''}" if pages else ""
        forced = " · published with --force" if entry.get("forced") else ""
        cards.append(f"""
  <a class="card" href="{entry['url']}" style="border-top: 4px solid {accent}">
    <h2>{_escape(title)}</h2>
    <p>{_escape(description)}</p>
    <span class="meta">{entry['url']}{f" · {page_note}" if page_note else ""}{forced}</span>
  </a>""")
    body = "".join(cards) or '<p class="empty">Nothing published yet.</p>'
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pagewright — published sites</title>
<style>
  body {{ font-family: ui-sans-serif, system-ui, sans-serif; margin: 0;
         background: #fafaf9; color: #1c1917; }}
  main {{ max-width: 720px; margin: 0 auto; padding: 48px 24px; }}
  h1 {{ font-size: 22px; }} h1 span {{ color: #a8a29e; font-weight: 400; }}
  .card {{ display: block; background: #fff; border: 1px solid #e7e5e4;
          border-radius: 10px; padding: 20px 24px; margin-top: 16px;
          text-decoration: none; color: inherit; }}
  .card h2 {{ margin: 0 0 6px; font-size: 17px; }}
  .card p {{ margin: 0 0 10px; color: #57534e; font-size: 14px; }}
  .meta {{ font-family: ui-monospace, monospace; font-size: 12px; color: #a8a29e; }}
  .empty {{ color: #a8a29e; }}
</style>
</head>
<body>
<main>
  <h1>Published sites <span>· Pagewright</span></h1>{body}
</main>
</body>
</html>
"""


def _escape(text: str) -> str:
    return (text.replace("&", "&amp;").replace("<", "&lt;")
            .replace(">", "&gt;").replace('"', "&quot;"))
