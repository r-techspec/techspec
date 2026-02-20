import { randomBytes } from 'node:crypto';
import { readFile, writeFile, rename, access, constants, chmod, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Logger } from '../logging/logger.js';

/**
 * Auth store schema for auth.json
 * Requirements: 10.1, 10.3
 */
export interface AuthStore {
  token: string;          // 32-byte hex token
  createdAt: number;      // Unix timestamp ms
  rotatedAt?: number;     // Unix timestamp ms of last rotation
}

/**
 * Result of token validation
 */
export interface TokenValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * SecurityManager - Manages authentication tokens for the Gateway
 * 
 * Requirements:
 * - 10.1: Generate local authentication token on first start
 * - 10.2: Validate authentication token on client connection
 * - 10.3: Store tokens securely with 600 permissions
 * - 10.4: Reject invalid tokens and log attempts
 * - 10.5: Support token rotation via CLI command
 */
export class SecurityManager {
  private authPath: string;
  private logger: Logger;
  private cachedToken: string | null = null;

  /**
   * Creates a new SecurityManager instance
   * @param authPath - Path to the auth.json file
   * @param logger - Logger instance for security events
   */
  constructor(authPath: string, logger?: Logger) {
    this.authPath = authPath;
    this.logger = logger ?? new Logger({ level: 'info', path: 'openclaw.log', maxSize: 10485760, maxFiles: 5 });
  }

  /**
   * Gets the path to the auth file
   */
  get path(): string {
    return this.authPath;
  }

  /**
   * Generates a cryptographically secure 32-byte hex token
   * Requirement 10.1: Generate local authentication token
   */
  generateToken(): string {
    return randomBytes(32).toString('hex');
  }

  /**
   * Initializes the security manager, generating a token if none exists
   * Requirement 10.1: Generate token on first start
   * @returns The current token (existing or newly generated)
   */
  async initialize(): Promise<string> {
    try {
      // Check if auth file exists
      await access(this.authPath, constants.F_OK);
      
      // Load existing token
      const authStore = await this.loadAuthStore();
      this.cachedToken = authStore.token;
      
      // Verify file permissions are correct
      await this.ensureSecurePermissions();
      
      await this.logger.info('Security manager initialized with existing token', {
        operation: 'security_init',
      });
      
      return authStore.token;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // No auth file exists, generate new token
        const token = await this.createNewToken();
        
        await this.logger.info('Security manager initialized with new token', {
          operation: 'security_init',
        });
        
        return token;
      }
      throw error;
    }
  }

  /**
   * Creates a new token and saves it to the auth file
   * @returns The newly generated token
   */
  private async createNewToken(): Promise<string> {
    const token = this.generateToken();
    const authStore: AuthStore = {
      token,
      createdAt: Date.now(),
    };
    
    await this.saveAuthStore(authStore);
    this.cachedToken = token;
    
    return token;
  }

  /**
   * Loads the auth store from disk
   */
  private async loadAuthStore(): Promise<AuthStore> {
    const content = await readFile(this.authPath, 'utf-8');
    return JSON.parse(content) as AuthStore;
  }

  /**
   * Saves the auth store to disk atomically with secure permissions
   * Requirement 10.3: Store tokens with 600 permissions
   */
  private async saveAuthStore(authStore: AuthStore): Promise<void> {
    const dir = dirname(this.authPath);
    const tempPath = join(dir, `.auth-${randomUUID()}.tmp`);
    
    try {
      // Write to temp file with secure permissions (600)
      await writeFile(tempPath, JSON.stringify(authStore, null, 2), { mode: 0o600 });
      
      // Atomic rename
      await rename(tempPath, this.authPath);
      
      // Ensure permissions are correct after rename (some systems may not preserve mode)
      await chmod(this.authPath, 0o600);
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
   * Ensures the auth file has secure permissions (600)
   * Requirement 10.3: Store tokens with 600 permissions
   */
  private async ensureSecurePermissions(): Promise<void> {
    try {
      const stats = await stat(this.authPath);
      const mode = stats.mode & 0o777;
      
      if (mode !== 0o600) {
        await chmod(this.authPath, 0o600);
        await this.logger.warn('Fixed insecure auth file permissions', {
          operation: 'security_permissions',
          previousMode: mode.toString(8),
          newMode: '600',
        });
      }
    } catch {
      // File may not exist yet
    }
  }

  /**
   * Validates a provided token against the stored token
   * Requirements: 10.2, 10.4
   * @param providedToken - Token to validate
   * @param clientInfo - Optional client information for logging
   * @returns Validation result
   */
  async validateToken(providedToken: string, clientInfo?: Record<string, unknown>): Promise<TokenValidationResult> {
    // Load token if not cached
    if (this.cachedToken === null) {
      try {
        const authStore = await this.loadAuthStore();
        this.cachedToken = authStore.token;
      } catch (error) {
        await this.logger.error('Failed to load auth token for validation', error, {
          operation: 'token_validation',
          ...clientInfo,
        });
        return {
          valid: false,
          reason: 'Authentication system unavailable',
        };
      }
    }

    // Constant-time comparison to prevent timing attacks
    const valid = this.constantTimeCompare(providedToken, this.cachedToken);

    if (valid) {
      await this.logger.info('Token validation successful', {
        operation: 'token_validation',
        result: 'success',
        ...clientInfo,
      });
      return { valid: true };
    } else {
      // Requirement 10.4: Log invalid token attempts
      await this.logger.warn('Token validation failed - invalid token', {
        operation: 'token_validation',
        result: 'failure',
        reason: 'invalid_token',
        ...clientInfo,
      });
      return {
        valid: false,
        reason: 'Invalid authentication token',
      };
    }
  }

  /**
   * Performs constant-time string comparison to prevent timing attacks
   */
  private constantTimeCompare(a: string, b: string): boolean {
    if (a.length !== b.length) {
      return false;
    }
    
    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return result === 0;
  }

  /**
   * Rotates the authentication token
   * Requirement 10.5: Support token rotation
   * @returns The new token
   */
  async rotateToken(): Promise<string> {
    const newToken = this.generateToken();
    
    // Load existing auth store to preserve createdAt
    let createdAt = Date.now();
    try {
      const existingStore = await this.loadAuthStore();
      createdAt = existingStore.createdAt;
    } catch {
      // No existing store, use current time
    }

    const authStore: AuthStore = {
      token: newToken,
      createdAt,
      rotatedAt: Date.now(),
    };

    await this.saveAuthStore(authStore);
    this.cachedToken = newToken;

    await this.logger.info('Token rotated successfully', {
      operation: 'token_rotation',
    });

    return newToken;
  }

  /**
   * Gets the current token (for CLI display)
   * @returns The current token or null if not initialized
   */
  async getToken(): Promise<string | null> {
    if (this.cachedToken) {
      return this.cachedToken;
    }

    try {
      const authStore = await this.loadAuthStore();
      this.cachedToken = authStore.token;
      return authStore.token;
    } catch {
      return null;
    }
  }

  /**
   * Gets the auth store metadata (without exposing the token)
   */
  async getMetadata(): Promise<{ createdAt: number; rotatedAt?: number | undefined } | null> {
    try {
      const authStore = await this.loadAuthStore();
      return {
        createdAt: authStore.createdAt,
        rotatedAt: authStore.rotatedAt,
      };
    } catch {
      return null;
    }
  }

  /**
   * Checks if the auth file has secure permissions
   * @returns true if permissions are 600, false otherwise
   */
  async hasSecurePermissions(): Promise<boolean> {
    try {
      const stats = await stat(this.authPath);
      const mode = stats.mode & 0o777;
      return mode === 0o600;
    } catch {
      return false;
    }
  }
}
