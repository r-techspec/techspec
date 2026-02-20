/**
 * Gateway connection utilities
 * 
 * Requirements:
 * - 7.5: Display helpful error message when Gateway not running
 */

import WebSocket from 'ws';
import { readFileSync, accessSync, constants } from 'node:fs';
import { Workspace } from '../../storage/workspace.js';
import { ConfigManager, DEFAULT_CONFIG } from '../../config/config-manager.js';

/**
 * Connection error types
 */
export type ConnectionErrorType = 
  | 'gateway_not_running'
  | 'auth_token_missing'
  | 'auth_failed'
  | 'connection_refused'
  | 'timeout'
  | 'unknown';

/**
 * Connection error with helpful message
 */
export interface ConnectionError {
  type: ConnectionErrorType;
  message: string;
  suggestion: string;
}

/**
 * Checks if the Gateway is reachable
 */
export async function checkGatewayConnection(
  host: string,
  port: number,
  timeoutMs: number = 5000
): Promise<{ connected: boolean; error?: ConnectionError }> {
  return new Promise((resolve) => {
    const wsUrl = `ws://${host}:${port}`;
    const ws = new WebSocket(wsUrl);
    
    const timeout = setTimeout(() => {
      ws.close();
      resolve({
        connected: false,
        error: {
          type: 'timeout',
          message: `Connection to Gateway timed out after ${timeoutMs}ms`,
          suggestion: 'Check if the Gateway is running and the port is correct.',
        },
      });
    }, timeoutMs);

    ws.on('open', () => {
      clearTimeout(timeout);
      ws.close();
      resolve({ connected: true });
    });

    ws.on('error', (error) => {
      clearTimeout(timeout);
      const errorMessage = error.message || String(error);
      
      if (errorMessage.includes('ECONNREFUSED')) {
        resolve({
          connected: false,
          error: {
            type: 'gateway_not_running',
            message: 'Cannot connect to Gateway - connection refused.',
            suggestion: 'Start the Gateway with: openclaw start',
          },
        });
      } else if (errorMessage.includes('ENOTFOUND')) {
        resolve({
          connected: false,
          error: {
            type: 'connection_refused',
            message: `Cannot resolve host: ${host}`,
            suggestion: 'Check your configuration with: openclaw config show',
          },
        });
      } else {
        resolve({
          connected: false,
          error: {
            type: 'unknown',
            message: `Connection error: ${errorMessage}`,
            suggestion: 'Check the Gateway logs with: openclaw logs',
          },
        });
      }
    });
  });
}

/**
 * Loads the auth token from the workspace
 */
export function loadAuthToken(workspace: Workspace): { token?: string; error?: ConnectionError } {
  try {
    accessSync(workspace.authPath, constants.F_OK);
    const authContent = readFileSync(workspace.authPath, 'utf-8');
    const authStore = JSON.parse(authContent);
    return { token: authStore.token };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        error: {
          type: 'auth_token_missing',
          message: 'No authentication token found.',
          suggestion: 'Start the Gateway first with: openclaw start',
        },
      };
    }
    return {
      error: {
        type: 'unknown',
        message: `Failed to read auth token: ${error instanceof Error ? error.message : String(error)}`,
        suggestion: 'Check workspace permissions or reinitialize with: openclaw start',
      },
    };
  }
}

/**
 * Gets the Gateway URL from configuration
 */
export async function getGatewayUrl(workspace: Workspace): Promise<{ url: string; host: string; port: number }> {
  const configManager = new ConfigManager(workspace.configPath);
  const result = await configManager.load();
  const config = result.config ?? DEFAULT_CONFIG;
  
  return {
    url: `ws://${config.gateway.host}:${config.gateway.port}`,
    host: config.gateway.host,
    port: config.gateway.port,
  };
}

/**
 * Displays a connection error with formatting
 */
export function displayConnectionError(error: ConnectionError): void {
  console.error(`\n\x1b[31mError:\x1b[0m ${error.message}`);
  console.error(`\n\x1b[33mSuggestion:\x1b[0m ${error.suggestion}\n`);
}

/**
 * Handles common connection errors and displays helpful messages
 * Requirement 7.5: Display helpful error message when Gateway not running
 */
export function handleConnectionError(error: Error | unknown): ConnectionError {
  const errorMessage = error instanceof Error ? error.message : String(error);
  
  if (errorMessage.includes('ECONNREFUSED')) {
    return {
      type: 'gateway_not_running',
      message: 'Cannot connect to Gateway - connection refused.',
      suggestion: 'Start the Gateway with: openclaw start',
    };
  }
  
  if (errorMessage.includes('ENOTFOUND')) {
    return {
      type: 'connection_refused',
      message: 'Cannot resolve Gateway host.',
      suggestion: 'Check your configuration with: openclaw config show',
    };
  }
  
  if (errorMessage.includes('ETIMEDOUT') || errorMessage.includes('timeout')) {
    return {
      type: 'timeout',
      message: 'Connection to Gateway timed out.',
      suggestion: 'Check if the Gateway is running and accessible.',
    };
  }
  
  if (errorMessage.includes('Authentication failed') || errorMessage.includes('invalid token')) {
    return {
      type: 'auth_failed',
      message: 'Authentication failed - invalid token.',
      suggestion: 'The auth token may have been rotated. Check ~/.openclaw/auth.json',
    };
  }
  
  return {
    type: 'unknown',
    message: errorMessage,
    suggestion: 'Check the Gateway logs with: openclaw logs',
  };
}
