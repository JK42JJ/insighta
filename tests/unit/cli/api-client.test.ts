/**
 * API Client Unit Tests
 */

import { ApiClient, ApiClientError, createApiClient } from '../../../src/cli/api-client';

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('ApiClient', () => {
  let client: ApiClient;
  const baseUrl = 'http://localhost:3000';

  beforeEach(() => {
    jest.clearAllMocks();
    client = new ApiClient({ baseUrl });
  });

  describe('constructor and token management', () => {
    test('should create client with base URL', () => {
      expect(client).toBeDefined();
    });

    test('should set access token', () => {
      client.setAccessToken('test-token');
      // Token is set internally, verify by making a request
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ user: {} }),
      });

      client.getProfile();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
          }),
        })
      );
    });

    test('should clear access token', () => {
      client.setAccessToken('test-token');
      client.clearAccessToken();

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: {} }),
      });

      client.listPlaylists();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.not.objectContaining({
            Authorization: expect.any(String),
          }),
        })
      );
    });
  });

  describe('Authentication API', () => {
    test('should register user', async () => {
      const mockResponse = {
        user: { id: 'user-123', email: 'test@example.com', name: 'Test' },
        tokens: { accessToken: 'access', refreshToken: 'refresh', expiresIn: 3600 },
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await client.register({
        email: 'test@example.com',
        password: 'password123',
        name: 'Test',
      });

      expect(result).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/api/v1/auth/register`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            email: 'test@example.com',
            password: 'password123',
            name: 'Test',
          }),
        })
      );
    });

    test('should login user', async () => {
      const mockResponse = {
        user: { id: 'user-123', email: 'test@example.com', name: 'Test' },
        tokens: { accessToken: 'access', refreshToken: 'refresh', expiresIn: 3600 },
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await client.login({
        email: 'test@example.com',
        password: 'password123',
      });

      expect(result).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/api/v1/auth/login`,
        expect.objectContaining({
          method: 'POST',
        })
      );
    });

    test('should logout user', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ message: 'Logged out' }),
      });

      const result = await client.logout('refresh-token');

      expect(result).toEqual({ message: 'Logged out' });
      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/api/v1/auth/logout`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ refreshToken: 'refresh-token' }),
        })
      );
    });

    test('should refresh token', async () => {
      const mockResponse = {
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
        expiresIn: 3600,
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await client.refresh('refresh-token');

      expect(result).toEqual(mockResponse);
    });

    test('should get user profile', async () => {
      const mockResponse = {
        user: { id: 'user-123', email: 'test@example.com', name: 'Test', createdAt: '2024-01-01' },
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      client.setAccessToken('access-token');
      const result = await client.getProfile();

      expect(result).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/api/v1/auth/me`,
        expect.objectContaining({
          method: 'GET',
        })
      );
    });
  });

  describe('Playlist API', () => {
    beforeEach(() => {
      client.setAccessToken('test-token');
    });

    test('should import playlist', async () => {
      const mockResponse = {
        playlist: {
          id: 'playlist-123',
          youtubeId: 'PLxxx',
          title: 'Test Playlist',
          description: null,
          channelId: 'channel-123',
          channelTitle: 'Test Channel',
          thumbnailUrl: null,
          itemCount: 10,
          syncStatus: 'pending',
          lastSyncedAt: null,
          createdAt: '2024-01-01',
          updatedAt: '2024-01-01',
        },
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await client.importPlaylist({
        playlistUrl: 'https://youtube.com/playlist?list=PLxxx',
      });

      expect(result).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/api/v1/playlists/import`,
        expect.objectContaining({
          method: 'POST',
        })
      );
    });

    test('should list playlists with query parameters', async () => {
      const mockResponse = {
        playlists: [],
        total: 0,
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      await client.listPlaylists({
        filter: 'test',
        sortBy: 'title',
        sortOrder: 'asc',
        limit: 10,
        offset: 0,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('filter=test'),
        expect.any(Object)
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('sortBy=title'),
        expect.any(Object)
      );
    });

    test('should list playlists without query parameters', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ playlists: [], total: 0 }),
      });

      await client.listPlaylists();

      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/api/v1/playlists`,
        expect.any(Object)
      );
    });

    test('should get playlist details', async () => {
      const mockResponse = {
        playlist: {
          id: 'playlist-123',
          youtubeId: 'PLxxx',
          title: 'Test',
          items: [],
        },
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await client.getPlaylist('playlist-123');

      expect(result).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/api/v1/playlists/playlist-123`,
        expect.objectContaining({
          method: 'GET',
        })
      );
    });

    test('should sync playlist', async () => {
      const mockResponse = {
        result: {
          playlistId: 'playlist-123',
          status: 'COMPLETED',
          itemsAdded: 5,
          itemsRemoved: 0,
          itemsReordered: 0,
          duration: 1000,
          quotaUsed: 10,
        },
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await client.syncPlaylist('playlist-123');

      expect(result).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/api/v1/playlists/playlist-123/sync`,
        expect.objectContaining({
          method: 'POST',
        })
      );
    });

    test('should delete playlist', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ message: 'Deleted' }),
      });

      const result = await client.deletePlaylist('playlist-123');

      expect(result).toEqual({ message: 'Deleted' });
      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/api/v1/playlists/playlist-123`,
        expect.objectContaining({
          method: 'DELETE',
        })
      );
    });
  });

  describe('Error handling', () => {
    test('should throw ApiClientError on API error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        json: () =>
          Promise.resolve({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid email',
              timestamp: '2024-01-01',
              path: '/api/v1/auth/register',
            },
          }),
      });

      await expect(
        client.register({ email: 'invalid', password: 'pass', name: 'Test' })
      ).rejects.toThrow(ApiClientError);
    });

    test('should include error details in ApiClientError', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        json: () =>
          Promise.resolve({
            error: {
              code: 'INVALID_CREDENTIALS',
              message: 'Wrong password',
              timestamp: '2024-01-01',
              path: '/api/v1/auth/login',
              details: { field: 'password' },
            },
          }),
      });

      try {
        await client.login({ email: 'test@example.com', password: 'wrong' });
        fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiClientError);
        const apiError = error as ApiClientError;
        expect(apiError.code).toBe('INVALID_CREDENTIALS');
        expect(apiError.statusCode).toBe(401);
        expect(apiError.details).toEqual({ field: 'password' });
      }
    });
  });
});

describe('ApiClientError', () => {
  test('should create error with all properties', () => {
    const error = new ApiClientError('Test error', 'TEST_CODE', 400, { key: 'value' });

    expect(error.message).toBe('Test error');
    expect(error.code).toBe('TEST_CODE');
    expect(error.statusCode).toBe(400);
    expect(error.details).toEqual({ key: 'value' });
    expect(error.name).toBe('ApiClientError');
  });

  test('should create error without details', () => {
    const error = new ApiClientError('Test error', 'TEST_CODE', 500);

    expect(error.details).toBeUndefined();
  });
});

describe('createApiClient', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('should create client with default base URL', () => {
    delete process.env['API_BASE_URL'];
    const client = createApiClient();

    expect(client).toBeInstanceOf(ApiClient);
  });

  test('should create client with custom base URL from env', () => {
    process.env['API_BASE_URL'] = 'http://custom:8080';
    const client = createApiClient();

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: {} }),
    });

    client.listPlaylists();

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('http://custom:8080'),
      expect.any(Object)
    );
  });

  test('should create client with access token', () => {
    const client = createApiClient('my-token');

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ user: {} }),
    });

    client.getProfile();

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer my-token',
        }),
      })
    );
  });
});
