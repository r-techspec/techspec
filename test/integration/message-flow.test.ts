/**
 * Integration tests for end-to-end message flow
 * 
 * Tests the complete flow: CLI → Gateway → Agent → Storage
 * 
 * Requirements: All (integration verification)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Workspace } from '../../src/storage/workspace.js';
import { ConfigManager } from '../../src/config/config-manager.js';
import { Logger } from '../../src/logging/logger.js';
import { SecurityManager } from '../../src/security/security-manager.js';
import { SessionManager } from '../../src/session/session-manager.js';
import { MemorySystem } from '../../src/memory/memory-system.js';
import { ToolSystem, createCoreTools } from '../../src/tools/index.js';
import { AgentRuntime } from '../../src/agent/agent-runtime.js';
import { GatewayServer } from '../../src/gateway/gateway-server.js';

describe('End-to-End Message Flow', () => {
  let tempDir: string;
  let workspace: Workspace;
  let logger: Logger;
  let securityManager: SecurityManager;
  let sessionManager: SessionManager;
  let memorySystem: MemorySystem;
  let toolSystem: ToolSystem;
  let agentRuntime: AgentRuntime;
  let configManager: ConfigManager;
  let gateway: GatewayServer;
  let authToken: string;
  let port: number;

  beforeEach(async () => {
    // Create temp directory for workspace
    tempDir = await mkdtemp(join(tmpdir(), 'openclaw-integration-test-'));
    workspace = new Workspace(tempDir);
    await workspace.initialize();

    // Create bootstrap files
    await writeFile(workspace.soulPath, `# Identity
You are OpenClaw, a helpful AI assistant.

# Capabilities
- File operations
- Code assistance`);

    await writeFile(workspace.userPath, `# User Profile
Name: Test User
Preferences: Concise responses`);

    // Create memory documents
    await writeFile(join(workspace.memoryDir, 'test-notes.md'), 
      '# Test Notes\n\nThis is a test document for memory search.');

    // Initialize all components
    logger = new Logger({ 
      level: 'debug', 
      path: join(tempDir, 'test.log'), 
      maxSize: 1024 * 1024, 
      maxFiles: 1 
    });

    securityManager = new SecurityManager(workspace.authPath, logger);
    sessionManager = new SessionManager(workspace, logger);
    configManager = new ConfigManager(workspace.configPath);
    
    toolSystem = new ToolSystem();
    createCoreTools(toolSystem);

    memorySystem = new MemorySystem(workspace, {
      workspacePath: workspace.workspaceDir,
      maxContextTokens: 100000,
      temporalDecayHalfLife: 7,
    }, logger);
    await memorySystem.indexWorkspace();

    agentRuntime = new AgentRuntime(toolSystem, {}, logger);

    // Initialize security and get token
    authToken = await securityManager.initialize();

    // Create gateway with random port
    port = 19000 + Math.floor(Math.random() * 1000);
    gateway = new GatewayServer(
      { port, host: '127.0.0.1' },
      logger,
      securityManager,
      sessionManager,
      agentRuntime,
      configManager,
      memorySystem,
      toolSystem
    );

    await gateway.start();
  });

  afterEach(async () => {
    if (gateway.isRunning) {
      await gateway.stop();
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  /**
   * Helper to connect and authenticate
   */
  async function connectAndAuth(): Promise<WebSocket> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    
    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => {
        ws.once('message', () => resolve());
      });
      ws.on('error', reject);
    });
    
    ws.send(JSON.stringify({ type: 'auth', token: authToken }));
    
    await new Promise<void>((resolve, reject) => {
      ws.once('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.success) resolve();
        else reject(new Error(msg.error));
      });
    });
    
    return ws;
  }

  /**
   * Helper to create a session
   */
  async function createSession(ws: WebSocket): Promise<string> {
    ws.send(JSON.stringify({ type: 'create_session' }));
    
    const response = await new Promise<{ sessionId: string }>((resolve) => {
      ws.once('message', (data) => {
        resolve(JSON.parse(data.toString()));
      });
    });
    
    return response.sessionId;
  }

  describe('Component Integration', () => {
    it('should wire all components together correctly', async () => {
      // Verify gateway is running
      expect(gateway.isRunning).toBe(true);
      
      // Verify security manager has token
      const token = await securityManager.getToken();
      expect(token).toBe(authToken);
      
      // Verify memory system loaded bootstrap
      const bootstrap = await memorySystem.loadBootstrap();
      expect(bootstrap).toContain('OpenClaw');
      expect(bootstrap).toContain('Test User');
      
      // Verify tool system has core tools
      const tools = toolSystem.list();
      expect(tools.length).toBeGreaterThan(0);
      expect(tools.some(t => t.name === 'read_file')).toBe(true);
    });

    it('should authenticate and create session through gateway', async () => {
      const ws = await connectAndAuth();
      const sessionId = await createSession(ws);
      
      expect(sessionId).toBeDefined();
      expect(sessionId.length).toBeGreaterThan(0);
      
      // Verify session was created in session manager
      const sessions = await sessionManager.list();
      expect(sessions.some(s => s.id === sessionId)).toBe(true);
      
      ws.close();
    });

    it('should persist messages to session transcript', async () => {
      const ws = await connectAndAuth();
      const sessionId = await createSession(ws);
      
      // Send a message (will fail to process with Claude but should still record)
      ws.send(JSON.stringify({ type: 'message', content: 'Hello, test message' }));
      
      // Wait for response (error or done expected)
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, 3000);
        ws.on('message', (data) => {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'done' || msg.type === 'error') {
            clearTimeout(timeout);
            resolve();
          }
        });
      });
      
      // Verify message was appended to transcript
      const history = await sessionManager.getHistory(sessionId);
      expect(history.length).toBeGreaterThan(0);
      expect(history[0]?.content).toBe('Hello, test message');
      expect(history[0]?.role).toBe('user');
      
      ws.close();
    }, 15000);

    it('should load session and preserve history', async () => {
      // Create session and add messages directly
      const session = await sessionManager.create();
      await sessionManager.appendMessage(session.id, {
        role: 'user',
        content: 'First message',
      });
      await sessionManager.appendMessage(session.id, {
        role: 'assistant',
        content: 'First response',
      });
      
      // Connect and load the session
      const ws = await connectAndAuth();
      ws.send(JSON.stringify({ type: 'load_session', sessionId: session.id }));
      
      const response = await new Promise<{ type: string; sessionId: string }>((resolve) => {
        ws.once('message', (data) => {
          resolve(JSON.parse(data.toString()));
        });
      });
      
      expect(response.type).toBe('session_loaded');
      expect(response.sessionId).toBe(session.id);
      
      // Verify history is preserved
      const history = await sessionManager.getHistory(session.id);
      expect(history.length).toBe(2);
      
      ws.close();
    });
  });

  describe('Memory System Integration', () => {
    it('should search memory and return relevant results', () => {
      const results = memorySystem.search('test notes', 5);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.content).toContain('test document');
    });

    it('should load bootstrap files into context', async () => {
      const bootstrap = await memorySystem.loadBootstrap();
      expect(bootstrap).toContain('OpenClaw');
      expect(bootstrap).toContain('Test User');
    });
  });

  describe('Tool System Integration', () => {
    it('should execute read_file tool', async () => {
      const result = await toolSystem.execute({
        id: 'test-1',
        name: 'read_file',
        arguments: { path: workspace.soulPath },
      });
      
      expect(result.success).toBe(true);
      expect(result.output).toContain('OpenClaw');
    });

    it('should execute list_directory tool', async () => {
      const result = await toolSystem.execute({
        id: 'test-2',
        name: 'list_directory',
        arguments: { path: workspace.workspaceDir },
      });
      
      expect(result.success).toBe(true);
      expect(result.output).toContain('SOUL.md');
    });

    it('should execute execute_shell tool', async () => {
      const result = await toolSystem.execute({
        id: 'test-3',
        name: 'execute_shell',
        arguments: { command: 'echo "integration test"' },
      });
      
      expect(result.success).toBe(true);
      expect(result.output).toContain('integration test');
    });
  });

  describe('Security Integration', () => {
    it('should reject invalid tokens', async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      
      await new Promise<void>((resolve) => {
        ws.on('open', () => {
          ws.once('message', () => resolve());
        });
      });
      
      ws.send(JSON.stringify({ type: 'auth', token: 'invalid-token' }));
      
      const response = await new Promise<{ success: boolean; error?: string }>((resolve) => {
        ws.once('message', (data) => {
          resolve(JSON.parse(data.toString()));
        });
      });
      
      expect(response.success).toBe(false);
      expect(response.error).toContain('Invalid');
      
      ws.close();
    });

    it('should require authentication for operations', async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      
      await new Promise<void>((resolve) => {
        ws.on('open', () => {
          ws.once('message', () => resolve());
        });
      });
      
      // Try to create session without auth
      ws.send(JSON.stringify({ type: 'create_session' }));
      
      const response = await new Promise<{ type: string; error?: string }>((resolve) => {
        ws.once('message', (data) => {
          resolve(JSON.parse(data.toString()));
        });
      });
      
      expect(response.type).toBe('error');
      expect(response.error).toContain('Not authenticated');
      
      ws.close();
    });
  });

  describe('Graceful Shutdown', () => {
    it('should complete shutdown with active connections', async () => {
      const ws = await connectAndAuth();
      await createSession(ws);
      
      expect(gateway.clientCount).toBe(1);
      
      // Shutdown should complete
      await gateway.stop();
      
      expect(gateway.isRunning).toBe(false);
      expect(gateway.clientCount).toBe(0);
    });
  });
});
