import { z } from 'zod';
import { readFile, writeFile, rename, access, constants } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * Configuration schema using Zod for validation
 * Requirements: 8.2 (defaults), 8.4 (validation)
 */
export const OpenClawConfigSchema = z.object({
  gateway: z.object({
    port: z.number().int().min(1).max(65535).default(18789),
    host: z.string().min(1).default('127.0.0.1'),
  }).default({}),
  
  agent: z.object({
    claudeCliPath: z.string().min(1).default('claude'),
    model: z.string().min(1).default('sonnet'),
    maxTokens: z.number().int().min(1).max(200000).default(8192),
  }).default({}),
  
  memory: z.object({
    workspacePath: z.string().min(1).default('~/.openclaw/workspace'),
    maxContextTokens: z.number().int().min(1000).max(200000).default(100000),
    temporalDecayHalfLife: z.number().positive().default(7),
  }).default({}),
  
  logging: z.object({
    level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    path: z.string().min(1).default('~/.openclaw/logs'),
    maxSize: z.number().int().min(1024).default(10 * 1024 * 1024), // 10MB
    maxFiles: z.number().int().min(1).max(100).default(5),
  }).default({}),
});

/**
 * Type for the full configuration
 */
export type OpenClawConfig = z.infer<typeof OpenClawConfigSchema>;

/**
 * Type for partial configuration (user overrides)
 */
export type PartialOpenClawConfig = z.input<typeof OpenClawConfigSchema>;

/**
 * Default configuration values
 * Requirement 8.2: Provide defaults for all required settings
 */
export const DEFAULT_CONFIG: OpenClawConfig = OpenClawConfigSchema.parse({});

/**
 * Environment variable prefix for configuration overrides
 */
const ENV_PREFIX = 'OPENCLAW_';

/**
 * Mapping of environment variables to config paths
 */
const ENV_MAPPINGS: Record<string, string[]> = {
  [`${ENV_PREFIX}GATEWAY_PORT`]: ['gateway', 'port'],
  [`${ENV_PREFIX}GATEWAY_HOST`]: ['gateway', 'host'],
  [`${ENV_PREFIX}AGENT_CLAUDE_CLI_PATH`]: ['agent', 'claudeCliPath'],
  [`${ENV_PREFIX}AGENT_MODEL`]: ['agent', 'model'],
  [`${ENV_PREFIX}AGENT_MAX_TOKENS`]: ['agent', 'maxTokens'],
  [`${ENV_PREFIX}MEMORY_WORKSPACE_PATH`]: ['memory', 'workspacePath'],
  [`${ENV_PREFIX}MEMORY_MAX_CONTEXT_TOKENS`]: ['memory', 'maxContextTokens'],
  [`${ENV_PREFIX}MEMORY_TEMPORAL_DECAY_HALF_LIFE`]: ['memory', 'temporalDecayHalfLife'],
  [`${ENV_PREFIX}LOGGING_LEVEL`]: ['logging', 'level'],
  [`${ENV_PREFIX}LOGGING_PATH`]: ['logging', 'path'],
  [`${ENV_PREFIX}LOGGING_MAX_SIZE`]: ['logging', 'maxSize'],
  [`${ENV_PREFIX}LOGGING_MAX_FILES`]: ['logging', 'maxFiles'],
};

/**
 * Result of configuration validation
 */
export interface ConfigValidationResult {
  success: boolean;
  config?: OpenClawConfig;
  errors?: string[];
}

/**
 * ConfigManager - Manages configuration loading, validation, and persistence
 * 
 * Requirements:
 * - 8.1: Support configuration via JSON file and environment variables
 * - 8.2: Provide defaults for all required settings
 * - 8.3: Environment variables override file-based configuration
 * - 8.4: Validate configuration on load and report errors clearly
 * - 4.2: Write changes atomically using temp file + rename
 * - 4.4: Merge defaults with user overrides
 */
export class ConfigManager {
  private configPath: string;
  private currentConfig: OpenClawConfig;

  /**
   * Creates a new ConfigManager instance
   * @param configPath - Path to the configuration file
   */
  constructor(configPath: string) {
    this.configPath = configPath;
    this.currentConfig = DEFAULT_CONFIG;
  }

  /**
   * Gets the current configuration
   */
  get config(): OpenClawConfig {
    return this.currentConfig;
  }

  /**
   * Gets the path to the configuration file
   */
  get path(): string {
    return this.configPath;
  }

  /**
   * Loads configuration with precedence: defaults → file → environment
   * Requirements: 4.4, 8.1, 8.3
   */
  async load(): Promise<ConfigValidationResult> {
    // Start with defaults
    let fileConfig: PartialOpenClawConfig = {};

    // Try to load from file
    try {
      await access(this.configPath, constants.F_OK);
      const content = await readFile(this.configPath, 'utf-8');
      fileConfig = JSON.parse(content) as PartialOpenClawConfig;
    } catch (error) {
      // File doesn't exist or is unreadable - use defaults
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        return {
          success: false,
          errors: [`Failed to read config file: ${(error as Error).message}`],
        };
      }
    }

    // Apply environment variable overrides
    const envOverrides = this.getEnvironmentOverrides();
    const mergedConfig = this.deepMerge(fileConfig, envOverrides);

    // Validate the merged configuration
    return this.validate(mergedConfig);
  }

  /**
   * Validates a partial configuration and returns the full config with defaults
   * Requirement 8.4: Validate configuration on load and report errors clearly
   */
  validate(partialConfig: PartialOpenClawConfig): ConfigValidationResult {
    const result = OpenClawConfigSchema.safeParse(partialConfig);

    if (result.success) {
      this.currentConfig = result.data;
      return {
        success: true,
        config: result.data,
      };
    }

    // Format Zod errors into clear messages
    const errors = result.error.issues.map((issue) => {
      const path = issue.path.join('.');
      return `Configuration error at '${path}': ${issue.message}`;
    });

    return {
      success: false,
      errors,
    };
  }

  /**
   * Saves the current configuration to file atomically
   * Requirement 4.2: Write changes atomically using temp file + rename
   */
  async save(config?: PartialOpenClawConfig): Promise<void> {
    const configToSave = config ?? this.currentConfig;
    
    // Validate before saving
    const validation = this.validate(configToSave);
    if (!validation.success) {
      throw new Error(`Invalid configuration: ${validation.errors?.join(', ')}`);
    }

    await this.atomicWrite(this.configPath, JSON.stringify(configToSave, null, 2));
  }

  /**
   * Writes content to a file atomically using temp file + rename
   * Requirement 4.2: Atomic writes
   */
  async atomicWrite(filePath: string, content: string): Promise<void> {
    const dir = dirname(filePath);
    const tempPath = join(dir, `.config-${randomUUID()}.tmp`);

    try {
      // Write to temp file
      await writeFile(tempPath, content, { mode: 0o600 });
      
      // Atomic rename
      await rename(tempPath, filePath);
    } catch (error) {
      // Clean up temp file on failure
      try {
        await access(tempPath, constants.F_OK);
        const { unlink } = await import('node:fs/promises');
        await unlink(tempPath);
      } catch {
        // Temp file doesn't exist, nothing to clean up
      }
      throw error;
    }
  }

  /**
   * Gets configuration overrides from environment variables
   * Requirement 8.3: Environment variables override file-based configuration
   */
  private getEnvironmentOverrides(): PartialOpenClawConfig {
    const overrides: Record<string, unknown> = {};

    for (const [envVar, path] of Object.entries(ENV_MAPPINGS)) {
      const value = process.env[envVar];
      if (value !== undefined) {
        this.setNestedValue(overrides, path, this.parseEnvValue(value, path));
      }
    }

    return overrides as PartialOpenClawConfig;
  }

  /**
   * Parses an environment variable value to the appropriate type
   */
  private parseEnvValue(value: string, path: string[]): unknown {
    const key = path[path.length - 1];
    
    // Numeric fields
    if (['port', 'maxTokens', 'maxContextTokens', 'maxSize', 'maxFiles'].includes(key ?? '')) {
      const num = parseInt(value, 10);
      if (isNaN(num)) {
        throw new Error(`Invalid numeric value for ${path.join('.')}: ${value}`);
      }
      return num;
    }
    
    // Float fields
    if (key === 'temporalDecayHalfLife') {
      const num = parseFloat(value);
      if (isNaN(num)) {
        throw new Error(`Invalid numeric value for ${path.join('.')}: ${value}`);
      }
      return num;
    }
    
    // String fields
    return value;
  }

  /**
   * Sets a nested value in an object using a path array
   */
  private setNestedValue(obj: Record<string, unknown>, path: string[], value: unknown): void {
    let current = obj;
    for (let i = 0; i < path.length - 1; i++) {
      const key = path[i];
      if (key === undefined) continue;
      if (!(key in current)) {
        current[key] = {};
      }
      current = current[key] as Record<string, unknown>;
    }
    const lastKey = path[path.length - 1];
    if (lastKey !== undefined) {
      current[lastKey] = value;
    }
  }

  /**
   * Deep merges two configuration objects
   * Later values override earlier values
   */
  private deepMerge(
    base: PartialOpenClawConfig,
    overrides: PartialOpenClawConfig
  ): PartialOpenClawConfig {
    const result = { ...base } as Record<string, unknown>;

    for (const [key, value] of Object.entries(overrides)) {
      if (
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        key in result &&
        typeof result[key] === 'object' &&
        result[key] !== null
      ) {
        result[key] = this.deepMerge(
          result[key] as PartialOpenClawConfig,
          value as PartialOpenClawConfig
        );
      } else {
        result[key] = value;
      }
    }

    return result as PartialOpenClawConfig;
  }

  /**
   * Gets a specific configuration value by path
   */
  get<T>(path: string): T | undefined {
    const parts = path.split('.');
    let current: unknown = this.currentConfig;

    for (const part of parts) {
      if (current === null || typeof current !== 'object') {
        return undefined;
      }
      current = (current as Record<string, unknown>)[part];
    }

    return current as T;
  }

  /**
   * Sets a specific configuration value by path
   */
  set(path: string, value: unknown): ConfigValidationResult {
    const parts = path.split('.');
    const newConfig = JSON.parse(JSON.stringify(this.currentConfig)) as Record<string, unknown>;
    
    let current = newConfig;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (part === undefined) continue;
      if (!(part in current) || typeof current[part] !== 'object') {
        current[part] = {};
      }
      current = current[part] as Record<string, unknown>;
    }
    
    const lastPart = parts[parts.length - 1];
    if (lastPart !== undefined) {
      current[lastPart] = value;
    }

    return this.validate(newConfig as PartialOpenClawConfig);
  }
}
