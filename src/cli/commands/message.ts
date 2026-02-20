/**
 * Message command - Send messages to the Gateway
 * 
 * Requirements:
 * - 7.2: Send message and stream response
 * - 7.4: Support --session flag
 * - 7.5: Display helpful error when Gateway not running
 */

import { Command } from 'commander';
import WebSocket from 'ws';
import { Workspace } from '../../storage/workspace.js';
import { formatMarkdown } from '../utils/markdown.js';
import { 
  loadAuthToken, 
  getGatewayUrl, 
  displayConnectionError, 
  handleConnectionError,
  checkGatewayConnection 
} from '../utils/connection.js';

interface MessageOptions {
  session?: string;
}

/**
 * Creates the message command
 */
export function messageCommand(): Command {
  const cmd = new Command('message');

  cmd
    .description('Send a message to the AI assistant')
    .argument('<text>', 'Message text to send')
    .option('-s, --session <id>', 'Session ID to use (creates new if not specified)')
    .action(async (text: string, options: MessageOptions) => {
      await runMessage(text, options);
    });

  return cmd;
}

/**
 * Runs the message command
 */
async function runMessage(text: string, options: MessageOptions): Promise<void> {
  const workspace = new Workspace();
  
  // Load auth token
  const authResult = loadAuthToken(workspace);
  if (authResult.error) {
    displayConnectionError(authResult.error);
    process.exit(1);
  }
  const token = authResult.token!;

  // Get gateway URL
  const { url: wsUrl, host, port } = await getGatewayUrl(workspace);
  
  // Check if gateway is running first
  const connectionCheck = await checkGatewayConnection(host, port);
  if (!connectionCheck.connected && connectionCheck.error) {
    displayConnectionError(connectionCheck.error);
    process.exit(1);
  }
  
  try {
    await connectAndSend(wsUrl, token, text, options.session);
  } catch (error) {
    const connError = handleConnectionError(error);
    displayConnectionError(connError);
    process.exit(1);
  }
}

/**
 * Connects to the Gateway and sends a message
 */
async function connectAndSend(
  wsUrl: string,
  token: string,
  text: string,
  sessionId?: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let authenticated = false;
    let authSent = false;
    let currentSessionId = sessionId;
    let responseBuffer = '';

    ws.on('open', () => {
      // Wait for server's auth request before sending
    });

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        
        switch (message.type) {
          case 'auth_result':
            if (!authSent) {
              // Server is requesting auth - send our token
              authSent = true;
              ws.send(JSON.stringify({ type: 'auth', token }));
            } else if (message.success) {
              authenticated = true;
              // Create or load session
              if (currentSessionId) {
                ws.send(JSON.stringify({ type: 'load_session', sessionId: currentSessionId }));
              } else {
                ws.send(JSON.stringify({ type: 'create_session' }));
              }
            } else {
              console.error('Authentication failed:', message.error);
              ws.close();
              reject(new Error('Authentication failed - invalid token'));
            }
            break;

          case 'session_created':
          case 'session_loaded':
            currentSessionId = message.sessionId;
            // Send the message
            ws.send(JSON.stringify({ type: 'message', content: text }));
            break;

          case 'text_delta':
            // Stream response to terminal
            responseBuffer += message.content;
            process.stdout.write(message.content);
            break;

          case 'tool_call':
            console.log(`\n[Tool: ${message.payload?.name}]`);
            break;

          case 'tool_result':
            if (message.payload?.success) {
              console.log(`[Tool result: success]`);
            } else {
              console.log(`[Tool result: error - ${message.payload?.error}]`);
            }
            break;

          case 'done':
            // Format final response with markdown
            if (responseBuffer) {
              process.stdout.write('\n');
            }
            ws.close();
            resolve();
            break;

          case 'error':
            console.error('\nError:', message.error);
            ws.close();
            reject(new Error(message.error));
            break;
        }
      } catch (error) {
        console.error('Failed to parse message:', error);
      }
    });

    ws.on('error', (error) => {
      reject(error);
    });

    ws.on('close', () => {
      if (!authenticated) {
        reject(new Error('Connection closed before authentication'));
      }
    });
  });
}
