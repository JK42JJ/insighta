/**
 * Token Storage Unit Tests
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { TokenStorage, StoredTokens, getTokenStorage } from '../../../src/cli/token-storage';

jest.mock('fs/promises');
jest.mock('os');

const mockFs = fs as jest.Mocked<typeof fs>;
const mockOs = os as jest.Mocked<typeof os>;

describe('TokenStorage', () => {
  let tokenStorage: TokenStorage;
  const mockHomeDir = '/home/testuser';
  const mockTokenFilePath = path.join(mockHomeDir, '.yt-sync-tokens.json');

  const mockTokens: StoredTokens = {
    accessToken: 'test-access-token',
    refreshToken: 'test-refresh-token',
    expiresAt: Date.now() + 3600000, // 1 hour from now
    user: {
      id: 'user-123',
      email: 'test@example.com',
      name: 'Test User',
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockOs.homedir.mockReturnValue(mockHomeDir);
    tokenStorage = new TokenStorage();
  });

  describe('saveTokens', () => {
    test('should save tokens to file with correct permissions', async () => {
      mockFs.writeFile.mockResolvedValue(undefined);

      await tokenStorage.saveTokens(mockTokens);

      expect(mockFs.writeFile).toHaveBeenCalledWith(
        mockTokenFilePath,
        JSON.stringify(mockTokens, null, 2),
        { mode: 0o600 }
      );
    });

    test('should throw error on write failure', async () => {
      mockFs.writeFile.mockRejectedValue(new Error('Permission denied'));

      await expect(tokenStorage.saveTokens(mockTokens)).rejects.toThrow(
        'Failed to save tokens: Permission denied'
      );
    });
  });

  describe('loadTokens', () => {
    test('should load and parse tokens from file', async () => {
      mockFs.readFile.mockResolvedValue(JSON.stringify(mockTokens));

      const result = await tokenStorage.loadTokens();

      expect(result).toEqual(mockTokens);
      expect(mockFs.readFile).toHaveBeenCalledWith(mockTokenFilePath, 'utf-8');
    });

    test('should return null if file does not exist', async () => {
      const error: NodeJS.ErrnoException = new Error('File not found');
      error.code = 'ENOENT';
      mockFs.readFile.mockRejectedValue(error);

      const result = await tokenStorage.loadTokens();

      expect(result).toBeNull();
    });

    test('should throw error for invalid token structure', async () => {
      mockFs.readFile.mockResolvedValue(JSON.stringify({ accessToken: 'only-access' }));

      await expect(tokenStorage.loadTokens()).rejects.toThrow('Invalid token structure');
    });

    test('should throw error on read failure', async () => {
      mockFs.readFile.mockRejectedValue(new Error('Read error'));

      await expect(tokenStorage.loadTokens()).rejects.toThrow('Failed to load tokens: Read error');
    });
  });

  describe('clearTokens', () => {
    test('should delete token file', async () => {
      mockFs.unlink.mockResolvedValue(undefined);

      await tokenStorage.clearTokens();

      expect(mockFs.unlink).toHaveBeenCalledWith(mockTokenFilePath);
    });

    test('should not throw if file does not exist', async () => {
      const error: NodeJS.ErrnoException = new Error('File not found');
      error.code = 'ENOENT';
      mockFs.unlink.mockRejectedValue(error);

      await expect(tokenStorage.clearTokens()).resolves.not.toThrow();
    });

    test('should throw error on delete failure', async () => {
      mockFs.unlink.mockRejectedValue(new Error('Delete error'));

      await expect(tokenStorage.clearTokens()).rejects.toThrow(
        'Failed to clear tokens: Delete error'
      );
    });
  });

  describe('hasTokens', () => {
    test('should return true if token file exists', async () => {
      mockFs.access.mockResolvedValue(undefined);

      const result = await tokenStorage.hasTokens();

      expect(result).toBe(true);
      expect(mockFs.access).toHaveBeenCalledWith(mockTokenFilePath);
    });

    test('should return false if token file does not exist', async () => {
      mockFs.access.mockRejectedValue(new Error('Not found'));

      const result = await tokenStorage.hasTokens();

      expect(result).toBe(false);
    });
  });

  describe('isExpired', () => {
    test('should return false for valid tokens', () => {
      const validTokens: StoredTokens = {
        ...mockTokens,
        expiresAt: Date.now() + 3600000, // 1 hour from now
      };

      expect(tokenStorage.isExpired(validTokens)).toBe(false);
    });

    test('should return true for expired tokens', () => {
      const expiredTokens: StoredTokens = {
        ...mockTokens,
        expiresAt: Date.now() - 1000, // 1 second ago
      };

      expect(tokenStorage.isExpired(expiredTokens)).toBe(true);
    });

    test('should return true when tokens expire exactly now', () => {
      const nowTokens: StoredTokens = {
        ...mockTokens,
        expiresAt: Date.now(),
      };

      expect(tokenStorage.isExpired(nowTokens)).toBe(true);
    });
  });

  describe('getValidTokens', () => {
    test('should return tokens if valid and not expired', async () => {
      mockFs.readFile.mockResolvedValue(JSON.stringify(mockTokens));

      const result = await tokenStorage.getValidTokens();

      expect(result).toEqual(mockTokens);
    });

    test('should return null if no tokens exist', async () => {
      const error: NodeJS.ErrnoException = new Error('File not found');
      error.code = 'ENOENT';
      mockFs.readFile.mockRejectedValue(error);

      const result = await tokenStorage.getValidTokens();

      expect(result).toBeNull();
    });

    test('should return null if tokens are expired', async () => {
      const expiredTokens: StoredTokens = {
        ...mockTokens,
        expiresAt: Date.now() - 1000,
      };
      mockFs.readFile.mockResolvedValue(JSON.stringify(expiredTokens));

      const result = await tokenStorage.getValidTokens();

      expect(result).toBeNull();
    });
  });

  describe('updateAccessToken', () => {
    test('should update access token and save', async () => {
      mockFs.readFile.mockResolvedValue(JSON.stringify(mockTokens));
      mockFs.writeFile.mockResolvedValue(undefined);

      const newAccessToken = 'new-access-token';
      const newRefreshToken = 'new-refresh-token';
      const expiresIn = 7200; // 2 hours

      await tokenStorage.updateAccessToken(newAccessToken, newRefreshToken, expiresIn);

      expect(mockFs.writeFile).toHaveBeenCalled();
      const savedData = JSON.parse((mockFs.writeFile.mock.calls[0] as any)[1]);
      expect(savedData.accessToken).toBe(newAccessToken);
      expect(savedData.refreshToken).toBe(newRefreshToken);
      expect(savedData.expiresAt).toBeGreaterThan(Date.now());
    });

    test('should throw error if no tokens exist', async () => {
      const error: NodeJS.ErrnoException = new Error('File not found');
      error.code = 'ENOENT';
      mockFs.readFile.mockRejectedValue(error);

      await expect(
        tokenStorage.updateAccessToken('new-token', 'new-refresh', 3600)
      ).rejects.toThrow('No tokens to update');
    });
  });

  describe('willExpireSoon', () => {
    test('should return false if tokens have plenty of time before expiry', () => {
      const tokens: StoredTokens = {
        ...mockTokens,
        expiresAt: Date.now() + 3600000, // 1 hour from now
      };

      // Default buffer is 5 minutes (300000ms)
      expect(tokenStorage.willExpireSoon(tokens)).toBe(false);
    });

    test('should return true if tokens will expire within default buffer (5 minutes)', () => {
      const tokens: StoredTokens = {
        ...mockTokens,
        expiresAt: Date.now() + 60000, // 1 minute from now
      };

      expect(tokenStorage.willExpireSoon(tokens)).toBe(true);
    });

    test('should return true if tokens will expire within custom buffer', () => {
      const tokens: StoredTokens = {
        ...mockTokens,
        expiresAt: Date.now() + 500000, // 8.3 minutes from now
      };

      const customBuffer = 10 * 60 * 1000; // 10 minutes
      expect(tokenStorage.willExpireSoon(tokens, customBuffer)).toBe(true);
    });

    test('should return false if tokens expire after custom buffer', () => {
      const tokens: StoredTokens = {
        ...mockTokens,
        expiresAt: Date.now() + 1200000, // 20 minutes from now
      };

      const customBuffer = 10 * 60 * 1000; // 10 minutes
      expect(tokenStorage.willExpireSoon(tokens, customBuffer)).toBe(false);
    });

    test('should return true if tokens are already expired', () => {
      const tokens: StoredTokens = {
        ...mockTokens,
        expiresAt: Date.now() - 1000, // Already expired
      };

      expect(tokenStorage.willExpireSoon(tokens)).toBe(true);
    });
  });

  describe('getTimeUntilExpiry', () => {
    test('should return time in milliseconds until expiry', () => {
      const futureTime = Date.now() + 3600000; // 1 hour from now
      const tokens: StoredTokens = {
        ...mockTokens,
        expiresAt: futureTime,
      };

      const timeUntilExpiry = tokenStorage.getTimeUntilExpiry(tokens);

      expect(timeUntilExpiry).toBeGreaterThan(3599000); // ~1 hour
      expect(timeUntilExpiry).toBeLessThanOrEqual(3600000);
    });

    test('should return 0 for expired tokens', () => {
      const tokens: StoredTokens = {
        ...mockTokens,
        expiresAt: Date.now() - 10000, // Expired 10 seconds ago
      };

      expect(tokenStorage.getTimeUntilExpiry(tokens)).toBe(0);
    });

    test('should return 0 for tokens expiring exactly now', () => {
      const tokens: StoredTokens = {
        ...mockTokens,
        expiresAt: Date.now(),
      };

      expect(tokenStorage.getTimeUntilExpiry(tokens)).toBe(0);
    });

    test('should return correct time for tokens expiring soon', () => {
      const tokens: StoredTokens = {
        ...mockTokens,
        expiresAt: Date.now() + 60000, // 1 minute from now
      };

      const timeUntilExpiry = tokenStorage.getTimeUntilExpiry(tokens);

      expect(timeUntilExpiry).toBeGreaterThan(59000);
      expect(timeUntilExpiry).toBeLessThanOrEqual(60000);
    });
  });
});

describe('getTokenStorage', () => {
  test('should return same instance (singleton)', () => {
    const instance1 = getTokenStorage();
    const instance2 = getTokenStorage();

    expect(instance1).toBe(instance2);
  });
});
