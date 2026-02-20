# OpenClaw MVP Technical Specification

A minimal viable implementation of a self-hosted AI assistant, built to understand how such systems work under the hood.

## Overview

OpenClaw MVP demonstrates the core architecture of an AI assistant: a Gateway server coordinating sessions, memory, tools, and an AI backend (Claude Code CLI). This is an educational project—not production code—designed to make the key ideas concrete and reproducible.

**What this is:** A working prototype that shows how the pieces fit together.

**What this isn't:** A production-ready system. No external messaging adapters, no multi-user support, no cloud deployment.

## Architecture at a Glance

```
┌─────────────────────────────────────────────────────────────┐
│                         CLI                                  │
│  (openclaw start | message | sessions | config | logs)      │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      Gateway :18789                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│  │ WebSocket│  │ Session  │  │  Memory  │  │ Security │    │
│  │  Server  │  │ Manager  │  │  System  │  │ Manager  │    │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     Agent Runtime                            │
│  ┌──────────────────┐  ┌──────────────────┐                 │
│  │ Claude Code CLI  │  │   Tool System    │                 │
│  │   Integration    │  │  (file, shell)   │                 │
│  └──────────────────┘  └──────────────────┘                 │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Storage Layer                             │
│  ~/.openclaw/                                                │
│  ├── config.json          # Settings                         │
│  ├── auth.json            # Auth token (600 perms)           │
│  ├── sessions/*.jsonl     # Conversation transcripts         │
│  ├── workspace/SOUL.md    # Agent persona                    │
│  ├── workspace/USER.md    # User profile                     │
│  ├── workspace/memory/    # Indexed knowledge files          │
│  └── logs/*.log           # Structured JSON logs             │
└─────────────────────────────────────────────────────────────┘
```

## How It Works

### The Message Flow

1. User runs `openclaw message "Hello"`
2. CLI loads auth token from `~/.openclaw/auth.json`
3. CLI connects to Gateway via WebSocket on port 18789
4. Gateway validates token (constant-time comparison to prevent timing attacks)
5. Session Manager creates/loads session, appends user message to JSONL transcript
6. Memory System loads bootstrap files (SOUL.md, USER.md) and searches for relevant context
7. Agent Runtime builds prompt and spawns Claude Code CLI subprocess
8. Claude CLI streams response back through Gateway to CLI
9. If Claude requests a tool call, Tool System executes it and returns result
10. Session Manager appends assistant response to transcript
11. CLI displays formatted response

### Key Design Decisions

**Why WebSocket?** Streaming. The assistant needs to stream responses token-by-token for a good UX. WebSocket gives us bidirectional streaming without the complexity of SSE or long-polling.

**Why JSONL for transcripts?** Append-only is simple and robust. Each message is a single line, so partial writes don't corrupt the whole file. Easy to repair, easy to tail, easy to debug.

**Why file-based storage?** Portability and simplicity. No database to configure, no migrations to run. Copy the `~/.openclaw/` directory and you've backed up everything.

**Why Claude Code CLI?** It's already authenticated and handles the API complexity. We just spawn it as a subprocess and parse its output.

---

## Components Deep Dive

### 1. Gateway Server

**File:** `src/gateway/gateway-server.ts`

The Gateway is the central coordinator—a WebSocket server that authenticates connections, routes messages, and streams responses.

**Key behaviors:**
- Binds to port 18789 (configurable)
- Token-based authentication on connect
- Routes messages to Agent Runtime
- Streams `text_delta`, `tool_call`, `tool_result`, `done` events
- Graceful shutdown: waits 30s for in-flight requests
- Hot-reload: watches config file for changes

**Connection protocol:**
```
Client connects → Server: {type: "auth_result", success: false}
Client: {type: "auth", token: "..."} → Server validates
Server: {type: "auth_result", success: true}
Client: {type: "create_session"} → Server: {type: "session_created", sessionId: "..."}
Client: {type: "message", content: "Hello"} → Server streams response
```

### 2. Session Manager

**File:** `src/session/session-manager.ts`

Manages conversation persistence with JSONL transcripts.

**Transcript format:**
```jsonl
#{"id":"abc-123","createdAt":1708444800000,"version":1}
{"id":"msg-1","role":"user","content":"Hello","timestamp":1708444801000}
{"id":"msg-2","role":"assistant","content":"Hi!","timestamp":1708444802000}
```

First line (prefixed `#`) is metadata. Each subsequent line is a message.

**Repair logic:** Malformed lines are skipped and logged. The file is rewritten with only valid entries.

### 3. Memory System

**File:** `src/memory/memory-system.ts`

Handles context retrieval using BM25 search with temporal decay and MMR diversity.

**Bootstrap files:**
- `SOUL.md` — Agent persona ("You are OpenClaw, a helpful AI assistant...")
- `USER.md` — User profile and preferences

**Search pipeline:**
1. BM25 keyword search on `workspace/memory/*.md`
2. Temporal decay: `score × 0.5^(age_days / 7)`
3. MMR re-ranking (λ=0.7) for diversity

**Context compaction:** When history exceeds token limit, older messages are summarized and facts are flushed to disk.

### 4. Agent Runtime

**File:** `src/agent/agent-runtime.ts`

Spawns Claude Code CLI and parses its output.

**Prompt structure:**
```
{SOUL.md}
{USER.md}
{Relevant context from memory search}

Available tools:
- read_file: Read file contents
- write_file: Write content to file
- list_directory: List directory contents
- execute_shell: Run shell command

Conversation history:
Human: ...
Assistant: ...

Human: {current message}

Assistant:
```

**Tool call parsing:** Looks for `<tool_call name="...">{"arg": "value"}</tool_call>` patterns in output.

### 5. Tool System

**File:** `src/tools/tool-system.ts`

Registers and executes tools with JSON Schema validation.

**Core tools:**
| Tool | Description |
|------|-------------|
| `read_file` | Read file contents |
| `write_file` | Write content to file |
| `list_directory` | List directory contents |
| `execute_shell` | Run shell command, capture stdout/stderr |

**Extensibility:** Register custom tools via `toolSystem.register(definition, handler)`.

### 6. Security Manager

**File:** `src/security/security-manager.ts`

Handles token generation, storage, and validation.

**Key features:**
- 32-byte hex tokens (cryptographically random)
- File permissions: 600 (owner read/write only)
- Constant-time comparison (prevents timing attacks)
- Token rotation support

### 7. Config Manager

**File:** `src/config/config-manager.ts`

Manages configuration with Zod validation.

**Precedence:** defaults → file → environment variables

**Environment variables:**
```bash
OPENCLAW_GATEWAY_PORT=8080
OPENCLAW_AGENT_MODEL=opus
OPENCLAW_LOGGING_LEVEL=debug
```

**Atomic writes:** Write to temp file, then rename. Readers never see partial state.

### 8. Logger

**File:** `src/logging/logger.ts`

Structured JSON logging with rotation.

**Log format:**
```json
{"timestamp":"2024-02-20T10:30:00.000Z","level":"info","message":"Gateway started","context":{"port":18789}}
```

**Features:**
- Levels: debug, info, warn, error
- Error entries include stack traces
- Rotation by size (default 10MB, keep 5 files)

---

## Data Schemas

### Configuration (`config.json`)

```typescript
interface OpenClawConfig {
  gateway: { port: number; host: string };
  agent: { claudeCliPath: string; model: string; maxTokens: number };
  memory: { workspacePath: string; maxContextTokens: number; temporalDecayHalfLife: number };
  logging: { level: 'debug'|'info'|'warn'|'error'; path: string; maxSize: number; maxFiles: number };
}
```

### Auth Store (`auth.json`)

```typescript
interface AuthStore {
  token: string;      // 32-byte hex
  createdAt: number;  // Unix ms
  rotatedAt?: number; // Unix ms
}
```

---

## How to Build This Yourself

### Prerequisites

- Node.js 18+
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated

### Step-by-Step

**1. Initialize the project**

```bash
mkdir openclaw && cd openclaw
npm init -y
npm pkg set type=module
npm install typescript ws zod commander @types/node @types/ws
npm install -D vitest fast-check
npx tsc --init --strict --module NodeNext --moduleResolution NodeNext
```

**2. Create the workspace manager**

Start with `src/storage/workspace.ts`. This handles the `~/.openclaw/` directory structure and path containment validation.

**3. Add configuration management**

`src/config/config-manager.ts` with Zod schemas, atomic writes, and environment variable overrides.

**4. Build the logger**

`src/logging/logger.ts` with JSON output, level filtering, and rotation.

**5. Implement security**

`src/security/security-manager.ts` for token generation, storage (600 perms), and constant-time validation.

**6. Create session management**

`src/session/session-manager.ts` with JSONL transcripts and repair logic.

**7. Build the tool system**

`src/tools/tool-system.ts` with JSON Schema validation and core tools (read_file, write_file, list_directory, execute_shell).

**8. Add memory/search**

`src/memory/bm25.ts` for keyword search, `src/memory/memory-system.ts` for bootstrap loading, temporal decay, and MMR.

**9. Create the agent runtime**

`src/agent/agent-runtime.ts` to spawn Claude CLI, parse responses, and handle tool calls.

**10. Wire up the gateway**

`src/gateway/gateway-server.ts` as the WebSocket coordinator.

**11. Build the CLI**

`src/cli/` with commander.js for start, message, sessions, config, and logs commands.

### Running It

```bash
npm run build

# Terminal 1: Start gateway
node dist/cli/index.js start

# Terminal 2: Send message
node dist/cli/index.js message "Hello, can you help me?"
```

---

## Relation to Full OpenClaw

This MVP is a stripped-down version of the full [OpenClaw](https://github.com/ttimblin/openclaw) project. Here's what's different:

| Feature | MVP | Full OpenClaw |
|---------|-----|---------------|
| Messaging | CLI only | Telegram, Slack, Discord, WhatsApp |
| Users | Single user | Multi-user with profiles |
| Storage | File-based | SQLite + file storage |
| Memory | BM25 only | BM25 + vector embeddings |
| Deployment | Local only | Docker, cloud-ready |
| Agent | Single Claude CLI | Multiple agent backends |

The MVP focuses on the core loop: receive message → retrieve context → call LLM → execute tools → return response. The full version adds the adapters and infrastructure needed for real-world use.

---

## Testing

The project uses Vitest with fast-check for property-based testing.

```bash
npm test           # Run all tests
npm run test:watch # Watch mode
```

**Test categories:**
- Unit tests: Individual component behavior
- Property tests: Invariants that hold across all inputs (e.g., "session IDs are always unique")
- Integration tests: End-to-end message flow

---

## Project Structure

```
src/
├── cli/           # Command-line interface
│   ├── commands/  # start, message, sessions, config, logs
│   └── utils/     # connection helpers, markdown formatting
├── gateway/       # WebSocket server
├── agent/         # Claude CLI integration
├── session/       # Conversation management
├── memory/        # BM25 search, context retrieval
├── security/      # Token auth
├── config/        # Configuration management
├── logging/       # Structured JSON logging
├── storage/       # Workspace file management
└── tools/         # File ops, shell commands
test/
├── integration/   # End-to-end tests
└── property/      # Property-based tests
```

---

## License

MIT