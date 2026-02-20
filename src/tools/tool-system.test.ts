import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ToolSystem, ToolDefinition, ToolCall } from './tool-system.js';
import { createCoreTools, READ_FILE_TOOL, WRITE_FILE_TOOL, LIST_DIRECTORY_TOOL, EXECUTE_SHELL_TOOL } from './core-tools.js';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

describe('ToolSystem', () => {
  let toolSystem: ToolSystem;

  beforeEach(() => {
    toolSystem = new ToolSystem();
  });

  describe('registration', () => {
    it('should register a tool', () => {
      const tool: ToolDefinition = {
        name: 'test_tool',
        description: 'A test tool',
        parameters: { type: 'object', properties: {}, required: [] },
      };
      const handler = async () => 'result';

      toolSystem.register(tool, handler);

      expect(toolSystem.has('test_tool')).toBe(true);
      expect(toolSystem.get('test_tool')).toEqual(tool);
    });

    it('should throw when registering duplicate tool', () => {
      const tool: ToolDefinition = {
        name: 'test_tool',
        description: 'A test tool',
        parameters: { type: 'object', properties: {}, required: [] },
      };
      const handler = async () => 'result';

      toolSystem.register(tool, handler);

      expect(() => toolSystem.register(tool, handler)).toThrow("Tool 'test_tool' is already registered");
    });

    it('should list all registered tools', () => {
      const tool1: ToolDefinition = {
        name: 'tool1',
        description: 'Tool 1',
        parameters: { type: 'object', properties: {}, required: [] },
      };
      const tool2: ToolDefinition = {
        name: 'tool2',
        description: 'Tool 2',
        parameters: { type: 'object', properties: {}, required: [] },
      };

      toolSystem.register(tool1, async () => '1');
      toolSystem.register(tool2, async () => '2');

      const tools = toolSystem.list();
      expect(tools).toHaveLength(2);
      expect(tools.map(t => t.name)).toContain('tool1');
      expect(tools.map(t => t.name)).toContain('tool2');
    });

    it('should unregister a tool', () => {
      const tool: ToolDefinition = {
        name: 'test_tool',
        description: 'A test tool',
        parameters: { type: 'object', properties: {}, required: [] },
      };

      toolSystem.register(tool, async () => 'result');
      expect(toolSystem.has('test_tool')).toBe(true);

      const result = toolSystem.unregister('test_tool');
      expect(result).toBe(true);
      expect(toolSystem.has('test_tool')).toBe(false);
    });
  });

  describe('parameter validation', () => {
    beforeEach(() => {
      const tool: ToolDefinition = {
        name: 'validated_tool',
        description: 'A tool with validation',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Name parameter' },
            count: { type: 'number', description: 'Count parameter' },
            enabled: { type: 'boolean', description: 'Enabled flag' },
            level: { type: 'string', enum: ['low', 'medium', 'high'] },
          },
          required: ['name'],
        },
      };
      toolSystem.register(tool, async () => 'ok');
    });

    it('should validate required parameters', () => {
      const result = toolSystem.validateParameters('validated_tool', {});
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Missing required parameter: 'name'");
    });

    it('should pass validation with required parameters', () => {
      const result = toolSystem.validateParameters('validated_tool', { name: 'test' });
      expect(result.valid).toBe(true);
    });

    it('should validate parameter types', () => {
      const result = toolSystem.validateParameters('validated_tool', { name: 123 });
      expect(result.valid).toBe(false);
      expect(result.errors?.[0]).toContain("must be of type 'string'");
    });

    it('should validate enum values', () => {
      const result = toolSystem.validateParameters('validated_tool', { name: 'test', level: 'invalid' });
      expect(result.valid).toBe(false);
      expect(result.errors?.[0]).toContain('must be one of: low, medium, high');
    });

    it('should return error for unknown tool', () => {
      const result = toolSystem.validateParameters('unknown_tool', {});
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Tool 'unknown_tool' not found");
    });
  });

  describe('execution', () => {
    it('should execute a tool and return result', async () => {
      const tool: ToolDefinition = {
        name: 'echo',
        description: 'Echo tool',
        parameters: {
          type: 'object',
          properties: { message: { type: 'string' } },
          required: ['message'],
        },
      };
      toolSystem.register(tool, async (args) => `Echo: ${args['message']}`);

      const call: ToolCall = {
        id: 'call-1',
        name: 'echo',
        arguments: { message: 'hello' },
      };

      const result = await toolSystem.execute(call);
      expect(result.success).toBe(true);
      expect(result.output).toBe('Echo: hello');
      expect(result.callId).toBe('call-1');
    });

    it('should return error for unknown tool', async () => {
      const call: ToolCall = {
        id: 'call-1',
        name: 'unknown',
        arguments: {},
      };

      const result = await toolSystem.execute(call);
      expect(result.success).toBe(false);
      expect(result.error?.errorType).toBe('not_found');
      expect(result.error?.toolName).toBe('unknown');
    });

    it('should return validation error for invalid parameters', async () => {
      const tool: ToolDefinition = {
        name: 'strict_tool',
        description: 'Strict tool',
        parameters: {
          type: 'object',
          properties: { required_param: { type: 'string' } },
          required: ['required_param'],
        },
      };
      toolSystem.register(tool, async () => 'ok');

      const call: ToolCall = {
        id: 'call-1',
        name: 'strict_tool',
        arguments: {},
      };

      const result = await toolSystem.execute(call);
      expect(result.success).toBe(false);
      expect(result.error?.errorType).toBe('validation');
      expect(result.error?.toolName).toBe('strict_tool');
    });

    it('should return execution error when handler throws', async () => {
      const tool: ToolDefinition = {
        name: 'failing_tool',
        description: 'Failing tool',
        parameters: { type: 'object', properties: {}, required: [] },
      };
      toolSystem.register(tool, async () => {
        throw new Error('Handler failed');
      });

      const call: ToolCall = {
        id: 'call-1',
        name: 'failing_tool',
        arguments: {},
      };

      const result = await toolSystem.execute(call);
      expect(result.success).toBe(false);
      expect(result.error?.errorType).toBe('execution');
      expect(result.error?.message).toBe('Handler failed');
    });
  });
});

describe('Core Tools', () => {
  let toolSystem: ToolSystem;
  let testDir: string;

  beforeEach(async () => {
    toolSystem = new ToolSystem();
    createCoreTools(toolSystem);
    testDir = join(tmpdir(), `openclaw-test-${randomUUID()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('should register all core tools', () => {
    expect(toolSystem.has('read_file')).toBe(true);
    expect(toolSystem.has('write_file')).toBe(true);
    expect(toolSystem.has('list_directory')).toBe(true);
    expect(toolSystem.has('execute_shell')).toBe(true);
  });

  describe('read_file', () => {
    it('should read file contents', async () => {
      const testFile = join(testDir, 'test.txt');
      await writeFile(testFile, 'Hello, World!');

      const result = await toolSystem.execute({
        id: 'read-1',
        name: 'read_file',
        arguments: { path: testFile },
      });

      expect(result.success).toBe(true);
      expect(result.output).toBe('Hello, World!');
    });

    it('should fail for non-existent file', async () => {
      const result = await toolSystem.execute({
        id: 'read-2',
        name: 'read_file',
        arguments: { path: join(testDir, 'nonexistent.txt') },
      });

      expect(result.success).toBe(false);
      expect(result.error?.errorType).toBe('execution');
    });
  });

  describe('write_file', () => {
    it('should write file contents', async () => {
      const testFile = join(testDir, 'output.txt');

      const result = await toolSystem.execute({
        id: 'write-1',
        name: 'write_file',
        arguments: { path: testFile, content: 'Test content' },
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('Successfully wrote');
    });

    it('should create parent directories', async () => {
      const testFile = join(testDir, 'nested', 'dir', 'file.txt');

      const result = await toolSystem.execute({
        id: 'write-2',
        name: 'write_file',
        arguments: { path: testFile, content: 'Nested content' },
      });

      expect(result.success).toBe(true);
    });
  });

  describe('list_directory', () => {
    it('should list directory contents', async () => {
      await writeFile(join(testDir, 'file1.txt'), 'content1');
      await writeFile(join(testDir, 'file2.txt'), 'content2');

      const result = await toolSystem.execute({
        id: 'list-1',
        name: 'list_directory',
        arguments: { path: testDir },
      });

      expect(result.success).toBe(true);
      const entries = JSON.parse(result.output!);
      expect(entries).toHaveLength(2);
    });

    it('should exclude hidden files by default', async () => {
      await writeFile(join(testDir, '.hidden'), 'hidden');
      await writeFile(join(testDir, 'visible.txt'), 'visible');

      const result = await toolSystem.execute({
        id: 'list-2',
        name: 'list_directory',
        arguments: { path: testDir },
      });

      expect(result.success).toBe(true);
      const entries = JSON.parse(result.output!);
      expect(entries).toHaveLength(1);
      expect(entries[0].name).toBe('visible.txt');
    });
  });

  describe('execute_shell', () => {
    it('should execute shell command and capture output', async () => {
      const result = await toolSystem.execute({
        id: 'shell-1',
        name: 'execute_shell',
        arguments: { command: 'echo "Hello"' },
      });

      expect(result.success).toBe(true);
      const output = JSON.parse(result.output!);
      expect(output.stdout.trim()).toBe('Hello');
      expect(output.exitCode).toBe(0);
    });

    it('should capture stderr', async () => {
      const result = await toolSystem.execute({
        id: 'shell-2',
        name: 'execute_shell',
        arguments: { command: 'echo "error" >&2' },
      });

      expect(result.success).toBe(true);
      const output = JSON.parse(result.output!);
      expect(output.stderr.trim()).toBe('error');
    });

    it('should respect working directory', async () => {
      const result = await toolSystem.execute({
        id: 'shell-3',
        name: 'execute_shell',
        arguments: { command: 'pwd', cwd: testDir },
      });

      expect(result.success).toBe(true);
      const output = JSON.parse(result.output!);
      // macOS resolves /var to /private/var, so check that the path ends with the same suffix
      const outputPath = output.stdout.trim();
      expect(outputPath.endsWith(testDir.replace('/var/', '/')) || outputPath === testDir).toBe(true);
    });
  });
});
