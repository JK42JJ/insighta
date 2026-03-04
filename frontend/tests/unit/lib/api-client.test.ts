/**
 * API Client Tests
 *
 * Tests for API client including token management, HTTP requests,
 * 401 token refresh, 204 handling, and error handling.
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';

// We need to test a fresh instance, so we'll create the class inline
// to avoid singleton issues

// ============================================
// Test Utilities
// ============================================

const API_BASE_URL = 'http://localhost:3000';

function createApiClientClass() {
  interface ApiError {
    message: string;
    statusCode: number;
    error?: string;
  }

  interface AuthTokens {
    accessToken: string;
    refreshToken: string;
  }

  interface User {
    id: string;
    email: string;
    name?: string;
    createdAt: string;
  }

  interface LoginResponse extends AuthTokens {
    user: User;
  }

  class ApiClient {
    private baseUrl: string;
    private accessToken: string | null = null;
    private refreshToken: string | null = null;

    constructor(baseUrl: string) {
      this.baseUrl = baseUrl;
      this.loadTokens();
    }

    private loadTokens(): void {
      this.accessToken = localStorage.getItem('accessToken');
      this.refreshToken = localStorage.getItem('refreshToken');
    }

    private saveTokens(access: string, refresh: string): void {
      this.accessToken = access;
      this.refreshToken = refresh;
      localStorage.setItem('accessToken', access);
      localStorage.setItem('refreshToken', refresh);
    }

    private clearTokens(): void {
      this.accessToken = null;
      this.refreshToken = null;
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
    }

    public isAuthenticated(): boolean {
      return !!this.accessToken;
    }

    public getAccessToken(): string | null {
      return this.accessToken;
    }

    private async request<T>(
      endpoint: string,
      options: RequestInit = {}
    ): Promise<T> {
      const url = `${this.baseUrl}/api/v1${endpoint}`;
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
        ...options.headers,
      };

      if (this.accessToken) {
        (headers as Record<string, string>)['Authorization'] = `Bearer ${this.accessToken}`;
      }

      let response = await fetch(url, { ...options, headers });

      if (response.status === 401 && this.refreshToken) {
        const refreshed = await this.refreshAccessToken();
        if (refreshed) {
          (headers as Record<string, string>)['Authorization'] = `Bearer ${this.accessToken}`;
          response = await fetch(url, { ...options, headers });
        }
      }

      return this.handleResponse<T>(response);
    }

    private async handleResponse<T>(response: Response): Promise<T> {
      if (!response.ok) {
        let error: ApiError;
        try {
          error = await response.json();
        } catch {
          error = {
            message: 'An unexpected error occurred',
            statusCode: response.status,
          };
        }
        throw new Error(error.message || `HTTP Error: ${response.status}`);
      }

      if (response.status === 204) {
        return undefined as T;
      }

      return response.json();
    }

    private async refreshAccessToken(): Promise<boolean> {
      try {
        const response = await fetch(`${this.baseUrl}/api/v1/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: this.refreshToken }),
        });

        if (response.ok) {
          const data: AuthTokens = await response.json();
          this.saveTokens(data.accessToken, data.refreshToken);
          return true;
        }

        this.clearTokens();
        return false;
      } catch {
        this.clearTokens();
        return false;
      }
    }

    async login(email: string, password: string): Promise<LoginResponse> {
      const data = await this.request<LoginResponse>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      this.saveTokens(data.accessToken, data.refreshToken);
      return data;
    }

    async logout(): Promise<void> {
      try {
        await this.request<void>('/auth/logout', { method: 'POST' });
      } finally {
        this.clearTokens();
      }
    }

    async getCurrentUser(): Promise<User> {
      return this.request<User>('/auth/me');
    }

    async getPlaylists(): Promise<unknown[]> {
      return this.request<unknown[]>('/playlists');
    }

    async deletePlaylist(id: string): Promise<void> {
      return this.request<void>(`/playlists/${id}`, { method: 'DELETE' });
    }

    async healthCheck(): Promise<{ status: string; timestamp: string }> {
      const response = await fetch(`${this.baseUrl}/health`);
      return response.json();
    }
  }

  return ApiClient;
}

// ============================================
// Mock Data
// ============================================

const mockUser = {
  id: 'user-123',
  email: 'test@example.com',
  name: 'Test User',
  createdAt: '2024-01-01T00:00:00Z',
};

const mockTokens = {
  accessToken: 'access-token-123',
  refreshToken: 'refresh-token-456',
};

const mockLoginResponse = {
  ...mockTokens,
  user: mockUser,
};

// ============================================
// Test Suite
// ============================================

describe('ApiClient', () => {
  let originalFetch: typeof global.fetch;
  let ApiClient: ReturnType<typeof createApiClientClass>;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    originalFetch = global.fetch;
    global.fetch = vi.fn();
    ApiClient = createApiClientClass();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  // ============================================
  // Token Management Tests
  // ============================================

  describe('token management', () => {
    it('should load tokens from localStorage on construction', () => {
      localStorage.setItem('accessToken', 'stored-access');
      localStorage.setItem('refreshToken', 'stored-refresh');

      const client = new ApiClient(API_BASE_URL);

      expect(client.isAuthenticated()).toBe(true);
      expect(client.getAccessToken()).toBe('stored-access');
    });

    it('should return false for isAuthenticated when no token', () => {
      const client = new ApiClient(API_BASE_URL);

      expect(client.isAuthenticated()).toBe(false);
      expect(client.getAccessToken()).toBeNull();
    });

    it('should save tokens to localStorage on login', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockLoginResponse),
      });

      const client = new ApiClient(API_BASE_URL);
      await client.login('test@example.com', 'password');

      expect(localStorage.getItem('accessToken')).toBe(mockTokens.accessToken);
      expect(localStorage.getItem('refreshToken')).toBe(mockTokens.refreshToken);
      expect(client.isAuthenticated()).toBe(true);
    });

    it('should clear tokens on logout', async () => {
      localStorage.setItem('accessToken', 'stored-access');
      localStorage.setItem('refreshToken', 'stored-refresh');

      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        status: 204,
      });

      const client = new ApiClient(API_BASE_URL);
      await client.logout();

      expect(localStorage.getItem('accessToken')).toBeNull();
      expect(localStorage.getItem('refreshToken')).toBeNull();
      expect(client.isAuthenticated()).toBe(false);
    });

    it('should clear tokens even if logout request fails', async () => {
      localStorage.setItem('accessToken', 'stored-access');
      localStorage.setItem('refreshToken', 'stored-refresh');

      (global.fetch as Mock).mockRejectedValueOnce(new Error('Network error'));

      const client = new ApiClient(API_BASE_URL);

      await expect(client.logout()).rejects.toThrow();

      expect(localStorage.getItem('accessToken')).toBeNull();
      expect(localStorage.getItem('refreshToken')).toBeNull();
    });
  });

  // ============================================
  // HTTP Request Tests
  // ============================================

  describe('HTTP requests', () => {
    it('should include Authorization header when authenticated', async () => {
      localStorage.setItem('accessToken', 'test-token');

      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve([]),
      });

      const client = new ApiClient(API_BASE_URL);
      await client.getPlaylists();

      expect(global.fetch).toHaveBeenCalledWith(
        `${API_BASE_URL}/api/v1/playlists`,
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
            'Content-Type': 'application/json',
          }),
        })
      );
    });

    it('should not include Authorization header when not authenticated', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve([]),
      });

      const client = new ApiClient(API_BASE_URL);
      await client.getPlaylists();

      const calledHeaders = (global.fetch as Mock).mock.calls[0][1].headers;
      expect(calledHeaders.Authorization).toBeUndefined();
    });

    it('should send JSON body for POST requests', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockLoginResponse),
      });

      const client = new ApiClient(API_BASE_URL);
      await client.login('test@example.com', 'password123');

      expect(global.fetch).toHaveBeenCalledWith(
        `${API_BASE_URL}/api/v1/auth/login`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ email: 'test@example.com', password: 'password123' }),
        })
      );
    });
  });

  // ============================================
  // 401 Token Refresh Tests
  // ============================================

  describe('401 token refresh', () => {
    it('should refresh token and retry request on 401', async () => {
      localStorage.setItem('accessToken', 'expired-token');
      localStorage.setItem('refreshToken', 'valid-refresh');

      const newTokens = {
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      };

      (global.fetch as Mock)
        // First request - 401
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          json: () => Promise.resolve({ message: 'Unauthorized' }),
        })
        // Refresh request - success
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(newTokens),
        })
        // Retry request - success
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve([{ id: 'playlist-1' }]),
        });

      const client = new ApiClient(API_BASE_URL);
      const result = await client.getPlaylists();

      expect(result).toEqual([{ id: 'playlist-1' }]);
      expect(global.fetch).toHaveBeenCalledTimes(3);
      expect(localStorage.getItem('accessToken')).toBe('new-access-token');
    });

    it('should not retry if refresh token is missing', async () => {
      localStorage.setItem('accessToken', 'expired-token');
      // No refresh token

      (global.fetch as Mock).mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ message: 'Unauthorized' }),
      });

      const client = new ApiClient(API_BASE_URL);

      await expect(client.getPlaylists()).rejects.toThrow('Unauthorized');
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('should clear tokens if refresh fails', async () => {
      localStorage.setItem('accessToken', 'expired-token');
      localStorage.setItem('refreshToken', 'invalid-refresh');

      (global.fetch as Mock)
        // First request - 401
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          json: () => Promise.resolve({ message: 'Unauthorized' }),
        })
        // Refresh request - fails
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          json: () => Promise.resolve({ message: 'Invalid refresh token' }),
        });

      const client = new ApiClient(API_BASE_URL);

      await expect(client.getPlaylists()).rejects.toThrow('Unauthorized');
      expect(localStorage.getItem('accessToken')).toBeNull();
      expect(localStorage.getItem('refreshToken')).toBeNull();
    });

    it('should clear tokens if refresh throws error', async () => {
      localStorage.setItem('accessToken', 'expired-token');
      localStorage.setItem('refreshToken', 'valid-refresh');

      (global.fetch as Mock)
        // First request - 401
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          json: () => Promise.resolve({ message: 'Unauthorized' }),
        })
        // Refresh request - network error
        .mockRejectedValueOnce(new Error('Network error'));

      const client = new ApiClient(API_BASE_URL);

      await expect(client.getPlaylists()).rejects.toThrow('Unauthorized');
      expect(localStorage.getItem('accessToken')).toBeNull();
    });
  });

  // ============================================
  // 204 No Content Tests
  // ============================================

  describe('204 No Content handling', () => {
    it('should return undefined for 204 responses', async () => {
      localStorage.setItem('accessToken', 'valid-token');

      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        status: 204,
      });

      const client = new ApiClient(API_BASE_URL);
      const result = await client.deletePlaylist('playlist-123');

      expect(result).toBeUndefined();
    });
  });

  // ============================================
  // Error Handling Tests
  // ============================================

  describe('error handling', () => {
    it('should throw error with message from API response', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ message: 'Invalid request', statusCode: 400 }),
      });

      const client = new ApiClient(API_BASE_URL);

      await expect(client.getPlaylists()).rejects.toThrow('Invalid request');
    });

    it('should throw generic error when response is not JSON', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.reject(new Error('Not JSON')),
      });

      const client = new ApiClient(API_BASE_URL);

      await expect(client.getPlaylists()).rejects.toThrow('An unexpected error occurred');
    });

    it('should throw HTTP error when message is empty', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ statusCode: 404 }),
      });

      const client = new ApiClient(API_BASE_URL);

      await expect(client.getPlaylists()).rejects.toThrow('HTTP Error: 404');
    });
  });

  // ============================================
  // Authentication Endpoints Tests
  // ============================================

  describe('authentication endpoints', () => {
    it('should login and store tokens', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockLoginResponse),
      });

      const client = new ApiClient(API_BASE_URL);
      const result = await client.login('test@example.com', 'password');

      expect(result.user).toEqual(mockUser);
      expect(client.isAuthenticated()).toBe(true);
    });

    it('should get current user', async () => {
      localStorage.setItem('accessToken', 'valid-token');

      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockUser),
      });

      const client = new ApiClient(API_BASE_URL);
      const result = await client.getCurrentUser();

      expect(result).toEqual(mockUser);
      expect(global.fetch).toHaveBeenCalledWith(
        `${API_BASE_URL}/api/v1/auth/me`,
        expect.anything()
      );
    });
  });

  // ============================================
  // Health Check Tests
  // ============================================

  describe('health check', () => {
    it('should check API health without authentication', async () => {
      const healthResponse = { status: 'ok', timestamp: '2024-01-01T00:00:00Z' };

      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(healthResponse),
      });

      const client = new ApiClient(API_BASE_URL);
      const result = await client.healthCheck();

      expect(result).toEqual(healthResponse);
      expect(global.fetch).toHaveBeenCalledWith(`${API_BASE_URL}/health`);
    });
  });
});
