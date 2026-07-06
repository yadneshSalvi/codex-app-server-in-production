# Codex App Server in Production

Companion repository for the blog series **[Codex App Server in Production: Build an AI Website Builder with FastAPI and Next.js](https://yadnesh.dev/series/codex-app-server-fastapi-nextjs)**.

You build **Pagewright**: describe a website in plain English and watch a Codex agent assemble it in a live preview, with streaming command output, a diff drawer, patch approvals, mid-turn steering, and a Publish button gated by the agent's own reviewer. The backend speaks raw JSON-RPC to `codex app-server`, the protocol behind every official Codex surface.

## How this repo works

**One folder per part.** Each folder is the complete, runnable project exactly as it exists at the end of that part, not a diff. `cd` into any part and run it without assembling earlier parts.

| Folder | Blog post |
|---|---|
| `part-01-first-thread` | [Part 1: Setup and your first thread](https://yadnesh.dev/blog/codex-1-first-thread) |
| `part-02-fastapi-bridge` | [Part 2: The FastAPI bridge and the event vocabulary](https://yadnesh.dev/blog/codex-2-fastapi-bridge) |
| `part-03-builder-ui` | [Part 3: The builder UI](https://yadnesh.dev/blog/codex-3-builder-ui) |
| `part-04-live-preview` | [Part 4: Workspaces, the live preview, and the diff drawer](https://yadnesh.dev/blog/codex-4-live-preview) |
| `part-05-threads` | [Part 5: Threads that persist](https://yadnesh.dev/blog/codex-5-threads) |
| `part-06-sandbox` | [Part 6: The sandbox](https://yadnesh.dev/blog/codex-6-sandbox) |
| `part-07-approvals` | [Part 7: Approvals](https://yadnesh.dev/blog/codex-7-approvals) |
| `part-08-stop-steer-usage` | [Part 8: Stop, steer, and the meter](https://yadnesh.dev/blog/codex-8-stop-steer-usage) |
| `part-09-durable-streams` | [Part 9: Durable streams](https://yadnesh.dev/blog/codex-9-durable-streams) |
| `part-10-plans-questions` | [Part 10: Plans, reasoning depth, and questions](https://yadnesh.dev/blog/codex-10-plans-questions) |
| `part-11-review-publish` | [Part 11: Trust but verify](https://yadnesh.dev/blog/codex-11-review-publish) |
| `part-12-mcp-skills` | [Part 12: The wider workshop](https://yadnesh.dev/blog/codex-12-mcp-skills) |
| `part-13-deploy-hetzner` | [Part 13: Ship it](https://yadnesh.dev/blog/codex-13-deploy-hetzner) |

The `briefs/` folder holds the fictional client briefs the series builds sites from. Every brief is self-contained (no webfonts, no CDN assets) because the agent works inside a sandbox with network access off.

## Tested with

| Tool | Version |
|---|---|
| Codex CLI (`@openai/codex`) | 0.142.4 |
| Python | 3.13 |
| uv | 0.8.x |
| Node.js | 22 LTS |
| Next.js | 16.x |

The app-server protocol is experimental and moves fast. Every part pins the CLI version above; if something behaves differently on your machine, check your `codex --version` first.

## Secrets

Only `.env.example` files are committed. You need an OpenAI API key (or an existing `codex login`); each part's README says where it goes.
