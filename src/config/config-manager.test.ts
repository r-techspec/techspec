import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConfigManager, DEFAULT_CONFIG, OpenClawConfigSchema } from './config-manager.js';
import { mkdtemp, rm, readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('ConfigManager', () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'openclaw-config-test-'));
    configPath = join(tempDir, 'config.json');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('defaults', () => {
    it('should provide defaults for all required settings', () => {
      // Requirement 8.2: Provide defaults for all required settings
      expect(DEFAULT_CONFIG.gateway.port).toBe(18789);
      expect(DEFAULT_CONFIG.gateway.host).toBe('127.0.0.1');
      expect(DEFAULT_CONFIG.agent.claudeCliPath).toBe('claude');
      expect(DEFAULT_CONFIG.agent.model).toBe('sonnet');
      expect(DEFAULT_CONFIG.agent.maxTokens).toBe(8192);
      expect(DEFAULT_CONFIG.memory.workspacePath).toBe('~/.openclaw/workspace');
      expect(DEFAULT_CONFIG.memory.maxContextTokens).toBe(100000);
      expect(DEFAULT_CONFIG.memory.temporalDecayHalfLife).toBe(7);
      expect(DEFAULT_CONFIG.logging.level).toBe('info');
      expect(DEFAULT_CONFIG.logging.maxSize).toBe(10 * 1024 * 1024);
      expect(DEFAULT_CONFIG.logging.maxFiles).toBe(5);
    });

    it('should start with an empty config file', async () => {
      const manager = new ConfigManager(configPath);
      const result = await manager.load();
      
      expect(result.success).toBe(true);
      expect(result.config).toEqual(DEFAULT_CONFIG);
    });
  });

  describe('validation', () => {
    it('should reject invalid port numbers', () => {
      // Requirement 8.4: Validate configuration and report errors clearly
      const manager = new ConfigManager(configPath);
      const result = manager.validate({ gateway: { port: 99999 } });
      
      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors?.[0]).toContain('gateway.port');
    });

    it('should reject invalid log levels', () => {
      const manager = new ConfigManager(configPath);
      const result = manager.validate({ logging: { level: 'invalid' as 'info' } });
      
      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors?.[0]).toContain('logging.level');
    });

    it('should accept valid partial configuration', () => {
      const manager = new ConfigManager(configPath);
      const result = manager.validate({ gateway: { port: 9000 } });
      
      expect(result.success).toBe(true);
      expect(result.config?.gateway.port).toBe(9000);
      expect(result.config?.gateway.host).toBe('127.0.0.1'); // default
    });
  });

  describe('file loading', () => {
    it('should load configuration from file', async () => {
      // Requirement 8.1: Support configuration via JSON file
      await writeFile(configPath, JSON.stringify({ gateway: { port: 9999 } }));
      
      const manager = new ConfigManager(configPath);
      const result = await manager.load();
      
      expect(result.success).toBe(true);
      expect(result.config?.gateway.port).toBe(9999);
    });

    it('should merge file config with defaults', async () => {
      // Requirement 4.4: Merge defaults with user overrides
      await writeFile(configPath, JSON.stringify({ agent: { model: 'custom-model' } }));
      
      const manager = new ConfigManager(configPath);
      const result = await manager.load();
      
      expect(result.success).toBe(true);
      expect(result.config?.agent.model).toBe('custom-model');
      expect(result.config?.agent.maxTokens).toBe(8192); // default preserved
    });
  });

  describe('atomic writes', () => {
    it('should write configuration atomically', async () => {
      // Requirement 4.2: Write changes atomically using temp file + rename
      const manager = new ConfigManager(configPath);
      await manager.load();
      
      await manager.save({ gateway: { port: 8888 } });
      
      const content = await readFile(configPath, 'utf-8');
      const saved = JSON.parse(content);
      expect(saved.gateway.port).toBe(8888);
    });

    it('should set proper file permissions on save', async () => {
      const manager = new ConfigManager(configPath);
      await manager.load();
      await manager.save();
      
      const stats = await stat(configPath);
      // Check that file is readable/writable by owner only (mode 0o600)
      expect(stats.mode & 0o777).toBe(0o600);
    });

    it('should handle concurrent writes safely', async () => {
      // Requirement 4.2: Handle concurrent access safely
      const manager = new ConfigManager(configPath);
      await manager.load();
      
      // Perform multiple concurrent writes
      const writes = [
        manager.save({ gateway: { port: 1111 } }),
        manager.save({ gateway: { port: 2222 } }),
        manager.save({ gateway: { port: 3333 } }),
      ];
      
      await Promise.all(writes);
      
      // File should contain valid JSON (one of the values)
      const content = await readFile(configPath, 'utf-8');
      const saved = JSON.parse(content);
      expect([1111, 2222, 3333]).toContain(saved.gateway.port);
    });

    it('should not leave temp files on successful write', async () => {
      const manager = new ConfigManager(configPath);
      await manager.load();
      await manager.save({ gateway: { port: 5555 } });
      
      // Check that no temp files remain
      const { readdir } = await import('node:fs/promises');
      const files = await readdir(tempDir);
      const tempFiles = files.filter(f => f.includes('.tmp'));
      expect(tempFiles).toHaveLength(0);
    });
  });

  describe('environment overrides', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should override file config with environment variables', async () => {
      // Requirement 8.3: Environment variables override file-based configuration
      await writeFile(configPath, JSON.stringify({ gateway: { port: 9999 } }));
      process.env['OPENCLAW_GATEWAY_PORT'] = '7777';
      
      const manager = new ConfigManager(configPath);
      const result = await manager.load();
      
      expect(result.success).toBe(true);
      expect(result.config?.gateway.port).toBe(7777);
    });

    it('should handle multiple environment overrides', async () => {
      process.env['OPENCLAW_GATEWAY_PORT'] = '5555';
      process.env['OPENCLAW_LOGGING_LEVEL'] = 'debug';
      
      const manager = new ConfigManager(configPath);
      const result = await manager.load();
      
      expect(result.success).toBe(true);
      expect(result.config?.gateway.port).toBe(5555);
      expect(result.config?.logging.level).toBe('debug');
    });
  });

  describe('get and set', () => {
    it('should get nested configuration values', async () => {
      const manager = new ConfigManager(configPath);
      await manager.load();
      
      expect(manager.get<number>('gateway.port')).toBe(18789);
      expect(manager.get<string>('agent.model')).toBe('sonnet');
    });

    it('should set and validate configuration values', async () => {
      const manager = new ConfigManager(configPath);
      await manager.load();
      
      const result = manager.set('gateway.port', 9000);
      
      expect(result.success).toBe(true);
      expect(manager.config.gateway.port).toBe(9000);
    });

    it('should reject invalid values when setting', async () => {
      const manager = new ConfigManager(configPath);
      await manager.load();
      
      const result = manager.set('gateway.port', 'invalid');
      
      expect(result.success).toBe(false);
    });
  });
});
