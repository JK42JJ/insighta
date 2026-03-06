export const queryKeys = {
  playlists: {
    all: ['playlists'] as const,
    detail: (id: string) => ['playlists', id] as const,
    videos: (id: string) => ['playlists', id, 'videos'] as const,
  },
  youtube: {
    playlists: ['youtube', 'playlists'] as const,
    playlist: (id: string) => ['youtube', 'playlist', id] as const,
    ideationVideos: ['youtube', 'ideation-videos'] as const,
    allVideoStates: ['youtube', 'all-video-states'] as const,
    authStatus: ['youtube', 'auth', 'status'] as const,
  },
  videos: {
    all: ['videos'] as const,
    byPlaylist: (id?: string) => ['videos', id] as const,
    detail: (id: string) => ['video', id] as const,
  },
  localCards: {
    all: ['local-cards'] as const,
    list: ['local-cards', 'list'] as const,
    subscription: ['local-cards', 'subscription'] as const,
  },
  uiPreferences: (userId?: string) => ['ui-preferences', userId] as const,
  notes: (videoId: string) => ['notes', videoId] as const,
  auth: {
    currentUser: ['currentUser'] as const,
  },
  sync: {
    status: (playlistId: string) => ['syncStatus', playlistId] as const,
  },
  analytics: ['analytics'] as const,
  watchHistory: ['watchHistory'] as const,
  health: ['health'] as const,
};
