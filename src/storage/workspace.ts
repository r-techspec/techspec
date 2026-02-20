import { mkdir, access, constants } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';

/**
 * Default workspace root directory
 */
const DEFAULT_WORKSPACE_ROOT = '.openclaw';

/**
 * Standard directory structure within the workspace
 */
const WORKSPACE_DIRS = [
  'sessions',
  'workspace',
  'workspace/memory',
  'logs',
] as const;

/**
 * Workspace - Manages the ~/.openclaw/ directory structure
 * 
 * Handles:
 * - Directory creation with proper permissions
 * - Path resolution and containment validation
 * - Standard directory structure setup
 * 
 * Requirements: 4.1, 4.3, 4.5
 */
export class Workspace {
  private readonly rootPath: string;

  /**
   * Creates a new Workspace instance
   * @param rootPath - Custom root path (defaults to ~/.openclaw/)
   */
  constructor(rootPath?: string) {
    if (rootPath) {
      this.rootPath = isAbsolute(rootPath) ? rootPath : resolve(rootPath);
    } else {
      this.rootPath = join(homedir(), DEFAULT_WORKSPACE_ROOT);
    }
  }

  /**
   * Gets the absolute root path of the workspace
   */
  get root(): string {
    return this.rootPath;
  }

  /**
   * Initializes the workspace directory structure
   * Creates all required directories with appropriate permissions (700)
   * 
   * Requirement 4.5: Create workspace directory if it doesn't exist
   */
  async initialize(): Promise<void> {
    // Create root directory with 700 permissions (owner rwx only)
    await mkdir(this.rootPath, { recursive: true, mode: 0o700 });

    // Create standard subdirectories
    for (const dir of WORKSPACE_DIRS) {
      const dirPath = join(this.rootPath, dir);
      await mkdir(dirPath, { recursive: true, mode: 0o700 });
    }
  }

  /**
   * Checks if the workspace has been initialized
   */
  async exists(): Promise<boolean> {
    try {
      await access(this.rootPath, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Resolves a relative path within the workspace to an absolute path
   * @param relativePath - Path relative to workspace root
   * @returns Absolute path
   * @throws Error if the resolved path escapes the workspace
   * 
   * Requirement 4.1: All data stored under workspace directory
   */
  resolve(relativePath: string): string {
    const absolutePath = resolve(this.rootPath, relativePath);
    
    if (!this.contains(absolutePath)) {
      throw new Error(
        `Path "${relativePath}" resolves outside workspace boundary`
      );
    }
    
    return absolutePath;
  }

  /**
   * Checks if an absolute path is contained within the workspace
   * @param absolutePath - Absolute path to check
   * @returns true if path is within workspace
   * 
   * Requirement 4.1: All data stored under workspace directory
   */
  contains(absolutePath: string): boolean {
    const normalizedRoot = resolve(this.rootPath);
    const normalizedPath = resolve(absolutePath);
    
    // Path must start with root path
    if (!normalizedPath.startsWith(normalizedRoot)) {
      return false;
    }
    
    // Ensure it's not just a prefix match (e.g., /home/user/.openclaw2)
    const remainder = normalizedPath.slice(normalizedRoot.length);
    return remainder.length === 0 || remainder.startsWith('/');
  }

  /**
   * Gets the relative path from workspace root
   * @param absolutePath - Absolute path within workspace
   * @returns Relative path from workspace root
   * @throws Error if path is outside workspace
   */
  relative(absolutePath: string): string {
    if (!this.contains(absolutePath)) {
      throw new Error(
        `Path "${absolutePath}" is outside workspace boundary`
      );
    }
    return relative(this.rootPath, absolutePath);
  }

  // Path helpers for standard directories

  /**
   * Gets the path to the config file
   * Requirement 4.3: config.json location
   */
  get configPath(): string {
    return join(this.rootPath, 'config.json');
  }

  /**
   * Gets the path to the auth file
   * Requirement 4.3: auth.json location
   */
  get authPath(): string {
    return join(this.rootPath, 'auth.json');
  }

  /**
   * Gets the path to the sessions directory
   * Requirement 4.3: sessions/*.jsonl location
   */
  get sessionsDir(): string {
    return join(this.rootPath, 'sessions');
  }

  /**
   * Gets the path to the workspace content directory
   * Requirement 4.3: workspace/ location
   */
  get workspaceDir(): string {
    return join(this.rootPath, 'workspace');
  }

  /**
   * Gets the path to the memory directory
   * Requirement 4.3: workspace/memory/*.md location
   */
  get memoryDir(): string {
    return join(this.rootPath, 'workspace', 'memory');
  }

  /**
   * Gets the path to the logs directory
   */
  get logsDir(): string {
    return join(this.rootPath, 'logs');
  }

  /**
   * Gets the path to SOUL.md bootstrap file
   * Requirement 4.3: workspace/SOUL.md location
   */
  get soulPath(): string {
    return join(this.rootPath, 'workspace', 'SOUL.md');
  }

  /**
   * Gets the path to USER.md bootstrap file
   * Requirement 4.3: workspace/USER.md location
   */
  get userPath(): string {
    return join(this.rootPath, 'workspace', 'USER.md');
  }

  /**
   * Gets the path to a session transcript file
   * @param sessionId - Session identifier
   */
  sessionPath(sessionId: string): string {
    // Validate session ID to prevent path traversal
    if (sessionId.includes('/') || sessionId.includes('\\') || sessionId.includes('..')) {
      throw new Error(`Invalid session ID: ${sessionId}`);
    }
    return join(this.sessionsDir, `${sessionId}.jsonl`);
  }

  /**
   * Gets the path to a log file
   * @param filename - Log filename
   */
  logPath(filename: string): string {
    // Validate filename to prevent path traversal
    if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
      throw new Error(`Invalid log filename: ${filename}`);
    }
    return join(this.logsDir, filename);
  }
}
