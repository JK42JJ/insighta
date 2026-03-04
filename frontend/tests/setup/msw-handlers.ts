/**
 * MSW Handlers
 *
 * Mock Service Worker handlers for API mocking in tests.
 */

import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import {
  mockPlaylists,
  mockVideos,
  mockUserVideoStates,
  mockUser,
  mockSession,
  mockUIPreferences,
} from '../mocks/fixtures';

// ============================================
// Base URLs
// ============================================

const SUPABASE_URL = 'http://localhost:8000';
const API_URL = 'http://localhost:3000';

// ============================================
// YouTube Sync Edge Function Handlers
// ============================================

const youtubeSyncHandlers = [
  // Auth Status
  http.get(`${SUPABASE_URL}/functions/v1/youtube-sync`, ({ request }) => {
    const url = new URL(request.url);
    const action = url.searchParams.get('action');

    switch (action) {
      case 'auth-status':
        return HttpResponse.json({
          isConnected: true,
          syncSettings: {
            syncInterval: 'daily',
            autoSyncEnabled: true,
          },
        });

      case 'list-playlists':
        return HttpResponse.json({ playlists: mockPlaylists });

      case 'get-ideation-videos':
        return HttpResponse.json({
          videos: mockUserVideoStates.map((state) => ({
            ...state,
            video: mockVideos.find((v) => v.id === state.video_id),
          })),
        });

      default:
        return HttpResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  }),

  // Add Playlist
  http.post(`${SUPABASE_URL}/functions/v1/youtube-sync`, async ({ request }) => {
    const url = new URL(request.url);
    const action = url.searchParams.get('action');
    const body = await request.json() as Record<string, unknown>;

    switch (action) {
      case 'add-playlist':
        return HttpResponse.json({
          playlist: {
            id: 'new-playlist-id',
            youtube_playlist_id: 'PLnew123',
            title: 'New Playlist',
            item_count: 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        });

      case 'sync-playlist':
        return HttpResponse.json({
          success: true,
          itemsAdded: 5,
          itemsRemoved: 0,
          totalItems: 15,
          quotaUsed: 10,
        });

      case 'delete-playlist':
        return HttpResponse.json({ success: true });

      case 'update-settings':
        return HttpResponse.json({ success: true });

      case 'update-video-state':
        const { videoStateId, updates } = body as { videoStateId: string; updates: Record<string, unknown> };
        const updatedState = {
          ...mockUserVideoStates.find((s) => s.id === videoStateId),
          ...updates,
          updated_at: new Date().toISOString(),
        };
        return HttpResponse.json({ videoState: updatedState });

      default:
        return HttpResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  }),
];

// ============================================
// Supabase Auth Handlers
// ============================================

const supabaseAuthHandlers = [
  // Get Session
  http.get(`${SUPABASE_URL}/auth/v1/token`, () => {
    return HttpResponse.json({
      access_token: mockSession.access_token,
      refresh_token: mockSession.refresh_token,
      expires_in: 3600,
      token_type: 'bearer',
      user: mockUser,
    });
  }),

  // Refresh Token
  http.post(`${SUPABASE_URL}/auth/v1/token`, () => {
    return HttpResponse.json({
      access_token: 'new-access-token',
      refresh_token: 'new-refresh-token',
      expires_in: 3600,
      token_type: 'bearer',
      user: mockUser,
    });
  }),

  // Sign Out
  http.post(`${SUPABASE_URL}/auth/v1/logout`, () => {
    return HttpResponse.json({});
  }),

  // Get User
  http.get(`${SUPABASE_URL}/auth/v1/user`, () => {
    return HttpResponse.json(mockUser);
  }),
];

// ============================================
// Supabase REST API Handlers
// ============================================

const supabaseRestHandlers = [
  // User UI Preferences
  http.get(`${SUPABASE_URL}/rest/v1/user_ui_preferences`, () => {
    return HttpResponse.json([mockUIPreferences]);
  }),

  http.post(`${SUPABASE_URL}/rest/v1/user_ui_preferences`, () => {
    return HttpResponse.json({}, { status: 201 });
  }),

  http.patch(`${SUPABASE_URL}/rest/v1/user_ui_preferences`, async ({ request }) => {
    const body = await request.json();
    return HttpResponse.json({
      ...mockUIPreferences,
      ...body,
      updated_at: new Date().toISOString(),
    });
  }),
];

// ============================================
// Backend API Handlers
// ============================================

const backendApiHandlers = [
  // Health Check
  http.get(`${API_URL}/health`, () => {
    return HttpResponse.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
    });
  }),

  // Auth
  http.post(`${API_URL}/api/v1/auth/login`, () => {
    return HttpResponse.json({
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      user: {
        id: 'test-user-id',
        email: 'test@example.com',
        name: 'Test User',
        createdAt: new Date().toISOString(),
      },
    });
  }),

  http.post(`${API_URL}/api/v1/auth/refresh`, () => {
    return HttpResponse.json({
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
    });
  }),

  http.get(`${API_URL}/api/v1/auth/me`, () => {
    return HttpResponse.json({
      id: 'test-user-id',
      email: 'test@example.com',
      name: 'Test User',
      createdAt: new Date().toISOString(),
    });
  }),

  // Playlists
  http.get(`${API_URL}/api/v1/playlists`, () => {
    return HttpResponse.json(mockPlaylists);
  }),

  http.post(`${API_URL}/api/v1/playlists/import`, () => {
    return HttpResponse.json({
      id: 'new-playlist-id',
      youtubeId: 'PLnew123',
      title: 'Imported Playlist',
      itemCount: 10,
      createdAt: new Date().toISOString(),
    });
  }),

  // Videos
  http.get(`${API_URL}/api/v1/videos`, () => {
    return HttpResponse.json(mockVideos);
  }),

  // Sync
  http.post(`${API_URL}/api/v1/sync/playlists/:playlistId`, () => {
    return HttpResponse.json({
      playlistId: 'playlist-1',
      status: 'completed',
      lastSyncedAt: new Date().toISOString(),
    });
  }),
];

// ============================================
// Combined Handlers
// ============================================

export const handlers = [
  ...youtubeSyncHandlers,
  ...supabaseAuthHandlers,
  ...supabaseRestHandlers,
  ...backendApiHandlers,
];

// ============================================
// Server Setup
// ============================================

export const server = setupServer(...handlers);

// ============================================
// Helper Functions
// ============================================

/**
 * Override handlers for specific test scenarios
 */
export function mockNetworkError(endpoint: string): void {
  server.use(
    http.get(endpoint, () => {
      return HttpResponse.error();
    }),
    http.post(endpoint, () => {
      return HttpResponse.error();
    })
  );
}

export function mockUnauthorized(endpoint: string): void {
  server.use(
    http.get(endpoint, () => {
      return HttpResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }),
    http.post(endpoint, () => {
      return HttpResponse.json({ error: 'Unauthorized' }, { status: 401 });
    })
  );
}

export function mockQuotaExceeded(): void {
  server.use(
    http.post(`${SUPABASE_URL}/functions/v1/youtube-sync`, () => {
      return HttpResponse.json(
        { error: 'Quota exceeded. Try again tomorrow.' },
        { status: 429 }
      );
    })
  );
}

export function mockEmptyPlaylists(): void {
  server.use(
    http.get(`${SUPABASE_URL}/functions/v1/youtube-sync`, ({ request }) => {
      const url = new URL(request.url);
      const action = url.searchParams.get('action');

      if (action === 'list-playlists') {
        return HttpResponse.json({ playlists: [] });
      }

      return HttpResponse.json({ error: 'Unknown action' }, { status: 400 });
    })
  );
}

export function mockYouTubeDisconnected(): void {
  server.use(
    http.get(`${SUPABASE_URL}/functions/v1/youtube-sync`, ({ request }) => {
      const url = new URL(request.url);
      const action = url.searchParams.get('action');

      if (action === 'auth-status') {
        return HttpResponse.json({
          isConnected: false,
          syncSettings: null,
        });
      }

      return HttpResponse.json(
        { error: 'YouTube not connected' },
        { status: 403 }
      );
    })
  );
}
