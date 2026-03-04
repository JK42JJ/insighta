/**
 * BaseOAuthAdapter - Base class for OAuth 2.0 based adapters
 *
 * Provides OAuth-specific functionality including:
 * - Authorization URL generation
 * - Token exchange and refresh
 * - Credential storage and validation
 *
 * @version 1.0.0
 * @since 2025-12-22
 */

import { BaseAdapter } from '../core/base-adapter';
import {
  AdapterConfig,
  SourceCredentials,
  AuthResult,
  AdapterErrorCode,
} from '../DataSourceAdapter';

/**
 * OAuth 2.0 configuration
 */
export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
  authorizationEndpoint: string;
  tokenEndpoint: string;
  revokeEndpoint?: string;
}

/**
 * OAuth token response
 */
export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  tokenType?: string;
  scope?: string;
}

/**
 * Abstract base class for OAuth 2.0 adapters
 */
export abstract class BaseOAuthAdapter extends BaseAdapter {
  protected oauthConfig: OAuthConfig | null = null;
  protected tokenExpiresAt: Date | null = null;

  // ============================================================================
  // Abstract Methods (OAuth-specific)
  // ============================================================================

  /**
   * Get OAuth configuration for this service
   */
  abstract getOAuthConfig(): OAuthConfig;

  /**
   * Exchange authorization code for tokens
   */
  abstract exchangeCodeForTokens(code: string): Promise<OAuthTokens>;

  /**
   * Refresh access token using refresh token
   */
  abstract refreshAccessToken(refreshToken: string): Promise<OAuthTokens>;

  // ============================================================================
  // Lifecycle
  // ============================================================================

  protected override async onInitialize(config: AdapterConfig): Promise<void> {
    this.oauthConfig = this.getOAuthConfig();
    await super.onInitialize(config);
  }

  // ============================================================================
  // OAuth Implementation
  // ============================================================================

  override getAuthUrl(): string {
    this.ensureOAuthConfig();

    const params = new URLSearchParams({
      client_id: this.oauthConfig!.clientId,
      redirect_uri: this.oauthConfig!.redirectUri,
      response_type: 'code',
      scope: this.oauthConfig!.scopes.join(' '),
      access_type: 'offline',
      prompt: 'consent',
    });

    return `${this.oauthConfig!.authorizationEndpoint}?${params.toString()}`;
  }

  override async authenticate(credentials: SourceCredentials): Promise<AuthResult> {
    // If we have an authorization code, exchange it for tokens
    if (credentials['authorizationCode']) {
      try {
        const tokens = await this.exchangeCodeForTokens(
          credentials['authorizationCode'] as string
        );

        this.credentials = {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
        };

        if (tokens.expiresIn) {
          this.tokenExpiresAt = new Date(Date.now() + tokens.expiresIn * 1000);
        }

        return {
          success: true,
          credentials: this.credentials,
          expiresAt: this.tokenExpiresAt ?? undefined,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Token exchange failed',
        };
      }
    }

    // If we already have tokens, just store them
    if (credentials.accessToken) {
      this.credentials = credentials;
      return { success: true, credentials };
    }

    return {
      success: false,
      error: 'No authorization code or access token provided',
    };
  }

  override async refreshAuth(): Promise<AuthResult> {
    if (!this.credentials?.refreshToken) {
      return {
        success: false,
        error: 'No refresh token available',
      };
    }

    try {
      const tokens = await this.refreshAccessToken(this.credentials.refreshToken);

      this.credentials = {
        ...this.credentials,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken ?? this.credentials.refreshToken,
      };

      if (tokens.expiresIn) {
        this.tokenExpiresAt = new Date(Date.now() + tokens.expiresIn * 1000);
      }

      return {
        success: true,
        credentials: this.credentials,
        expiresAt: this.tokenExpiresAt ?? undefined,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Token refresh failed',
      };
    }
  }

  // ============================================================================
  // Token Management
  // ============================================================================

  /**
   * Check if access token is expired or about to expire
   */
  protected isTokenExpired(bufferSeconds = 60): boolean {
    if (!this.tokenExpiresAt) return false;
    return new Date() >= new Date(this.tokenExpiresAt.getTime() - bufferSeconds * 1000);
  }

  /**
   * Ensure we have a valid access token, refreshing if needed
   */
  protected async ensureValidToken(): Promise<string> {
    this.ensureAuthenticated();

    if (this.isTokenExpired()) {
      const result = await this.refreshAuth();
      if (!result.success) {
        throw this.createError(
          AdapterErrorCode.AUTH_EXPIRED,
          'Failed to refresh expired token'
        );
      }
    }

    return this.credentials!.accessToken!;
  }

  /**
   * Get authorization header for API requests
   */
  protected getAuthHeader(): { Authorization: string } {
    this.ensureAuthenticated();
    return { Authorization: `Bearer ${this.credentials!.accessToken}` };
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  private ensureOAuthConfig(): void {
    if (!this.oauthConfig) {
      throw this.createError(
        AdapterErrorCode.INTERNAL_ERROR,
        'OAuth configuration not set. Call initialize() first.'
      );
    }
  }
}

export default BaseOAuthAdapter;
