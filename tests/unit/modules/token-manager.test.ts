/**
 * Token Manager Unit Tests
 *
 * Tests for automatic token refresh functionality
 */

import { OAuth2Client } from 'google-auth-library';
import {
  TokenManager,
  OAuthCredentials,
  getTokenManager,
} from '../../../src/modules/auth/token-manager';
import { AuthenticationError, InvalidCredentialsError } from '../../../src/utils/errors';

describe('TokenManager', () => {
  let tokenManager: TokenManager;
  let mockOAuth2Client: jest.Mocked<Partial<OAuth2Client>>;

  beforeEach(() => {
    // Reset singleton before each test
    TokenManager.resetInstance();

    // Create mock OAuth2Client
    mockOAuth2Client = {
      setCredentials: jest.fn(),
      refreshAccessToken: jest.fn() as any,
    };

    // Get fresh instance
    tokenManager = TokenManager.getInstance();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Singleton Pattern', () => {
    it('should return the same instance', () => {
      const instance1 = TokenManager.getInstance();
      const instance2 = TokenManager.getInstance();

      expect(instance1).toBe(instance2);
    });

    it('should return same instance via getTokenManager', () => {
      const instance1 = getTokenManager();
      const instance2 = getTokenManager();

      expect(instance1).toBe(instance2);
    });

    it('should reset instance', () => {
      const instance1 = TokenManager.getInstance();
      TokenManager.resetInstance();
      const instance2 = TokenManager.getInstance();

      expect(instance1).not.toBe(instance2);
    });
  });

  describe('Initialization', () => {
    it('should initialize with OAuth2Client and credentials', () => {
      const credentials: OAuthCredentials = {
        access_token: 'test-access-token',
        refresh_token: 'test-refresh-token',
        expiry_date: Date.now() + 3600000, // 1 hour from now
      };

      tokenManager.initialize(mockOAuth2Client as OAuth2Client, credentials);

      expect(tokenManager.isInitialized()).toBe(true);
      expect(mockOAuth2Client.setCredentials).not.toHaveBeenCalled(); // Only sets on update
    });

    it('should not be initialized by default', () => {
      expect(tokenManager.isInitialized()).toBe(false);
    });
  });

  describe('Token Expiration Detection', () => {
    it('should detect expired token', () => {
      const credentials: OAuthCredentials = {
        access_token: 'test-token',
        refresh_token: 'refresh-token',
        expiry_date: Date.now() - 1000, // 1 second ago
      };

      tokenManager.initialize(mockOAuth2Client as OAuth2Client, credentials);

      expect(tokenManager.isTokenExpired(0)).toBe(true);
    });

    it('should detect token expiring soon (within buffer)', () => {
      const credentials: OAuthCredentials = {
        access_token: 'test-token',
        refresh_token: 'refresh-token',
        expiry_date: Date.now() + 60000, // 1 minute from now
      };

      tokenManager.initialize(mockOAuth2Client as OAuth2Client, credentials);

      // Default buffer is 5 minutes
      expect(tokenManager.isTokenExpired()).toBe(true);
    });

    it('should not detect valid token as expired', () => {
      const credentials: OAuthCredentials = {
        access_token: 'test-token',
        refresh_token: 'refresh-token',
        expiry_date: Date.now() + 3600000, // 1 hour from now
      };

      tokenManager.initialize(mockOAuth2Client as OAuth2Client, credentials);

      expect(tokenManager.isTokenExpired()).toBe(false);
    });

    it('should use custom buffer time', () => {
      const credentials: OAuthCredentials = {
        access_token: 'test-token',
        refresh_token: 'refresh-token',
        expiry_date: Date.now() + 120000, // 2 minutes from now
      };

      tokenManager.initialize(mockOAuth2Client as OAuth2Client, credentials);

      // 1 minute buffer - should not be expired
      expect(tokenManager.isTokenExpired(60000)).toBe(false);

      // 3 minute buffer - should be expired
      expect(tokenManager.isTokenExpired(180000)).toBe(true);
    });

    it('should return true if no expiry date', () => {
      const credentials: OAuthCredentials = {
        access_token: 'test-token',
        refresh_token: 'refresh-token',
        expiry_date: null,
      };

      tokenManager.initialize(mockOAuth2Client as OAuth2Client, credentials);

      expect(tokenManager.isTokenExpired()).toBe(true);
    });
  });

  describe('Token Validation', () => {
    it('should validate valid token', () => {
      const credentials: OAuthCredentials = {
        access_token: 'test-token',
        refresh_token: 'refresh-token',
        expiry_date: Date.now() + 3600000, // 1 hour from now
      };

      tokenManager.initialize(mockOAuth2Client as OAuth2Client, credentials);

      const validation = tokenManager.validateToken();

      expect(validation.isValid).toBe(true);
      expect(validation.needsRefresh).toBe(false);
      expect(validation.timeUntilExpiry).toBeGreaterThan(3000000); // ~50 minutes
    });

    it('should detect token needing refresh', () => {
      const credentials: OAuthCredentials = {
        access_token: 'test-token',
        refresh_token: 'refresh-token',
        expiry_date: Date.now() + 120000, // 2 minutes from now
      };

      tokenManager.initialize(mockOAuth2Client as OAuth2Client, credentials);

      const validation = tokenManager.validateToken();

      expect(validation.isValid).toBe(true);
      expect(validation.needsRefresh).toBe(true); // Within 5 minute buffer
    });

    it('should detect expired token', () => {
      const credentials: OAuthCredentials = {
        access_token: 'test-token',
        refresh_token: 'refresh-token',
        expiry_date: Date.now() - 1000, // 1 second ago
      };

      tokenManager.initialize(mockOAuth2Client as OAuth2Client, credentials);

      const validation = tokenManager.validateToken();

      expect(validation.isValid).toBe(false);
      expect(validation.needsRefresh).toBe(true);
    });

    it('should handle missing credentials', () => {
      const validation = tokenManager.validateToken();

      expect(validation.isValid).toBe(false);
      expect(validation.needsRefresh).toBe(true);
    });
  });

  describe('Token Refresh', () => {
    it('should refresh token successfully', async () => {
      const initialCredentials: OAuthCredentials = {
        access_token: 'old-token',
        refresh_token: 'refresh-token',
        expiry_date: Date.now() - 1000,
      };

      const newCredentials = {
        access_token: 'new-token',
        refresh_token: 'refresh-token',
        expiry_date: Date.now() + 3600000,
      };

      tokenManager.initialize(mockOAuth2Client as OAuth2Client, initialCredentials);

      (mockOAuth2Client.refreshAccessToken as jest.Mock).mockResolvedValueOnce({
        credentials: newCredentials,
      });

      const result = await tokenManager.refreshToken();

      expect(mockOAuth2Client.refreshAccessToken).toHaveBeenCalledTimes(1);
      expect(result.access_token).toBe('new-token');
      expect(mockOAuth2Client.setCredentials).toHaveBeenCalledWith(newCredentials);
    });

    it('should preserve refresh token if not provided', async () => {
      const initialCredentials: OAuthCredentials = {
        access_token: 'old-token',
        refresh_token: 'original-refresh-token',
        expiry_date: Date.now() - 1000,
      };

      const newCredentials = {
        access_token: 'new-token',
        expiry_date: Date.now() + 3600000,
      };

      tokenManager.initialize(mockOAuth2Client as OAuth2Client, initialCredentials);

      (mockOAuth2Client.refreshAccessToken as jest.Mock).mockResolvedValueOnce({
        credentials: newCredentials,
      });

      const result = await tokenManager.refreshToken();

      expect(result.refresh_token).toBe('original-refresh-token');
    });

    it('should throw error if OAuth client not initialized', async () => {
      await expect(tokenManager.refreshToken()).rejects.toThrow(AuthenticationError);
    });

    it('should throw error if no refresh token', async () => {
      const credentials: OAuthCredentials = {
        access_token: 'test-token',
        refresh_token: null,
        expiry_date: Date.now() - 1000,
      };

      tokenManager.initialize(mockOAuth2Client as OAuth2Client, credentials);

      await expect(tokenManager.refreshToken()).rejects.toThrow(InvalidCredentialsError);
    });

    it('should handle refresh token expired error', async () => {
      const credentials: OAuthCredentials = {
        access_token: 'old-token',
        refresh_token: 'expired-refresh-token',
        expiry_date: Date.now() - 1000,
      };

      tokenManager.initialize(mockOAuth2Client as OAuth2Client, credentials);

      // Mock refresh to fail with invalid_grant twice (once per call)
      (mockOAuth2Client.refreshAccessToken as jest.Mock)
        .mockRejectedValueOnce({
          response: {
            status: 400,
            data: { error: 'invalid_grant' },
          },
          message: 'Refresh token expired',
        })
        .mockRejectedValueOnce({
          response: {
            status: 400,
            data: { error: 'invalid_grant' },
          },
          message: 'Refresh token expired',
        });

      // First call
      await expect(tokenManager.refreshToken()).rejects.toThrow(InvalidCredentialsError);

      // Second call - check error details contain the reason
      try {
        await tokenManager.refreshToken();
        fail('Should have thrown error');
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidCredentialsError);
        const err = error as InvalidCredentialsError;
        expect(err.details?.['reason']).toContain('expired or revoked');
      }
    });

    it('should handle generic refresh error', async () => {
      const credentials: OAuthCredentials = {
        access_token: 'old-token',
        refresh_token: 'refresh-token',
        expiry_date: Date.now() - 1000,
      };

      tokenManager.initialize(mockOAuth2Client as OAuth2Client, credentials);

      // Mock refresh to fail twice (once per call)
      (mockOAuth2Client.refreshAccessToken as jest.Mock)
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'));

      // First call
      await expect(tokenManager.refreshToken()).rejects.toThrow(InvalidCredentialsError);

      // Second call - check error details contain the reason
      try {
        await tokenManager.refreshToken();
        fail('Should have thrown error');
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidCredentialsError);
        const err = error as InvalidCredentialsError;
        expect(err.details?.['reason']).toContain('refresh failed');
      }
    });

    it('should handle concurrent refresh calls (thread-safe)', async () => {
      const credentials: OAuthCredentials = {
        access_token: 'old-token',
        refresh_token: 'refresh-token',
        expiry_date: Date.now() - 1000,
      };

      tokenManager.initialize(mockOAuth2Client as OAuth2Client, credentials);

      const newCredentials = {
        access_token: 'new-token',
        refresh_token: 'refresh-token',
        expiry_date: Date.now() + 3600000,
      };

      // Simulate slow refresh
      (mockOAuth2Client.refreshAccessToken as jest.Mock).mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve({ credentials: newCredentials }), 100)
          )
      );

      // Start 3 concurrent refresh calls
      const [result1, result2, result3] = await Promise.all([
        tokenManager.refreshToken(),
        tokenManager.refreshToken(),
        tokenManager.refreshToken(),
      ]);

      // Should only call refresh once
      expect(mockOAuth2Client.refreshAccessToken).toHaveBeenCalledTimes(1);

      // All should get same result
      expect(result1.access_token).toBe('new-token');
      expect(result2.access_token).toBe('new-token');
      expect(result3.access_token).toBe('new-token');
    });
  });

  describe('Get Valid Token', () => {
    it('should return valid token without refresh', async () => {
      const credentials: OAuthCredentials = {
        access_token: 'valid-token',
        refresh_token: 'refresh-token',
        expiry_date: Date.now() + 3600000, // 1 hour from now
      };

      tokenManager.initialize(mockOAuth2Client as OAuth2Client, credentials);

      const token = await tokenManager.getValidToken();

      expect(token).toBe('valid-token');
      expect(mockOAuth2Client.refreshAccessToken).not.toHaveBeenCalled();
    });

    it('should refresh token if expired', async () => {
      const credentials: OAuthCredentials = {
        access_token: 'old-token',
        refresh_token: 'refresh-token',
        expiry_date: Date.now() + 60000, // 1 minute - within buffer
      };

      tokenManager.initialize(mockOAuth2Client as OAuth2Client, credentials);

      const newCredentials = {
        access_token: 'new-token',
        refresh_token: 'refresh-token',
        expiry_date: Date.now() + 3600000,
      };

      (mockOAuth2Client.refreshAccessToken as jest.Mock).mockResolvedValueOnce({
        credentials: newCredentials,
      });

      const token = await tokenManager.getValidToken();

      expect(token).toBe('new-token');
      expect(mockOAuth2Client.refreshAccessToken).toHaveBeenCalledTimes(1);
    });

    it('should force refresh if requested', async () => {
      const credentials: OAuthCredentials = {
        access_token: 'valid-token',
        refresh_token: 'refresh-token',
        expiry_date: Date.now() + 3600000, // Still valid
      };

      tokenManager.initialize(mockOAuth2Client as OAuth2Client, credentials);

      const newCredentials = {
        access_token: 'force-refreshed-token',
        refresh_token: 'refresh-token',
        expiry_date: Date.now() + 3600000,
      };

      (mockOAuth2Client.refreshAccessToken as jest.Mock).mockResolvedValueOnce({
        credentials: newCredentials,
      });

      const token = await tokenManager.getValidToken(true);

      expect(token).toBe('force-refreshed-token');
      expect(mockOAuth2Client.refreshAccessToken).toHaveBeenCalledTimes(1);
    });

    it('should throw error if no credentials', async () => {
      await expect(tokenManager.getValidToken()).rejects.toThrow(AuthenticationError);
    });

    it('should throw error if auto-refresh disabled and token expired', async () => {
      tokenManager.updateConfig({ autoRefresh: false });

      const credentials: OAuthCredentials = {
        access_token: 'old-token',
        refresh_token: 'refresh-token',
        expiry_date: Date.now() + 60000, // Within buffer
      };

      tokenManager.initialize(mockOAuth2Client as OAuth2Client, credentials);

      // First call
      await expect(tokenManager.getValidToken()).rejects.toThrow(InvalidCredentialsError);

      // Second call - check error details contain the reason
      try {
        await tokenManager.getValidToken();
        fail('Should have thrown error');
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidCredentialsError);
        const err = error as InvalidCredentialsError;
        expect(err.details?.['reason']).toContain('auto-refresh disabled');
      }
    });
  });

  describe('Credentials Management', () => {
    it('should get current credentials', () => {
      const credentials: OAuthCredentials = {
        access_token: 'test-token',
        refresh_token: 'refresh-token',
        expiry_date: Date.now() + 3600000,
      };

      tokenManager.initialize(mockOAuth2Client as OAuth2Client, credentials);

      const retrieved = tokenManager.getCredentials();

      expect(retrieved).toEqual(credentials);
      expect(retrieved).not.toBe(credentials); // Should be a copy
    });

    it('should return null if no credentials', () => {
      const retrieved = tokenManager.getCredentials();

      expect(retrieved).toBeNull();
    });

    it('should update credentials', () => {
      const initialCredentials: OAuthCredentials = {
        access_token: 'old-token',
        refresh_token: 'refresh-token',
        expiry_date: Date.now() + 3600000,
      };

      tokenManager.initialize(mockOAuth2Client as OAuth2Client, initialCredentials);

      const newCredentials: OAuthCredentials = {
        access_token: 'new-token',
        refresh_token: 'new-refresh-token',
        expiry_date: Date.now() + 7200000,
      };

      tokenManager.updateCredentials(newCredentials);

      expect(mockOAuth2Client.setCredentials).toHaveBeenCalledWith(newCredentials);
      expect(tokenManager.getCredentials()).toEqual(newCredentials);
    });

    it('should clear credentials', () => {
      const credentials: OAuthCredentials = {
        access_token: 'test-token',
        refresh_token: 'refresh-token',
        expiry_date: Date.now() + 3600000,
      };

      tokenManager.initialize(mockOAuth2Client as OAuth2Client, credentials);

      tokenManager.clearCredentials();

      expect(mockOAuth2Client.setCredentials).toHaveBeenCalledWith({});
      expect(tokenManager.getCredentials()).toBeNull();
    });
  });

  describe('Configuration', () => {
    it('should use default configuration', () => {
      const config = tokenManager.getConfig();

      expect(config.refreshBuffer).toBe(5 * 60 * 1000); // 5 minutes
      expect(config.autoRefresh).toBe(true);
    });

    it('should accept custom configuration', () => {
      TokenManager.resetInstance();

      const customConfig = {
        refreshBuffer: 10 * 60 * 1000, // 10 minutes
        autoRefresh: false,
      };

      tokenManager = TokenManager.getInstance(customConfig);

      const config = tokenManager.getConfig();

      expect(config.refreshBuffer).toBe(10 * 60 * 1000);
      expect(config.autoRefresh).toBe(false);
    });

    it('should update configuration', () => {
      tokenManager.updateConfig({
        refreshBuffer: 2 * 60 * 1000, // 2 minutes
      });

      const config = tokenManager.getConfig();

      expect(config.refreshBuffer).toBe(2 * 60 * 1000);
    });
  });

  describe('Time Until Expiry', () => {
    it('should return time until expiry', () => {
      const expiryDate = Date.now() + 3600000; // 1 hour from now
      const credentials: OAuthCredentials = {
        access_token: 'test-token',
        refresh_token: 'refresh-token',
        expiry_date: expiryDate,
      };

      tokenManager.initialize(mockOAuth2Client as OAuth2Client, credentials);

      const timeUntilExpiry = tokenManager.getTimeUntilExpiry();

      expect(timeUntilExpiry).toBeGreaterThan(3500000); // ~58 minutes
      expect(timeUntilExpiry).toBeLessThanOrEqual(3600000); // <= 1 hour
    });

    it('should return null if no expiry date', () => {
      const credentials: OAuthCredentials = {
        access_token: 'test-token',
        refresh_token: 'refresh-token',
        expiry_date: null,
      };

      tokenManager.initialize(mockOAuth2Client as OAuth2Client, credentials);

      const timeUntilExpiry = tokenManager.getTimeUntilExpiry();

      expect(timeUntilExpiry).toBeNull();
    });

    it('should return 0 if already expired', () => {
      const credentials: OAuthCredentials = {
        access_token: 'test-token',
        refresh_token: 'refresh-token',
        expiry_date: Date.now() - 1000, // 1 second ago
      };

      tokenManager.initialize(mockOAuth2Client as OAuth2Client, credentials);

      const timeUntilExpiry = tokenManager.getTimeUntilExpiry();

      expect(timeUntilExpiry).toBe(0);
    });
  });

  describe('Callbacks', () => {
    it('should trigger onTokenRefresh callback', async () => {
      const onTokenRefresh = jest.fn();

      TokenManager.resetInstance();
      tokenManager = TokenManager.getInstance({ onTokenRefresh });

      const credentials: OAuthCredentials = {
        access_token: 'old-token',
        refresh_token: 'refresh-token',
        expiry_date: Date.now() - 1000,
      };

      tokenManager.initialize(mockOAuth2Client as OAuth2Client, credentials);

      const newCredentials = {
        access_token: 'new-token',
        refresh_token: 'refresh-token',
        expiry_date: Date.now() + 3600000,
      };

      (mockOAuth2Client.refreshAccessToken as jest.Mock).mockResolvedValueOnce({
        credentials: newCredentials,
      });

      await tokenManager.refreshToken();

      expect(onTokenRefresh).toHaveBeenCalledWith(
        expect.objectContaining({
          access_token: 'new-token',
        })
      );
    });

    it('should trigger onRefreshError callback', async () => {
      const onRefreshError = jest.fn();

      TokenManager.resetInstance();
      tokenManager = TokenManager.getInstance({ onRefreshError });

      const credentials: OAuthCredentials = {
        access_token: 'old-token',
        refresh_token: 'refresh-token',
        expiry_date: Date.now() - 1000,
      };

      tokenManager.initialize(mockOAuth2Client as OAuth2Client, credentials);

      (mockOAuth2Client.refreshAccessToken as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

      await expect(tokenManager.refreshToken()).rejects.toThrow();

      expect(onRefreshError).toHaveBeenCalledWith(expect.any(Error));
    });
  });
});
