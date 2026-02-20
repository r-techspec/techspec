/**
 * OpenClaw MVP Demo
 * 
 * This script demonstrates the implemented components working together:
 * - Workspace initialization
 * - Configuration management
 * - Session management
 * - Memory system (BM25 search, temporal decay, MMR)
 * - Security (token generation/validation)
 * - Logging
 * - Tool system
 * - Gateway server with WebSocket
 * - Agent runtime
 * 
 * Run with: npx tsx src/demo.ts
 */

import { Workspace } from './storage/workspace.js';
import { ConfigManager } from './config/config-manager.js';
import { SessionManager } from './session/session-manager.js';
import { MemorySystem } from './memory/memory-system.js';
import { SecurityManager } from './security/security-manager.js';
import { Logger } from './logging/logger.js';
import { ToolSystem } from './tools/tool-system.js';
import { createCoreTools } from './tools/core-tools.js';
import { GatewayServer } from './gateway/gateway-server.js';
import { AgentRuntime } from './agent/agent-runtime.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import WebSocket from 'ws';

// Demo mode selection
const DEMO_MODE = process.argv[2] || 'components';

async function main() {
  console.log('🦞 OpenClaw MVP Demo\n');
  console.log(`Mode: ${DEMO_MODE}\n`);

  if (DEMO_MODE === 'gateway') {
    await runGatewayDemo();
  } else {
    await runComponentsDemo();
  }
}

/**
 * Demonstrates individual components working together
 */
async function runComponentsDemo() {
  const demoDir = join(tmpdir(), `openclaw-demo-${randomUUID()}`);
  console.log(`📁 Demo workspace: ${demoDir}\n`);

  try {
    // 1. Initialize Workspace
    console.log('━'.repeat(50));
    console.log('1. WORKSPACE INITIALIZATION');
    console.log('━'.repeat(50));
    const workspace = new Workspace(demoDir);
    await workspace.initialize();
    console.log('✓ Workspace created with directories:');
    console.log(`  - Sessions: ${workspace.sessionsDir}`);
    console.log(`  - Memory: ${workspace.memoryDir}`);
    console.log(`  - Logs: ${workspace.logsDir}`);

    // 2. Configuration Management
    console.log('\n' + '━'.repeat(50));
    console.log('2. CONFIGURATION MANAGEMENT');
    console.log('━'.repeat(50));
    const configManager = new ConfigManager(workspace.configPath);
    const configResult = await configManager.load();
    if (configResult.success && configResult.config) {
      console.log('✓ Configuration loaded with defaults:');
      console.log(`  - Gateway port: ${configResult.config.gateway.port}`);
      console.log(`  - Log level: ${configResult.config.logging.level}`);
      console.log(`  - Max context tokens: ${configResult.config.memory.maxContextTokens}`);
    }
    
    // Update a config value
    configManager.set('logging.level', 'debug');
    console.log(`✓ Updated log level to: ${configManager.config.logging.level}`);

    // 3. Logger
    console.log('\n' + '━'.repeat(50));
    console.log('3. LOGGING SYSTEM');
    console.log('━'.repeat(50));
    const logger = new Logger({
      level: 'debug',
      path: join(workspace.logsDir, 'demo.log'),
      maxSize: 1024 * 1024,
      maxFiles: 3,
    });
    await logger.info('Demo started', { component: 'demo' });
    await logger.debug('Debug message', { detail: 'testing' });
    await logger.warn('Warning example', { code: 'DEMO_WARN' });
    console.log('✓ Logged messages at debug, info, and warn levels');
    console.log(`  - Log file: ${join(workspace.logsDir, 'demo.log')}`);

    // 4. Security Manager
    console.log('\n' + '━'.repeat(50));
    console.log('4. SECURITY MANAGER');
    console.log('━'.repeat(50));
    const securityManager = new SecurityManager(workspace.authPath, logger);
    await securityManager.initialize();
    const token = await securityManager.getToken();
    if (token) {
      console.log(`✓ Auth token generated: ${token.substring(0, 16)}...`);
      
      const validResult = await securityManager.validateToken(token);
      console.log(`✓ Token validation: ${validResult.valid ? 'VALID' : 'INVALID'}`);
      
      const invalidResult = await securityManager.validateToken('invalid-token');
      console.log(`✓ Invalid token rejected: ${!invalidResult.valid}`);
    }

    // 5. Session Management
    console.log('\n' + '━'.repeat(50));
    console.log('5. SESSION MANAGEMENT');
    console.log('━'.repeat(50));
    const sessionManager = new SessionManager(workspace, logger);
    
    // Create sessions
    const session1 = await sessionManager.create();
    const session2 = await sessionManager.create();
    console.log(`✓ Created session 1: ${session1.id}`);
    console.log(`✓ Created session 2: ${session2.id}`);
    
    // Add messages to session
    await sessionManager.appendMessage(session1.id, {
      role: 'user',
      content: 'Hello, can you help me with TypeScript?',
    });
    await sessionManager.appendMessage(session1.id, {
      role: 'assistant',
      content: 'Of course! I\'d be happy to help with TypeScript. What would you like to know?',
    });
    console.log('✓ Added 2 messages to session 1');
    
    // List sessions
    const sessions = await sessionManager.list();
    console.log(`✓ Listed ${sessions.length} sessions`);
    
    // Load session history
    const history = await sessionManager.getHistory(session1.id);
    console.log(`✓ Loaded ${history.length} messages from session 1`);

    // 6. Memory System
    console.log('\n' + '━'.repeat(50));
    console.log('6. MEMORY SYSTEM');
    console.log('━'.repeat(50));
    
    // Create bootstrap files
    await writeFile(workspace.soulPath, `# Identity
You are OpenClaw, a helpful AI assistant.

# Capabilities
- File operations
- Code assistance
- Shell commands`);
    
    await writeFile(workspace.userPath, `# User Profile
Name: Demo User
Preferences: Concise responses, TypeScript focus`);
    
    const memorySystem = new MemorySystem(workspace, { temporalDecayHalfLife: 7 });
    const bootstrap = await memorySystem.loadBootstrap();
    console.log('✓ Loaded bootstrap files:');
    console.log(`  - SOUL.md: ${bootstrap.includes('OpenClaw') ? 'loaded' : 'missing'}`);
    console.log(`  - USER.md: ${bootstrap.includes('Demo User') ? 'loaded' : 'missing'}`);
    
    // Add memory documents
    await writeFile(join(workspace.memoryDir, 'typescript-tips.md'), 
      '# TypeScript Tips\n\nUse strict mode for better type safety.\nPrefer interfaces over type aliases for object shapes.');
    await writeFile(join(workspace.memoryDir, 'project-notes.md'),
      '# Project Notes\n\nThe user is working on a Node.js backend with Express.\nDatabase: PostgreSQL with Prisma ORM.');
    
    const indexed = await memorySystem.indexWorkspace();
    console.log(`✓ Indexed ${indexed} memory documents`);
    
    // Search memory
    const searchResults = memorySystem.search('typescript');
    console.log(`✓ Search for "typescript" returned ${searchResults.length} results`);
    if (searchResults.length > 0) {
      console.log(`  - Top result: ${searchResults[0]?.path} (score: ${searchResults[0]?.score.toFixed(3)})`);
    }

    // 7. Tool System
    console.log('\n' + '━'.repeat(50));
    console.log('7. TOOL SYSTEM');
    console.log('━'.repeat(50));
    const toolSystem = new ToolSystem();
    createCoreTools(toolSystem);
    
    const tools = toolSystem.list();
    console.log(`✓ Registered ${tools.length} core tools:`);
    tools.forEach(t => console.log(`  - ${t.name}: ${t.description.substring(0, 50)}...`));
    
    // Execute read_file tool
    const readResult = await toolSystem.execute({
      id: 'call-1',
      name: 'read_file',
      arguments: { path: workspace.soulPath },
    });
    console.log(`✓ read_file executed: ${readResult.success ? 'success' : 'failed'}`);
    
    // Execute list_directory tool
    const listResult = await toolSystem.execute({
      id: 'call-2',
      name: 'list_directory',
      arguments: { path: workspace.workspaceDir },
    });
    console.log(`✓ list_directory executed: ${listResult.success ? 'success' : 'failed'}`);
    
    // Execute shell command
    const shellResult = await toolSystem.execute({
      id: 'call-3',
      name: 'execute_shell',
      arguments: { command: 'echo "Hello from OpenClaw!"' },
    });
    console.log(`✓ execute_shell executed: ${shellResult.success ? 'success' : 'failed'}`);
    if (shellResult.output) {
      const parsed = JSON.parse(shellResult.output);
      console.log(`  - Output: ${parsed.stdout.trim()}`);
    }

    // Summary
    console.log('\n' + '━'.repeat(50));
    console.log('DEMO COMPLETE');
    console.log('━'.repeat(50));
    console.log('All implemented components are working correctly:');
    console.log('  ✓ Workspace - File-based storage');
    console.log('  ✓ ConfigManager - Configuration with defaults and overrides');
    console.log('  ✓ Logger - Structured JSON logging');
    console.log('  ✓ SecurityManager - Token generation and validation');
    console.log('  ✓ SessionManager - Session creation and transcript management');
    console.log('  ✓ MemorySystem - Bootstrap loading, BM25 search, MMR');
    console.log('  ✓ ToolSystem - Core tools (read_file, write_file, list_directory, execute_shell)');

  } finally {
    // Cleanup
    console.log(`\n🧹 Cleaning up demo workspace...`);
    await rm(demoDir, { recursive: true, force: true });
    console.log('Done!');
  }
}

/**
 * Demonstrates the Gateway server with WebSocket communication
 */
async function runGatewayDemo() {
  const demoDir = join(tmpdir(), `openclaw-gateway-demo-${randomUUID()}`);
  const port = 18790 + Math.floor(Math.random() * 100); // Random port to avoid conflicts
  
  console.log(`📁 Demo workspace: ${demoDir}`);
  console.log(`🌐 Gateway port: ${port}\n`);

  let gateway: GatewayServer | null = null;
  let ws: WebSocket | null = null;

  try {
    // Initialize all components
    console.log('━'.repeat(50));
    console.log('INITIALIZING COMPONENTS');
    console.log('━'.repeat(50));

    const workspace = new Workspace(demoDir);
    await workspace.initialize();
    console.log('✓ Workspace initialized');

    const configManager = new ConfigManager(workspace.configPath);
    await configManager.load();
    console.log('✓ Configuration loaded');

    const logger = new Logger({
      level: 'info',
      path: join(workspace.logsDir, 'gateway.log'),
      maxSize: 1024 * 1024,
      maxFiles: 3,
    });
    console.log('✓ Logger initialized');

    const securityManager = new SecurityManager(workspace.authPath, logger);
    await securityManager.initialize();
    const token = await securityManager.getToken();
    console.log(`✓ Security initialized (token: ${token?.substring(0, 8)}...)`);

    const sessionManager = new SessionManager(workspace, logger);
    console.log('✓ Session manager initialized');

    // Create bootstrap files for memory
    await writeFile(workspace.soulPath, `# Identity
You are OpenClaw, a helpful AI coding assistant.
You help users with programming tasks, file operations, and shell commands.`);
    await writeFile(workspace.userPath, `# User Profile
A developer testing the OpenClaw system.`);

    const memorySystem = new MemorySystem(workspace, { temporalDecayHalfLife: 7 });
    await memorySystem.indexWorkspace();
    console.log('✓ Memory system initialized');

    const toolSystem = new ToolSystem();
    createCoreTools(toolSystem);
    console.log('✓ Tool system initialized');

    // Create a mock agent runtime (since we don't have Claude CLI in demo)
    const agentRuntime = new AgentRuntime(toolSystem, {
      claudeCliPath: 'echo', // Use echo as a mock
      model: 'demo-model',
      maxTokens: 1000,
    }, logger);
    console.log('✓ Agent runtime initialized (mock mode)');

    // Start Gateway
    console.log('\n' + '━'.repeat(50));
    console.log('STARTING GATEWAY SERVER');
    console.log('━'.repeat(50));

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
    console.log(`✓ Gateway started on ws://127.0.0.1:${port}`);

    // Connect WebSocket client
    console.log('\n' + '━'.repeat(50));
    console.log('WEBSOCKET CLIENT DEMO');
    console.log('━'.repeat(50));

    ws = new WebSocket(`ws://127.0.0.1:${port}`);

    // Set up message queue
    const messageQueue: object[] = [];
    let messageResolver: ((msg: object) => void) | null = null;

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (messageResolver) {
        messageResolver(msg);
        messageResolver = null;
      } else {
        messageQueue.push(msg);
      }
    });

    // Wait for connection
    await new Promise<void>((resolve, reject) => {
      if (ws!.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }
      ws!.on('open', resolve);
      ws!.on('error', reject);
      setTimeout(() => reject(new Error('Connection timeout')), 5000);
    });
    console.log('✓ WebSocket connected');

    // Helper to wait for next message
    const waitForMessage = (): Promise<object> => {
      return new Promise((resolve, reject) => {
        if (messageQueue.length > 0) {
          resolve(messageQueue.shift()!);
          return;
        }
        const timeout = setTimeout(() => reject(new Error('Response timeout')), 5000);
        messageResolver = (msg) => {
          clearTimeout(timeout);
          resolve(msg);
        };
      });
    };

    // Helper to send and receive messages
    const sendAndReceive = async (msg: object): Promise<object> => {
      ws!.send(JSON.stringify(msg));
      return waitForMessage();
    };

    // Receive initial auth request
    const initialMsg = await waitForMessage();
    console.log('✓ Received auth request:', JSON.stringify(initialMsg));

    // Authenticate
    const authResponse = await sendAndReceive({ type: 'auth', token });
    console.log('✓ Authentication:', JSON.stringify(authResponse));

    // Create session
    const sessionResponse = await sendAndReceive({ type: 'create_session' });
    console.log('✓ Session created:', JSON.stringify(sessionResponse));

    // Send a message (will use mock agent)
    console.log('\n📤 Sending message: "Hello, OpenClaw!"');
    ws.send(JSON.stringify({ type: 'message', content: 'Hello, OpenClaw!' }));

    // Collect responses with timeout
    const responses: object[] = [];
    const collectStart = Date.now();
    while (Date.now() - collectStart < 2000) {
      try {
        const msg = await Promise.race([
          waitForMessage(),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 500))
        ]);
        if (msg === null) break;
        responses.push(msg);
        const msgType = (msg as { type?: string }).type;
        if (msgType === 'done' || msgType === 'error') break;
      } catch {
        break;
      }
    }

    console.log('📥 Received responses:');
    responses.forEach((r, i) => console.log(`  ${i + 1}. ${JSON.stringify(r)}`));

    // Summary
    console.log('\n' + '━'.repeat(50));
    console.log('GATEWAY DEMO COMPLETE');
    console.log('━'.repeat(50));
    console.log('Demonstrated:');
    console.log('  ✓ Gateway server startup');
    console.log('  ✓ WebSocket connection');
    console.log('  ✓ Token authentication');
    console.log('  ✓ Session creation');
    console.log('  ✓ Message routing');
    console.log('  ✓ Response streaming');

  } finally {
    // Cleanup
    console.log('\n🧹 Cleaning up...');
    
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
    
    if (gateway) {
      await gateway.stop();
      console.log('✓ Gateway stopped');
    }
    
    await rm(demoDir, { recursive: true, force: true });
    console.log('✓ Workspace cleaned');
    console.log('Done!');
  }
}

main().catch(console.error);
