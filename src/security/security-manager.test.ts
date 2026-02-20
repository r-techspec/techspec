import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SecurityManager } from './security-manager.js';
import { mkdir, rm, readFile, stat, chmod, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

describe('SecurityManager', () => {
  let testDir: string;
  let authPath: string;
  let securityManager: SecurityManager;

  beforeEach(async () => {
    // Create a unique temp directory for each test
    testDir = join(tmpdir(), `openclaw-security-test-${randomUUID()}`);
    await mkdir(testDir, { recursive: true });
    authPath = join(testDir, 'auth.json');
    securityManager = new SecurityManager(authPath);
  });

  afterEach(async () => {
    // Clean up temp directory
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('generateToken', () => {
    it('should generate a 64-character hex string (32 bytes)', () => {
      const token = securityManager.generateToken();
      expect(token).toHaveLength(64);
      expect(token).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should generate unique tokens', () => {
      const tokens = new Set<string>();
      for (let i = 0; i < 100; i++) {
        tokens.add(securityManager.generateToken());
      }
      expect(tokens.size).toBe(100);
    });
  });

  describe('initialize', () => {
    it('should create a new token when auth file does not exist', async () => {
      const token = await securityManager.initialize();
      
      expect(token).toHaveLength(64);
      expect(token).toMatch(/^[0-9a-f]{64}$/);
      
      // Verify file was created
      const content = await readFile(authPath, 'utf-8');
      const authStore = JSON.parse(content);
      expect(authStore.token).toBe(token);
      expect(authStore.createdAt).toBeTypeOf('number');
    });

    it('should return existing token when auth file exists', async () => {
      // Create initial token
      const initialToken = await securityManager.initialize();
      
      // Create new manager and initialize again
      const newManager = new SecurityManager(authPath);
      const loadedToken = await newManager.initialize();
      
      expect(loadedToken).toBe(initialToken);
    });

    it('should create auth file with 600 permissions', async () => {
      await securityManager.initialize();
      
      const stats = await stat(authPath);
      const mode = stats.mode & 0o777;
      expect(mode).toBe(0o600);
    });
  });

  describe('validateToken', () => {
    it('should return valid for correct token', async () => {
      const token = await securityManager.initialize();
      
      const result = await securityManager.validateToken(token);
      
      expect(result.valid).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should return invalid for incorrect token', async () => {
      await securityManager.initialize();
      
      const result = await securityManager.validateToken('invalid-token');
      
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Invalid authentication token');
    });

    it('should return invalid for empty token', async () => {
      await securityManager.initialize();
      
      const result = await securityManager.validateToken('');
      
      expect(result.valid).toBe(false);
    });

    it('should return invalid for token with wrong length', async () => {
      await securityManager.initialize();
      
      const result = await securityManager.validateToken('abc123');
      
      expect(result.valid).toBe(false);
    });
  });

  describe('rotateToken', () => {
    it('should generate a new token', async () => {
      const initialToken = await securityManager.initialize();
      const newToken = await securityManager.rotateToken();
      
      expect(newToken).not.toBe(initialToken);
      expect(newToken).toHaveLength(64);
      expect(newToken).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should update the stored token', async () => {
      await securityManager.initialize();
      const newToken = await securityManager.rotateToken();
      
      const content = await readFile(authPath, 'utf-8');
      const authStore = JSON.parse(content);
      expect(authStore.token).toBe(newToken);
    });

    it('should preserve createdAt and add rotatedAt', async () => {
      await securityManager.initialize();
      
      const contentBefore = await readFile(authPath, 'utf-8');
      const storeBefore = JSON.parse(contentBefore);
      
      await securityManager.rotateToken();
      
      const contentAfter = await readFile(authPath, 'utf-8');
      const storeAfter = JSON.parse(contentAfter);
      
      expect(storeAfter.createdAt).toBe(storeBefore.createdAt);
      expect(storeAfter.rotatedAt).toBeTypeOf('number');
      expect(storeAfter.rotatedAt).toBeGreaterThanOrEqual(storeBefore.createdAt);
    });

    it('should invalidate old token after rotation', async () => {
      const oldToken = await securityManager.initialize();
      await securityManager.rotateToken();
      
      const result = await securityManager.validateToken(oldToken);
      expect(result.valid).toBe(false);
    });

    it('should validate new token after rotation', async () => {
      await securityManager.initialize();
      const newToken = await securityManager.rotateToken();
      
      const result = await securityManager.validateToken(newToken);
      expect(result.valid).toBe(true);
    });
  });

  describe('getToken', () => {
    it('should return the current token', async () => {
      const token = await securityManager.initialize();
      const retrieved = await securityManager.getToken();
      
      expect(retrieved).toBe(token);
    });

    it('should return null when no token exists', async () => {
      const retrieved = await securityManager.getToken();
      expect(retrieved).toBeNull();
    });
  });

  describe('hasSecurePermissions', () => {
    it('should return true when permissions are 600', async () => {
      await securityManager.initialize();
      
      const secure = await securityManager.hasSecurePermissions();
      expect(secure).toBe(true);
    });

    it('should return false when file does not exist', async () => {
      const secure = await securityManager.hasSecurePermissions();
      expect(secure).toBe(false);
    });

    it('should return false when permissions are not 600', async () => {
      await securityManager.initialize();
      await chmod(authPath, 0o644);
      
      const secure = await securityManager.hasSecurePermissions();
      expect(secure).toBe(false);
    });
  });

  describe('ensureSecurePermissions on initialize', () => {
    it('should fix insecure permissions on initialize', async () => {
      // Create auth file with insecure permissions
      const authStore = {
        token: securityManager.generateToken(),
        createdAt: Date.now(),
      };
      await writeFile(authPath, JSON.stringify(authStore), { mode: 0o644 });
      
      // Initialize should fix permissions
      await securityManager.initialize();
      
      const stats = await stat(authPath);
      const mode = stats.mode & 0o777;
      expect(mode).toBe(0o600);
    });
  });
});
