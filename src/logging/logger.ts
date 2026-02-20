import { appendFile, stat, rename, unlink, readdir, mkdir, access, constants } from 'node:fs/promises';
import { join, dirname } from 'node:path';

/**
 * Log levels in order of severity (higher = more severe)
 * Requirement 9.2: Support log levels debug, info, warn, error
 */
export const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
} as const;

export type LogLevel = keyof typeof LOG_LEVELS;

/**
 * Context information for log entries
 * Requirement 9.3: Include context (session ID, operation)
 */
export interface LogContext {
  sessionId?: string;
  operation?: string;
  [key: string]: unknown;
}

/**
 * Structured log entry format
 * Requirement 9.1: Output JSON with timestamp, level, message, context
 */
export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: LogContext;
  stack?: string;
}

/**
 * Logger configuration options
 */
export interface LoggerConfig {
  level: LogLevel;
  path: string;
  maxSize: number;
  maxFiles: number;
}

/**
 * Default logger configuration
 */
export const DEFAULT_LOGGER_CONFIG: LoggerConfig = {
  level: 'info',
  path: 'openclaw.log',
  maxSize: 10 * 1024 * 1024, // 10MB
  maxFiles: 5,
};

/**
 * Logger - Structured JSON logger with level filtering and rotation
 * 
 * Requirements:
 * - 9.1: Write structured JSON logs to configurable location
 * - 9.2: Support log levels: debug, info, warn, error
 * - 9.3: Include stack traces and context for errors
 * - 9.4: Rotate log files based on size
 */
export class Logger {
  private config: LoggerConfig;
  private defaultContext: LogContext;

  /**
   * Creates a new Logger instance
   * @param config - Logger configuration
   * @param defaultContext - Default context to include in all log entries
   */
  constructor(config: Partial<LoggerConfig> = {}, defaultContext: LogContext = {}) {
    this.config = { ...DEFAULT_LOGGER_CONFIG, ...config };
    this.defaultContext = defaultContext;
  }

  /**
   * Gets the current log level
   */
  get level(): LogLevel {
    return this.config.level;
  }

  /**
   * Sets the log level
   */
  set level(level: LogLevel) {
    this.config.level = level;
  }

  /**
   * Gets the log file path
   */
  get path(): string {
    return this.config.path;
  }

  /**
   * Checks if a log level should be written based on current config
   * Requirement 9.2: Log level filtering
   */
  shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.config.level];
  }

  /**
   * Creates a child logger with additional default context
   */
  child(context: LogContext): Logger {
    const childLogger = new Logger(this.config, {
      ...this.defaultContext,
      ...context,
    });
    return childLogger;
  }

  /**
   * Formats a log entry as JSON
   * Requirement 9.1: Structured JSON format
   */
  formatEntry(level: LogLevel, message: string, context?: LogContext, error?: Error): LogEntry {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
    };

    // Merge default context with provided context
    const mergedContext = { ...this.defaultContext, ...context };
    if (Object.keys(mergedContext).length > 0) {
      entry.context = mergedContext;
    }

    // Include stack trace for errors
    // Requirement 9.3: Include stack traces for error level
    if (error?.stack) {
      entry.stack = error.stack;
    }

    return entry;
  }

  /**
   * Writes a log entry to the configured output
   */
  async write(entry: LogEntry): Promise<void> {
    const line = JSON.stringify(entry) + '\n';
    
    // Ensure directory exists
    const dir = dirname(this.config.path);
    if (dir && dir !== '.') {
      try {
        await mkdir(dir, { recursive: true });
      } catch {
        // Directory may already exist
      }
    }

    // Check if rotation is needed before writing
    await this.rotateIfNeeded();

    // Append to log file
    await appendFile(this.config.path, line, { encoding: 'utf-8' });
  }

  /**
   * Logs a debug message
   */
  async debug(message: string, context?: LogContext): Promise<void> {
    if (!this.shouldLog('debug')) return;
    const entry = this.formatEntry('debug', message, context);
    await this.write(entry);
  }

  /**
   * Logs an info message
   */
  async info(message: string, context?: LogContext): Promise<void> {
    if (!this.shouldLog('info')) return;
    const entry = this.formatEntry('info', message, context);
    await this.write(entry);
  }

  /**
   * Logs a warning message
   */
  async warn(message: string, context?: LogContext): Promise<void> {
    if (!this.shouldLog('warn')) return;
    const entry = this.formatEntry('warn', message, context);
    await this.write(entry);
  }

  /**
   * Logs an error message with stack trace
   * Requirement 9.3: Include stack trace for error level
   */
  async error(message: string, error?: Error | unknown, context?: LogContext): Promise<void> {
    if (!this.shouldLog('error')) return;
    
    const err = error instanceof Error ? error : undefined;
    const entry = this.formatEntry('error', message, context, err);
    
    // If error is not an Error instance but has useful info, add it to context
    if (error && !(error instanceof Error)) {
      entry.context = {
        ...entry.context,
        errorDetails: String(error),
      };
    }
    
    await this.write(entry);
  }

  /**
   * Rotates log files if current file exceeds maxSize
   * Requirement 9.4: Rotate log files based on size
   */
  async rotateIfNeeded(): Promise<void> {
    try {
      await access(this.config.path, constants.F_OK);
      const stats = await stat(this.config.path);
      
      if (stats.size >= this.config.maxSize) {
        await this.rotate();
      }
    } catch {
      // File doesn't exist yet, no rotation needed
    }
  }

  /**
   * Performs log rotation
   * Requirement 9.4: Keep configurable number of old files
   */
  async rotate(): Promise<void> {
    const dir = dirname(this.config.path);
    const baseName = this.config.path.split('/').pop() ?? 'openclaw.log';
    
    // Delete oldest file if we're at max
    const oldestPath = `${this.config.path}.${this.config.maxFiles}`;
    try {
      await access(oldestPath, constants.F_OK);
      await unlink(oldestPath);
    } catch {
      // File doesn't exist
    }

    // Shift existing rotated files
    for (let i = this.config.maxFiles - 1; i >= 1; i--) {
      const oldPath = `${this.config.path}.${i}`;
      const newPath = `${this.config.path}.${i + 1}`;
      try {
        await access(oldPath, constants.F_OK);
        await rename(oldPath, newPath);
      } catch {
        // File doesn't exist
      }
    }

    // Rotate current file to .1
    try {
      await rename(this.config.path, `${this.config.path}.1`);
    } catch {
      // Current file doesn't exist
    }
  }

  /**
   * Lists all log files (current + rotated)
   */
  async listLogFiles(): Promise<string[]> {
    const files: string[] = [];
    
    try {
      await access(this.config.path, constants.F_OK);
      files.push(this.config.path);
    } catch {
      // Current file doesn't exist
    }

    for (let i = 1; i <= this.config.maxFiles; i++) {
      const rotatedPath = `${this.config.path}.${i}`;
      try {
        await access(rotatedPath, constants.F_OK);
        files.push(rotatedPath);
      } catch {
        // Rotated file doesn't exist
      }
    }

    return files;
  }
}
