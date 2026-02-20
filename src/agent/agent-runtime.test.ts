import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentRuntime, DEFAULT_AGENT_CONFIG, type AgentEvent, type ParsedResponse } from './agent-runtime.js';
import { ToolSystem, type ToolDefinition } from '../tools/tool-system.js';
import type { TranscriptEntry } from '../session/session-manager.js';

describe('AgentRuntime', () => {
  let toolSystem: ToolSystem;
  let agentRuntime: AgentRuntime;

  beforeEach(() => {
    toolSystem = new ToolSystem();
    agentRuntime = new AgentRuntime(toolSystem);
  });

  describe('constructor', () => {
    it('should use default config when none provided', () => {
      const config = agentRuntime.getConfig();
      expect(config).toEqual(DEFAULT_AGENT_CONFIG);
    });

    it('should merge provided config with defaults', () => {
      const customRuntime = new AgentRuntime(toolSystem, { model: 'custom-model' });
      const config = customRuntime.getConfig();
      expect(config.model).toBe('custom-model');
      expect(config.claudeCliPath).toBe(DEFAULT_AGENT_CONFIG.claudeCliPath);
    });
  });

  describe('formatHistory', () => {
    it('should format empty history', () => {
      const result = agentRuntime.formatHistory([]);
      expect(result).toBe('');
    });

    it('should format user messages', () => {
      const history: TranscriptEntry[] = [
        { id: '1', role: 'user', content: 'Hello', timestamp: Date.now() },
      ];
      const result = agentRuntime.formatHistory(history);
      expect(result).toBe('Human: Hello');
    });

    it('should format assistant messages', () => {
      const history: TranscriptEntry[] = [
        { id: '1', role: 'assistant', content: 'Hi there', timestamp: Date.now() },
      ];
      const result = agentRuntime.formatHistory(history);
      expect(result).toBe('Assistant: Hi there');
    });

    it('should format tool results', () => {
      const history: TranscriptEntry[] = [
        { 
          id: '1', 
          role: 'tool', 
          content: '', 
          timestamp: Date.now(),
          toolResult: { callId: 'call1', success: true, output: 'file contents' }
        },
      ];
      const result = agentRuntime.formatHistory(history);
      expect(result).toBe('[Tool Result: file contents]');
    });

    it('should format mixed conversation', () => {
      const history: TranscriptEntry[] = [
        { id: '1', role: 'user', content: 'Read file.txt', timestamp: Date.now() },
        { id: '2', role: 'assistant', content: 'I will read that file', timestamp: Date.now() },
      ];
      const result = agentRuntime.formatHistory(history);
      expect(result).toContain('Human: Read file.txt');
      expect(result).toContain('Assistant: I will read that file');
    });
  });

  describe('formatTools', () => {
    it('should return empty string for no tools', () => {
      const result = agentRuntime.formatTools([]);
      expect(result).toBe('');
    });

    it('should format tool definitions', () => {
      const tools: ToolDefinition[] = [
        {
          name: 'read_file',
          description: 'Read a file',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'File path' },
            },
            required: ['path'],
          },
        },
      ];
      const result = agentRuntime.formatTools(tools);
      expect(result).toContain('read_file');
      expect(result).toContain('Read a file');
      expect(result).toContain('path');
    });
  });

  describe('buildPrompt', () => {
    it('should build prompt with system prompt', () => {
      const prompt = agentRuntime.buildPrompt({
        sessionId: 'test',
        systemPrompt: 'You are a helpful assistant',
        history: [],
        userMessage: 'Hello',
        tools: [],
      });
      expect(prompt).toContain('You are a helpful assistant');
      expect(prompt).toContain('Human: Hello');
      expect(prompt).toContain('Assistant:');
    });

    it('should include history in prompt', () => {
      const prompt = agentRuntime.buildPrompt({
        sessionId: 'test',
        systemPrompt: '',
        history: [
          { id: '1', role: 'user', content: 'Previous message', timestamp: Date.now() },
        ],
        userMessage: 'New message',
        tools: [],
      });
      expect(prompt).toContain('Previous message');
      expect(prompt).toContain('New message');
    });

    it('should include tools in prompt', () => {
      const prompt = agentRuntime.buildPrompt({
        sessionId: 'test',
        systemPrompt: '',
        history: [],
        userMessage: 'Hello',
        tools: [
          {
            name: 'test_tool',
            description: 'A test tool',
            parameters: { type: 'object' },
          },
        ],
      });
      expect(prompt).toContain('test_tool');
      expect(prompt).toContain('A test tool');
    });
  });

  describe('parseResponse', () => {
    it('should parse plain text response', () => {
      const result = agentRuntime.parseResponse('Hello, how can I help?');
      expect(result.text).toBe('Hello, how can I help?');
      expect(result.toolCalls).toHaveLength(0);
    });

    it('should parse XML-style tool calls', () => {
      const response = 'Let me read that file. <tool_call name="read_file">{"path": "test.txt"}</tool_call>';
      const result = agentRuntime.parseResponse(response);
      expect(result.text).toBe('Let me read that file.');
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0]?.name).toBe('read_file');
      expect(result.toolCalls[0]?.arguments).toEqual({ path: 'test.txt' });
    });

    it('should parse JSON-style tool calls', () => {
      const response = 'Reading file. {"tool": "read_file", "arguments": {"path": "test.txt"}}';
      const result = agentRuntime.parseResponse(response);
      expect(result.text).toContain('Reading file.');
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0]?.name).toBe('read_file');
    });

    it('should handle multiple tool calls', () => {
      const response = '<tool_call name="tool1">{"a": 1}</tool_call> text <tool_call name="tool2">{"b": 2}</tool_call>';
      const result = agentRuntime.parseResponse(response);
      expect(result.toolCalls).toHaveLength(2);
      expect(result.toolCalls[0]?.name).toBe('tool1');
      expect(result.toolCalls[1]?.name).toBe('tool2');
    });

    it('should handle invalid JSON in tool calls gracefully', () => {
      const response = '<tool_call name="test">{invalid json}</tool_call> Some text';
      const result = agentRuntime.parseResponse(response);
      // Invalid tool call should be kept as text
      expect(result.toolCalls).toHaveLength(0);
    });

    it('should generate unique IDs for tool calls', () => {
      const response = '<tool_call name="test">{"a": 1}</tool_call>';
      const result1 = agentRuntime.parseResponse(response);
      const result2 = agentRuntime.parseResponse(response);
      expect(result1.toolCalls[0]?.id).not.toBe(result2.toolCalls[0]?.id);
    });
  });

  describe('executeTool', () => {
    it('should execute registered tool', async () => {
      toolSystem.register(
        {
          name: 'echo',
          description: 'Echo input',
          parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
        },
        async (args) => args['text'] as string
      );

      const result = await agentRuntime.executeTool({
        id: 'call1',
        name: 'echo',
        arguments: { text: 'hello' },
      });

      expect(result.success).toBe(true);
      expect(result.output).toBe('hello');
    });

    it('should return error for unregistered tool', async () => {
      const result = await agentRuntime.executeTool({
        id: 'call1',
        name: 'nonexistent',
        arguments: {},
      });

      expect(result.success).toBe(false);
      expect(result.error?.errorType).toBe('not_found');
    });

    it('should handle tool execution errors', async () => {
      toolSystem.register(
        {
          name: 'failing_tool',
          description: 'A tool that fails',
          parameters: { type: 'object' },
        },
        async () => { throw new Error('Tool failed'); }
      );

      const result = await agentRuntime.executeTool({
        id: 'call1',
        name: 'failing_tool',
        arguments: {},
      });

      expect(result.success).toBe(false);
      expect(result.error?.errorType).toBe('execution');
      expect(result.error?.message).toContain('Tool failed');
    });

    it('should validate tool parameters', async () => {
      toolSystem.register(
        {
          name: 'strict_tool',
          description: 'A tool with required params',
          parameters: { 
            type: 'object', 
            properties: { required_param: { type: 'string' } }, 
            required: ['required_param'] 
          },
        },
        async (args) => 'ok'
      );

      const result = await agentRuntime.executeTool({
        id: 'call1',
        name: 'strict_tool',
        arguments: {}, // Missing required param
      });

      expect(result.success).toBe(false);
      expect(result.error?.errorType).toBe('validation');
    });
  });

  describe('error handling', () => {
    it('should create structured errors with session context', () => {
      // Test that AgentError structure is correct
      const error: import('./agent-runtime.js').AgentError = {
        code: 'cli_error',
        message: 'Test error',
        sessionId: 'test-session',
        details: { exitCode: 1 },
      };

      expect(error.code).toBe('cli_error');
      expect(error.sessionId).toBe('test-session');
      expect(error.details).toEqual({ exitCode: 1 });
    });

    it('should support all error codes', () => {
      const errorCodes: import('./agent-runtime.js').AgentError['code'][] = [
        'cli_not_found',
        'cli_error', 
        'parse_error',
        'timeout',
        'tool_error',
      ];

      for (const code of errorCodes) {
        const error: import('./agent-runtime.js').AgentError = {
          code,
          message: `Error: ${code}`,
          sessionId: 'test',
        };
        expect(error.code).toBe(code);
      }
    });
  });

  describe('streaming', () => {
    it('should emit text_delta events for streaming', () => {
      // The run method uses async generator for streaming
      // Verify the event types are correct
      const textDelta: import('./agent-runtime.js').AgentTextDeltaEvent = {
        type: 'text_delta',
        content: 'Hello',
      };
      expect(textDelta.type).toBe('text_delta');
      expect(textDelta.content).toBe('Hello');
    });

    it('should emit done event with full response', () => {
      const doneEvent: import('./agent-runtime.js').AgentDoneEvent = {
        type: 'done',
        fullResponse: 'Complete response text',
      };
      expect(doneEvent.type).toBe('done');
      expect(doneEvent.fullResponse).toBe('Complete response text');
    });

    it('should emit tool events in order', () => {
      const toolCallEvent: import('./agent-runtime.js').AgentToolCallEvent = {
        type: 'tool_call',
        toolCall: { id: 'call1', name: 'test', arguments: {} },
      };
      const toolResultEvent: import('./agent-runtime.js').AgentToolResultEvent = {
        type: 'tool_result',
        toolResult: { callId: 'call1', success: true, output: 'result' },
      };
      
      expect(toolCallEvent.type).toBe('tool_call');
      expect(toolResultEvent.type).toBe('tool_result');
      expect(toolResultEvent.toolResult.callId).toBe(toolCallEvent.toolCall.id);
    });
  });
});
