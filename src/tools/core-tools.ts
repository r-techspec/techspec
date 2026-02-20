import { readFile, writeFile, readdir, stat, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { ToolSystem, ToolDefinition, ToolHandler } from './tool-system.js';

/**
 * read_file tool definition
 * Requirement 6.1: Provide core tools
 */
export const READ_FILE_TOOL: ToolDefinition = {
  name: 'read_file',
  description: 'Read the contents of a file at the specified path',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The path to the file to read',
      },
      encoding: {
        type: 'string',
        description: 'The encoding to use (default: utf-8)',
        enum: ['utf-8', 'utf8', 'ascii', 'base64', 'hex', 'binary'],
      },
    },
    required: ['path'],
  },
};

/**
 * write_file tool definition
 * Requirement 6.1: Provide core tools
 */
export const WRITE_FILE_TOOL: ToolDefinition = {
  name: 'write_file',
  description: 'Write content to a file at the specified path',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The path to the file to write',
      },
      content: {
        type: 'string',
        description: 'The content to write to the file',
      },
      createDirectories: {
        type: 'boolean',
        description: 'Create parent directories if they do not exist (default: true)',
      },
    },
    required: ['path', 'content'],
  },
};

/**
 * list_directory tool definition
 * Requirement 6.1: Provide core tools
 */
export const LIST_DIRECTORY_TOOL: ToolDefinition = {
  name: 'list_directory',
  description: 'List the contents of a directory',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The path to the directory to list',
      },
      recursive: {
        type: 'boolean',
        description: 'Whether to list recursively (default: false)',
      },
      includeHidden: {
        type: 'boolean',
        description: 'Whether to include hidden files (default: false)',
      },
    },
    required: ['path'],
  },
};

/**
 * execute_shell tool definition
 * Requirement 6.3: execute_shell tool
 */
export const EXECUTE_SHELL_TOOL: ToolDefinition = {
  name: 'execute_shell',
  description: 'Execute a shell command and return the output',
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The shell command to execute',
      },
      cwd: {
        type: 'string',
        description: 'The working directory for the command',
      },
      timeout: {
        type: 'number',
        description: 'Timeout in milliseconds (default: 30000)',
      },
    },
    required: ['command'],
  },
};

/**
 * Handler for read_file tool
 */
async function readFileHandler(args: Record<string, unknown>): Promise<string> {
  const path = args['path'] as string;
  const encoding = (args['encoding'] as BufferEncoding) ?? 'utf-8';
  
  const content = await readFile(path, { encoding });
  return content;
}

/**
 * Handler for write_file tool
 */
async function writeFileHandler(args: Record<string, unknown>): Promise<string> {
  const path = args['path'] as string;
  const content = args['content'] as string;
  const createDirectories = args['createDirectories'] !== false;
  
  if (createDirectories) {
    const dir = dirname(path);
    await mkdir(dir, { recursive: true });
  }
  
  await writeFile(path, content, { encoding: 'utf-8' });
  return `Successfully wrote ${content.length} bytes to ${path}`;
}

/**
 * Handler for list_directory tool
 */
async function listDirectoryHandler(args: Record<string, unknown>): Promise<string> {
  const path = args['path'] as string;
  const recursive = args['recursive'] === true;
  const includeHidden = args['includeHidden'] === true;
  
  const entries = await listDir(path, recursive, includeHidden);
  return JSON.stringify(entries, null, 2);
}

/**
 * Recursively lists directory contents
 */
async function listDir(
  dirPath: string,
  recursive: boolean,
  includeHidden: boolean,
  basePath: string = ''
): Promise<DirectoryEntry[]> {
  const entries: DirectoryEntry[] = [];
  const items = await readdir(dirPath);
  
  for (const item of items) {
    // Skip hidden files unless requested
    if (!includeHidden && item.startsWith('.')) {
      continue;
    }
    
    const fullPath = join(dirPath, item);
    const relativePath = basePath ? join(basePath, item) : item;
    const stats = await stat(fullPath);
    
    const entry: DirectoryEntry = {
      name: item,
      path: relativePath,
      type: stats.isDirectory() ? 'directory' : 'file',
      size: stats.size,
      modified: stats.mtime.toISOString(),
    };
    
    entries.push(entry);
    
    if (recursive && stats.isDirectory()) {
      const children = await listDir(fullPath, recursive, includeHidden, relativePath);
      entries.push(...children);
    }
  }
  
  return entries;
}

interface DirectoryEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size: number;
  modified: string;
}

/**
 * Handler for execute_shell tool
 * Requirement 6.3: Run command and capture stdout/stderr
 */
async function executeShellHandler(args: Record<string, unknown>): Promise<string> {
  const command = args['command'] as string;
  const cwd = args['cwd'] as string | undefined;
  const timeout = (args['timeout'] as number) ?? 30000;
  
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      shell: true,
      cwd,
      timeout,
    });
    
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    
    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });
    
    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });
    
    const timeoutId = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeout);
    
    child.on('close', (code) => {
      clearTimeout(timeoutId);
      
      const result: ShellResult = {
        exitCode: code ?? -1,
        stdout,
        stderr,
        timedOut,
      };
      
      if (timedOut) {
        reject(new Error(`Command timed out after ${timeout}ms`));
      } else {
        resolve(JSON.stringify(result, null, 2));
      }
    });
    
    child.on('error', (error) => {
      clearTimeout(timeoutId);
      reject(error);
    });
  });
}

interface ShellResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/**
 * Creates and registers all core tools on a ToolSystem instance
 * Requirement 6.1: Provide core tools
 */
export function createCoreTools(toolSystem: ToolSystem): void {
  toolSystem.register(READ_FILE_TOOL, readFileHandler);
  toolSystem.register(WRITE_FILE_TOOL, writeFileHandler);
  toolSystem.register(LIST_DIRECTORY_TOOL, listDirectoryHandler);
  toolSystem.register(EXECUTE_SHELL_TOOL, executeShellHandler);
}
