/**
 * Start command - Starts the Gateway process
 * 
 * Requirements:
 * - 7.1: Provide start command for gateway
 */

import { Command } from 'commander';
import { spawn, type ChildProcess } from 'node:child_process';
import { Workspace } from '../../storage/workspace.js';
import { ConfigManager, DEFAULT_CONFIG } from '../../config/config-manager.js';
import { Logger } from '../../logging/logger.js';
import { SecurityManager } from '../../security/security-manager.js';
import { SessionManager } from '../../session/session-manager.js';
import { AgentRuntime } from '../../agent/agent-runtime.js';
import { GatewayServer, DEFAULT_GATEWAY_CONFIG } from '../../gateway/gateway-server.js';
import { ToolSystem, createCoreTools } from '../../tools/index.js';
import { MemorySystem } from '../../memory/memory-system.js';

interface StartOptions {
  port?: number;
  detach?: boolean;
}

/**
 * Creates the start command
 */
export function startCommand(): Command {
  const cmd = new Command('start');

  cmd
    .description('Start the Gateway server')
    .option('-p, --port <port>', 'Port to listen on', parseInt)
    .option('-d, --detach', 'Run in background (detached mode)')
    .action(async (options: StartOptions) => {
      await runStart(options);
    });

  return cmd;
}

/**
 * Runs the start command
 */
async function runStart(options: StartOptions): Promise<void> {
  const workspace = new Workspace();
  
  // Initialize workspace if needed
  if (!(await workspace.exists())) {
    await workspace.initialize();
    console.log(`Created workspace at ${workspace.root}`);
  }

  // Load configuration
  const configManager = new ConfigManager(workspace.configPath);
  const configResult = await configManager.load();
  
  if (!configResult.success) {
    console.error('Configuration error:', configResult.errors?.join('\n'));
    process.exit(1);
  }

  const config = configResult.config ?? DEFAULT_CONFIG;
  const port = options.port ?? config.gateway.port;

  if (options.detach) {
    // Spawn detached process
    await startDetached(port);
  } else {
    // Run in foreground
    await startForeground(workspace, configManager, port);
  }
}

/**
 * Starts the gateway in detached mode
 */
async function startDetached(port: number): Promise<void> {
  const scriptPath = new URL(import.meta.url).pathname;
  
  // Spawn a new process that runs the gateway
  const child: ChildProcess = spawn(
    process.execPath,
    [scriptPath, '--port', String(port)],
    {
      detached: true,
      stdio: 'ignore',
    }
  );

  child.unref();
  
  console.log(`Gateway started in background on port ${port}`);
  console.log(`PID: ${child.pid}`);
}

/**
 * Starts the gateway in foreground mode
 */
async function startForeground(
  workspace: Workspace,
  configManager: ConfigManager,
  port: number
): Promise<void> {
  const config = configManager.config;
  
  // Initialize logger
  const logger = new Logger({
    level: config.logging.level,
    path: workspace.logPath('openclaw.log'),
    maxSize: config.logging.maxSize,
    maxFiles: config.logging.maxFiles,
  });

  // Initialize security manager
  const securityManager = new SecurityManager(workspace.authPath, logger);
  
  // Initialize session manager
  const sessionManager = new SessionManager(workspace, logger);

  // Initialize tool system
  const toolSystem = new ToolSystem();
  createCoreTools(toolSystem);

  // Initialize memory system
  const memorySystem = new MemorySystem(workspace, {
    workspacePath: workspace.workspaceDir,
    maxContextTokens: config.memory.maxContextTokens,
    temporalDecayHalfLife: config.memory.temporalDecayHalfLife,
  }, logger);
  
  // Index workspace for memory search
  await memorySystem.indexWorkspace();

  // Initialize agent runtime with logger
  const agentRuntime = new AgentRuntime(toolSystem, {
    claudeCliPath: config.agent.claudeCliPath,
    model: config.agent.model,
    maxTokens: config.agent.maxTokens,
  }, logger);

  // Create and start gateway with all components wired together
  const gateway = new GatewayServer(
    { port, host: config.gateway.host },
    logger,
    securityManager,
    sessionManager,
    agentRuntime,
    configManager,
    memorySystem,
    toolSystem
  );

  // Handle shutdown signals
  const shutdown = async () => {
    console.log('\nShutting down...');
    await gateway.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  try {
    await gateway.start();
    
    // Display token for first-time setup
    const token = await securityManager.getToken();
    console.log(`Gateway started on ${config.gateway.host}:${port}`);
    console.log(`Auth token: ${token}`);
    console.log('\nPress Ctrl+C to stop');
  } catch (error) {
    console.error('Failed to start gateway:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
