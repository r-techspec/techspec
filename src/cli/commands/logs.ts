/**
 * Logs command - View and tail log files
 * 
 * Requirements:
 * - 9.5: Provide logs command to tail and filter logs
 */

import { Command } from 'commander';
import { createReadStream, watch, type FSWatcher } from 'node:fs';
import { readFile, stat, access, constants } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { Workspace } from '../../storage/workspace.js';
import { type LogLevel, LOG_LEVELS, type LogEntry } from '../../logging/logger.js';

interface LogsOptions {
  follow?: boolean;
  level?: string;
  lines?: number;
}

/**
 * Creates the logs command
 */
export function logsCommand(): Command {
  const cmd = new Command('logs');

  cmd
    .description('View log files')
    .option('-f, --follow', 'Follow log output (like tail -f)')
    .option('-l, --level <level>', 'Filter by minimum log level (debug, info, warn, error)')
    .option('-n, --lines <count>', 'Number of lines to show', parseInt)
    .action(async (options: LogsOptions) => {
      await runLogs(options);
    });

  return cmd;
}

/**
 * Runs the logs command
 */
async function runLogs(options: LogsOptions): Promise<void> {
  const workspace = new Workspace();
  const logPath = workspace.logPath('openclaw.log');
  
  // Check if log file exists
  try {
    await access(logPath, constants.F_OK);
  } catch {
    console.log('No log file found.');
    return;
  }

  const minLevel = options.level as LogLevel | undefined;
  
  // Validate log level
  if (minLevel && !(minLevel in LOG_LEVELS)) {
    console.error(`Invalid log level: ${minLevel}`);
    console.error('Valid levels: debug, info, warn, error');
    process.exit(1);
  }

  if (options.follow) {
    await tailLogs(logPath, minLevel);
  } else {
    await showLogs(logPath, minLevel, options.lines ?? 50);
  }
}

/**
 * Shows recent log entries
 */
async function showLogs(logPath: string, minLevel?: LogLevel, lineCount: number = 50): Promise<void> {
  const content = await readFile(logPath, 'utf-8');
  const lines = content.trim().split('\n');
  
  // Get last N lines
  const recentLines = lines.slice(-lineCount);
  
  for (const line of recentLines) {
    const entry = parseLine(line);
    if (entry && shouldShow(entry, minLevel)) {
      printEntry(entry);
    }
  }
}

/**
 * Tails log file with follow mode
 */
async function tailLogs(logPath: string, minLevel?: LogLevel): Promise<void> {
  // First show recent entries
  await showLogs(logPath, minLevel, 20);
  
  console.log('\n--- Following log file (Ctrl+C to stop) ---\n');
  
  // Track file position
  let position = (await stat(logPath)).size;
  
  // Watch for changes
  const watcher: FSWatcher = watch(logPath, async (eventType) => {
    if (eventType === 'change') {
      try {
        const newStats = await stat(logPath);
        
        if (newStats.size > position) {
          // Read new content
          const stream = createReadStream(logPath, {
            start: position,
            end: newStats.size - 1,
          });
          
          const rl = createInterface({ input: stream });
          
          for await (const line of rl) {
            const entry = parseLine(line);
            if (entry && shouldShow(entry, minLevel)) {
              printEntry(entry);
            }
          }
          
          position = newStats.size;
        } else if (newStats.size < position) {
          // File was truncated (rotated)
          position = 0;
        }
      } catch {
        // File may have been rotated
        position = 0;
      }
    }
  });

  // Handle shutdown
  process.on('SIGINT', () => {
    watcher.close();
    process.exit(0);
  });

  // Keep process alive
  await new Promise(() => {});
}

/**
 * Parses a log line into a LogEntry
 */
function parseLine(line: string): LogEntry | null {
  try {
    return JSON.parse(line) as LogEntry;
  } catch {
    return null;
  }
}

/**
 * Checks if an entry should be shown based on level filter
 */
function shouldShow(entry: LogEntry, minLevel?: LogLevel): boolean {
  if (!minLevel) return true;
  return LOG_LEVELS[entry.level] >= LOG_LEVELS[minLevel];
}

/**
 * Prints a log entry with formatting
 */
function printEntry(entry: LogEntry): void {
  const levelColors: Record<LogLevel, string> = {
    debug: '\x1b[90m', // gray
    info: '\x1b[36m',  // cyan
    warn: '\x1b[33m',  // yellow
    error: '\x1b[31m', // red
  };
  
  const reset = '\x1b[0m';
  const color = levelColors[entry.level] ?? reset;
  
  const time = entry.timestamp.split('T')[1]?.split('.')[0] ?? entry.timestamp;
  const level = entry.level.toUpperCase().padEnd(5);
  
  let output = `${color}[${time}] ${level}${reset} ${entry.message}`;
  
  // Add context if present
  if (entry.context && Object.keys(entry.context).length > 0) {
    const contextStr = Object.entries(entry.context)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(' ');
    output += ` ${'\x1b[90m'}${contextStr}${reset}`;
  }
  
  console.log(output);
  
  // Print stack trace for errors
  if (entry.stack) {
    console.log(`${'\x1b[90m'}${entry.stack}${reset}`);
  }
}
