/**
 * Test Fixtures
 *
 * Mock data for testing. Provides consistent test data across all tests.
 */

// ============================================
// User & Session
// ============================================

export const mockUser = {
  id: 'test-user-id',
  email: 'test@example.com',
  aud: 'authenticated',
  role: 'authenticated',
  email_confirmed_at: '2024-01-01T00:00:00Z',
  phone: null,
  confirmed_at: '2024-01-01T00:00:00Z',
  last_sign_in_at: '2024-06-01T00:00:00Z',
  app_metadata: {
    provider: 'google',
    providers: ['google'],
  },
  user_metadata: {
    full_name: 'Test User',
    avatar_url: 'https://example.com/avatar.png',
    email: 'test@example.com',
    email_verified: true,
  },
  identities: [
    {
      id: 'identity-1',
      user_id: 'test-user-id',
      identity_data: {
        email: 'test@example.com',
        full_name: 'Test User',
      },
      provider: 'google',
      last_sign_in_at: '2024-06-01T00:00:00Z',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-06-01T00:00:00Z',
    },
  ],
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-06-01T00:00:00Z',
};

export const mockSession = {
  access_token: 'test-access-token-jwt',
  refresh_token: 'test-refresh-token',
  expires_in: 3600,
  expires_at: Date.now() / 1000 + 3600,
  token_type: 'bearer',
  user: mockUser,
};

// ============================================
// Playlists
// ============================================

export const mockPlaylists = [
  {
    id: 'playlist-1',
    user_id: 'test-user-id',
    youtube_playlist_id: 'PLtest123abc',
    title: 'React Tutorials',
    description: 'A collection of React tutorials',
    thumbnail_url: 'https://i.ytimg.com/vi/abc123/default.jpg',
    channel_title: 'React Academy',
    item_count: 25,
    published_at: '2024-01-15T10:00:00Z',
    last_synced_at: '2024-06-15T14:30:00Z',
    sync_interval: 'daily' as const,
    is_auto_sync_enabled: true,
    created_at: '2024-02-01T00:00:00Z',
    updated_at: '2024-06-15T14:30:00Z',
  },
  {
    id: 'playlist-2',
    user_id: 'test-user-id',
    youtube_playlist_id: 'PLtest456def',
    title: 'TypeScript Deep Dive',
    description: 'Advanced TypeScript concepts',
    thumbnail_url: 'https://i.ytimg.com/vi/def456/default.jpg',
    channel_title: 'TypeScript Pro',
    item_count: 18,
    published_at: '2024-02-20T08:00:00Z',
    last_synced_at: '2024-06-14T10:00:00Z',
    sync_interval: 'weekly' as const,
    is_auto_sync_enabled: false,
    created_at: '2024-03-01T00:00:00Z',
    updated_at: '2024-06-14T10:00:00Z',
  },
  {
    id: 'playlist-3',
    user_id: 'test-user-id',
    youtube_playlist_id: 'PLtest789ghi',
    title: 'System Design',
    description: 'System design interview preparation',
    thumbnail_url: 'https://i.ytimg.com/vi/ghi789/default.jpg',
    channel_title: 'Tech Interview',
    item_count: 12,
    published_at: '2024-03-10T12:00:00Z',
    last_synced_at: null,
    sync_interval: 'manual' as const,
    is_auto_sync_enabled: false,
    created_at: '2024-04-01T00:00:00Z',
    updated_at: '2024-04-01T00:00:00Z',
  },
];

// ============================================
// Videos
// ============================================

export const mockVideos = [
  {
    id: 'video-1',
    youtube_video_id: 'dQw4w9WgXcQ',
    title: 'React Hooks Tutorial',
    description: 'Learn React Hooks from scratch. This tutorial covers useState, useEffect, useContext, and custom hooks.',
    thumbnail_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg',
    channel_title: 'React Academy',
    channel_id: 'UCabc123',
    duration: 1847, // 30:47
    published_at: '2024-01-10T09:00:00Z',
    view_count: 1500000,
    like_count: 45000,
    comment_count: 2300,
    created_at: '2024-02-01T00:00:00Z',
    updated_at: '2024-06-01T00:00:00Z',
  },
  {
    id: 'video-2',
    youtube_video_id: 'aBcDeFgH123',
    title: 'useEffect Deep Dive',
    description: 'Master the useEffect hook with advanced patterns and best practices.',
    thumbnail_url: 'https://i.ytimg.com/vi/aBcDeFgH123/maxresdefault.jpg',
    channel_title: 'React Academy',
    channel_id: 'UCabc123',
    duration: 2456, // 40:56
    published_at: '2024-02-15T10:00:00Z',
    view_count: 850000,
    like_count: 28000,
    comment_count: 1200,
    created_at: '2024-02-01T00:00:00Z',
    updated_at: '2024-06-01T00:00:00Z',
  },
  {
    id: 'video-3',
    youtube_video_id: 'XyZ987654ab',
    title: 'TypeScript Generics Explained',
    description: 'A comprehensive guide to TypeScript generics with real-world examples.',
    thumbnail_url: 'https://i.ytimg.com/vi/XyZ987654ab/maxresdefault.jpg',
    channel_title: 'TypeScript Pro',
    channel_id: 'UCdef456',
    duration: 3120, // 52:00
    published_at: '2024-03-01T14:00:00Z',
    view_count: 420000,
    like_count: 15000,
    comment_count: 890,
    created_at: '2024-03-05T00:00:00Z',
    updated_at: '2024-06-01T00:00:00Z',
  },
];

// ============================================
// User Video States
// ============================================

export const mockUserVideoStates = [
  {
    id: 'state-1',
    user_id: 'test-user-id',
    video_id: 'video-1',
    is_watched: true,
    watch_position_seconds: 1847,
    is_in_ideation: true,
    user_note: 'Great explanation of useState',
    cell_index: 0,
    level_id: 'root',
    sort_order: 0,
    created_at: '2024-03-01T00:00:00Z',
    updated_at: '2024-06-01T00:00:00Z',
  },
  {
    id: 'state-2',
    user_id: 'test-user-id',
    video_id: 'video-2',
    is_watched: false,
    watch_position_seconds: 1230,
    is_in_ideation: true,
    user_note: null,
    cell_index: 1,
    level_id: 'root',
    sort_order: 1,
    created_at: '2024-03-01T00:00:00Z',
    updated_at: '2024-06-01T00:00:00Z',
  },
  {
    id: 'state-3',
    user_id: 'test-user-id',
    video_id: 'video-3',
    is_watched: false,
    watch_position_seconds: 0,
    is_in_ideation: false,
    user_note: null,
    cell_index: null,
    level_id: null,
    sort_order: null,
    created_at: '2024-03-05T00:00:00Z',
    updated_at: '2024-03-05T00:00:00Z',
  },
];

// ============================================
// UI Preferences
// ============================================

export const mockUIPreferences = {
  id: 'pref-1',
  user_id: 'test-user-id',
  mandala_subjects: [
    'Health & Fitness',
    'Career Growth',
    'Learning',
    'Relationships',
    'Finance',
    'Creativity',
    'Mindfulness',
    'Technology',
  ],
  theme: 'dark' as const,
  sidebar_collapsed: false,
  show_completed_videos: true,
  default_sync_interval: 'daily' as const,
  notifications_enabled: true,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-06-01T00:00:00Z',
};

// ============================================
// YouTube OAuth
// ============================================

export const mockYouTubeAuthStatus = {
  isConnected: true,
  syncSettings: {
    syncInterval: 'daily' as const,
    autoSyncEnabled: true,
  },
  quotaUsed: 500,
  quotaLimit: 10000,
  lastSyncAt: '2024-06-15T14:30:00Z',
};

export const mockYouTubeAuthStatusDisconnected = {
  isConnected: false,
  syncSettings: null,
  quotaUsed: 0,
  quotaLimit: 10000,
  lastSyncAt: null,
};

// ============================================
// Sync Results
// ============================================

export const mockSyncResult = {
  success: true,
  itemsAdded: 5,
  itemsRemoved: 2,
  totalItems: 28,
  quotaUsed: 15,
  syncedAt: new Date().toISOString(),
};

export const mockSyncAllResult = {
  synced: 2,
  failed: 1,
  errors: ['System Design: Network timeout'],
};

// ============================================
// Error Responses
// ============================================

export const mockErrors = {
  unauthorized: {
    error: 'Unauthorized',
    message: 'Invalid or expired token',
    statusCode: 401,
  },
  forbidden: {
    error: 'Forbidden',
    message: 'You do not have permission to access this resource',
    statusCode: 403,
  },
  notFound: {
    error: 'Not Found',
    message: 'Resource not found',
    statusCode: 404,
  },
  quotaExceeded: {
    error: 'Quota Exceeded',
    message: 'YouTube API quota exceeded. Try again tomorrow.',
    statusCode: 429,
  },
  serverError: {
    error: 'Internal Server Error',
    message: 'An unexpected error occurred',
    statusCode: 500,
  },
};
