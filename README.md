# OpenClaw MVP

A minimal viable implementation of a self-hosted AI assistant to understand how such systems work under the hood.

This is an educational project that demonstrates the core architecture of an AI assistant: a Gateway server coordinating sessions, memory, tools, and an AI backend (Claude Code CLI).

## Architecture

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
│  ├── auth.json            # Auth token                       │
│  ├── sessions/*.jsonl     # Conversation transcripts         │
│  ├── workspace/SOUL.md    # Agent persona                    │
│  ├── workspace/USER.md    # Your profile                     │
│  └── logs/*.log           # Application logs                 │
└─────────────────────────────────────────────────────────────┘
```

## Prerequisites

- Node.js 18+
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated

## Quick Start

```bash
# Install dependencies
npm install

# Build
npm run build

# Start the gateway (Terminal 1)
node dist/cli/index.js start

# Send a message (Terminal 2)
node dist/cli/index.js message "Hello, can you help me?"
```

## CLI Commands

```bash
# Start the gateway server
node dist/cli/index.js start
node dist/cli/index.js start --port 8080

# Send messages
node dist/cli/index.js message "Your question here"
node dist/cli/index.js message --session <id> "Continue conversation"

# Manage sessions
node dist/cli/index.js sessions list
node dist/cli/index.js sessions show <id>
node dist/cli/index.js sessions delete <id>

# View/edit configuration
node dist/cli/index.js config show
node dist/cli/index.js config set gateway.port 8080

# View logs
node dist/cli/index.js logs
node dist/cli/index.js logs --follow
node dist/cli/index.js logs --level error
```

## Install Globally (Optional)

```bash
npm link
openclaw start
openclaw message "Hello"
```

## Run the Demo

```bash
# Component demo - shows all parts working
npm run demo

# Gateway demo - shows WebSocket server flow
npm run demo:gateway
```

## Project Structure

```
src/
├── cli/           # Command-line interface
├── gateway/       # WebSocket server
├── agent/         # Claude CLI integration
├── session/       # Conversation management
├── memory/        # BM25 search, context retrieval
├── security/      # Token auth
├── config/        # Configuration management
├── logging/       # Structured JSON logging
├── storage/       # Workspace file management
└── tools/         # File ops, shell commands
```

## Key Components

| Component | Purpose |
|-----------|---------|
| Gateway | WebSocket server coordinating all operations |
| Session Manager | Creates sessions, stores transcripts as JSONL |
| Memory System | BM25 keyword search, loads SOUL.md/USER.md |
| Agent Runtime | Spawns Claude CLI, streams responses |
| Tool System | read_file, write_file, list_directory, execute_shell |
| Security Manager | Token generation and validation |
| Config Manager | JSON config with env var overrides |

## Customization

Edit `~/.openclaw/workspace/SOUL.md` to change the agent's persona:

```markdown
# Identity
You are OpenClaw, a helpful AI assistant.

# Capabilities
- File operations
- Code assistance
- Shell commands

# Guidelines
- Be concise and helpful
```

Edit `~/.openclaw/workspace/USER.md` to add your preferences:

```markdown
# User Profile
Name: Your Name
Preferences: Concise responses, TypeScript focus
```

## Running Tests

```bash
npm test
```

## License

MIT
