# Implementation Plan: OpenClaw MVP

## Overview

This implementation plan breaks down the OpenClaw MVP into incremental coding tasks. Each task builds on previous work, with property tests validating correctness at each stage. The implementation uses TypeScript with strict ESM modules.

## Tasks

- [x] 1. Project setup and core infrastructure
  - [x] 1.1 Initialize TypeScript project with ESM configuration
    - Create package.json with type: "module"
    - Configure tsconfig.json with strict mode
    - Set up vitest and fast-check for testing
    - _Requirements: N/A (infrastructure)_

  - [x] 1.2 Implement workspace directory structure
    - Create Workspace class to manage ~/.openclaw/ directory
    - Implement directory creation with proper permissions
    - Add path resolution helpers
    - _Requirements: 4.1, 4.3, 4.5_

  - [x]* 1.3 Write property test for workspace path containment
    - **Property 5: Workspace Path Containment**
    - **Validates: Requirements 4.1**

- [-] 2. Configuration management
  - [x] 2.1 Implement ConfigManager with defaults and validation
    - Define configuration schema with Zod
    - Implement default values for all settings
    - Add validation with clear error messages
    - _Requirements: 8.2, 8.4_

  - [x] 2.2 Implement atomic file writes for configuration
    - Write to temp file, then rename
    - Handle concurrent access safely
    - _Requirements: 4.2_

  - [ ]* 2.3 Write property test for atomic configuration writes
    - **Property 6: Atomic Configuration Writes**
    - **Validates: Requirements 4.2**

  - [x] 2.4 Implement configuration merging (defaults → file → env)
    - Load from JSON file
    - Override with environment variables
    - Merge with defaults
    - _Requirements: 4.4, 8.1, 8.3_

  - [ ]* 2.5 Write property test for configuration override precedence
    - **Property 7: Configuration Override Precedence**
    - **Validates: Requirements 4.4, 8.1, 8.3**

  - [ ]* 2.6 Write property test for configuration defaults completeness
    - **Property 8: Configuration Defaults Completeness**
    - **Validates: Requirements 8.2**

  - [ ]* 2.7 Write property test for configuration validation
    - **Property 9: Configuration Validation**
    - **Validates: Requirements 8.4**

- [x] 3. Checkpoint - Configuration complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Logging system
  - [x] 4.1 Implement structured JSON logger
    - Create Logger class with level filtering
    - Output JSON with timestamp, level, message, context
    - Support configurable output path
    - _Requirements: 9.1, 9.2_

  - [ ]* 4.2 Write property test for structured log format
    - **Property 23: Structured Log Format**
    - **Validates: Requirements 9.1**

  - [ ]* 4.3 Write property test for log level filtering
    - **Property 24: Log Level Filtering**
    - **Validates: Requirements 9.2**

  - [x] 4.4 Implement error logging with stack traces
    - Include stack trace for error level
    - Add context (session ID, operation)
    - _Requirements: 9.3_

  - [ ]* 4.5 Write property test for error log completeness
    - **Property 25: Error Log Completeness**
    - **Validates: Requirements 9.3**

  - [x] 4.6 Implement log rotation
    - Rotate based on file size
    - Keep configurable number of old files
    - _Requirements: 9.4_

- [-] 5. Security manager
  - [x] 5.1 Implement token generation and storage
    - Generate 32-byte hex tokens
    - Store in auth.json with 600 permissions
    - _Requirements: 10.1, 10.3_

  - [ ]* 5.2 Write property test for token storage security
    - **Property 26: Token Storage Security**
    - **Validates: Requirements 10.3**

  - [x] 5.3 Implement token validation
    - Compare provided token with stored token
    - Log validation attempts
    - _Requirements: 10.2, 10.4_

  - [ ]* 5.4 Write property test for authentication token validation
    - **Property 1: Authentication Token Validation**
    - **Validates: Requirements 1.2, 10.2, 10.4**

  - [x] 5.5 Implement token rotation
    - Generate new token
    - Update stored token
    - _Requirements: 10.5_

- [x] 6. Checkpoint - Security complete
  - Ensure all tests pass, ask the user if questions arise.

- [-] 7. Session management
  - [x] 7.1 Implement session creation with unique IDs
    - Generate UUID-based session IDs
    - Create transcript file
    - Store session metadata
    - _Requirements: 3.1_

  - [ ]* 7.2 Write property test for session ID uniqueness
    - **Property 2: Session ID Uniqueness**
    - **Validates: Requirements 3.1**

  - [x] 7.3 Implement transcript append and load
    - Append entries as JSONL
    - Load and parse transcript file
    - Handle malformed entries gracefully
    - _Requirements: 3.2, 3.3_

  - [ ]* 7.4 Write property test for transcript round-trip consistency
    - **Property 3: Transcript Round-Trip Consistency**
    - **Validates: Requirements 3.2, 3.3**

  - [x] 7.5 Implement session listing with metadata
    - Return ID, creation time, message count
    - Sort by most recent
    - _Requirements: 3.4_

  - [ ]* 7.6 Write property test for session metadata completeness
    - **Property 4: Session Metadata Completeness**
    - **Validates: Requirements 3.4**

  - [x] 7.7 Implement transcript repair for corrupted files
    - Detect and skip malformed lines
    - Log repair actions
    - _Requirements: 3.5_

- [x] 8. Checkpoint - Sessions complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Tool system
  - [x] 9.1 Implement tool registry and schema validation
    - Define ToolDefinition interface
    - Validate parameters against JSON schema
    - _Requirements: 6.2_

  - [ ]* 9.2 Write property test for tool parameter validation
    - **Property 15: Tool Parameter Validation**
    - **Validates: Requirements 6.2**

  - [x] 9.3 Implement core tools (read_file, write_file, list_directory)
    - read_file: Read file contents
    - write_file: Write content to file
    - list_directory: List directory contents
    - _Requirements: 6.1_

  - [x] 9.4 Implement execute_shell tool
    - Spawn subprocess
    - Capture stdout and stderr
    - Handle timeouts
    - _Requirements: 6.3_

  - [ ]* 9.5 Write property test for shell command output capture
    - **Property 16: Shell Command Output Capture**
    - **Validates: Requirements 6.3**

  - [x] 9.6 Implement tool error handling
    - Return structured errors
    - Include tool name, error type, message
    - _Requirements: 6.4_

  - [ ]* 9.7 Write property test for tool error structure
    - **Property 17: Tool Error Structure**
    - **Validates: Requirements 6.4**

  - [x] 9.8 Implement tool registration for extensibility
    - Allow registering custom tools
    - Invoke by name
    - _Requirements: 6.5_

  - [ ]* 9.9 Write property test for tool registration extensibility
    - **Property 18: Tool Registration Extensibility**
    - **Validates: Requirements 6.5**

- [x] 10. Checkpoint - Tools complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Memory system
  - [x] 11.1 Implement bootstrap file loading
    - Load SOUL.md and USER.md
    - Include in prompt context
    - _Requirements: 5.1_

  - [ ]* 11.2 Write property test for bootstrap context inclusion
    - **Property 10: Bootstrap Context Inclusion**
    - **Validates: Requirements 5.1**

  - [x] 11.3 Implement BM25 keyword search
    - Index workspace markdown files
    - Search with BM25 scoring
    - _Requirements: 5.2_

  - [x] 11.4 Implement temporal decay for search results
    - Apply decay based on document age
    - Recent documents score higher
    - _Requirements: 5.4_

  - [ ]* 11.5 Write property test for temporal decay ordering
    - **Property 12: Temporal Decay Ordering**
    - **Validates: Requirements 5.4**

  - [x] 11.6 Implement MMR re-ranking for diversity
    - Re-rank results to reduce redundancy
    - Ensure diversity in top results
    - _Requirements: 5.5_

  - [ ]* 11.7 Write property test for MMR diversity
    - **Property 13: MMR Diversity**
    - **Validates: Requirements 5.5**

  - [ ]* 11.8 Write property test for memory search relevance
    - **Property 11: Memory Search Relevance**
    - **Validates: Requirements 5.2**

  - [x] 11.9 Implement context compaction
    - Summarize older messages when context exceeds limit
    - Flush important facts to disk
    - _Requirements: 5.3_

  - [ ]* 11.10 Write property test for context size invariant
    - **Property 14: Context Size Invariant**
    - **Validates: Requirements 5.3**

- [x] 12. Checkpoint - Memory complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 13. Agent runtime
  - [x] 13.1 Implement Claude Code CLI integration
    - Spawn claude CLI subprocess
    - Pass system prompt, history, user message
    - _Requirements: 2.1_

  - [x] 13.2 Implement response parsing
    - Parse text and tool calls from CLI output
    - Handle streaming responses
    - _Requirements: 2.2_

  - [ ]* 13.3 Write property test for agent response parsing round-trip
    - **Property 19: Agent Response Parsing Round-Trip**
    - **Validates: Requirements 2.2**

  - [x] 13.4 Implement tool call execution flow
    - Execute tool calls via Tool System
    - Return results to agent
    - _Requirements: 2.3_

  - [ ]* 13.5 Write property test for tool execution flow
    - **Property 21: Tool Execution Flow**
    - **Validates: Requirements 2.3**

  - [x] 13.6 Implement error propagation
    - Propagate CLI errors to session
    - Include context in error messages
    - _Requirements: 2.4_

  - [x] 13.7 Implement response streaming
    - Stream partial responses to client
    - Handle backpressure
    - _Requirements: 2.5_

- [x] 14. Checkpoint - Agent runtime complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 15. Gateway server
  - [x] 15.1 Implement WebSocket server
    - Bind to configurable port
    - Accept WebSocket connections
    - _Requirements: 1.1_

  - [x] 15.2 Implement connection authentication
    - Validate token on connection
    - Reject invalid tokens
    - _Requirements: 1.2_

  - [x] 15.3 Implement message routing
    - Route messages to sessions
    - Dispatch to Agent Runtime
    - _Requirements: 1.3_

  - [ ]* 15.4 Write property test for message routing correctness
    - **Property 20: Message Routing Correctness**
    - **Validates: Requirements 1.3, 2.1**

  - [x] 15.5 Implement graceful shutdown
    - Complete in-flight requests
    - Close connections cleanly
    - _Requirements: 1.4, 1.5_

  - [x] 15.6 Implement configuration hot-reload
    - Watch config file for changes
    - Apply changes without restart
    - _Requirements: 8.5_

- [x] 16. Checkpoint - Gateway complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 17. CLI interface
  - [x] 17.1 Implement CLI framework with commander
    - Set up command structure
    - Add help and version commands
    - _Requirements: 7.1_

  - [x] 17.2 Implement start command
    - Start Gateway process
    - Support --port and --detach flags
    - _Requirements: 7.1_

  - [x] 17.3 Implement message command
    - Connect to Gateway via WebSocket
    - Send message and stream response
    - Support --session flag
    - _Requirements: 7.2, 7.4_

  - [x] 17.4 Implement sessions commands
    - List sessions with metadata
    - Show session details
    - Delete sessions
    - _Requirements: 7.1_

  - [x] 17.5 Implement config commands
    - Show current configuration
    - Set configuration values
    - _Requirements: 7.1_

  - [x] 17.6 Implement logs command
    - Tail log files
    - Filter by level
    - Support --follow flag
    - _Requirements: 9.5_

  - [x] 17.7 Implement markdown formatting for terminal
    - Format code blocks with highlighting
    - Handle headers, lists, emphasis
    - _Requirements: 7.3_

  - [ ]* 17.8 Write property test for CLI markdown formatting
    - **Property 22: CLI Markdown Formatting**
    - **Validates: Requirements 7.3**

  - [x] 17.9 Implement Gateway connection error handling
    - Detect when Gateway is not running
    - Display helpful error message
    - _Requirements: 7.5_

- [x] 18. Final checkpoint - All components integrated
  - Ensure all tests pass, ask the user if questions arise.

- [x] 19. Integration and wiring
  - [x] 19.1 Wire all components together
    - Connect CLI → Gateway → Agent → Storage
    - Ensure end-to-end message flow works
    - _Requirements: All_

  - [x]* 19.2 Write integration tests
    - Test complete message flow
    - Test session persistence across restarts
    - Test graceful shutdown
    - _Requirements: All_

- [x] 20. Final checkpoint - MVP complete
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
