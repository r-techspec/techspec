import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Workspace } from './workspace.js';
import { rm, access, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

describe('Workspace', () => {
  let testDir: string;
  let workspace: Workspace;

  beforeEach(() => {
    testDir = join(tmpdir(), `openclaw-test-${randomUUID()}`);
    workspace = new Workspace(testDir);
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('constructor', () => {
    it('should use provided path', () => {
      expect(workspace.root).toBe(testDir);
    });

    it('should resolve relative paths', () => {
      const relativeWorkspace = new Workspace('./test-workspace');
      expect(relativeWorkspace.root).toContain('test-workspace');
    });
  });

  describe('initialize', () => {
    it('should create workspace directory structure', async () => {
      await workspace.initialize();

      // Check root exists
      await expect(access(workspace.root)).resolves.toBeUndefined();

      // Check subdirectories exist
      await expect(access(workspace.sessionsDir)).resolves.toBeUndefined();
      await expect(access(workspace.workspaceDir)).resolves.toBeUndefined();
      await expect(access(workspace.memoryDir)).resolves.toBeUndefined();
      await expect(access(workspace.logsDir)).resolves.toBeUndefined();
    });

    it('should create directories with 700 permissions', async () => {
      await workspace.initialize();

      const stats = await stat(workspace.root);
      // Check owner has rwx (0o700 = 448 in decimal, but mode includes file type bits)
      expect(stats.mode & 0o777).toBe(0o700);
    });

    it('should be idempotent', async () => {
      await workspace.initialize();
      await workspace.initialize(); // Should not throw
      await expect(access(workspace.root)).resolves.toBeUndefined();
    });
  });

  describe('exists', () => {
    it('should return false for non-existent workspace', async () => {
      expect(await workspace.exists()).toBe(false);
    });

    it('should return true after initialization', async () => {
      await workspace.initialize();
      expect(await workspace.exists()).toBe(true);
    });
  });

  describe('resolve', () => {
    it('should resolve relative paths within workspace', () => {
      const resolved = workspace.resolve('sessions/test.jsonl');
      expect(resolved).toBe(join(testDir, 'sessions/test.jsonl'));
    });

    it('should throw for paths escaping workspace', () => {
      expect(() => workspace.resolve('../outside')).toThrow(
        'resolves outside workspace boundary'
      );
    });

    it('should throw for absolute paths outside workspace', () => {
      expect(() => workspace.resolve('/etc/passwd')).toThrow(
        'resolves outside workspace boundary'
      );
    });
  });

  describe('contains', () => {
    it('should return true for paths within workspace', () => {
      expect(workspace.contains(join(testDir, 'sessions'))).toBe(true);
      expect(workspace.contains(join(testDir, 'config.json'))).toBe(true);
    });

    it('should return true for workspace root itself', () => {
      expect(workspace.contains(testDir)).toBe(true);
    });

    it('should return false for paths outside workspace', () => {
      expect(workspace.contains('/etc/passwd')).toBe(false);
      expect(workspace.contains(join(testDir, '..', 'other'))).toBe(false);
    });

    it('should not match prefix-similar paths', () => {
      // e.g., /home/user/.openclaw2 should not match /home/user/.openclaw
      expect(workspace.contains(testDir + '2')).toBe(false);
    });
  });

  describe('relative', () => {
    it('should return relative path from workspace root', () => {
      const absPath = join(testDir, 'sessions', 'test.jsonl');
      expect(workspace.relative(absPath)).toBe(join('sessions', 'test.jsonl'));
    });

    it('should throw for paths outside workspace', () => {
      expect(() => workspace.relative('/etc/passwd')).toThrow(
        'outside workspace boundary'
      );
    });
  });

  describe('path helpers', () => {
    it('should return correct config path', () => {
      expect(workspace.configPath).toBe(join(testDir, 'config.json'));
    });

    it('should return correct auth path', () => {
      expect(workspace.authPath).toBe(join(testDir, 'auth.json'));
    });

    it('should return correct sessions directory', () => {
      expect(workspace.sessionsDir).toBe(join(testDir, 'sessions'));
    });

    it('should return correct workspace directory', () => {
      expect(workspace.workspaceDir).toBe(join(testDir, 'workspace'));
    });

    it('should return correct memory directory', () => {
      expect(workspace.memoryDir).toBe(join(testDir, 'workspace', 'memory'));
    });

    it('should return correct logs directory', () => {
      expect(workspace.logsDir).toBe(join(testDir, 'logs'));
    });

    it('should return correct SOUL.md path', () => {
      expect(workspace.soulPath).toBe(join(testDir, 'workspace', 'SOUL.md'));
    });

    it('should return correct USER.md path', () => {
      expect(workspace.userPath).toBe(join(testDir, 'workspace', 'USER.md'));
    });
  });

  describe('sessionPath', () => {
    it('should return correct session file path', () => {
      expect(workspace.sessionPath('abc123')).toBe(
        join(testDir, 'sessions', 'abc123.jsonl')
      );
    });

    it('should reject session IDs with path traversal', () => {
      expect(() => workspace.sessionPath('../evil')).toThrow('Invalid session ID');
      expect(() => workspace.sessionPath('foo/bar')).toThrow('Invalid session ID');
      expect(() => workspace.sessionPath('foo\\bar')).toThrow('Invalid session ID');
    });
  });

  describe('logPath', () => {
    it('should return correct log file path', () => {
      expect(workspace.logPath('app.log')).toBe(join(testDir, 'logs', 'app.log'));
    });

    it('should reject filenames with path traversal', () => {
      expect(() => workspace.logPath('../evil.log')).toThrow('Invalid log filename');
      expect(() => workspace.logPath('foo/bar.log')).toThrow('Invalid log filename');
    });
  });
});
