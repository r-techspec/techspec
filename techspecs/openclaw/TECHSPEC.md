# OpenClaw: A Self-Hosted AI Assistant You Actually Own

**TL;DR:** One process on your machine. Every messaging app you use. Full control over what it can do.

---

## What is it?

OpenClaw is a self-hosted, single-user AI assistant that talks to you through the messaging apps you already have -- Telegram, WhatsApp, Slack, Discord, Signal, and more. No cloud platform. No multi-tenant SaaS. One long-running process called the **Gateway** runs on your hardware and coordinates everything.

## The Architecture in 30 Seconds

```
  You (Telegram, Slack, Discord, WhatsApp, CLI, Web UI, mobile apps)
                            |
                     [ Gateway :18789 ]
                            |
         +---------+--------+--------+---------+
         |         |        |        |         |
      Agents    Sessions  Memory  Plugins   Security
```

The Gateway is the entire control plane. It holds open connections to your messaging platforms, dispatches messages to an LLM agent runtime, manages long-term memory, and exposes a WebSocket + HTTP API for clients. Everything else -- channel adapters, skills, auth providers -- plugs into it.

## Key Design Decisions

**TypeScript, strict ESM, no exceptions.** This is an orchestration system -- prompts, tools, protocols. TypeScript keeps it hackable and readable. No `any`, no `@ts-nocheck`.

**File-based storage.** All state lives under `~/.openclaw/`. JSON config, JSONL transcripts, markdown knowledge files. No external database server. The one exception: SQLite with `sqlite-vec` for vector embeddings.

**Flat agents only.** No agent hierarchies, no manager-of-managers, no planner trees. One agent runtime, one tool loop.

**Model-agnostic.** Anthropic, OpenAI, Gemini, Bedrock, Ollama, OpenRouter. Credentials rotate automatically on rate limits. Swap providers without changing anything else.

## How Memory Works (the interesting part)

LLMs have no memory between calls. OpenClaw builds memory around the model in layers:

1. **Bootstrap files** -- `SOUL.md` (persona), `USER.md` (your profile) -- load into every prompt
2. **Session transcripts** -- append-only JSONL, reconstructed per turn
3. **Hybrid search** -- BM25 keyword + vector semantic search over the agent's markdown workspace, with temporal decay and MMR re-ranking
4. **Compaction** -- when context gets too long, a silent turn flushes important info to disk, then the old conversation is summarized and replaced

The cycle: conversation happens -> facts get written to markdown files -> files get indexed -> future turns retrieve relevant snippets. The model never "remembers" anything. The system around it does.

**Temporal decay and MMR re-ranking** are the two techniques that make retrieval feel natural rather than mechanical. Temporal decay applies a time-based penalty to older documents -- a note from yesterday scores higher than an identical note from six months ago, because recency usually correlates with relevance in conversation. MMR (Maximal Marginal Relevance) re-ranking then diversifies the final result set: instead of returning the top N most similar chunks (which often say the same thing in slightly different words), MMR iteratively selects results that are both relevant to the query *and* dissimilar to what's already been selected. The combination means you get fresh, non-redundant context that actually helps the model respond coherently.

## Security Model

This thing runs real commands on your real computer and is reachable from the internet, so:

- **DM pairing** -- nobody talks to the bot until you approve a pairing code
- **Exec approvals** -- dangerous tools (like shell execution) require operator sign-off before they run
- **Sandboxing** -- optional Docker isolation with restricted filesystem and no network

## Plugin System

Five extension points: memory backends, channel adapters, skills (50+ bundled), auth providers, and lifecycle hooks. Each is a workspace package loaded at runtime via `jiti`. Core stays lean.

### Building a Plugin

Two files: a manifest (`openclaw.plugin.json`) and an entry point (`index.ts`).

```typescript
// index.ts
import { definePlugin } from "openclaw/plugin-sdk";

export default definePlugin({
  id: "my-plugin",
  name: "My Plugin",
  register(api) {
    api.registerTool({ name: "my_tool", ... }, async (params, ctx) => { /* ... */ });
    api.on("before_agent_start", async (event) => ({ prependContext: "..." }));
    api.registerHttpRoute("GET", "/my-plugin/status", handler);
  }
});
```

The `api` object exposes `registerTool`, `registerChannel`, `registerHttpRoute`, `registerCli`, `registerService`, `registerProvider`, and 20 lifecycle hooks (`before_agent_start`, `agent_end`, `before_compaction`, `message_received`, etc.). Void hooks run in parallel; modifying hooks run sequentially.

### Data Storage: You Own Your Files

Plugins **do not** get an auto-scoped markdown directory. The workspace (`~/.openclaw/workspace/`) has a defined structure -- `SOUL.md`, `USER.md`, `memory/YYYY-MM-DD.md`, etc. -- and the core memory system manages those files.

Your plugin controls its own data in two ways:

1. **Structured state** -- Use `writeJsonFileAtomically` and `readJsonFileWithFallback` from the SDK for safe JSON persistence. Resolve paths with `api.resolvePath()`. Your service context provides a `stateDir` for plugin-specific state.

2. **Agent-visible knowledge** -- If your plugin needs to surface data to the agent, register a **tool** that the agent calls to query your data, rather than writing directly into the workspace markdown. This keeps the workspace clean and lets you control the format. The LanceDB memory extension, for example, registers its own search tools and hooks into `before_agent_start` to inject relevant context.

The workspace markdown files are the agent's long-term memory -- managed by the core memory system, indexed for hybrid search. Plugins extend what the agent can *do* and *know* by registering tools and hooks, not by writing directly into that file tree.

## Stack

Grammy (Telegram), Carbon (Discord), Bolt (Slack), Baileys (WhatsApp), Express, ws, Zod, sqlite-vec, Playwright, Lit (web UI), Vitest. Formatting and linting via Oxfmt/Oxlint (Rust-based).

---

**Status:** Active development. Calendar versioning (`YYYY.M.D`). Runs as a daemon via launchd (macOS) or systemd (Linux).

[GitHub](https://github.com/openclaw) | Built with TypeScript | MIT License
