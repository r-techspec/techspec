/**
 * Sessions command - Manage conversation sessions
 * 
 * Requirements:
 * - 7.1: Provide sessions command (list/manage)
 */

import { Command } from 'commander';
import { Workspace } from '../../storage/workspace.js';
import { SessionManager } from '../../session/session-manager.js';
import { Logger } from '../../logging/logger.js';

/**
 * Creates the sessions command with subcommands
 */
export function sessionsCommand(): Command {
  const cmd = new Command('sessions');

  cmd.description('Manage conversation sessions');

  // List subcommand
  cmd
    .command('list')
    .description('List all sessions')
    .action(async () => {
      await listSessions();
    });

  // Show subcommand
  cmd
    .command('show <sessionId>')
    .description('Show session details and history')
    .action(async (sessionId: string) => {
      await showSession(sessionId);
    });

  // Delete subcommand
  cmd
    .command('delete <sessionId>')
    .description('Delete a session')
    .action(async (sessionId: string) => {
      await deleteSession(sessionId);
    });

  // Default action (list)
  cmd.action(async () => {
    await listSessions();
  });

  return cmd;
}

/**
 * Lists all sessions with metadata
 */
async function listSessions(): Promise<void> {
  const workspace = new Workspace();
  
  if (!(await workspace.exists())) {
    console.log('No sessions found. Start the gateway first.');
    return;
  }

  const logger = new Logger({ level: 'error', path: workspace.logPath('openclaw.log') });
  const sessionManager = new SessionManager(workspace, logger);
  
  const sessions = await sessionManager.list();
  
  if (sessions.length === 0) {
    console.log('No sessions found.');
    return;
  }

  console.log('Sessions:\n');
  console.log('ID                                    Created              Messages');
  console.log('─'.repeat(76));
  
  for (const session of sessions) {
    const created = new Date(session.createdAt).toLocaleString();
    console.log(`${session.id}  ${created.padEnd(20)}  ${session.messageCount}`);
  }
}

/**
 * Shows details for a specific session
 */
async function showSession(sessionId: string): Promise<void> {
  const workspace = new Workspace();
  
  if (!(await workspace.exists())) {
    console.error('Error: Workspace not initialized.');
    process.exit(1);
  }

  const logger = new Logger({ level: 'error', path: workspace.logPath('openclaw.log') });
  const sessionManager = new SessionManager(workspace, logger);
  
  try {
    const session = await sessionManager.load(sessionId);
    const history = await sessionManager.getHistory(sessionId);
    
    console.log('Session Details:\n');
    console.log(`ID:       ${session.id}`);
    console.log(`Created:  ${new Date(session.createdAt).toLocaleString()}`);
    console.log(`Updated:  ${new Date(session.updatedAt).toLocaleString()}`);
    console.log(`Messages: ${session.messageCount}`);
    
    if (history.length > 0) {
      console.log('\nConversation History:\n');
      console.log('─'.repeat(60));
      
      for (const entry of history) {
        const time = new Date(entry.timestamp).toLocaleTimeString();
        const role = entry.role.toUpperCase().padEnd(10);
        console.log(`[${time}] ${role}`);
        console.log(entry.content);
        console.log('─'.repeat(60));
      }
    }
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * Deletes a session
 */
async function deleteSession(sessionId: string): Promise<void> {
  const workspace = new Workspace();
  
  if (!(await workspace.exists())) {
    console.error('Error: Workspace not initialized.');
    process.exit(1);
  }

  const logger = new Logger({ level: 'error', path: workspace.logPath('openclaw.log') });
  const sessionManager = new SessionManager(workspace, logger);
  
  try {
    await sessionManager.delete(sessionId);
    console.log(`Session ${sessionId} deleted.`);
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
