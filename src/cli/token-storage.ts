/**
 * CLI Token Storage
 *
 * Secure storage for authentication tokens on the local filesystem
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix timestamp
  user: {
    id: string;
    email: string;
    name: string;
  };
}

const TOKEN_FILE_NAME = '.yt-sync-tokens.json';

export class TokenStorage {
  private tokenFilePath: string;

  constructor() {
    // Store tokens in user's home directory
    const homeDir = os.homedir();
    this.tokenFilePath = path.join(homeDir, TOKEN_FILE_NAME);
  }

  /**
   * Save tokens to storage
   */
  async saveTokens(tokens: StoredTokens): Promise<void> {
    try {
      const data = JSON.stringify(tokens, null, 2);
      await fs.writeFile(this.tokenFilePath, data, { mode: 0o600 }); // Owner read/write only
    } catch (error) {
      throw new Error(`Failed to save tokens: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Load tokens from storage
   */
  async loadTokens(): Promise<StoredTokens | null> {
    try {
      const data = await fs.readFile(this.tokenFilePath, 'utf-8');
      const tokens = JSON.parse(data) as StoredTokens;

      // Validate token structure
      if (!tokens.accessToken || !tokens.refreshToken || !tokens.expiresAt || !tokens.user) {
        throw new Error('Invalid token structure');
      }

      return tokens;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // File doesn't exist - not an error, just no tokens
        return null;
      }
      throw new Error(`Failed to load tokens: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Clear stored tokens
   */
  async clearTokens(): Promise<void> {
    try {
      await fs.unlink(this.tokenFilePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new Error(`Failed to clear tokens: ${error instanceof Error ? error.message : String(error)}`);
      }
      // File doesn't exist - already cleared
    }
  }

  /**
   * Check if tokens are stored
   */
  async hasTokens(): Promise<boolean> {
    try {
      await fs.access(this.tokenFilePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if tokens are expired
   */
  isExpired(tokens: StoredTokens): boolean {
    return Date.now() >= tokens.expiresAt;
  }

  /**
   * Get tokens if valid (not expired)
   */
  async getValidTokens(): Promise<StoredTokens | null> {
    const tokens = await this.loadTokens();

    if (!tokens) {
      return null;
    }

    if (this.isExpired(tokens)) {
      return null;
    }

    return tokens;
  }

  /**
   * Update only the access token (after refresh)
   */
  async updateAccessToken(accessToken: string, refreshToken: string, expiresIn: number): Promise<void> {
    const existingTokens = await this.loadTokens();

    if (!existingTokens) {
      throw new Error('No tokens to update');
    }

    existingTokens.accessToken = accessToken;
    existingTokens.refreshToken = refreshToken;
    existingTokens.expiresAt = Date.now() + expiresIn * 1000;

    await this.saveTokens(existingTokens);
  }

  /**
   * Check if tokens will expire soon (within buffer time)
   */
  willExpireSoon(tokens: StoredTokens, bufferMs: number = 5 * 60 * 1000): boolean {
    return Date.now() >= tokens.expiresAt - bufferMs;
  }

  /**
   * Get time until expiration (in milliseconds)
   */
  getTimeUntilExpiry(tokens: StoredTokens): number {
    const timeUntilExpiry = tokens.expiresAt - Date.now();
    return Math.max(0, timeUntilExpiry);
  }
}

/**
 * Global token storage instance
 */
let tokenStorage: TokenStorage | null = null;

export function getTokenStorage(): TokenStorage {
  if (!tokenStorage) {
    tokenStorage = new TokenStorage();
  }
  return tokenStorage;
}
