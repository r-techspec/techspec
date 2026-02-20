import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import { GatewayServer } from './gateway-server.js';
import { Logger } from '../logging/logger.js';
import { SecurityManager } from '../security/security-manager.js';
import { SessionManager } from '../session/session-manager.js';
import { AgentRuntime } from '../agent/agent-runtime.js';
import { ConfigManager } from '../config/config-manager.js';
import { ToolSystem } from '../tools/tool-system.js';
import { Workspace } from '../storage/workspace.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('GatewayServer', () => {
  let tempDir: string;
  let workspace: Workspace;
  let logger: Logger;
  let securityManager: SecurityManager;
  let sessionManager: SessionManager;
  let agentRuntime: AgentRuntime;
  let configManager: ConfigManager;
  let gateway: GatewayServer;
  let authToken: string;

  beforeEach(async () => {
    // Create temp directory for workspace
    tempDir = await mkdtemp(join(tmpdir(), 'openclaw-gateway-test-'));
    workspace = new Workspace(tempDir);
    await workspace.initialize();

    // Initialize components
    logger = new Logger({ level: 'error', path: join(tempDir, 'test.log'), maxSize: 1024 * 1024, maxFiles: 1 });
    securityManager = new SecurityManager(workspace.authPath, logger);
    sessionManager = new SessionManager(workspace, logger);
    configManager = new ConfigManager(workspace.configPath);
    
    const toolSystem = new ToolSystem();
    agentRuntime = new AgentRuntime(toolSystem, {}, logger);

    // Initialize security and get token
    authToken = await securityManager.initialize();

    // Create gateway with random port to avoid conflicts
    const port = 18789 + Math.floor(Math.random() * 1000);
    gateway = new GatewayServer(
      { port, host: '127.0.0.1' },
      logger,
      securityManager,
      sessionManager,
      agentRuntime,
      configManager
    );
  });

  afterEach(async () => {
    // Stop gateway if running
    if (gateway.isRunning) {
      await gateway.stop();
    }
    // Clean up temp directory
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('start/stop', () => {
    it('should start and accept connections', async () => {
      await gateway.start();
      expect(gateway.isRunning).toBe(true);
      
      const config = gateway.getConfig();
      expect(config.port).toBeGreaterThan(0);
    });

    it('should stop gracefully', async () => {
      await gateway.start();
      expect(gateway.isRunning).toBe(true);
      
      await gateway.stop();
      expect(gateway.isRunning).toBe(false);
    });

    it('should throw if started twice', async () => {
      await gateway.start();
      await expect(gateway.start()).rejects.toThrow('already running');
    });
  });

  describe('WebSocket connections', () => {
    it('should accept WebSocket connections', async () => {
      await gateway.start();
      const config = gateway.getConfig();
      
      const ws = new WebSocket(`ws://${config.host}:${config.port}`);
      
      await new Promise<void>((resolve, reject) => {
        ws.on('open', () => {
          expect(gateway.clientCount).toBe(1);
          ws.close();
          resolve();
        });
        ws.on('error', reject);
      });
    });

    it('should request authentication on connect', async () => {
      await gateway.start();
      const config = gateway.getConfig();
      
      const ws = new WebSocket(`ws://${config.host}:${config.port}`);
      
      const message = await new Promise<{ type: string; success: boolean; error?: string }>((resolve, reject) => {
        ws.on('message', (data) => {
          resolve(JSON.parse(data.toString()));
        });
        ws.on('error', reject);
      });
      
      expect(message.type).toBe('auth_result');
      expect(message.success).toBe(false);
      expect(message.error).toBe('Authentication required');
      
      ws.close();
    });
  });

  describe('authentication', () => {
    it('should authenticate with valid token', async () => {
      await gateway.start();
      const config = gateway.getConfig();
      
      const ws = new WebSocket(`ws://${config.host}:${config.port}`);
      
      // Wait for initial auth request
      await new Promise<void>((resolve) => {
        ws.on('message', () => resolve());
      });
      
      // Send auth
      ws.send(JSON.stringify({ type: 'auth', token: authToken }));
      
      const response = await new Promise<{ type: string; success: boolean }>((resolve) => {
        ws.on('message', (data) => {
          resolve(JSON.parse(data.toString()));
        });
      });
      
      expect(response.type).toBe('auth_result');
      expect(response.success).toBe(true);
      
      ws.close();
    });

    it('should reject invalid token', async () => {
      await gateway.start();
      const config = gateway.getConfig();
      
      const ws = new WebSocket(`ws://${config.host}:${config.port}`);
      
      // Wait for initial auth request
      await new Promise<void>((resolve) => {
        ws.on('message', () => resolve());
      });
      
      // Send invalid auth
      ws.send(JSON.stringify({ type: 'auth', token: 'invalid-token' }));
      
      const response = await new Promise<{ type: string; success: boolean; error?: string }>((resolve) => {
        ws.on('message', (data) => {
          resolve(JSON.parse(data.toString()));
        });
      });
      
      expect(response.type).toBe('auth_result');
      expect(response.success).toBe(false);
      expect(response.error).toContain('Invalid');
      
      ws.close();
    });
  });

  describe('session management', () => {
    async function connectAndAuth(port: number, host: string, token: string): Promise<WebSocket> {
      const ws = new WebSocket(`ws://${host}:${port}`);
      
      // Wait for initial message
      await new Promise<void>((resolve) => {
        ws.on('open', () => {
          ws.once('message', () => resolve());
        });
      });
      
      // Authenticate
      ws.send(JSON.stringify({ type: 'auth', token }));
      await new Promise<void>((resolve) => {
        ws.once('message', () => resolve());
      });
      
      return ws;
    }

    it('should create a new session', async () => {
      await gateway.start();
      const config = gateway.getConfig();
      
      const ws = await connectAndAuth(config.port, config.host, authToken);
      
      // Create session
      ws.send(JSON.stringify({ type: 'create_session' }));
      
      const response = await new Promise<{ type: string; success: boolean; sessionId?: string }>((resolve) => {
        ws.once('message', (data) => {
          resolve(JSON.parse(data.toString()));
        });
      });
      
      expect(response.type).toBe('session_created');
      expect(response.success).toBe(true);
      expect(response.sessionId).toBeDefined();
      
      ws.close();
    });

    it('should load an existing session', async () => {
      await gateway.start();
      const config = gateway.getConfig();
      
      // Create a session first
      const session = await sessionManager.create();
      
      const ws = await connectAndAuth(config.port, config.host, authToken);
      
      // Load session
      ws.send(JSON.stringify({ type: 'load_session', sessionId: session.id }));
      
      const response = await new Promise<{ type: string; success: boolean; sessionId?: string }>((resolve) => {
        ws.once('message', (data) => {
          resolve(JSON.parse(data.toString()));
        });
      });
      
      expect(response.type).toBe('session_loaded');
      expect(response.success).toBe(true);
      expect(response.sessionId).toBe(session.id);
      
      ws.close();
    });

    it('should reject messages without session', async () => {
      await gateway.start();
      const config = gateway.getConfig();
      
      const ws = await connectAndAuth(config.port, config.host, authToken);
      
      // Try to send message without session
      ws.send(JSON.stringify({ type: 'message', content: 'Hello' }));
      
      const response = await new Promise<{ type: string; error?: string }>((resolve) => {
        ws.once('message', (data) => {
          resolve(JSON.parse(data.toString()));
        });
      });
      
      expect(response.type).toBe('error');
      expect(response.error).toContain('No session');
      
      ws.close();
    });
  });

  describe('graceful shutdown', () => {
    it('should close all connections on shutdown', async () => {
      await gateway.start();
      const config = gateway.getConfig();
      
      const ws = new WebSocket(`ws://${config.host}:${config.port}`);
      
      await new Promise<void>((resolve) => {
        ws.on('open', resolve);
      });
      
      expect(gateway.clientCount).toBe(1);
      
      // Stop gateway
      await gateway.stop();
      
      expect(gateway.clientCount).toBe(0);
      expect(gateway.isRunning).toBe(false);
    });
  });
});
