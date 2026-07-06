# Part 1: Setup and your first thread

The end state of [Part 1 of the series](https://yadnesh.dev/blog/codex-1-first-thread):
two Python scripts that speak JSON-RPC to `codex app-server` over stdio. The
first shakes hands with the engine; the second starts a thread, sends one
prompt, narrates everything the agent does, and leaves a real website in
`site/index.html`.

📖 Read along: [Part 1: Setup and your first thread](https://yadnesh.dev/blog/codex-1-first-thread)
🎬 See it run: **[demo.mp4](demo.mp4)**, a real gpt-5.4-mini run building the Beanline page.

## Run it

Prerequisites: Python 3.13 + [uv](https://docs.astral.sh/uv/), Node 22 LTS, and
the Codex CLI, pinned:

```bash
npm install -g @openai/codex@0.142.4
```

Authenticate once (either works):

- `codex login` if you have a ChatGPT plan, or
- `codex login --api-key` with an OpenAI API key (set a hard monthly budget first).

Then:

```bash
cd backend
uv run python hello_appserver.py   # the handshake
uv run python first_thread.py      # the real thing
open site/index.html               # what it built
```

`first_thread.py` accepts your own prompt too:

```bash
uv run python first_thread.py "Build a one-page site for a tiny bookshop called Dog-Eared"
```

## What changed since the previous part

This is the first part. Everything is new: the handshake (`initialize` +
`initialized`), `thread/start` with a workspace-write sandbox, `turn/start`,
and a narrated notification stream (`item/started`, `item/agentMessage/delta`,
`thread/tokenUsage/updated`, `turn/completed`).
