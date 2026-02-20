import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SessionManager, type TranscriptEntry } from './session-manager.js';
import { Workspace } from '../storage/workspace.js';
import { Logger } from '../logging/logger.js';
import { rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

describe('SessionManager', () => {
  let testDir: string;
  let workspace: Workspace;
  let logger: Logger;
  let sessionManager: SessionManager;

  beforeEach(async () => {
    testDir = join(tmpdir(), `openclaw-session-test-${randomUUID()}`);
    workspace = new Workspace(testDir);
    await workspace.initialize();
    logger = new Logger({ level: 'warn', path: join(testDir, 'test.log'), maxSize: 1024 * 1024, maxFiles: 1 });
    sessionManager = new SessionManager(workspace, logger);
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('create', () => {
    it('should create a session with unique UUID', async () => {
      const session = await sessionManager.create();
      
      expect(session.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(session.createdAt).toBeLessThanOrEqual(Date.now());
      expect(session.updatedAt).toBe(session.createdAt);
      expect(session.messageCount).toBe(0);
      expect(session.transcriptPath).toContain(session.id);
    });

    it('should create transcript file', async () => {
      const session = await sessionManager.create();
      
      const content = await readFile(session.transcriptPath, 'utf-8');
      expect(content).toContain(session.id);
    });

    it('should generate unique IDs for multiple sessions', async () => {
      const sessions = await Promise.all([
        sessionManager.create(),
        sessionManager.create(),
        sessionManager.create(),
      ]);
      
      const ids = sessions.map(s => s.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(3);
    });
  });

  describe('load', () => {
    it('should load an existing session', async () => {
      const created = await sessionManager.create();
      const loaded = await sessionManager.load(created.id);
      
      expect(loaded.id).toBe(created.id);
      expect(loaded.createdAt).toBe(created.createdAt);
      expect(loaded.messageCount).toBe(0);
    });

    it('should throw for non-existent session', async () => {
      await expect(sessionManager.load('non-existent-id')).rejects.toThrow('Session not found');
    });

    it('should count messages correctly', async () => {
      const session = await sessionManager.create();
      
      await sessionManager.appendMessage(session.id, { role: 'user', content: 'Hello' });
      await sessionManager.appendMessage(session.id, { role: 'assistant', content: 'Hi there' });
      
      const loaded = await sessionManager.load(session.id);
      expect(loaded.messageCount).toBe(2);
    });
  });

  describe('appendMessage', () => {
    it('should append message to transcript', async () => {
      const session = await sessionManager.create();
      
      const entry = await sessionManager.appendMessage(session.id, {
        role: 'user',
        content: 'Hello, world!',
      });
      
      expect(entry.id).toBeDefined();
      expect(entry.role).toBe('user');
      expect(entry.content).toBe('Hello, world!');
      expect(entry.timestamp).toBeLessThanOrEqual(Date.now());
    });

    it('should throw for non-existent session', async () => {
      await expect(
        sessionManager.appendMessage('non-existent', { role: 'user', content: 'test' })
      ).rejects.toThrow('Session not found');
    });

    it('should preserve tool call data', async () => {
      const session = await sessionManager.create();
      
      const entry = await sessionManager.appendMessage(session.id, {
        role: 'assistant',
        content: '',
        toolCall: {
          id: 'call-123',
          name: 'read_file',
          arguments: '{"path": "test.txt"}',
        },
      });
      
      expect(entry.toolCall).toEqual({
        id: 'call-123',
        name: 'read_file',
        arguments: '{"path": "test.txt"}',
      });
    });
  });

  describe('getHistory', () => {
    it('should return empty array for new session', async () => {
      const session = await sessionManager.create();
      const history = await sessionManager.getHistory(session.id);
      
      expect(history).toEqual([]);
    });

    it('should return messages in order', async () => {
      const session = await sessionManager.create();
      
      await sessionManager.appendMessage(session.id, { role: 'user', content: 'First' });
      await sessionManager.appendMessage(session.id, { role: 'assistant', content: 'Second' });
      await sessionManager.appendMessage(session.id, { role: 'user', content: 'Third' });
      
      const history = await sessionManager.getHistory(session.id);
      
      expect(history).toHaveLength(3);
      expect(history[0]!.content).toBe('First');
      expect(history[1]!.content).toBe('Second');
      expect(history[2]!.content).toBe('Third');
    });

    it('should throw for non-existent session', async () => {
      await expect(sessionManager.getHistory('non-existent')).rejects.toThrow('Session not found');
    });
  });

  describe('list', () => {
    it('should return empty array when no sessions', async () => {
      const sessions = await sessionManager.list();
      expect(sessions).toEqual([]);
    });

    it('should list all sessions', async () => {
      await sessionManager.create();
      await sessionManager.create();
      await sessionManager.create();
      
      const sessions = await sessionManager.list();
      expect(sessions).toHaveLength(3);
    });

    it('should sort by most recent first', async () => {
      const s1 = await sessionManager.create();
      await sessionManager.appendMessage(s1.id, { role: 'user', content: 'first' });
      
      await new Promise(r => setTimeout(r, 20));
      
      const s2 = await sessionManager.create();
      await sessionManager.appendMessage(s2.id, { role: 'user', content: 'second' });
      
      await new Promise(r => setTimeout(r, 20));
      
      const s3 = await sessionManager.create();
      await sessionManager.appendMessage(s3.id, { role: 'user', content: 'third' });
      
      const sessions = await sessionManager.list();
      
      // Most recently updated should be first
      expect(sessions[0]!.id).toBe(s3.id);
      expect(sessions[1]!.id).toBe(s2.id);
      expect(sessions[2]!.id).toBe(s1.id);
    });

    it('should include correct metadata', async () => {
      const created = await sessionManager.create();
      await sessionManager.appendMessage(created.id, { role: 'user', content: 'test' });
      
      const sessions = await sessionManager.list();
      
      expect(sessions[0]!.id).toBe(created.id);
      expect(sessions[0]!.messageCount).toBe(1);
      expect(sessions[0]!.createdAt).toBe(created.createdAt);
    });
  });

  describe('repair', () => {
    it('should handle valid transcript without changes', async () => {
      const session = await sessionManager.create();
      await sessionManager.appendMessage(session.id, { role: 'user', content: 'test' });
      
      const result = await sessionManager.repair(session.id);
      
      expect(result.repaired).toBe(false);
      expect(result.entriesRecovered).toBe(1);
      expect(result.entriesLost).toBe(0);
    });

    it('should skip malformed entries', async () => {
      const session = await sessionManager.create();
      await sessionManager.appendMessage(session.id, { role: 'user', content: 'valid' });
      
      // Append malformed entry directly
      const { appendFile } = await import('node:fs/promises');
      await appendFile(session.transcriptPath, 'not valid json\n');
      await appendFile(session.transcriptPath, '{"also": "incomplete"\n');
      
      const result = await sessionManager.repair(session.id);
      
      expect(result.repaired).toBe(true);
      expect(result.entriesRecovered).toBe(1);
      expect(result.entriesLost).toBe(2);
      
      // Verify history only contains valid entry
      const history = await sessionManager.getHistory(session.id);
      expect(history).toHaveLength(1);
      expect(history[0]!.content).toBe('valid');
    });

    it('should throw for non-existent session', async () => {
      await expect(sessionManager.repair('non-existent')).rejects.toThrow('Session not found');
    });
  });

  describe('delete', () => {
    it('should delete session', async () => {
      const session = await sessionManager.create();
      await sessionManager.delete(session.id);
      
      await expect(sessionManager.load(session.id)).rejects.toThrow('Session not found');
    });

    it('should throw for non-existent session', async () => {
      await expect(sessionManager.delete('non-existent')).rejects.toThrow('Session not found');
    });
  });
});
