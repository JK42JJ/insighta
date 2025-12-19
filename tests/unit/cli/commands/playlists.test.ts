/**
 * Playlist Management Commands Unit Tests
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
  importPlaylistCommand,
  listPlaylistsCommand,
  getPlaylistCommand,
  syncPlaylistCommand,
  deletePlaylistCommand,
  registerPlaylistCommands,
} from '../../../../src/cli/commands/playlists';
import { Command } from 'commander';

describe('Playlist Management Commands', () => {
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
    };
    mockGetTokenStorage.mockReturnValue(mockTokenStorage);

    // Mock API client
    mockApiClient = {
      importPlaylist: jest.fn(),
      listPlaylists: jest.fn(),
      getPlaylist: jest.fn(),
      syncPlaylist: jest.fn(),
      deletePlaylist: jest.fn(),
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

  describe('registerPlaylistCommands', () => {
    test('should register all playlist commands', () => {
      const program = new Command();
      registerPlaylistCommands(program);

      const commands = program.commands.map((cmd) => cmd.name());
      expect(commands).toContain('playlist-import');
      expect(commands).toContain('playlist-list');
      expect(commands).toContain('playlist-get');
      expect(commands).toContain('playlist-sync');
      expect(commands).toContain('playlist-delete');
    });
  });

  describe('listPlaylistsCommand', () => {
    test('should list playlists successfully', async () => {
      mockTokenStorage.getValidTokens.mockResolvedValue({
        accessToken: 'test-token',
        user: { email: 'test@example.com' },
      });
      mockApiClient.listPlaylists.mockResolvedValue({
        playlists: [
          {
            id: 'pl1',
            title: 'Test Playlist',
            channelTitle: 'Test Channel',
            itemCount: 10,
            syncStatus: 'COMPLETED',
            lastSyncedAt: new Date().toISOString(),
          },
        ],
        total: 1,
      });

      await listPlaylistsCommand({});

      expect(mockApiClient.listPlaylists).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Found 1 playlist')
      );
    });

    test('should show message when no playlists found', async () => {
      mockTokenStorage.getValidTokens.mockResolvedValue({
        accessToken: 'test-token',
        user: { email: 'test@example.com' },
      });
      mockApiClient.listPlaylists.mockResolvedValue({
        playlists: [],
        total: 0,
      });

      await listPlaylistsCommand({});

      expect(consoleLogSpy).toHaveBeenCalledWith('⚠️  No playlists found\n');
    });

    test('should exit when not logged in', async () => {
      mockTokenStorage.getValidTokens.mockResolvedValue(null);

      await expect(listPlaylistsCommand({})).rejects.toThrow(
        'process.exit called'
      );

      expect(consoleErrorSpy).toHaveBeenCalledWith('\n❌ You are not logged in\n');
    });

    test('should handle API errors', async () => {
      const { ApiClientError } = require('../../../../src/cli/api-client');
      mockTokenStorage.getValidTokens.mockResolvedValue({
        accessToken: 'test-token',
        user: { email: 'test@example.com' },
      });
      mockApiClient.listPlaylists.mockRejectedValue(
        new ApiClientError('Server error', 500)
      );

      await expect(listPlaylistsCommand({})).rejects.toThrow(
        'process.exit called'
      );

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to list playlists')
      );
    });

    test('should handle expired session', async () => {
      const { ApiClientError } = require('../../../../src/cli/api-client');
      mockTokenStorage.getValidTokens.mockResolvedValue({
        accessToken: 'test-token',
        user: { email: 'test@example.com' },
      });
      mockApiClient.listPlaylists.mockRejectedValue(
        new ApiClientError('Unauthorized', 401)
      );

      await expect(listPlaylistsCommand({})).rejects.toThrow(
        'process.exit called'
      );

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('session has expired')
      );
    });

    test('should pass query parameters correctly', async () => {
      mockTokenStorage.getValidTokens.mockResolvedValue({
        accessToken: 'test-token',
        user: { email: 'test@example.com' },
      });
      mockApiClient.listPlaylists.mockResolvedValue({
        playlists: [],
        total: 0,
      });

      await listPlaylistsCommand({
        filter: 'test',
        sortBy: 'title',
        sortOrder: 'asc',
        limit: '10',
        offset: '5',
      });

      expect(mockApiClient.listPlaylists).toHaveBeenCalledWith({
        filter: 'test',
        sortBy: 'title',
        sortOrder: 'asc',
        limit: 10,
        offset: 5,
      });
    });
  });

  describe('getPlaylistCommand', () => {
    test('should get playlist details successfully', async () => {
      mockTokenStorage.getValidTokens.mockResolvedValue({
        accessToken: 'test-token',
        user: { email: 'test@example.com' },
      });
      mockApiClient.getPlaylist.mockResolvedValue({
        playlist: {
          id: 'pl1',
          title: 'Test Playlist',
          channelTitle: 'Test Channel',
          description: 'Test description',
          itemCount: 5,
          syncStatus: 'COMPLETED',
          lastSyncedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          youtubeId: 'PLtest123',
          items: [
            {
              position: 0,
              video: {
                title: 'Test Video',
                channelTitle: 'Test Channel',
                duration: 300,
                viewCount: 1000,
                publishedAt: new Date().toISOString(),
                youtubeId: 'vid123',
              },
            },
          ],
        },
      });

      await getPlaylistCommand('pl1');

      expect(mockApiClient.getPlaylist).toHaveBeenCalledWith('pl1');
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('PLAYLIST DETAILS')
      );
    });

    test('should exit when playlist ID not provided', async () => {
      await expect(getPlaylistCommand('')).rejects.toThrow(
        'process.exit called'
      );

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '\n❌ Playlist ID is required\n'
      );
    });

    test('should handle playlist not found', async () => {
      const { ApiClientError } = require('../../../../src/cli/api-client');
      mockTokenStorage.getValidTokens.mockResolvedValue({
        accessToken: 'test-token',
        user: { email: 'test@example.com' },
      });
      mockApiClient.getPlaylist.mockRejectedValue(
        new ApiClientError('Not found', 404)
      );

      await expect(getPlaylistCommand('pl1')).rejects.toThrow(
        'process.exit called'
      );

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('not found')
      );
    });

    test('should display videos with more than 10 items message', async () => {
      const items = Array.from({ length: 15 }, (_, i) => ({
        position: i,
        video: {
          title: `Video ${i}`,
          channelTitle: 'Test Channel',
          duration: 300,
          viewCount: 1000,
          publishedAt: new Date().toISOString(),
          youtubeId: `vid${i}`,
        },
      }));

      mockTokenStorage.getValidTokens.mockResolvedValue({
        accessToken: 'test-token',
        user: { email: 'test@example.com' },
      });
      mockApiClient.getPlaylist.mockResolvedValue({
        playlist: {
          id: 'pl1',
          title: 'Test Playlist',
          channelTitle: 'Test Channel',
          itemCount: 15,
          syncStatus: 'COMPLETED',
          lastSyncedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          youtubeId: 'PLtest123',
          items,
        },
      });

      await getPlaylistCommand('pl1');

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('and 5 more videos')
      );
    });
  });

  describe('syncPlaylistCommand', () => {
    test('should sync playlist successfully', async () => {
      mockTokenStorage.getValidTokens.mockResolvedValue({
        accessToken: 'test-token',
        user: { email: 'test@example.com' },
      });
      mockApiClient.syncPlaylist.mockResolvedValue({
        result: {
          playlistId: 'pl1',
          status: 'COMPLETED',
          itemsAdded: 2,
          itemsRemoved: 1,
          itemsReordered: 0,
          duration: 5000,
          quotaUsed: 3,
        },
      });

      await syncPlaylistCommand('pl1');

      expect(mockApiClient.syncPlaylist).toHaveBeenCalledWith('pl1');
      expect(consoleLogSpy).toHaveBeenCalledWith(
        '✅ Sync completed successfully!\n'
      );
    });

    test('should exit when playlist ID not provided', async () => {
      await expect(syncPlaylistCommand('')).rejects.toThrow(
        'process.exit called'
      );

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '\n❌ Playlist ID is required\n'
      );
    });

    test('should handle sync conflict (409)', async () => {
      const { ApiClientError } = require('../../../../src/cli/api-client');
      mockTokenStorage.getValidTokens.mockResolvedValue({
        accessToken: 'test-token',
        user: { email: 'test@example.com' },
      });
      mockApiClient.syncPlaylist.mockRejectedValue(
        new ApiClientError('Sync in progress', 409)
      );

      await expect(syncPlaylistCommand('pl1')).rejects.toThrow(
        'process.exit called'
      );

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('already in progress')
      );
    });

    test('should display error in sync result', async () => {
      mockTokenStorage.getValidTokens.mockResolvedValue({
        accessToken: 'test-token',
        user: { email: 'test@example.com' },
      });
      mockApiClient.syncPlaylist.mockResolvedValue({
        result: {
          playlistId: 'pl1',
          status: 'COMPLETED',
          itemsAdded: 0,
          itemsRemoved: 0,
          itemsReordered: 0,
          duration: 1000,
          quotaUsed: 1,
          error: 'Some warning message',
        },
      });

      await syncPlaylistCommand('pl1');

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Some warning message')
      );
    });
  });

  describe('deletePlaylistCommand', () => {
    test('should delete playlist with force flag', async () => {
      mockTokenStorage.getValidTokens.mockResolvedValue({
        accessToken: 'test-token',
        user: { email: 'test@example.com' },
      });
      mockApiClient.deletePlaylist.mockResolvedValue({});

      await deletePlaylistCommand('pl1', { force: true });

      expect(mockApiClient.deletePlaylist).toHaveBeenCalledWith('pl1');
      expect(consoleLogSpy).toHaveBeenCalledWith(
        '✅ Playlist deleted successfully!\n'
      );
    });

    test('should exit when playlist ID not provided', async () => {
      await expect(deletePlaylistCommand('', {})).rejects.toThrow(
        'process.exit called'
      );

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '\n❌ Playlist ID is required\n'
      );
    });

    test('should handle playlist not found on delete', async () => {
      const { ApiClientError } = require('../../../../src/cli/api-client');
      mockTokenStorage.getValidTokens.mockResolvedValue({
        accessToken: 'test-token',
        user: { email: 'test@example.com' },
      });
      mockApiClient.deletePlaylist.mockRejectedValue(
        new ApiClientError('Not found', 404)
      );

      await expect(deletePlaylistCommand('pl1', { force: true })).rejects.toThrow(
        'process.exit called'
      );

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('already been deleted')
      );
    });
  });

  describe('importPlaylistCommand', () => {
    test('should import playlist successfully', async () => {
      mockTokenStorage.getValidTokens.mockResolvedValue({
        accessToken: 'test-token',
        user: { email: 'test@example.com' },
      });
      mockApiClient.importPlaylist.mockResolvedValue({
        playlist: {
          id: 'pl1',
          title: 'Test Playlist',
          channelTitle: 'Test Channel',
          itemCount: 10,
          youtubeId: 'PLtest123',
        },
      });

      await importPlaylistCommand('https://youtube.com/playlist?list=PLtest123');

      expect(mockApiClient.importPlaylist).toHaveBeenCalledWith({
        playlistUrl: 'https://youtube.com/playlist?list=PLtest123',
      });
      expect(consoleLogSpy).toHaveBeenCalledWith(
        '✅ Playlist imported successfully!\n'
      );
    });

    test('should handle duplicate playlist', async () => {
      const { ApiClientError } = require('../../../../src/cli/api-client');
      mockTokenStorage.getValidTokens.mockResolvedValue({
        accessToken: 'test-token',
        user: { email: 'test@example.com' },
      });
      mockApiClient.importPlaylist.mockRejectedValue(
        new ApiClientError('Already exists', 409, 'DUPLICATE_RESOURCE')
      );

      await expect(
        importPlaylistCommand('https://youtube.com/playlist?list=PLtest123')
      ).rejects.toThrow('process.exit called');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('already imported')
      );
    });

    test('should handle expired session on import', async () => {
      const { ApiClientError } = require('../../../../src/cli/api-client');
      mockTokenStorage.getValidTokens.mockResolvedValue({
        accessToken: 'test-token',
        user: { email: 'test@example.com' },
      });
      mockApiClient.importPlaylist.mockRejectedValue(
        new ApiClientError('Unauthorized', 401)
      );

      await expect(
        importPlaylistCommand('https://youtube.com/playlist?list=PLtest123')
      ).rejects.toThrow('process.exit called');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('session has expired')
      );
    });
  });
});
