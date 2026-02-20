# Design Document: OpenClaw MVP

## Overview

OpenClaw MVP is a minimal self-hosted AI assistant built around a single Gateway process that orchestrates message handling, session management, and AI agent execution via Claude Code CLI. The architecture prioritizes simplicity, file-based storage, and local-first operation.

The system follows a layered architecture:
1. **CLI Layer** - User-facing command interface
2. **Gateway Layer** - WebSocket server coordinating all operations
3. **Agent Layer** - Claude Code CLI integration for AI processing
4. **Storage Layer** - File-based persistence for sessions, config, and memory

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
│  ├── config.json                                             │
│  ├── auth.json (tokens)                                      │
│  ├── sessions/*.jsonl                                        │
│  ├── workspace/                                              │
│  │   ├── SOUL.md                                             │
│  │   ├── USER.md                                             │
│  │   └── memory/*.md                                         │
│  └── logs/*.log                                              │
└─────────────────────────────────────────────────────────────┘
```

## Architecture

### Component Responsibilities

**Gateway Server**
- Binds to port 18789 (configurable)
- Accepts WebSocket connections with token authentication
- Routes messages to appropriate handlers
- Manages graceful shutdown

**Session Manager**
- Creates and loads sessions
- Appends messages to JSONL transcripts
- Provides session listing and metadata
- Handles transcript repair

**Memory System**
- Loads bootstrap files (SOUL.md, USER.md)
- Performs hybrid search (BM25 + vector)
- Manages context window limits
- Applies temporal decay and MMR re-ranking

**Agent Runtime**
- Spawns Claude Code CLI subprocess
- Streams responses back to Gateway
- Executes tool calls
- Handles errors and retries

**Tool System**
- Registers core tools (read_file, write_file, list_directory, execute_shell)
- Validates tool parameters
- Executes tools and returns results

**Security Manager**
- Generates and validates auth tokens
- Manages token storage and rotation
- Logs security events

**Config Manager**
- Loads configuration from file and environment
- Validates configuration schema
- Supports hot-reload

### Message Flow

```
1. CLI sends message via WebSocket
2. Gateway authenticates connection
3. Session Manager loads/creates session
4. Memory System retrieves relevant context
5. Agent Runtime invokes Claude Code CLI with:
   - System prompt (SOUL.md + USER.md + context)
   - Session history
   - User message
6. Claude Code CLI streams response
7. If tool call: Tool System executes, returns result
8. Response streamed back to CLI
9. Session Manager appends to transcript
```

## Components and Interfaces

### Gateway Server

```typescript
interface GatewayConfig {
  port: number;           // default: 18789
  host: string;           // default: "127.0.0.1"
  authTokenPath: string;  // default: "~/.openclaw/auth.json"
}

interface GatewayServer {
  start(): Promise<void>;
  stop(): Promise<void>;
  broadcast(event: GatewayEvent): void;
}

interface GatewayEvent {
  type: "message" | "tool_call" | "tool_result" | "error" | "session_update";
  sessionId: string;
  payload: unknown;
  timestamp: number;
}
```

### Session Manager

```typescript
interface Session {
  id: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  transcriptPath: string;
}

interface SessionManager {
  create(): Promise<Session>;
  load(sessionId: string): Promise<Session>;
  list(): Promise<Session[]>;
  appendMessage(sessionId: string, message: TranscriptEntry): Promise<void>;
  getHistory(sessionId: string): Promise<TranscriptEntry[]>;
}

interface TranscriptEntry {
  role: "user" | "assistant" | "tool";
  content: string;
  timestamp: number;
  toolCall?: ToolCall;
  toolResult?: ToolResult;
}
```

### Memory System

```typescript
interface MemoryConfig {
  workspacePath: string;      // default: "~/.openclaw/workspace"
  maxContextTokens: number;   // default: 100000
  temporalDecayHalfLife: number; // days, default: 7
}

interface MemorySystem {
  loadBootstrap(): Promise<string>;
  search(query: string, limit: number): Promise<SearchResult[]>;
  addDocument(path: string, content: string): Promise<void>;
  compact(session: Session): Promise<void>;
}

interface SearchResult {
  path: string;
  content: string;
  score: number;
  timestamp: number;
}
```

### Agent Runtime

```typescript
interface AgentConfig {
  claudeCliPath: string;  // default: "claude"
  model: string;          // default: "claude-sonnet-4-20250514"
  maxTokens: number;      // default: 8192
}

interface AgentRuntime {
  run(params: AgentRunParams): AsyncGenerator<AgentEvent>;
}

interface AgentRunParams {
  sessionId: string;
  systemPrompt: string;
  history: TranscriptEntry[];
  userMessage: string;
  tools: ToolDefinition[];
}

interface AgentEvent {
  type: "text_delta" | "tool_call" | "tool_result" | "done" | "error";
  content?: string;
  toolCall?: ToolCall;
  toolResult?: ToolResult;
  error?: Error;
}
```

### Tool System

```typescript
interface ToolDefinition {
  name: string;
  description: string;
  parameters: JSONSchema;
}

interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

interface ToolResult {
  callId: string;
  success: boolean;
  output?: string;
  error?: string;
}

interface ToolSystem {
  register(tool: ToolDefinition, handler: ToolHandler): void;
  execute(call: ToolCall): Promise<ToolResult>;
  list(): ToolDefinition[];
}

type ToolHandler = (args: Record<string, unknown>) => Promise<string>;
```

### CLI Interface

```typescript
interface CLICommands {
  start: (options: { port?: number; detach?: boolean }) => Promise<void>;
  message: (text: string, options: { session?: string }) => Promise<void>;
  sessions: {
    list: () => Promise<void>;
    show: (sessionId: string) => Promise<void>;
    delete: (sessionId: string) => Promise<void>;
  };
  config: {
    show: () => Promise<void>;
    set: (key: string, value: string) => Promise<void>;
  };
  logs: (options: { follow?: boolean; level?: string }) => Promise<void>;
}
```

## Data Models

### Configuration Schema

```typescript
interface OpenClawConfig {
  gateway: {
    port: number;
    host: string;
  };
  agent: {
    claudeCliPath: string;
    model: string;
    maxTokens: number;
  };
  memory: {
    workspacePath: string;
    maxContextTokens: number;
    temporalDecayHalfLife: number;
  };
  logging: {
    level: "debug" | "info" | "warn" | "error";
    path: string;
    maxSize: number;      // bytes
    maxFiles: number;
  };
}
```

### Transcript Entry Schema (JSONL)

```typescript
// Each line in sessions/*.jsonl
interface TranscriptLine {
  id: string;             // unique message ID
  role: "user" | "assistant" | "tool";
  content: string;
  timestamp: number;      // Unix ms
  toolCall?: {
    id: string;
    name: string;
    arguments: string;    // JSON string
  };
  toolResult?: {
    callId: string;
    success: boolean;
    output: string;
  };
}
```

### Auth Token Schema

```typescript
// ~/.openclaw/auth.json
interface AuthStore {
  token: string;          // 32-byte hex
  createdAt: number;
  rotatedAt?: number;
}
```

### Bootstrap Files

**SOUL.md** - Agent persona and behavior guidelines
```markdown
# Identity
You are OpenClaw, a helpful AI assistant...

# Capabilities
- File operations
- Shell command execution
- Code assistance

# Guidelines
- Be concise and helpful
- Ask for clarification when needed
```

**USER.md** - User profile and preferences
```markdown
# User Profile
Name: [User Name]
Preferences: [User preferences]
```



## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Authentication Token Validation

*For any* authentication token, the Gateway SHALL accept the connection if and only if the token matches the stored token; invalid tokens SHALL be rejected and the rejection SHALL be logged.

**Validates: Requirements 1.2, 10.2, 10.4**

### Property 2: Session ID Uniqueness

*For any* set of created sessions, all session IDs SHALL be unique (no two sessions share the same ID).

**Validates: Requirements 3.1**

### Property 3: Transcript Round-Trip Consistency

*For any* sequence of transcript entries appended to a session, loading that session SHALL reconstruct the exact same sequence of entries (content, role, timestamps, tool calls preserved).

**Validates: Requirements 3.2, 3.3**

### Property 4: Session Metadata Completeness

*For any* session returned by the list operation, the metadata SHALL include a valid ID, creation timestamp, and accurate message count.

**Validates: Requirements 3.4**

### Property 5: Workspace Path Containment

*For any* file created by the system, the file path SHALL be under the configured workspace directory.

**Validates: Requirements 4.1**

### Property 6: Atomic Configuration Writes

*For any* configuration update, the write SHALL be atomic—readers SHALL never observe a partial or corrupted configuration file.

**Validates: Requirements 4.2**

### Property 7: Configuration Override Precedence

*For any* configuration key, if an environment variable is set, its value SHALL override the file-based value; if not set, the file value SHALL override the default.

**Validates: Requirements 4.4, 8.1, 8.3**

### Property 8: Configuration Defaults Completeness

*For any* required configuration setting, a default value SHALL exist such that the system can start with an empty configuration file.

**Validates: Requirements 8.2**

### Property 9: Configuration Validation

*For any* invalid configuration value, the Config_Manager SHALL reject it with a clear error message describing the validation failure.

**Validates: Requirements 8.4**

### Property 10: Bootstrap Context Inclusion

*For any* session start, the prompt context SHALL include the contents of SOUL.md and USER.md bootstrap files.

**Validates: Requirements 5.1**

### Property 11: Memory Search Relevance

*For any* search query, the returned results SHALL be ordered by relevance score (highest first) and limited to the requested count.

**Validates: Requirements 5.2**

### Property 12: Temporal Decay Ordering

*For any* two documents with identical content and relevance, the more recent document SHALL have a higher score than the older document.

**Validates: Requirements 5.4**

### Property 13: MMR Diversity

*For any* search result set of size N > 1, the results SHALL be diverse—no two consecutive results SHALL have similarity above a threshold (0.95).

**Validates: Requirements 5.5**

### Property 14: Context Size Invariant

*For any* session after compaction, the total context size SHALL be within the configured maximum token limit.

**Validates: Requirements 5.3**

### Property 15: Tool Parameter Validation

*For any* tool invocation, if the parameters do not match the tool's JSON schema, the Tool_System SHALL reject the call with a validation error.

**Validates: Requirements 6.2**

### Property 16: Shell Command Output Capture

*For any* shell command execution, the Tool_System SHALL capture and return both stdout and stderr in the result.

**Validates: Requirements 6.3**

### Property 17: Tool Error Structure

*For any* failed tool execution, the returned error SHALL include the tool name, error type, and descriptive message.

**Validates: Requirements 6.4**

### Property 18: Tool Registration Extensibility

*For any* custom tool registered with the Tool_System, invoking that tool by name SHALL execute the registered handler.

**Validates: Requirements 6.5**

### Property 19: Agent Response Parsing Round-Trip

*For any* valid Claude Code CLI response, parsing and re-serializing SHALL produce an equivalent structure (text content and tool calls preserved).

**Validates: Requirements 2.2**

### Property 20: Message Routing Correctness

*For any* message sent to a session, the message SHALL be routed to the Agent_Runtime associated with that session.

**Validates: Requirements 1.3, 2.1**

### Property 21: Tool Execution Flow

*For any* tool call requested by the agent, the Tool_System SHALL execute it and the result SHALL be returned to the agent.

**Validates: Requirements 2.3**

### Property 22: CLI Markdown Formatting

*For any* response containing markdown, the CLI SHALL format code blocks with syntax highlighting and preserve structure.

**Validates: Requirements 7.3**

### Property 23: Structured Log Format

*For any* log entry, the output SHALL be valid JSON containing timestamp, level, message, and context fields.

**Validates: Requirements 9.1**

### Property 24: Log Level Filtering

*For any* log entry, it SHALL only be written if its level is at or above the configured minimum level (error > warn > info > debug).

**Validates: Requirements 9.2**

### Property 25: Error Log Completeness

*For any* error log entry, the output SHALL include a stack trace and relevant context (session ID, operation name).

**Validates: Requirements 9.3**

### Property 26: Token Storage Security

*For any* token file created by the Security_Manager, the file permissions SHALL be 600 (owner read/write only).

**Validates: Requirements 10.3**

## Error Handling

### Gateway Errors

| Error Type | Handling Strategy |
|------------|-------------------|
| Port already in use | Log error, suggest alternative port, exit with code 1 |
| WebSocket connection failure | Log warning, close connection, continue serving |
| Authentication failure | Log attempt with client info, reject connection |
| Fatal error | Log error with stack trace, initiate graceful shutdown |

### Agent Runtime Errors

| Error Type | Handling Strategy |
|------------|-------------------|
| Claude CLI not found | Log error, return user-friendly message about installation |
| Claude CLI timeout | Log warning, return partial response if available |
| Claude CLI error response | Parse error, propagate to session with context |
| Tool execution failure | Return structured error to agent, let it retry or report |

### Storage Errors

| Error Type | Handling Strategy |
|------------|-------------------|
| Disk full | Log error, reject write operations, notify user |
| Permission denied | Log error with path, return clear error message |
| Corrupted transcript | Attempt repair, log issue, continue with recovered data |
| Config parse error | Log error with line number, use defaults |

### Memory System Errors

| Error Type | Handling Strategy |
|------------|-------------------|
| Embedding service unavailable | Fall back to BM25-only search, log warning |
| Search timeout | Return partial results, log warning |
| Compaction failure | Retry once, log error, continue without compaction |

## Testing Strategy

### Dual Testing Approach

This MVP uses both unit tests and property-based tests for comprehensive coverage:

- **Unit tests**: Verify specific examples, edge cases, and error conditions
- **Property tests**: Verify universal properties across all valid inputs

### Property-Based Testing Configuration

- **Library**: fast-check (TypeScript)
- **Minimum iterations**: 100 per property test
- **Tag format**: `Feature: openclaw-mvp, Property {number}: {property_text}`

### Test Categories

**Unit Tests**
- Gateway startup and shutdown
- WebSocket connection handling
- CLI command parsing
- Error message formatting
- File permission checks

**Property Tests**
- Authentication token validation (Property 1)
- Session ID uniqueness (Property 2)
- Transcript round-trip (Property 3)
- Configuration override precedence (Property 7)
- Tool parameter validation (Property 15)
- Log format validation (Property 23)

**Integration Tests**
- End-to-end message flow (CLI → Gateway → Agent → Response)
- Session persistence across Gateway restarts
- Configuration hot-reload
- Graceful shutdown with in-flight requests

### Test File Organization

```
test/
├── unit/
│   ├── gateway.test.ts
│   ├── session-manager.test.ts
│   ├── memory-system.test.ts
│   ├── tool-system.test.ts
│   ├── config-manager.test.ts
│   └── security-manager.test.ts
├── property/
│   ├── auth.property.test.ts
│   ├── session.property.test.ts
│   ├── config.property.test.ts
│   ├── tools.property.test.ts
│   └── logging.property.test.ts
└── integration/
    ├── message-flow.test.ts
    ├── persistence.test.ts
    └── shutdown.test.ts
```

### Mocking Strategy

- **Claude Code CLI**: Mock subprocess for unit tests, real CLI for integration tests
- **File System**: Use temp directories for isolation
- **Time**: Mock timestamps for deterministic tests
- **Network**: Mock WebSocket for unit tests
