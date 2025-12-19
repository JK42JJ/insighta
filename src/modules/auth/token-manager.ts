/**
 * Token Manager
 *
 * Manages YouTube OAuth token lifecycle with automatic refresh:
 * - Token expiration detection
 * - Automatic token refresh
 * - Thread-safe refresh operations
 * - Secure credential storage
 *
 * Features:
 * - 5-minute buffer before expiration
 * - Singleton pattern for global access
 * - Race condition protection
 * - Refresh token expiration handling
 */

import { OAuth2Client } from 'google-auth-library';
import { logger } from '../../utils/logger';
import { AuthenticationError, InvalidCredentialsError } from '../../utils/errors';

/**
 * OAuth credentials structure
 */
export interface OAuthCredentials {
  access_token: string | null;
  refresh_token: string | null;
  expiry_date?: number | null; // Unix timestamp in milliseconds
}

/**
 * Token validation result
 */
export interface TokenValidationResult {
  isValid: boolean;
  needsRefresh: boolean;
  timeUntilExpiry?: number; // milliseconds
}

/**
 * Token Manager Configuration
 */
export interface TokenManagerConfig {
  /**
   * Time buffer before token expiration to trigger refresh (milliseconds)
   * Default: 5 minutes (300000 ms)
   */
  refreshBuffer?: number;

  /**
   * Enable automatic token refresh
   * Default: true
   */
  autoRefresh?: boolean;

  /**
   * Callback when tokens are refreshed
   */
  onTokenRefresh?: (credentials: OAuthCredentials) => void | Promise<void>;

  /**
   * Callback when refresh fails (e.g., refresh token expired)
   */
  onRefreshError?: (error: Error) => void | Promise<void>;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: Required<Omit<TokenManagerConfig, 'onTokenRefresh' | 'onRefreshError'>> = {
  refreshBuffer: 5 * 60 * 1000, // 5 minutes in milliseconds
  autoRefresh: true,
};

/**
 * Token Manager Class
 *
 * Singleton class that manages OAuth token lifecycle for YouTube API.
 * Provides automatic token refresh and thread-safe operations.
 */
export class TokenManager {
  private static instance: TokenManager | null = null;
  private oauth2Client: OAuth2Client | null = null;
  private credentials: OAuthCredentials | null = null;
  private refreshPromise: Promise<OAuthCredentials> | null = null;
  private config: Required<Omit<TokenManagerConfig, 'onTokenRefresh' | 'onRefreshError'>> & TokenManagerConfig;

  /**
   * Private constructor for singleton pattern
   */
  private constructor(config: TokenManagerConfig = {}) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    };
  }

  /**
   * Get TokenManager singleton instance
   */
  public static getInstance(config?: TokenManagerConfig): TokenManager {
    if (!TokenManager.instance) {
      TokenManager.instance = new TokenManager(config);
    }
    return TokenManager.instance;
  }

  /**
   * Reset singleton instance (for testing)
   */
  public static resetInstance(): void {
    TokenManager.instance = null;
  }

  /**
   * Initialize with OAuth2Client and credentials
   *
   * @param oauth2Client - Google OAuth2Client instance
   * @param credentials - Initial OAuth credentials
   */
  public initialize(oauth2Client: OAuth2Client, credentials: OAuthCredentials): void {
    this.oauth2Client = oauth2Client;
    this.credentials = credentials;

    logger.info('TokenManager initialized', {
      hasAccessToken: !!credentials.access_token,
      hasRefreshToken: !!credentials.refresh_token,
      expiryDate: credentials.expiry_date,
    });
  }

  /**
   * Check if token is expired
   *
   * @param bufferMs - Optional buffer time in milliseconds (default: configured refreshBuffer)
   * @returns true if token is expired or will expire within buffer time
   */
  public isTokenExpired(bufferMs?: number): boolean {
    if (!this.credentials || !this.credentials.expiry_date) {
      return true;
    }

    const buffer = bufferMs ?? this.config.refreshBuffer;
    const expiryTime = this.credentials.expiry_date;
    const now = Date.now();

    return now >= expiryTime - buffer;
  }

  /**
   * Get time until token expiration
   *
   * @returns milliseconds until expiration, or null if no expiry date
   */
  public getTimeUntilExpiry(): number | null {
    if (!this.credentials || !this.credentials.expiry_date) {
      return null;
    }

    const timeUntilExpiry = this.credentials.expiry_date - Date.now();
    return Math.max(0, timeUntilExpiry);
  }

  /**
   * Validate current token
   *
   * @returns Token validation result
   */
  public validateToken(): TokenValidationResult {
    if (!this.credentials || !this.credentials.access_token) {
      return {
        isValid: false,
        needsRefresh: true,
      };
    }

    const isExpired = this.isTokenExpired(0); // Check actual expiration
    const needsRefresh = this.isTokenExpired(); // Check with buffer

    const timeUntilExpiry = this.getTimeUntilExpiry();

    return {
      isValid: !isExpired,
      needsRefresh,
      timeUntilExpiry: timeUntilExpiry ?? undefined,
    };
  }

  /**
   * Refresh access token using refresh token
   *
   * Thread-safe implementation - multiple concurrent calls will share the same refresh operation.
   *
   * @returns New credentials with refreshed access token
   * @throws AuthenticationError if OAuth client not initialized
   * @throws InvalidCredentialsError if refresh token is invalid or expired
   */
  public async refreshToken(): Promise<OAuthCredentials> {
    // If refresh is already in progress, return the existing promise
    if (this.refreshPromise) {
      logger.debug('Token refresh already in progress, waiting for completion');
      return this.refreshPromise;
    }

    // Create new refresh promise
    this.refreshPromise = this._performRefresh();

    try {
      const credentials = await this.refreshPromise;
      return credentials;
    } finally {
      // Clear refresh promise after completion
      this.refreshPromise = null;
    }
  }

  /**
   * Internal method to perform token refresh
   */
  private async _performRefresh(): Promise<OAuthCredentials> {
    if (!this.oauth2Client) {
      throw new AuthenticationError('OAuth2Client not initialized');
    }

    if (!this.credentials || !this.credentials.refresh_token) {
      throw new InvalidCredentialsError({
        reason: 'No refresh token available',
      });
    }

    try {
      logger.info('Refreshing access token');

      // Perform token refresh
      const { credentials } = await this.oauth2Client.refreshAccessToken();

      // Update stored credentials
      this.credentials = {
        access_token: credentials.access_token ?? null,
        refresh_token: credentials.refresh_token ?? this.credentials.refresh_token, // Keep old refresh token if not provided
        expiry_date: credentials.expiry_date ?? null,
      };

      // Update OAuth client credentials
      this.oauth2Client.setCredentials(this.credentials);

      logger.info('Access token refreshed successfully', {
        expiryDate: this.credentials.expiry_date,
        timeUntilExpiry: this.getTimeUntilExpiry(),
      });

      // Trigger callback if provided
      if (this.config.onTokenRefresh) {
        await this.config.onTokenRefresh(this.credentials);
      }

      return this.credentials;
    } catch (error) {
      logger.error('Failed to refresh access token', { error });

      // Trigger error callback if provided
      if (this.config.onRefreshError) {
        await this.config.onRefreshError(error as Error);
      }

      // Determine error type
      const err = error as any;
      if (err?.response?.status === 400 && err?.response?.data?.error === 'invalid_grant') {
        throw new InvalidCredentialsError({
          reason: 'Refresh token expired or revoked',
          error: err.message,
        });
      }

      throw new InvalidCredentialsError({
        reason: 'Token refresh failed',
        error: err?.message || String(error),
      });
    }
  }

  /**
   * Get valid access token with automatic refresh
   *
   * If token is expired or will expire soon, automatically refreshes it.
   *
   * @param forceRefresh - Force token refresh even if not expired
   * @returns Valid access token
   * @throws AuthenticationError if no credentials available
   * @throws InvalidCredentialsError if refresh fails
   */
  public async getValidToken(forceRefresh: boolean = false): Promise<string> {
    if (!this.credentials) {
      throw new AuthenticationError('No credentials available');
    }

    // Check if refresh is needed
    const validation = this.validateToken();

    if (forceRefresh || validation.needsRefresh) {
      if (!this.config.autoRefresh && !forceRefresh) {
        logger.warn('Token needs refresh but auto-refresh is disabled');
        throw new InvalidCredentialsError({
          reason: 'Token expired and auto-refresh disabled',
        });
      }

      // Refresh token
      await this.refreshToken();
    }

    // Return access token
    if (!this.credentials.access_token) {
      throw new AuthenticationError('No access token available after refresh');
    }

    return this.credentials.access_token;
  }

  /**
   * Get current credentials
   *
   * @returns Current OAuth credentials or null if not initialized
   */
  public getCredentials(): OAuthCredentials | null {
    return this.credentials ? { ...this.credentials } : null;
  }

  /**
   * Update credentials
   *
   * @param credentials - New OAuth credentials
   */
  public updateCredentials(credentials: OAuthCredentials): void {
    this.credentials = credentials;

    if (this.oauth2Client) {
      this.oauth2Client.setCredentials(credentials);
    }

    logger.debug('Credentials updated', {
      hasAccessToken: !!credentials.access_token,
      hasRefreshToken: !!credentials.refresh_token,
      expiryDate: credentials.expiry_date,
    });
  }

  /**
   * Clear credentials
   */
  public clearCredentials(): void {
    this.credentials = null;

    if (this.oauth2Client) {
      this.oauth2Client.setCredentials({});
    }

    logger.info('Credentials cleared');
  }

  /**
   * Check if TokenManager is initialized
   */
  public isInitialized(): boolean {
    return this.oauth2Client !== null && this.credentials !== null;
  }

  /**
   * Update configuration
   *
   * @param config - Partial configuration to update
   */
  public updateConfig(config: Partial<TokenManagerConfig>): void {
    this.config = {
      ...this.config,
      ...config,
    };

    logger.debug('TokenManager configuration updated', config);
  }

  /**
   * Get current configuration
   */
  public getConfig(): Readonly<TokenManagerConfig> {
    return { ...this.config };
  }
}

/**
 * Get global TokenManager instance
 *
 * @param config - Optional configuration for first initialization
 * @returns TokenManager singleton instance
 */
export function getTokenManager(config?: TokenManagerConfig): TokenManager {
  return TokenManager.getInstance(config);
}

/**
 * Helper: Convert OAuth credentials to StoredTokens format (for CLI)
 */
export function credentialsToStoredTokens(
  credentials: OAuthCredentials,
  user: { id: string; email: string; name: string }
): {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  user: { id: string; email: string; name: string };
} {
  if (!credentials.access_token || !credentials.refresh_token) {
    throw new Error('Invalid credentials: missing access_token or refresh_token');
  }

  return {
    accessToken: credentials.access_token,
    refreshToken: credentials.refresh_token,
    expiresAt: credentials.expiry_date || Date.now() + 3600 * 1000, // Default 1 hour if not provided
    user,
  };
}
