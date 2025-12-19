/**
 * YouTube API Client Unit Tests
 */

// Mock dependencies before imports
const mockGoogleAuth = {
  generateAuthUrl: jest.fn(),
  setCredentials: jest.fn(),
  getToken: jest.fn(),
};

const mockYouTubeApi = {
  playlists: {
    list: jest.fn(),
  },
  playlistItems: {
    list: jest.fn(),
  },
  videos: {
    list: jest.fn(),
  },
};

jest.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: jest.fn(() => mockGoogleAuth),
    },
    youtube: jest.fn(() => mockYouTubeApi),
  },
}));

const mockCacheService = {
  initialize: jest.fn().mockResolvedValue(undefined),
  get: jest.fn(),
  set: jest.fn(),
  delete: jest.fn(),
  clear: jest.fn(),
};

jest.mock('../../../src/utils/cache', () => ({
  getCacheService: jest.fn(() => mockCacheService),
}));

const mockTokenManager = {
  initialize: jest.fn(),
  isInitialized: jest.fn().mockReturnValue(true),
  getValidToken: jest.fn().mockResolvedValue('valid-token'),
  refreshToken: jest.fn().mockResolvedValue({
    access_token: 'new-access-token',
    refresh_token: 'refresh-token',
    expiry_date: Date.now() + 3600000,
  }),
  validateToken: jest.fn().mockReturnValue({
    isValid: true,
    needsRefresh: false,
    isExpired: false,
    expiresIn: 3600,
  }),
};

jest.mock('../../../src/modules/auth/token-manager', () => ({
  getTokenManager: jest.fn(() => mockTokenManager),
}));

jest.mock('../../../src/config', () => ({
  config: {
    youtube: {
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      redirectUri: 'http://localhost:3000/callback',
      apiKey: 'test-api-key',
    },
  },
}));

jest.mock('../../../src/utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('../../../src/utils/retry', () => ({
  retry: jest.fn((fn) => fn()),
}));

// Import after mocks
import { YouTubeClient, getYouTubeClient } from '../../../src/api/client';
import {
  AuthenticationError,
  InvalidCredentialsError,
  YouTubeAPIError,
  QuotaExceededError,
} from '../../../src/utils/errors';

describe('YouTubeClient', () => {
  let client: YouTubeClient;

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset singleton
    (global as any).clientInstance = null;
    client = new YouTubeClient(true);
  });

  describe('constructor', () => {
    test('should create client with cache enabled', () => {
      expect(client).toBeDefined();
      expect(mockCacheService.initialize).toHaveBeenCalled();
    });

    test('should create client with cache disabled', () => {
      jest.clearAllMocks();
      const clientNoCache = new YouTubeClient(false);
      expect(clientNoCache).toBeDefined();
      expect(mockCacheService.initialize).not.toHaveBeenCalled();
    });
  });

  describe('setCredentials', () => {
    test('should set OAuth credentials', () => {
      const credentials = {
        access_token: 'test-access-token',
        refresh_token: 'test-refresh-token',
        expiry_date: Date.now() + 3600000,
      };

      client.setCredentials(credentials);

      expect(mockGoogleAuth.setCredentials).toHaveBeenCalledWith({
        access_token: credentials.access_token,
        refresh_token: credentials.refresh_token,
        expiry_date: credentials.expiry_date,
      });
      expect(mockTokenManager.initialize).toHaveBeenCalled();
    });

    test('should handle null values in credentials', () => {
      const credentials = {
        access_token: null,
        refresh_token: null,
        expiry_date: null,
      };

      client.setCredentials(credentials);

      expect(mockGoogleAuth.setCredentials).toHaveBeenCalledWith({
        access_token: null,
        refresh_token: null,
        expiry_date: null,
      });
    });

    test('should handle undefined values in credentials', () => {
      const credentials = {};

      client.setCredentials(credentials);

      expect(mockGoogleAuth.setCredentials).toHaveBeenCalledWith({
        access_token: null,
        refresh_token: null,
        expiry_date: null,
      });
    });
  });

  describe('getAuthUrl', () => {
    test('should generate authorization URL', () => {
      mockGoogleAuth.generateAuthUrl.mockReturnValue(
        'https://accounts.google.com/o/oauth2/v2/auth?scope=...'
      );

      const authUrl = client.getAuthUrl();

      expect(authUrl).toContain('https://accounts.google.com');
      expect(mockGoogleAuth.generateAuthUrl).toHaveBeenCalledWith({
        access_type: 'offline',
        scope: expect.arrayContaining([
          'https://www.googleapis.com/auth/youtube.readonly',
          'https://www.googleapis.com/auth/youtube.force-ssl',
        ]),
      });
    });
  });

  describe('getTokensFromCode', () => {
    test('should exchange authorization code for tokens', async () => {
      const mockTokens = {
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        expiry_date: Date.now() + 3600000,
      };

      mockGoogleAuth.getToken.mockResolvedValue({ tokens: mockTokens });

      const result = await client.getTokensFromCode('auth-code');

      expect(result).toEqual({
        access_token: mockTokens.access_token,
        refresh_token: mockTokens.refresh_token,
        expiry_date: mockTokens.expiry_date,
      });
      expect(mockGoogleAuth.getToken).toHaveBeenCalledWith('auth-code');
      expect(mockTokenManager.initialize).toHaveBeenCalled();
    });

    test('should throw InvalidCredentialsError on failure', async () => {
      mockGoogleAuth.getToken.mockRejectedValue(new Error('Invalid code'));

      await expect(client.getTokensFromCode('invalid-code')).rejects.toThrow(
        InvalidCredentialsError
      );
    });

    test('should filter out null values from tokens', async () => {
      const mockTokens = {
        access_token: 'access-token',
        refresh_token: null,
        expiry_date: null,
      };

      mockGoogleAuth.getToken.mockResolvedValue({ tokens: mockTokens });

      const result = await client.getTokensFromCode('auth-code');

      expect(result).toEqual({
        access_token: 'access-token',
      });
      expect(result).not.toHaveProperty('refresh_token');
      expect(result).not.toHaveProperty('expiry_date');
    });
  });

  describe('refreshAccessToken', () => {
    test('should refresh access token using TokenManager', async () => {
      await client.refreshAccessToken();

      expect(mockTokenManager.refreshToken).toHaveBeenCalled();
      expect(mockGoogleAuth.setCredentials).toHaveBeenCalled();
    });

    test('should propagate errors from TokenManager', async () => {
      mockTokenManager.refreshToken.mockRejectedValue(
        new AuthenticationError('Token refresh failed')
      );

      await expect(client.refreshAccessToken()).rejects.toThrow(
        AuthenticationError
      );
    });
  });

  describe('getValidAccessToken', () => {
    test('should return valid access token from TokenManager', async () => {
      mockTokenManager.getValidToken.mockResolvedValue('valid-access-token');

      const token = await client.getValidAccessToken();

      expect(token).toBe('valid-access-token');
      expect(mockTokenManager.getValidToken).toHaveBeenCalled();
    });
  });

  describe('needsTokenRefresh', () => {
    test('should return true when token needs refresh', () => {
      mockTokenManager.validateToken.mockReturnValue({
        isValid: true,
        needsRefresh: true,
        isExpired: false,
        expiresIn: 100,
      });

      expect(client.needsTokenRefresh()).toBe(true);
    });

    test('should return false when token is valid', () => {
      mockTokenManager.validateToken.mockReturnValue({
        isValid: true,
        needsRefresh: false,
        isExpired: false,
        expiresIn: 3600,
      });

      expect(client.needsTokenRefresh()).toBe(false);
    });
  });

  describe('getPlaylist', () => {
    const mockPlaylist = {
      id: 'PLtest123',
      snippet: {
        title: 'Test Playlist',
        description: 'Test Description',
        channelId: 'UCtest',
        channelTitle: 'Test Channel',
      },
      contentDetails: {
        itemCount: 10,
      },
    };

    beforeEach(() => {
      mockYouTubeApi.playlists.list.mockResolvedValue({
        data: {
          items: [mockPlaylist],
        },
      });
    });

    test('should fetch playlist from API', async () => {
      mockCacheService.get.mockResolvedValue(null);

      const result = await client.getPlaylist('PLtest123');

      expect(result).toEqual(mockPlaylist);
      expect(mockYouTubeApi.playlists.list).toHaveBeenCalledWith({
        part: ['snippet', 'contentDetails', 'status'],
        id: ['PLtest123'],
      });
    });

    test('should return cached playlist when available', async () => {
      mockCacheService.get.mockResolvedValue(mockPlaylist);

      const result = await client.getPlaylist('PLtest123');

      expect(result).toEqual(mockPlaylist);
      expect(mockYouTubeApi.playlists.list).not.toHaveBeenCalled();
    });

    test('should skip cache when useCache is false', async () => {
      mockCacheService.get.mockResolvedValue(mockPlaylist);

      const result = await client.getPlaylist('PLtest123', false);

      expect(result).toEqual(mockPlaylist);
      expect(mockCacheService.get).not.toHaveBeenCalled();
      expect(mockYouTubeApi.playlists.list).toHaveBeenCalled();
    });

    test('should cache playlist result', async () => {
      mockCacheService.get.mockResolvedValue(null);

      await client.getPlaylist('PLtest123');

      expect(mockCacheService.set).toHaveBeenCalledWith(
        'playlist:PLtest123',
        mockPlaylist,
        3600
      );
    });

    test('should throw YouTubeAPIError when playlist not found', async () => {
      mockCacheService.get.mockResolvedValue(null);
      mockYouTubeApi.playlists.list.mockResolvedValue({
        data: {
          items: [],
        },
      });

      await expect(client.getPlaylist('nonexistent')).rejects.toThrow(
        YouTubeAPIError
      );
    });
  });

  describe('getPlaylistItems', () => {
    const mockItems = [
      {
        id: 'item1',
        snippet: {
          resourceId: { videoId: 'video1' },
          position: 0,
        },
      },
      {
        id: 'item2',
        snippet: {
          resourceId: { videoId: 'video2' },
          position: 1,
        },
      },
    ];

    beforeEach(() => {
      mockYouTubeApi.playlistItems.list.mockResolvedValue({
        data: {
          items: mockItems,
          nextPageToken: undefined,
        },
      });
    });

    test('should fetch playlist items from API', async () => {
      mockCacheService.get.mockResolvedValue(null);

      const result = await client.getPlaylistItems('PLtest123');

      expect(result).toEqual(mockItems);
      expect(mockYouTubeApi.playlistItems.list).toHaveBeenCalledWith({
        part: ['snippet', 'contentDetails', 'status'],
        playlistId: 'PLtest123',
        maxResults: 50,
        pageToken: undefined,
      });
    });

    test('should return cached playlist items when available', async () => {
      mockCacheService.get.mockResolvedValue(mockItems);

      const result = await client.getPlaylistItems('PLtest123');

      expect(result).toEqual(mockItems);
      expect(mockYouTubeApi.playlistItems.list).not.toHaveBeenCalled();
    });

    test('should handle pagination', async () => {
      mockCacheService.get.mockResolvedValue(null);

      const page1Items = [{ id: 'item1' }, { id: 'item2' }];
      const page2Items = [{ id: 'item3' }, { id: 'item4' }];

      mockYouTubeApi.playlistItems.list
        .mockResolvedValueOnce({
          data: {
            items: page1Items,
            nextPageToken: 'next-page',
          },
        })
        .mockResolvedValueOnce({
          data: {
            items: page2Items,
            nextPageToken: undefined,
          },
        });

      const result = await client.getPlaylistItems('PLtest123', 100);

      expect(result).toHaveLength(4);
      expect(mockYouTubeApi.playlistItems.list).toHaveBeenCalledTimes(2);
    });

    test('should respect maxResults limit', async () => {
      mockCacheService.get.mockResolvedValue(null);

      const manyItems = Array.from({ length: 50 }, (_, i) => ({
        id: `item${i}`,
      }));

      mockYouTubeApi.playlistItems.list.mockResolvedValue({
        data: {
          items: manyItems,
          nextPageToken: 'next-page',
        },
      });

      const result = await client.getPlaylistItems('PLtest123', 25);

      expect(result).toHaveLength(25);
    });
  });

  describe('getVideos', () => {
    const mockVideos = [
      {
        id: 'video1',
        snippet: {
          title: 'Video 1',
          channelTitle: 'Channel 1',
        },
        contentDetails: {
          duration: 'PT10M30S',
        },
        statistics: {
          viewCount: '1000',
        },
      },
      {
        id: 'video2',
        snippet: {
          title: 'Video 2',
          channelTitle: 'Channel 2',
        },
        contentDetails: {
          duration: 'PT5M',
        },
        statistics: {
          viewCount: '500',
        },
      },
    ];

    beforeEach(() => {
      mockYouTubeApi.videos.list.mockResolvedValue({
        data: {
          items: mockVideos,
        },
      });
    });

    test('should fetch videos from API', async () => {
      mockCacheService.get.mockResolvedValue(null);

      const result = await client.getVideos(['video1', 'video2']);

      expect(result).toEqual(mockVideos);
      expect(mockYouTubeApi.videos.list).toHaveBeenCalledWith({
        part: ['snippet', 'contentDetails', 'statistics', 'status'],
        id: ['video1', 'video2'],
      });
    });

    test('should return empty array for empty input', async () => {
      const result = await client.getVideos([]);

      expect(result).toEqual([]);
      expect(mockYouTubeApi.videos.list).not.toHaveBeenCalled();
    });

    test('should return cached videos when available', async () => {
      mockCacheService.get.mockResolvedValue(mockVideos);

      const result = await client.getVideos(['video1', 'video2']);

      expect(result).toEqual(mockVideos);
      expect(mockYouTubeApi.videos.list).not.toHaveBeenCalled();
    });

    test('should limit to 50 videos per request', async () => {
      mockCacheService.get.mockResolvedValue(null);

      const manyIds = Array.from({ length: 100 }, (_, i) => `video${i}`);

      await client.getVideos(manyIds);

      // The client limits to first 50 IDs
      expect(mockYouTubeApi.videos.list).toHaveBeenCalled();
      const callArgs = mockYouTubeApi.videos.list.mock.calls[0][0];
      expect(callArgs.id).toHaveLength(50);
    });
  });

  describe('getVideosBatch', () => {
    test('should fetch videos in batches', async () => {
      mockCacheService.get.mockResolvedValue(null);

      const batch1Videos = [{ id: 'video1' }];
      const batch2Videos = [{ id: 'video2' }];

      mockYouTubeApi.videos.list
        .mockResolvedValueOnce({ data: { items: batch1Videos } })
        .mockResolvedValueOnce({ data: { items: batch2Videos } });

      const videoIds = [
        ...Array.from({ length: 50 }, (_, i) => `batch1_video${i}`),
        ...Array.from({ length: 50 }, (_, i) => `batch2_video${i}`),
      ];

      const result = await client.getVideosBatch(videoIds);

      expect(result).toHaveLength(2);
      expect(mockYouTubeApi.videos.list).toHaveBeenCalledTimes(2);
    });

    test('should return empty array for empty input', async () => {
      const result = await client.getVideosBatch([]);

      expect(result).toEqual([]);
    });
  });
});

describe('getYouTubeClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset module to clear singleton
    jest.resetModules();
  });

  test('should return singleton instance', () => {
    // Re-import to test singleton
    const { getYouTubeClient: getClient } = require('../../../src/api/client');

    const client1 = getClient();
    const client2 = getClient();

    expect(client1).toBe(client2);
  });
});

describe('Error handling', () => {
  let client: YouTubeClient;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new YouTubeClient(true);
    mockCacheService.get.mockResolvedValue(null);
  });

  test('should handle quota exceeded error', async () => {
    const quotaError = {
      response: {
        status: 403,
        data: {
          error: {
            errors: [{ reason: 'quotaExceeded' }],
          },
        },
      },
    };

    mockYouTubeApi.playlists.list.mockRejectedValue(quotaError);

    // The retry mock just calls the function, so the error propagates
    const { retry } = require('../../../src/utils/retry');
    retry.mockImplementation((fn: () => Promise<any>) => fn());

    await expect(client.getPlaylist('PLtest123')).rejects.toThrow(
      QuotaExceededError
    );
  });

  test('should handle authentication error', async () => {
    const authError = {
      response: {
        status: 401,
      },
      message: 'Unauthorized',
    };

    mockYouTubeApi.playlists.list.mockRejectedValue(authError);
    mockTokenManager.refreshToken.mockRejectedValue(
      new AuthenticationError('Token refresh failed')
    );

    const { retry } = require('../../../src/utils/retry');
    retry.mockImplementation((fn: () => Promise<any>) => fn());

    await expect(client.getPlaylist('PLtest123')).rejects.toThrow(
      AuthenticationError
    );
  });
});
