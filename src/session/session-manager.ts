import { randomUUID } from 'node:crypto';
import { readFile, writeFile, readdir, stat, access, constants } from 'node:fs/promises';
import { Workspace } from '../storage/workspace.js';
import { Logger } from '../logging/logger.js';

/**
 * Transcript entry representing a single message in a session
 * Requirements: 3.2, 3.3
 */
export interface TranscriptEntry {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: number;
  toolCall?: {
    id: string;
    name: string;
    arguments: string;
  };
  toolResult?: {
    callId: string;
    success: boolean;
    output: string;
  };
}

/**
 * Session metadata
 * Requirement 3.4: Return session metadata including ID, creation time, and message count
 */
export interface Session {
  id: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  transcriptPath: string;
}

/**
 * SessionManager - Manages conversation sessions with persistent transcripts
 * 
 * Requirements:
 * - 3.1: Generate unique session ID and create transcript file
 * - 3.2: Append messages to session transcript in JSONL format
 * - 3.3: Reconstruct conversation history from transcript file
 * - 3.4: Return session metadata including ID, creation time, and message count
 * - 3.5: Attempt repair of corrupted transcript files
 */
export class SessionManager {
  private workspace: Workspace;
  private logger: Logger;

  constructor(workspace: Workspace, logger?: Logger) {
    this.workspace = workspace;
    this.logger = logger ?? new Logger({ level: 'info', path: 'openclaw.log', maxSize: 10485760, maxFiles: 5 });
  }

  /**
   * Creates a new session with a unique ID
   * Requirement 3.1: Generate unique session ID and create transcript file
   */
  async create(): Promise<Session> {
    const id = randomUUID();
    const now = Date.now();
    const transcriptPath = this.workspace.sessionPath(id);

    // Create empty transcript file with metadata header
    const metadata: SessionMetadata = {
      id,
      createdAt: now,
      version: 1,
    };
    
    // Write metadata as first line (prefixed with #)
    await writeFile(transcriptPath, `#${JSON.stringify(metadata)}\n`, { mode: 0o600 });

    return {
      id,
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
      transcriptPath,
    };
  }

  /**
   * Loads an existing session by ID
   * Requirement 3.3: Reconstruct conversation history from transcript file
   */
  async load(sessionId: string): Promise<Session> {
    const transcriptPath = this.workspace.sessionPath(sessionId);
    
    // Check if session exists
    try {
      await access(transcriptPath, constants.F_OK);
    } catch {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const content = await readFile(transcriptPath, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim().length > 0);
    
    let createdAt = 0;
    let updatedAt = 0;
    let messageCount = 0;

    for (const line of lines) {
      if (line.startsWith('#')) {
        // Metadata line
        try {
          const metadata = JSON.parse(line.slice(1)) as SessionMetadata;
          createdAt = metadata.createdAt;
          // Initialize updatedAt to createdAt if not set
          if (updatedAt === 0) {
            updatedAt = createdAt;
          }
        } catch {
          // Ignore malformed metadata
        }
      } else {
        // Transcript entry
        try {
          const entry = JSON.parse(line) as TranscriptEntry;
          messageCount++;
          if (entry.timestamp > updatedAt) {
            updatedAt = entry.timestamp;
          }
        } catch {
          // Malformed entry - will be handled by repair
        }
      }
    }
    
    // Fallback if no metadata found
    if (createdAt === 0) {
      createdAt = Date.now();
      updatedAt = createdAt;
    }

    return {
      id: sessionId,
      createdAt,
      updatedAt,
      messageCount,
      transcriptPath,
    };
  }


  /**
   * Appends a message to a session transcript
   * Requirement 3.2: Append messages to session transcript in JSONL format
   */
  async appendMessage(sessionId: string, message: Omit<TranscriptEntry, 'id' | 'timestamp'>): Promise<TranscriptEntry> {
    const transcriptPath = this.workspace.sessionPath(sessionId);
    
    // Check if session exists
    try {
      await access(transcriptPath, constants.F_OK);
    } catch {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const entry: TranscriptEntry = {
      id: randomUUID(),
      timestamp: Date.now(),
      ...message,
    };

    // Append entry as JSONL
    const line = JSON.stringify(entry) + '\n';
    const { appendFile } = await import('node:fs/promises');
    await appendFile(transcriptPath, line, { encoding: 'utf-8' });

    return entry;
  }

  /**
   * Gets the conversation history for a session
   * Requirement 3.3: Reconstruct conversation history from transcript file
   */
  async getHistory(sessionId: string): Promise<TranscriptEntry[]> {
    const transcriptPath = this.workspace.sessionPath(sessionId);
    
    try {
      await access(transcriptPath, constants.F_OK);
    } catch {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const content = await readFile(transcriptPath, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim().length > 0);
    const entries: TranscriptEntry[] = [];

    for (const line of lines) {
      if (line.startsWith('#')) {
        // Skip metadata lines
        continue;
      }
      
      try {
        const entry = JSON.parse(line) as TranscriptEntry;
        entries.push(entry);
      } catch {
        // Skip malformed entries - will be handled by repair
        await this.logger.warn('Skipping malformed transcript entry', { sessionId, line });
      }
    }

    return entries;
  }

  /**
   * Lists all sessions with metadata
   * Requirement 3.4: Return session metadata including ID, creation time, and message count
   */
  async list(): Promise<Session[]> {
    const sessionsDir = this.workspace.sessionsDir;
    
    let files: string[];
    try {
      files = await readdir(sessionsDir);
    } catch {
      return [];
    }

    const sessions: Session[] = [];
    
    for (const file of files) {
      if (!file.endsWith('.jsonl')) {
        continue;
      }
      
      const sessionId = file.slice(0, -6); // Remove .jsonl extension
      try {
        const session = await this.load(sessionId);
        sessions.push(session);
      } catch {
        // Skip invalid sessions
        await this.logger.warn('Skipping invalid session file', { file });
      }
    }

    // Sort by most recent (updatedAt descending)
    sessions.sort((a, b) => b.updatedAt - a.updatedAt);

    return sessions;
  }

  /**
   * Repairs a corrupted transcript file
   * Requirement 3.5: Attempt repair of corrupted transcript files
   */
  async repair(sessionId: string): Promise<{ repaired: boolean; entriesRecovered: number; entriesLost: number }> {
    const transcriptPath = this.workspace.sessionPath(sessionId);
    
    try {
      await access(transcriptPath, constants.F_OK);
    } catch {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const content = await readFile(transcriptPath, 'utf-8');
    const lines = content.split('\n');
    
    const validLines: string[] = [];
    let metadata: SessionMetadata | null = null;
    let entriesRecovered = 0;
    let entriesLost = 0;

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        continue;
      }

      if (trimmed.startsWith('#')) {
        // Metadata line
        try {
          metadata = JSON.parse(trimmed.slice(1)) as SessionMetadata;
          validLines.push(trimmed);
        } catch {
          await this.logger.warn('Skipping malformed metadata line during repair', { sessionId, line: trimmed });
        }
      } else {
        // Transcript entry
        try {
          JSON.parse(trimmed) as TranscriptEntry;
          validLines.push(trimmed);
          entriesRecovered++;
        } catch {
          entriesLost++;
          await this.logger.warn('Discarding malformed entry during repair', { sessionId, line: trimmed });
        }
      }
    }

    // If no metadata found, create one
    if (!metadata) {
      const stats = await stat(transcriptPath);
      metadata = {
        id: sessionId,
        createdAt: stats.birthtimeMs,
        version: 1,
      };
      validLines.unshift(`#${JSON.stringify(metadata)}`);
    }

    // Write repaired content
    const repairedContent = validLines.join('\n') + '\n';
    await writeFile(transcriptPath, repairedContent, { mode: 0o600 });

    const repaired = entriesLost > 0;
    if (repaired) {
      await this.logger.info('Session transcript repaired', { 
        sessionId, 
        entriesRecovered, 
        entriesLost 
      });
    }

    return { repaired, entriesRecovered, entriesLost };
  }

  /**
   * Deletes a session
   */
  async delete(sessionId: string): Promise<void> {
    const transcriptPath = this.workspace.sessionPath(sessionId);
    
    try {
      await access(transcriptPath, constants.F_OK);
    } catch {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const { unlink } = await import('node:fs/promises');
    await unlink(transcriptPath);
  }
}

/**
 * Internal metadata stored in transcript files
 */
interface SessionMetadata {
  id: string;
  createdAt: number;
  version: number;
}
