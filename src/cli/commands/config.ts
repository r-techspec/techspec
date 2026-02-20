/**
 * Config command - View and edit configuration
 * 
 * Requirements:
 * - 7.1: Provide config command (view/edit)
 */

import { Command } from 'commander';
import { Workspace } from '../../storage/workspace.js';
import { ConfigManager, DEFAULT_CONFIG } from '../../config/config-manager.js';

/**
 * Creates the config command with subcommands
 */
export function configCommand(): Command {
  const cmd = new Command('config');

  cmd.description('View and edit configuration');

  // Show subcommand
  cmd
    .command('show')
    .description('Show current configuration')
    .action(async () => {
      await showConfig();
    });

  // Set subcommand
  cmd
    .command('set <key> <value>')
    .description('Set a configuration value (e.g., gateway.port 8080)')
    .action(async (key: string, value: string) => {
      await setConfig(key, value);
    });

  // Get subcommand
  cmd
    .command('get <key>')
    .description('Get a specific configuration value')
    .action(async (key: string) => {
      await getConfig(key);
    });

  // Default action (show)
  cmd.action(async () => {
    await showConfig();
  });

  return cmd;
}

/**
 * Shows the current configuration
 */
async function showConfig(): Promise<void> {
  const workspace = new Workspace();
  const configManager = new ConfigManager(workspace.configPath);
  
  const result = await configManager.load();
  const config = result.config ?? DEFAULT_CONFIG;
  
  console.log('Current Configuration:\n');
  console.log(JSON.stringify(config, null, 2));
  
  if (!result.success && result.errors) {
    console.log('\nWarnings:');
    for (const error of result.errors) {
      console.log(`  - ${error}`);
    }
  }
}

/**
 * Sets a configuration value
 */
async function setConfig(key: string, value: string): Promise<void> {
  const workspace = new Workspace();
  
  // Initialize workspace if needed
  if (!(await workspace.exists())) {
    await workspace.initialize();
  }

  const configManager = new ConfigManager(workspace.configPath);
  await configManager.load();
  
  // Parse value to appropriate type
  let parsedValue: unknown = value;
  
  // Try to parse as number
  const numValue = Number(value);
  if (!isNaN(numValue) && value.trim() !== '') {
    parsedValue = numValue;
  }
  // Try to parse as boolean
  else if (value.toLowerCase() === 'true') {
    parsedValue = true;
  } else if (value.toLowerCase() === 'false') {
    parsedValue = false;
  }
  
  const result = configManager.set(key, parsedValue);
  
  if (!result.success) {
    console.error('Invalid configuration:');
    for (const error of result.errors ?? []) {
      console.error(`  - ${error}`);
    }
    process.exit(1);
  }
  
  try {
    await configManager.save();
    console.log(`Set ${key} = ${JSON.stringify(parsedValue)}`);
  } catch (error) {
    console.error('Failed to save configuration:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * Gets a specific configuration value
 */
async function getConfig(key: string): Promise<void> {
  const workspace = new Workspace();
  const configManager = new ConfigManager(workspace.configPath);
  
  await configManager.load();
  
  const value = configManager.get(key);
  
  if (value === undefined) {
    console.error(`Configuration key not found: ${key}`);
    process.exit(1);
  }
  
  if (typeof value === 'object') {
    console.log(JSON.stringify(value, null, 2));
  } else {
    console.log(value);
  }
}
