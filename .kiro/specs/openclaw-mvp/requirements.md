# Requirements Document

## Introduction

OpenClaw MVP is a minimal viable product implementation of a self-hosted, single-user AI assistant. The MVP focuses on core functionality: a Gateway process that coordinates message handling, a single AI agent runtime (Claude Code CLI), file-based memory/storage, and a CLI interface for interaction. This MVP excludes external messaging platform adapters (Telegram, WhatsApp, etc.) and focuses on local CLI-based interaction only.

## Glossary

- **Gateway**: The central orchestration process that manages agent sessions, memory, and message routing
- **Agent_Runtime**: The component that interfaces with AI models (Claude Code CLI) to process messages and execute tools
- **Session**: A conversation context with append-only transcript storage
- **Memory_System**: The hybrid search system combining BM25 keyword search and vector embeddings for context retrieval
- **Workspace**: The file-based storage directory (~/.openclaw/) containing configuration, transcripts, and knowledge files
- **Tool**: A function the AI agent can invoke to perform actions (file operations, shell commands, etc.)
- **Bootstrap_Files**: Core persona files (SOUL.md, USER.md) loaded into every prompt
- **Transcript**: JSONL file storing conversation history for a session

## Requirements

### Requirement 1: Gateway Process

**User Story:** As a user, I want a single long-running Gateway process, so that I can interact with my AI assistant through a unified interface.

#### Acceptance Criteria

1. WHEN the Gateway starts, THE Gateway SHALL bind to a configurable port (default 18789) and accept WebSocket connections
2. WHEN a client connects via WebSocket, THE Gateway SHALL authenticate the connection using a local token
3. WHILE the Gateway is running, THE Gateway SHALL maintain session state and route messages to the Agent_Runtime
4. IF the Gateway encounters a fatal error, THEN THE Gateway SHALL log the error and attempt graceful shutdown
5. WHEN the Gateway receives a shutdown signal, THE Gateway SHALL complete in-flight requests before terminating

### Requirement 2: Agent Runtime Integration

**User Story:** As a user, I want the system to use Claude Code CLI as the AI backend, so that I can leverage Claude's capabilities for coding assistance.

#### Acceptance Criteria

1. WHEN a message is received, THE Agent_Runtime SHALL format it as a prompt and invoke Claude Code CLI
2. WHEN Claude Code CLI returns a response, THE Agent_Runtime SHALL parse the response and extract text and tool calls
3. WHEN a tool call is requested, THE Agent_Runtime SHALL execute the tool and return results to Claude Code CLI
4. IF Claude Code CLI returns an error, THEN THE Agent_Runtime SHALL propagate the error to the session with context
5. WHILE processing a message, THE Agent_Runtime SHALL stream partial responses to the client

### Requirement 3: Session Management

**User Story:** As a user, I want persistent conversation sessions, so that context is maintained across interactions.

#### Acceptance Criteria

1. WHEN a new session is created, THE Session_Manager SHALL generate a unique session ID and create a transcript file
2. WHEN a message is sent, THE Session_Manager SHALL append it to the session transcript in JSONL format
3. WHEN a session is loaded, THE Session_Manager SHALL reconstruct conversation history from the transcript file
4. WHEN listing sessions, THE Session_Manager SHALL return session metadata including ID, creation time, and message count
5. IF a transcript file is corrupted, THEN THE Session_Manager SHALL attempt repair and log the issue

### Requirement 4: File-Based Storage

**User Story:** As a user, I want all data stored in local files, so that I have full control and portability of my data.

#### Acceptance Criteria

1. THE Workspace SHALL store all data under a configurable directory (default ~/.openclaw/)
2. WHEN configuration is updated, THE Config_Manager SHALL write changes atomically using temp file + rename
3. THE Workspace SHALL organize files as: config.json, sessions/*.jsonl, workspace/SOUL.md, workspace/USER.md, workspace/memory/*.md
4. WHEN reading configuration, THE Config_Manager SHALL merge defaults with user overrides
5. IF the workspace directory does not exist, THEN THE Workspace SHALL create it with appropriate permissions

### Requirement 5: Memory and Context Retrieval

**User Story:** As a user, I want the assistant to remember relevant information from past conversations, so that it can provide contextual responses.

#### Acceptance Criteria

1. WHEN a session starts, THE Memory_System SHALL load bootstrap files (SOUL.md, USER.md) into the prompt context
2. WHEN a message is processed, THE Memory_System SHALL search for relevant context using hybrid BM25 + vector search
3. WHEN context exceeds the model's limit, THE Memory_System SHALL summarize older messages and flush important facts to disk
4. THE Memory_System SHALL apply temporal decay to search results, prioritizing recent information
5. THE Memory_System SHALL use MMR re-ranking to diversify retrieved context and avoid redundancy

### Requirement 6: Tool System

**User Story:** As a user, I want the AI to execute tools on my behalf, so that it can perform useful actions like file operations and shell commands.

#### Acceptance Criteria

1. THE Tool_System SHALL provide core tools: read_file, write_file, list_directory, execute_shell
2. WHEN a tool is invoked, THE Tool_System SHALL validate parameters against the tool's schema
3. WHEN execute_shell is called, THE Tool_System SHALL run the command and capture stdout/stderr
4. IF a tool execution fails, THEN THE Tool_System SHALL return a structured error with details
5. THE Tool_System SHALL support tool registration for extensibility

### Requirement 7: CLI Interface

**User Story:** As a user, I want to interact with the assistant via command line, so that I can use it in my terminal workflow.

#### Acceptance Criteria

1. THE CLI SHALL provide commands: start (gateway), message (send message), sessions (list/manage), config (view/edit)
2. WHEN the user sends a message via CLI, THE CLI SHALL connect to the Gateway and stream the response
3. WHEN displaying responses, THE CLI SHALL format markdown and code blocks appropriately for terminal output
4. THE CLI SHALL support --session flag to specify or create a session
5. IF the Gateway is not running, THEN THE CLI SHALL display a helpful error message

### Requirement 8: Configuration Management

**User Story:** As a user, I want to configure the assistant's behavior, so that I can customize it to my needs.

#### Acceptance Criteria

1. THE Config_Manager SHALL support configuration via JSON file and environment variables
2. THE Config_Manager SHALL provide defaults for all required settings
3. WHEN environment variables are set, THE Config_Manager SHALL override file-based configuration
4. THE Config_Manager SHALL validate configuration on load and report errors clearly
5. THE Config_Manager SHALL support hot-reload of configuration without Gateway restart

### Requirement 9: Logging and Observability

**User Story:** As a user, I want comprehensive logging, so that I can debug issues and understand system behavior.

#### Acceptance Criteria

1. THE Logger SHALL write structured JSON logs to a configurable location
2. THE Logger SHALL support log levels: debug, info, warn, error
3. WHEN an error occurs, THE Logger SHALL include stack traces and context
4. THE Logger SHALL rotate log files based on size or time
5. THE CLI SHALL provide a logs command to tail and filter logs

### Requirement 10: Security

**User Story:** As a user, I want secure access to my assistant, so that unauthorized users cannot interact with it.

#### Acceptance Criteria

1. WHEN the Gateway starts for the first time, THE Security_Manager SHALL generate a local authentication token
2. WHEN a client connects, THE Security_Manager SHALL validate the authentication token
3. THE Security_Manager SHALL store tokens securely with appropriate file permissions (600)
4. IF an invalid token is provided, THEN THE Security_Manager SHALL reject the connection and log the attempt
5. THE Security_Manager SHALL support token rotation via CLI command
