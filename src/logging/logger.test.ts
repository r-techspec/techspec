import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, readFile, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Logger, LOG_LEVELS, type LogEntry, type LogLevel } from './logger.js';

describe('Logger', () => {
  let testDir: string;
  let logPath: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `logger-test-${randomUUID()}`);
    await mkdir(testDir, { recursive: true });
    logPath = join(testDir, 'test.log');
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('log level filtering', () => {
    it('should filter logs below configured level', async () => {
      const logger = new Logger({ level: 'warn', path: logPath });
      
      await logger.debug('debug message');
      await logger.info('info message');
      await logger.warn('warn message');
      await logger.error('error message');

      const content = await readFile(logPath, 'utf-8');
      const lines = content.trim().split('\n');
      
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0]!).level).toBe('warn');
      expect(JSON.parse(lines[1]!).level).toBe('error');
    });

    it('should log all levels when set to debug', async () => {
      const logger = new Logger({ level: 'debug', path: logPath });
      
      await logger.debug('debug');
      await logger.info('info');
      await logger.warn('warn');
      await logger.error('error');

      const content = await readFile(logPath, 'utf-8');
      const lines = content.trim().split('\n');
      
      expect(lines).toHaveLength(4);
    });

    it('should only log errors when set to error level', async () => {
      const logger = new Logger({ level: 'error', path: logPath });
      
      await logger.debug('debug');
      await logger.info('info');
      await logger.warn('warn');
      await logger.error('error');

      const content = await readFile(logPath, 'utf-8');
      const lines = content.trim().split('\n');
      
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0]!).level).toBe('error');
    });
  });

  describe('structured JSON format', () => {
    it('should output valid JSON with required fields', async () => {
      const logger = new Logger({ level: 'info', path: logPath });
      await logger.info('test message');

      const content = await readFile(logPath, 'utf-8');
      const entry: LogEntry = JSON.parse(content.trim());

      expect(entry.timestamp).toBeDefined();
      expect(new Date(entry.timestamp).toISOString()).toBe(entry.timestamp);
      expect(entry.level).toBe('info');
      expect(entry.message).toBe('test message');
    });

    it('should include context when provided', async () => {
      const logger = new Logger({ level: 'info', path: logPath });
      await logger.info('test message', { sessionId: 'sess-123', operation: 'test' });

      const content = await readFile(logPath, 'utf-8');
      const entry: LogEntry = JSON.parse(content.trim());

      expect(entry.context).toBeDefined();
      expect(entry.context?.sessionId).toBe('sess-123');
      expect(entry.context?.operation).toBe('test');
    });

    it('should merge default context with provided context', async () => {
      const logger = new Logger(
        { level: 'info', path: logPath },
        { sessionId: 'default-session' }
      );
      await logger.info('test', { operation: 'custom-op' });

      const content = await readFile(logPath, 'utf-8');
      const entry: LogEntry = JSON.parse(content.trim());

      expect(entry.context?.sessionId).toBe('default-session');
      expect(entry.context?.operation).toBe('custom-op');
    });
  });

  describe('error logging with stack traces', () => {
    it('should include stack trace for errors', async () => {
      const logger = new Logger({ level: 'error', path: logPath });
      const error = new Error('Test error');
      
      await logger.error('An error occurred', error);

      const content = await readFile(logPath, 'utf-8');
      const entry: LogEntry = JSON.parse(content.trim());

      expect(entry.stack).toBeDefined();
      expect(entry.stack).toContain('Error: Test error');
    });

    it('should include context with error logs', async () => {
      const logger = new Logger({ level: 'error', path: logPath });
      const error = new Error('Test error');
      
      await logger.error('An error occurred', error, {
        sessionId: 'sess-456',
        operation: 'processMessage',
      });

      const content = await readFile(logPath, 'utf-8');
      const entry: LogEntry = JSON.parse(content.trim());

      expect(entry.context?.sessionId).toBe('sess-456');
      expect(entry.context?.operation).toBe('processMessage');
      expect(entry.stack).toBeDefined();
    });

    it('should handle non-Error objects in error logging', async () => {
      const logger = new Logger({ level: 'error', path: logPath });
      
      await logger.error('An error occurred', 'string error');

      const content = await readFile(logPath, 'utf-8');
      const entry: LogEntry = JSON.parse(content.trim());

      expect(entry.context?.errorDetails).toBe('string error');
    });
  });

  describe('log rotation', () => {
    it('should rotate when file exceeds maxSize', async () => {
      const logger = new Logger({
        level: 'info',
        path: logPath,
        maxSize: 100, // Very small for testing
        maxFiles: 3,
      });

      // Write enough to trigger rotation
      for (let i = 0; i < 10; i++) {
        await logger.info(`Message ${i} with some extra content to fill space`);
      }

      const files = await logger.listLogFiles();
      expect(files.length).toBeGreaterThan(1);
    });

    it('should keep only maxFiles rotated files', async () => {
      const logger = new Logger({
        level: 'info',
        path: logPath,
        maxSize: 50,
        maxFiles: 2,
      });

      // Write many messages to trigger multiple rotations
      for (let i = 0; i < 20; i++) {
        await logger.info(`Message ${i} with padding content`);
      }

      const files = await logger.listLogFiles();
      // Should have at most current + maxFiles rotated
      expect(files.length).toBeLessThanOrEqual(3);
    });
  });

  describe('child logger', () => {
    it('should create child with inherited config and merged context', async () => {
      const parent = new Logger(
        { level: 'info', path: logPath },
        { sessionId: 'parent-session' }
      );
      
      const child = parent.child({ operation: 'child-op' });
      await child.info('child message');

      const content = await readFile(logPath, 'utf-8');
      const entry: LogEntry = JSON.parse(content.trim());

      expect(entry.context?.sessionId).toBe('parent-session');
      expect(entry.context?.operation).toBe('child-op');
    });
  });

  describe('shouldLog', () => {
    it('should correctly determine if level should be logged', () => {
      const logger = new Logger({ level: 'warn', path: logPath });
      
      expect(logger.shouldLog('debug')).toBe(false);
      expect(logger.shouldLog('info')).toBe(false);
      expect(logger.shouldLog('warn')).toBe(true);
      expect(logger.shouldLog('error')).toBe(true);
    });
  });
});
