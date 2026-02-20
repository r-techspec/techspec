import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Logger } from '../logging/logger.js';
import { ToolSystem, type ToolCall, type ToolResult, type ToolDefinition } from '../tools/tool-system.js';
import type { TranscriptEntry } from '../session/session-manager.js';

/**
 * Agent runtime configuration
 * Requirement 2.1: Interface with Claude Code CLI
 */
export interface AgentConfig {
  claudeCliPath: string;
  model: string;
  maxTokens: number;
}

/**
 * Default agent configuration
 */
export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  claudeCliPath: 'claude',
  model: 'sonnet',
  maxTokens: 8192,
};

/**
 * Parameters for running the agent
 */
export interface AgentRunParams {
  sessionId: string;
  systemPrompt: string;
  history: TranscriptEntry[];
  userMessage: string;
  tools: ToolDefinition[];
}

/**
 * Agent event types for streaming responses
 * Requirement 2.2: Parse response and extract text and tool calls
 * Requirement 2.5: Stream partial responses
 */
export interface AgentTextDeltaEvent {
  type: 'text_delta';
  content: string;
}

export interface AgentToolCallEvent {
  type: 'tool_call';
  toolCall: ToolCall;
}

export interface AgentToolResultEvent {
  type: 'tool_result';
  toolResult: ToolResult;
}

export interface AgentDoneEvent {
  type: 'done';
  fullResponse: string;
}

export interface AgentErrorEvent {
  type: 'error';
  error: AgentError;
}

export type AgentEvent = 
  | AgentTextDeltaEvent 
  | AgentToolCallEvent 
  | AgentToolResultEvent 
  | AgentDoneEvent 
  | AgentErrorEvent;

/**
 * Structured agent error
 * Requirement 2.4: Propagate CLI errors with context
 */
export interface AgentError {
  code: 'cli_not_found' | 'cli_error' | 'parse_error' | 'timeout' | 'tool_error';
  message: string;
  sessionId: string;
  details?: unknown;
}

/**
 * Parsed response from Claude CLI
 */
export interface ParsedResponse {
  text: string;
  toolCalls: ToolCall[];
}

/**
 * AgentRuntime - Manages Claude Code CLI integration and tool execution
 * 
 * Requirements:
 * - 2.1: Format message as prompt and invoke Claude Code CLI
 * - 2.2: Parse response and extract text and tool calls
 * - 2.3: Execute tool calls and return results
 * - 2.4: Propagate CLI errors with context
 * - 2.5: Stream partial responses to client
 */
export class AgentRuntime {
  private config: AgentConfig;
  private toolSystem: ToolSystem;
  private logger: Logger;

  constructor(
    toolSystem: ToolSystem,
    config: Partial<AgentConfig> = {},
    logger?: Logger
  ) {
    this.config = { ...DEFAULT_AGENT_CONFIG, ...config };
    this.toolSystem = toolSystem;
    this.logger = logger ?? new Logger({ level: 'info', path: 'openclaw.log', maxSize: 10485760, maxFiles: 5 });
  }

  /**
   * Gets the current configuration
   */
  getConfig(): AgentConfig {
    return { ...this.config };
  }

  /**
   * Formats conversation history for Claude CLI
   */
  formatHistory(history: TranscriptEntry[]): string {
    return history.map(entry => {
      if (entry.role === 'tool') {
        return `[Tool Result: ${entry.toolResult?.output ?? entry.content}]`;
      }
      const prefix = entry.role === 'user' ? 'Human' : 'Assistant';
      return `${prefix}: ${entry.content}`;
    }).join('\n\n');
  }

  /**
   * Formats tools for Claude CLI
   */
  formatTools(tools: ToolDefinition[]): string {
    if (tools.length === 0) return '';
    
    const toolDescriptions = tools.map(tool => {
      const params = tool.parameters.properties 
        ? Object.entries(tool.parameters.properties)
            .map(([name, prop]) => `  - ${name}: ${prop.description ?? prop.type}`)
            .join('\n')
        : '';
      return `- ${tool.name}: ${tool.description}\n${params}`;
    }).join('\n\n');

    return `\nAvailable tools:\n${toolDescriptions}`;
  }

  /**
   * Builds the full prompt for Claude CLI
   * Requirement 2.1: Format message as prompt
   */
  buildPrompt(params: AgentRunParams): string {
    const parts: string[] = [];

    // System prompt
    if (params.systemPrompt) {
      parts.push(params.systemPrompt);
    }

    // Tools
    const toolsSection = this.formatTools(params.tools);
    if (toolsSection) {
      parts.push(toolsSection);
    }

    // History
    if (params.history.length > 0) {
      parts.push('\nConversation history:');
      parts.push(this.formatHistory(params.history));
    }

    // Current message
    parts.push(`\nHuman: ${params.userMessage}`);
    parts.push('\nAssistant:');

    return parts.join('\n');
  }

  /**
   * Spawns Claude CLI subprocess
   * Requirement 2.1: Invoke Claude Code CLI
   */
  spawnClaude(prompt: string): ChildProcess {
    const args = [
      '--print',
      '--model', this.config.model,
    ];

    const child = spawn(this.config.claudeCliPath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Write prompt to stdin and close it
    if (child.stdin) {
      child.stdin.write(prompt);
      child.stdin.end();
    }

    return child;
  }

  /**
   * Parses Claude CLI output to extract text and tool calls
   * Requirement 2.2: Parse response and extract text and tool calls
   */
  parseResponse(output: string): ParsedResponse {
    const toolCalls: ToolCall[] = [];
    let text = output;

    // Look for tool call patterns: <tool_call name="tool_name">{"arg": "value"}</tool_call>
    const toolCallRegex = /<tool_call\s+name="([^"]+)">([\s\S]*?)<\/tool_call>/g;
    let match;

    while ((match = toolCallRegex.exec(output)) !== null) {
      const [fullMatch, toolName, argsJson] = match;
      if (!toolName || !argsJson) continue;

      try {
        const args = JSON.parse(argsJson.trim()) as Record<string, unknown>;
        toolCalls.push({
          id: randomUUID(),
          name: toolName,
          arguments: args,
        });
        // Remove tool call from text
        text = text.replace(fullMatch, '');
      } catch {
        // Invalid JSON in tool call, keep as text
        this.logger.warn('Failed to parse tool call arguments', { toolName, argsJson }).catch(() => {});
      }
    }

    // Also support JSON-style tool calls: {"tool": "name", "arguments": {...}}
    const jsonToolRegex = /\{"tool":\s*"([^"]+)",\s*"arguments":\s*(\{[^}]+\})\}/g;
    while ((match = jsonToolRegex.exec(output)) !== null) {
      const [fullMatch, toolName, argsJson] = match;
      if (!toolName || !argsJson) continue;

      try {
        const args = JSON.parse(argsJson) as Record<string, unknown>;
        toolCalls.push({
          id: randomUUID(),
          name: toolName,
          arguments: args,
        });
        text = text.replace(fullMatch, '');
      } catch {
        // Invalid JSON, keep as text
      }
    }

    return {
      text: text.trim(),
      toolCalls,
    };
  }

  /**
   * Runs the agent with streaming response
   * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5
   */
  async *run(params: AgentRunParams): AsyncGenerator<AgentEvent> {
    const { sessionId } = params;

    await this.logger.info('Starting agent run', { sessionId, model: this.config.model });

    // Build prompt
    const prompt = this.buildPrompt(params);

    // Spawn Claude CLI
    let child: ChildProcess;
    try {
      child = this.spawnClaude(prompt);
    } catch (error) {
      const agentError: AgentError = {
        code: 'cli_not_found',
        message: `Failed to spawn Claude CLI: ${error instanceof Error ? error.message : String(error)}`,
        sessionId,
        details: error,
      };
      await this.logger.error('Failed to spawn Claude CLI', error, { sessionId });
      yield { type: 'error', error: agentError };
      return;
    }

    // Collect output with streaming
    let fullOutput = '';
    let stderr = '';

    // Stream stdout
    if (child.stdout) {
      for await (const chunk of child.stdout) {
        const text = chunk.toString();
        fullOutput += text;
        
        // Emit text delta for streaming
        // Requirement 2.5: Stream partial responses
        yield { type: 'text_delta', content: text };
      }
    }

    // Collect stderr
    if (child.stderr) {
      for await (const chunk of child.stderr) {
        stderr += chunk.toString();
      }
    }

    // Wait for process to exit
    const exitCode = await new Promise<number | null>((resolve) => {
      child.on('close', resolve);
      child.on('error', () => resolve(null));
    });

    // Handle CLI errors
    // Requirement 2.4: Propagate CLI errors with context
    if (exitCode !== 0 || stderr) {
      if (stderr && !fullOutput) {
        const agentError: AgentError = {
          code: 'cli_error',
          message: stderr || `Claude CLI exited with code ${exitCode}`,
          sessionId,
          details: { exitCode, stderr },
        };
        await this.logger.error('Claude CLI error', new Error(stderr), { sessionId, exitCode });
        yield { type: 'error', error: agentError };
        return;
      }
      // Log warning but continue if we have output
      await this.logger.warn('Claude CLI stderr', { sessionId, stderr });
    }

    // Parse response
    // Requirement 2.2: Parse response and extract text and tool calls
    let parsed: ParsedResponse;
    try {
      parsed = this.parseResponse(fullOutput);
    } catch (error) {
      const agentError: AgentError = {
        code: 'parse_error',
        message: `Failed to parse Claude response: ${error instanceof Error ? error.message : String(error)}`,
        sessionId,
        details: { output: fullOutput, error },
      };
      await this.logger.error('Failed to parse response', error, { sessionId });
      yield { type: 'error', error: agentError };
      return;
    }

    // Execute tool calls
    // Requirement 2.3: Execute tool calls and return results
    for (const toolCall of parsed.toolCalls) {
      yield { type: 'tool_call', toolCall };

      const result = await this.toolSystem.execute(toolCall);
      yield { type: 'tool_result', toolResult: result };

      // If tool failed, log it
      if (!result.success) {
        await this.logger.warn('Tool execution failed', { 
          sessionId, 
          toolName: toolCall.name,
          error: result.error 
        });
      }
    }

    // Done
    await this.logger.info('Agent run completed', { 
      sessionId, 
      responseLength: parsed.text.length,
      toolCallCount: parsed.toolCalls.length 
    });

    yield { type: 'done', fullResponse: parsed.text };
  }

  /**
   * Executes a single tool call
   * Requirement 2.3: Execute tool calls via Tool System
   */
  async executeTool(toolCall: ToolCall): Promise<ToolResult> {
    return this.toolSystem.execute(toolCall);
  }
}
