import { WebSocketServer, WebSocket, type RawData } from 'ws';
import { createServer, type Server as HttpServer, type IncomingMessage } from 'node:http';
import { randomUUID } from 'node:crypto';
import { Logger } from '../logging/logger.js';
import { SecurityManager } from '../security/security-manager.js';
import { SessionManager } from '../session/session-manager.js';
import { AgentRuntime, type AgentEvent } from '../agent/agent-runtime.js';
import { ConfigManager } from '../config/config-manager.js';
import { MemorySystem } from '../memory/memory-system.js';
import { ToolSystem } from '../tools/tool-system.js';
import { watch, type FSWatcher } from 'node:fs';

/**
 * Gateway configuration
 * Requirement 1.1: Bind to configurable port
 */
export interface GatewayConfig {
  port: number;
  host: string;
}

/**
 * Default gateway configuration
 */
export const DEFAULT_GATEWAY_CONFIG: GatewayConfig = {
  port: 18789,
  host: '127.0.0.1',
};

/**
 * Client connection state
 */
interface ClientConnection {
  id: string;
  ws: WebSocket;
  authenticated: boolean;
  sessionId?: string;
  connectedAt: number;
}

/**
 * Gateway event types for broadcasting
 */
export interface GatewayEvent {
  type: 'message' | 'tool_call' | 'tool_result' | 'error' | 'session_update';
  sessionId: string;
  payload: unknown;
  timestamp: number;
}

/**
 * Client message types
 */
interface ClientMessage {
  type: 'auth' | 'message' | 'create_session' | 'load_session';
  token?: string;
  sessionId?: string;
  content?: string;
}

/**
 * Server response types
 */
interface ServerResponse {
  type: 'auth_result' | 'session_created' | 'session_loaded' | 'text_delta' | 
        'tool_call' | 'tool_result' | 'done' | 'error';
  success?: boolean;
  sessionId?: string;
  content?: string;
  error?: string;
  payload?: unknown;
}

/**
 * In-flight request tracking for graceful shutdown
 */
interface InFlightRequest {
  sessionId: string;
  clientId: string;
  startedAt: number;
  abortController: AbortController;
}


/**
 * GatewayServer - WebSocket server for coordinating message handling
 * 
 * Requirements:
 * - 1.1: Bind to configurable port and accept WebSocket connections
 * - 1.2: Authenticate connections using local token
 * - 1.3: Maintain session state and route messages to Agent_Runtime
 * - 1.4: Log fatal errors and attempt graceful shutdown
 * - 1.5: Complete in-flight requests before terminating
 * - 8.5: Support hot-reload of configuration
 */
export class GatewayServer {
  private config: GatewayConfig;
  private httpServer: HttpServer | null = null;
  private wss: WebSocketServer | null = null;
  private clients: Map<string, ClientConnection> = new Map();
  private inFlightRequests: Map<string, InFlightRequest> = new Map();
  private isShuttingDown = false;
  private configWatcher: FSWatcher | null = null;
  
  private logger: Logger;
  private securityManager: SecurityManager;
  private sessionManager: SessionManager;
  private agentRuntime: AgentRuntime;
  private configManager: ConfigManager;
  private memorySystem: MemorySystem | null = null;
  private toolSystem: ToolSystem | null = null;

  constructor(
    config: Partial<GatewayConfig>,
    logger: Logger,
    securityManager: SecurityManager,
    sessionManager: SessionManager,
    agentRuntime: AgentRuntime,
    configManager: ConfigManager,
    memorySystem?: MemorySystem,
    toolSystem?: ToolSystem
  ) {
    this.config = { ...DEFAULT_GATEWAY_CONFIG, ...config };
    this.logger = logger;
    this.securityManager = securityManager;
    this.sessionManager = sessionManager;
    this.agentRuntime = agentRuntime;
    this.configManager = configManager;
    this.memorySystem = memorySystem ?? null;
    this.toolSystem = toolSystem ?? null;
  }

  /**
   * Gets the current configuration
   */
  getConfig(): GatewayConfig {
    return { ...this.config };
  }

  /**
   * Gets the number of connected clients
   */
  get clientCount(): number {
    return this.clients.size;
  }

  /**
   * Gets the number of in-flight requests
   */
  get inFlightCount(): number {
    return this.inFlightRequests.size;
  }

  /**
   * Checks if the server is running
   */
  get isRunning(): boolean {
    return this.httpServer !== null && this.httpServer.listening;
  }

  /**
   * Starts the Gateway server
   * Requirement 1.1: Bind to configurable port and accept WebSocket connections
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error('Gateway server is already running');
    }

    // Initialize security manager to ensure token exists
    await this.securityManager.initialize();

    // Create HTTP server
    this.httpServer = createServer();

    // Create WebSocket server
    this.wss = new WebSocketServer({ 
      server: this.httpServer,
      clientTracking: true,
    });

    // Set up WebSocket event handlers
    this.wss.on('connection', (ws, req) => this.handleConnection(ws, req));
    this.wss.on('error', (error) => this.handleServerError(error));

    // Start listening
    await new Promise<void>((resolve, reject) => {
      this.httpServer!.on('error', reject);
      this.httpServer!.listen(this.config.port, this.config.host, () => {
        this.httpServer!.removeListener('error', reject);
        resolve();
      });
    });

    await this.logger.info('Gateway server started', {
      operation: 'gateway_start',
      port: this.config.port,
      host: this.config.host,
    });

    // Start config file watcher for hot-reload
    this.startConfigWatcher();
  }

  /**
   * Handles new WebSocket connections
   * Requirement 1.2: Authenticate connections using local token
   */
  private handleConnection(ws: WebSocket, req: IncomingMessage): void {
    const clientId = randomUUID();
    const clientInfo = {
      id: clientId,
      remoteAddress: req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
    };

    const connection: ClientConnection = {
      id: clientId,
      ws,
      authenticated: false,
      connectedAt: Date.now(),
    };

    this.clients.set(clientId, connection);

    this.logger.info('Client connected', {
      operation: 'client_connect',
      ...clientInfo,
    }).catch(() => {});

    // Set up message handler
    ws.on('message', (data) => this.handleMessage(clientId, data));
    
    // Set up close handler
    ws.on('close', () => this.handleDisconnect(clientId));
    
    // Set up error handler
    ws.on('error', (error) => this.handleClientError(clientId, error));

    // Send welcome message requesting authentication
    this.send(ws, {
      type: 'auth_result',
      success: false,
      error: 'Authentication required',
    });
  }


  /**
   * Handles incoming messages from clients
   * Requirement 1.3: Route messages to Agent_Runtime
   */
  private async handleMessage(clientId: string, data: RawData): Promise<void> {
    const connection = this.clients.get(clientId);
    if (!connection) return;

    let message: ClientMessage;
    try {
      message = JSON.parse(data.toString()) as ClientMessage;
    } catch {
      this.send(connection.ws, {
        type: 'error',
        error: 'Invalid JSON message',
      });
      return;
    }

    // Handle authentication
    if (message.type === 'auth') {
      await this.handleAuth(connection, message.token ?? '');
      return;
    }

    // All other messages require authentication
    if (!connection.authenticated) {
      this.send(connection.ws, {
        type: 'error',
        error: 'Not authenticated',
      });
      return;
    }

    // Route message based on type
    switch (message.type) {
      case 'create_session':
        await this.handleCreateSession(connection);
        break;
      case 'load_session':
        await this.handleLoadSession(connection, message.sessionId ?? '');
        break;
      case 'message':
        await this.handleUserMessage(connection, message.content ?? '');
        break;
      default:
        this.send(connection.ws, {
          type: 'error',
          error: `Unknown message type: ${(message as { type: string }).type}`,
        });
    }
  }

  /**
   * Handles authentication requests
   * Requirement 1.2: Authenticate connections using local token
   */
  private async handleAuth(connection: ClientConnection, token: string): Promise<void> {
    const result = await this.securityManager.validateToken(token, {
      clientId: connection.id,
    });

    if (result.valid) {
      connection.authenticated = true;
      this.send(connection.ws, {
        type: 'auth_result',
        success: true,
      });
      await this.logger.info('Client authenticated', {
        operation: 'client_auth',
        clientId: connection.id,
      });
    } else {
      this.send(connection.ws, {
        type: 'auth_result',
        success: false,
        error: result.reason ?? 'Authentication failed',
      });
    }
  }

  /**
   * Handles session creation requests
   */
  private async handleCreateSession(connection: ClientConnection): Promise<void> {
    try {
      const session = await this.sessionManager.create();
      connection.sessionId = session.id;
      
      this.send(connection.ws, {
        type: 'session_created',
        success: true,
        sessionId: session.id,
      });

      await this.logger.info('Session created', {
        operation: 'session_create',
        clientId: connection.id,
        sessionId: session.id,
      });
    } catch (error) {
      this.send(connection.ws, {
        type: 'error',
        error: `Failed to create session: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  /**
   * Handles session loading requests
   */
  private async handleLoadSession(connection: ClientConnection, sessionId: string): Promise<void> {
    try {
      const session = await this.sessionManager.load(sessionId);
      connection.sessionId = session.id;
      
      this.send(connection.ws, {
        type: 'session_loaded',
        success: true,
        sessionId: session.id,
      });

      await this.logger.info('Session loaded', {
        operation: 'session_load',
        clientId: connection.id,
        sessionId: session.id,
      });
    } catch (error) {
      this.send(connection.ws, {
        type: 'error',
        error: `Failed to load session: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  /**
   * Handles user messages and routes to Agent Runtime
   * Requirement 1.3: Route messages to Agent_Runtime
   */
  private async handleUserMessage(connection: ClientConnection, content: string): Promise<void> {
    if (!connection.sessionId) {
      this.send(connection.ws, {
        type: 'error',
        error: 'No session selected. Create or load a session first.',
      });
      return;
    }

    if (this.isShuttingDown) {
      this.send(connection.ws, {
        type: 'error',
        error: 'Server is shutting down. Please try again later.',
      });
      return;
    }

    const sessionId = connection.sessionId;
    const requestId = randomUUID();
    const abortController = new AbortController();

    // Track in-flight request
    this.inFlightRequests.set(requestId, {
      sessionId,
      clientId: connection.id,
      startedAt: Date.now(),
      abortController,
    });

    try {
      // Append user message to transcript
      await this.sessionManager.appendMessage(sessionId, {
        role: 'user',
        content,
      });

      // Get session history
      const history = await this.sessionManager.getHistory(sessionId);

      // Build system prompt from memory system
      let systemPrompt = '';
      if (this.memorySystem) {
        // Load bootstrap files (SOUL.md, USER.md)
        systemPrompt = await this.memorySystem.loadBootstrap();
        
        // Search for relevant context
        const searchResults = this.memorySystem.search(content, 5);
        if (searchResults.length > 0) {
          const contextSection = searchResults
            .map(r => `[From ${r.path}]:\n${r.content}`)
            .join('\n\n');
          systemPrompt += `\n\n## Relevant Context\n${contextSection}`;
        }
      }

      // Get tool definitions
      const tools = this.toolSystem ? this.toolSystem.list() : [];

      // Run agent
      const agentParams = {
        sessionId,
        systemPrompt,
        history,
        userMessage: content,
        tools,
      };

      let fullResponse = '';
      
      for await (const event of this.agentRuntime.run(agentParams)) {
        // Check if request was aborted (during shutdown)
        if (abortController.signal.aborted) {
          break;
        }

        // Stream events to client
        this.streamAgentEvent(connection.ws, sessionId, event);

        // Collect full response
        if (event.type === 'text_delta') {
          fullResponse += event.content;
        }
      }

      // Append assistant response to transcript
      if (fullResponse) {
        await this.sessionManager.appendMessage(sessionId, {
          role: 'assistant',
          content: fullResponse,
        });
      }

    } catch (error) {
      await this.logger.error('Error processing message', error, {
        operation: 'message_process',
        clientId: connection.id,
        sessionId,
      });

      this.send(connection.ws, {
        type: 'error',
        error: `Failed to process message: ${error instanceof Error ? error.message : String(error)}`,
      });
    } finally {
      this.inFlightRequests.delete(requestId);
    }
  }


  /**
   * Streams agent events to the client
   */
  private streamAgentEvent(ws: WebSocket, sessionId: string, event: AgentEvent): void {
    switch (event.type) {
      case 'text_delta':
        this.send(ws, {
          type: 'text_delta',
          sessionId,
          content: event.content,
        });
        break;
      case 'tool_call':
        this.send(ws, {
          type: 'tool_call',
          sessionId,
          payload: event.toolCall,
        });
        break;
      case 'tool_result':
        this.send(ws, {
          type: 'tool_result',
          sessionId,
          payload: event.toolResult,
        });
        break;
      case 'done':
        this.send(ws, {
          type: 'done',
          sessionId,
          content: event.fullResponse,
        });
        break;
      case 'error':
        this.send(ws, {
          type: 'error',
          sessionId,
          error: event.error.message,
        });
        break;
    }
  }

  /**
   * Handles client disconnection
   */
  private handleDisconnect(clientId: string): void {
    const connection = this.clients.get(clientId);
    if (connection) {
      this.clients.delete(clientId);
      this.logger.info('Client disconnected', {
        operation: 'client_disconnect',
        clientId,
        ...(connection.sessionId ? { sessionId: connection.sessionId } : {}),
      }).catch(() => {});
    }
  }

  /**
   * Handles client errors
   */
  private handleClientError(clientId: string, error: Error): void {
    this.logger.error('Client error', error, {
      operation: 'client_error',
      clientId,
    }).catch(() => {});
  }

  /**
   * Handles server-level errors
   * Requirement 1.4: Log fatal errors and attempt graceful shutdown
   */
  private handleServerError(error: Error): void {
    this.logger.error('Gateway server error', error, {
      operation: 'gateway_error',
    }).catch(() => {});

    // Attempt graceful shutdown on fatal errors
    if (this.isFatalError(error)) {
      this.stop().catch(() => {});
    }
  }

  /**
   * Determines if an error is fatal and requires shutdown
   */
  private isFatalError(error: Error): boolean {
    const fatalCodes = ['EADDRINUSE', 'EACCES', 'EPERM'];
    return fatalCodes.includes((error as NodeJS.ErrnoException).code ?? '');
  }

  /**
   * Sends a message to a WebSocket client
   */
  private send(ws: WebSocket, message: ServerResponse): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  /**
   * Broadcasts an event to all authenticated clients
   */
  broadcast(event: GatewayEvent): void {
    const message = JSON.stringify(event);
    for (const connection of this.clients.values()) {
      if (connection.authenticated && connection.ws.readyState === WebSocket.OPEN) {
        connection.ws.send(message);
      }
    }
  }

  /**
   * Starts watching the config file for hot-reload
   * Requirement 8.5: Support hot-reload of configuration
   */
  private startConfigWatcher(): void {
    try {
      this.configWatcher = watch(this.configManager.path, async (eventType) => {
        if (eventType === 'change') {
          await this.handleConfigChange();
        }
      });
    } catch {
      // Config file may not exist yet
      this.logger.warn('Could not start config watcher', {
        operation: 'config_watch',
        path: this.configManager.path,
      }).catch(() => {});
    }
  }

  /**
   * Handles configuration file changes
   * Requirement 8.5: Apply changes without restart
   */
  private async handleConfigChange(): Promise<void> {
    try {
      const result = await this.configManager.load();
      if (result.success && result.config) {
        // Update gateway config if port/host changed
        const newGatewayConfig = result.config.gateway;
        const configChanged = 
          newGatewayConfig.port !== this.config.port ||
          newGatewayConfig.host !== this.config.host;

        if (configChanged) {
          await this.logger.info('Configuration changed - restart required for port/host changes', {
            operation: 'config_reload',
            oldPort: this.config.port,
            newPort: newGatewayConfig.port,
            oldHost: this.config.host,
            newHost: newGatewayConfig.host,
          });
        }

        // Update non-restart-requiring config
        this.config = { ...this.config, ...newGatewayConfig };

        await this.logger.info('Configuration reloaded', {
          operation: 'config_reload',
        });
      }
    } catch (error) {
      await this.logger.error('Failed to reload configuration', error, {
        operation: 'config_reload',
      });
    }
  }

  /**
   * Stops the Gateway server gracefully
   * Requirement 1.5: Complete in-flight requests before terminating
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.isShuttingDown = true;

    await this.logger.info('Gateway server shutting down', {
      operation: 'gateway_shutdown',
      inFlightRequests: this.inFlightRequests.size,
      connectedClients: this.clients.size,
    });

    // Stop accepting new connections
    if (this.wss) {
      this.wss.close();
    }

    // Stop config watcher
    if (this.configWatcher) {
      this.configWatcher.close();
      this.configWatcher = null;
    }

    // Wait for in-flight requests to complete (with timeout)
    const shutdownTimeout = 30000; // 30 seconds
    const startTime = Date.now();

    while (this.inFlightRequests.size > 0 && Date.now() - startTime < shutdownTimeout) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Abort any remaining requests
    for (const request of this.inFlightRequests.values()) {
      request.abortController.abort();
    }
    this.inFlightRequests.clear();

    // Close all client connections
    for (const connection of this.clients.values()) {
      connection.ws.close(1001, 'Server shutting down');
    }
    this.clients.clear();

    // Close HTTP server
    if (this.httpServer) {
      await new Promise<void>((resolve) => {
        this.httpServer!.close(() => resolve());
      });
      this.httpServer = null;
    }

    this.wss = null;
    this.isShuttingDown = false;

    await this.logger.info('Gateway server stopped', {
      operation: 'gateway_stopped',
    });
  }
}
