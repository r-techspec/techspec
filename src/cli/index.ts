#!/usr/bin/env node
/**
 * OpenClaw CLI - Command-line interface for the OpenClaw AI assistant
 * 
 * Requirements:
 * - 7.1: Provide commands: start, message, sessions, config, logs
 */

import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Import command handlers
import { startCommand } from './commands/start.js';
import { messageCommand } from './commands/message.js';
import { sessionsCommand } from './commands/sessions.js';
import { configCommand } from './commands/config.js';
import { logsCommand } from './commands/logs.js';

// Get package version
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packagePath = join(__dirname, '../../package.json');
let version = '0.1.0';
try {
  const pkg = JSON.parse(readFileSync(packagePath, 'utf-8'));
  version = pkg.version;
} catch {
  // Use default version
}

/**
 * Creates and configures the CLI program
 */
export function createProgram(): Command {
  const program = new Command();

  program
    .name('openclaw')
    .description('Self-hosted AI assistant with Claude Code CLI integration')
    .version(version, '-v, --version', 'Display version number');

  // Register commands
  program.addCommand(startCommand());
  program.addCommand(messageCommand());
  program.addCommand(sessionsCommand());
  program.addCommand(configCommand());
  program.addCommand(logsCommand());

  return program;
}

// Run CLI if this is the main module
const program = createProgram();
program.parse(process.argv);
