/**
 * User Authentication Commands Unit Tests
 */

// Mock dependencies before imports
const mockCreateApiClient = jest.fn();
const mockGetTokenStorage = jest.fn();

jest.mock('../../../../src/cli/api-client', () => ({
  createApiClient: mockCreateApiClient,
  ApiClientError: class ApiClientError extends Error {
    code?: string;
    statusCode?: number;
    constructor(message: string, statusCode?: number, code?: string) {
      super(message);
      this.statusCode = statusCode;
      this.code = code;
    }
  },
}));

jest.mock('../../../../src/cli/token-storage', () => ({
  getTokenStorage: mockGetTokenStorage,
  StoredTokens: {},
}));

// Mock readline
jest.mock('readline/promises', () => ({
  createInterface: jest.fn(() => ({
    question: jest.fn(),
    close: jest.fn(),
  })),
}));

// Import after mocks
import {
  registerCommand,
  loginCommand,
  logoutCommand,
  whoamiCommand,
  registerAuthCommands,
} from '../../../../src/cli/commands/auth';
import { Command } from 'commander';

describe('User Authentication Commands', () => {
  let mockTokenStorage: any;
  let mockApiClient: any;
  let consoleLogSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;
  let processExitSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock token storage
    mockTokenStorage = {
      getValidTokens: jest.fn(),
      loadTokens: jest.fn(),
      saveTokens: jest.fn(),
      clearTokens: jest.fn(),
    };
    mockGetTokenStorage.mockReturnValue(mockTokenStorage);

    // Mock API client
    mockApiClient = {
      register: jest.fn(),
      login: jest.fn(),
      logout: jest.fn(),
      getProfile: jest.fn(),
    };
    mockCreateApiClient.mockReturnValue(mockApiClient);

    // Mock console methods
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    processExitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  describe('registerAuthCommands', () => {
    test('should register all authentication commands', () => {
      const program = new Command();
      registerAuthCommands(program);

      const commands = program.commands.map((cmd) => cmd.name());
      expect(commands).toContain('user-register');
      expect(commands).toContain('user-login');
      expect(commands).toContain('user-logout');
      expect(commands).toContain('user-whoami');
    });
  });

  describe('logoutCommand', () => {
    test('should logout successfully when logged in', async () => {
      const tokens = {
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
        expiresAt: Date.now() + 3600000,
        user: { email: 'test@example.com', name: 'Test User', id: '123' },
      };
      mockTokenStorage.loadTokens.mockResolvedValue(tokens);
      mockApiClient.logout.mockResolvedValue({});

      await logoutCommand();

      expect(mockApiClient.logout).toHaveBeenCalledWith('test-refresh-token');
      expect(mockTokenStorage.clearTokens).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith('✅ Logged out successfully\n');
    });

    test('should show message when not logged in', async () => {
      mockTokenStorage.loadTokens.mockResolvedValue(null);

      await logoutCommand();

      expect(mockApiClient.logout).not.toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith('⚠️  You are not logged in\n');
    });

    test('should clear tokens even if API logout fails', async () => {
      const tokens = {
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
        expiresAt: Date.now() + 3600000,
        user: { email: 'test@example.com', name: 'Test User', id: '123' },
      };
      mockTokenStorage.loadTokens.mockResolvedValue(tokens);
      mockApiClient.logout.mockRejectedValue(new Error('API error'));

      await logoutCommand();

      expect(mockTokenStorage.clearTokens).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith('✅ Logged out successfully\n');
    });
  });

  describe('whoamiCommand', () => {
    test('should display user profile when logged in', async () => {
      const tokens = {
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
        expiresAt: Date.now() + 3600000,
        user: { email: 'test@example.com', name: 'Test User', id: '123' },
      };
      mockTokenStorage.getValidTokens.mockResolvedValue(tokens);
      mockApiClient.getProfile.mockResolvedValue({
        user: {
          id: '123',
          email: 'test@example.com',
          name: 'Test User',
          createdAt: new Date().toISOString(),
        },
      });

      await whoamiCommand();

      expect(mockApiClient.getProfile).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('USER PROFILE'));
    });

    test('should show message when not logged in', async () => {
      mockTokenStorage.getValidTokens.mockResolvedValue(null);

      await whoamiCommand();

      expect(mockApiClient.getProfile).not.toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith('\n⚠️  You are not logged in\n');
    });

    test('should handle expired session', async () => {
      const { ApiClientError } = require('../../../../src/cli/api-client');
      const tokens = {
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
        expiresAt: Date.now() + 3600000,
        user: { email: 'test@example.com', name: 'Test User', id: '123' },
      };
      mockTokenStorage.getValidTokens.mockResolvedValue(tokens);
      mockApiClient.getProfile.mockRejectedValue(
        new ApiClientError('Unauthorized', 401)
      );

      await expect(whoamiCommand()).rejects.toThrow('process.exit called');

      expect(mockTokenStorage.clearTokens).toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Session expired')
      );
    });

    test('should display token expiry in hours', async () => {
      const tokens = {
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
        expiresAt: Date.now() + 3600000 * 2, // 2 hours
        user: { email: 'test@example.com', name: 'Test User', id: '123' },
      };
      mockTokenStorage.getValidTokens.mockResolvedValue(tokens);
      mockApiClient.getProfile.mockResolvedValue({
        user: {
          id: '123',
          email: 'test@example.com',
          name: 'Test User',
          createdAt: new Date().toISOString(),
        },
      });

      await whoamiCommand();

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('hour')
      );
    });

    test('should display token expiry in minutes', async () => {
      const tokens = {
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
        expiresAt: Date.now() + 60000 * 30, // 30 minutes
        user: { email: 'test@example.com', name: 'Test User', id: '123' },
      };
      mockTokenStorage.getValidTokens.mockResolvedValue(tokens);
      mockApiClient.getProfile.mockResolvedValue({
        user: {
          id: '123',
          email: 'test@example.com',
          name: 'Test User',
          createdAt: new Date().toISOString(),
        },
      });

      await whoamiCommand();

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('minute')
      );
    });

    test('should display soon expiry warning', async () => {
      const tokens = {
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
        expiresAt: Date.now() + 5000, // 5 seconds
        user: { email: 'test@example.com', name: 'Test User', id: '123' },
      };
      mockTokenStorage.getValidTokens.mockResolvedValue(tokens);
      mockApiClient.getProfile.mockResolvedValue({
        user: {
          id: '123',
          email: 'test@example.com',
          name: 'Test User',
          createdAt: new Date().toISOString(),
        },
      });

      await whoamiCommand();

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Soon')
      );
    });

    test('should handle non-401 API errors', async () => {
      const { ApiClientError } = require('../../../../src/cli/api-client');
      const tokens = {
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
        expiresAt: Date.now() + 3600000,
        user: { email: 'test@example.com', name: 'Test User', id: '123' },
      };
      mockTokenStorage.getValidTokens.mockResolvedValue(tokens);
      mockApiClient.getProfile.mockRejectedValue(
        new ApiClientError('Server error', 500)
      );

      await expect(whoamiCommand()).rejects.toThrow('process.exit called');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to get profile')
      );
    });

    test('should handle generic errors', async () => {
      const tokens = {
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
        expiresAt: Date.now() + 3600000,
        user: { email: 'test@example.com', name: 'Test User', id: '123' },
      };
      mockTokenStorage.getValidTokens.mockResolvedValue(tokens);
      mockApiClient.getProfile.mockRejectedValue(new Error('Network error'));

      await expect(whoamiCommand()).rejects.toThrow('process.exit called');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Network error')
      );
    });
  });

  describe('registerCommand', () => {
    test('should show already logged in message', async () => {
      const tokens = {
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
        expiresAt: Date.now() + 3600000,
        user: { email: 'test@example.com', name: 'Test User', id: '123' },
      };
      mockTokenStorage.getValidTokens.mockResolvedValue(tokens);

      await registerCommand();

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('already logged in')
      );
    });
  });

  describe('loginCommand', () => {
    test('should show already logged in message', async () => {
      const tokens = {
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
        expiresAt: Date.now() + 3600000,
        user: { email: 'test@example.com', name: 'Test User', id: '123' },
      };
      mockTokenStorage.getValidTokens.mockResolvedValue(tokens);

      await loginCommand();

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('already logged in')
      );
    });
  });

  describe('logoutCommand error handling', () => {
    test('should handle unexpected logout errors', async () => {
      mockTokenStorage.loadTokens.mockRejectedValue(new Error('Storage error'));

      await expect(logoutCommand()).rejects.toThrow('process.exit called');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Logout failed')
      );
    });

    test('should handle non-Error objects in logout', async () => {
      mockTokenStorage.loadTokens.mockRejectedValue('string error');

      await expect(logoutCommand()).rejects.toThrow('process.exit called');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Logout failed')
      );
    });
  });
});
