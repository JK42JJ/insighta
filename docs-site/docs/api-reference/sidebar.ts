import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

const sidebar: SidebarsConfig = {
  apisidebar: [
    {
      type: "doc",
      id: "api-reference/youtube-playlist-sync-api",
    },
    {
      type: "category",
      label: "auth",
      link: {
        type: "doc",
        id: "api-reference/auth",
      },
      items: [
        {
          type: "doc",
          id: "api-reference/post-auth-register",
          label: "Register a new user account",
          className: "api-method post",
        },
        {
          type: "doc",
          id: "api-reference/post-auth-login",
          label: "Authenticate user and obtain access tokens",
          className: "api-method post",
        },
        {
          type: "doc",
          id: "api-reference/post-auth-refresh",
          label: "Refresh access token using refresh token",
          className: "api-method post",
        },
        {
          type: "doc",
          id: "api-reference/post-auth-logout",
          label: "Invalidate refresh token and log out user",
          className: "api-method post",
        },
        {
          type: "doc",
          id: "api-reference/get-auth-me",
          label: "Get current authenticated user information",
          className: "api-method get",
        },
      ],
    },
    {
      type: "category",
      label: "playlists",
      link: {
        type: "doc",
        id: "api-reference/playlists",
      },
      items: [
        {
          type: "doc",
          id: "api-reference/post-playlists-import",
          label: "Import a YouTube playlist by URL or ID",
          className: "api-method post",
        },
        {
          type: "doc",
          id: "api-reference/get-playlists",
          label: "List all playlists with optional filtering and pagination",
          className: "api-method get",
        },
        {
          type: "doc",
          id: "api-reference/get-playlists-byid",
          label: "Get playlist details with items and videos",
          className: "api-method get",
        },
        {
          type: "doc",
          id: "api-reference/delete-playlists-byid",
          label: "Delete a playlist and all its items",
          className: "api-method delete",
        },
        {
          type: "doc",
          id: "api-reference/post-playlists-byid-sync",
          label: "Trigger synchronization of playlist with YouTube",
          className: "api-method post",
        },
      ],
    },
    {
      type: "category",
      label: "videos",
      link: {
        type: "doc",
        id: "api-reference/videos",
      },
      items: [
        {
          type: "doc",
          id: "api-reference/get-videos",
          label: "List videos with filtering, search, and pagination",
          className: "api-method get",
        },
        {
          type: "doc",
          id: "api-reference/get-videos-byid",
          label: "Get video details with user state",
          className: "api-method get",
        },
        {
          type: "doc",
          id: "api-reference/get-videos-byid-captions",
          label: "Get video captions in specified language",
          className: "api-method get",
        },
        {
          type: "doc",
          id: "api-reference/get-videos-byid-captions-languages",
          label: "Get available caption languages for a video",
          className: "api-method get",
        },
        {
          type: "doc",
          id: "api-reference/get-videos-byid-summary",
          label: "Get existing video summary",
          className: "api-method get",
        },
        {
          type: "doc",
          id: "api-reference/post-videos-byid-summary",
          label: "Generate video summary using captions",
          className: "api-method post",
        },
      ],
    },
    {
      type: "category",
      label: "analytics",
      link: {
        type: "doc",
        id: "api-reference/analytics",
      },
      items: [
        {
          type: "doc",
          id: "api-reference/get-analytics-dashboard",
          label: "Get learning dashboard with overall statistics",
          className: "api-method get",
        },
        {
          type: "doc",
          id: "api-reference/get-analytics-videos-byid",
          label: "Get analytics for a specific video",
          className: "api-method get",
        },
        {
          type: "doc",
          id: "api-reference/get-analytics-playlists-byid",
          label: "Get analytics for a specific playlist",
          className: "api-method get",
        },
        {
          type: "doc",
          id: "api-reference/post-analytics-sessions",
          label: "Record a watch session",
          className: "api-method post",
        },
      ],
    },
    {
      type: "category",
      label: "sync",
      link: {
        type: "doc",
        id: "api-reference/sync",
      },
      items: [
        {
          type: "doc",
          id: "api-reference/get-sync-status",
          label: "Get sync status for all playlists",
          className: "api-method get",
        },
        {
          type: "doc",
          id: "api-reference/get-sync-status-byplaylist-id",
          label: "Get sync status for a specific playlist",
          className: "api-method get",
        },
        {
          type: "doc",
          id: "api-reference/get-sync-history",
          label: "Get sync history with filters and pagination",
          className: "api-method get",
        },
        {
          type: "doc",
          id: "api-reference/get-sync-history-bysync-id",
          label: "Get details for a specific sync",
          className: "api-method get",
        },
        {
          type: "doc",
          id: "api-reference/get-sync-schedule",
          label: "List all sync schedules",
          className: "api-method get",
        },
        {
          type: "doc",
          id: "api-reference/post-sync-schedule",
          label: "Create a sync schedule",
          className: "api-method post",
        },
        {
          type: "doc",
          id: "api-reference/patch-sync-schedule-byid",
          label: "Update a sync schedule",
          className: "api-method patch",
        },
        {
          type: "doc",
          id: "api-reference/delete-sync-schedule-byid",
          label: "Delete a sync schedule",
          className: "api-method delete",
        },
      ],
    },
    {
      type: "category",
      label: "quota",
      link: {
        type: "doc",
        id: "api-reference/quota",
      },
      items: [
        {
          type: "doc",
          id: "api-reference/get-quota-usage",
          label: "Get current YouTube API quota usage",
          className: "api-method get",
        },
        {
          type: "doc",
          id: "api-reference/get-quota-limits",
          label: "Get YouTube API quota limits and rate limit configurations",
          className: "api-method get",
        },
      ],
    },
    {
      type: "category",
      label: "health",
      link: {
        type: "doc",
        id: "api-reference/health",
      },
      items: [
        {
          type: "doc",
          id: "api-reference/get-health",
          label: "Health check endpoint",
          className: "api-method get",
        },
        {
          type: "doc",
          id: "api-reference/get-health-ready",
          label: "Readiness probe for Kubernetes",
          className: "api-method get",
        },
      ],
    },
    {
      type: "category",
      label: "notes",
      items: [
        {
          type: "doc",
          id: "api-reference/get-notes-videos-byid-notes",
          label: "List all notes for a video with optional filtering",
          className: "api-method get",
        },
        {
          type: "doc",
          id: "api-reference/post-notes-videos-byid-notes",
          label: "Create a new note for a video",
          className: "api-method post",
        },
        {
          type: "doc",
          id: "api-reference/get-notes-bynote-id",
          label: "Get a specific note by ID",
          className: "api-method get",
        },
        {
          type: "doc",
          id: "api-reference/patch-notes-bynote-id",
          label: "Update an existing note",
          className: "api-method patch",
        },
        {
          type: "doc",
          id: "api-reference/delete-notes-bynote-id",
          label: "Delete a note",
          className: "api-method delete",
        },
        {
          type: "doc",
          id: "api-reference/get-notes-export",
          label: "Export notes in specified format",
          className: "api-method get",
        },
      ],
    },
    {
      type: "category",
      label: "UNTAGGED",
      items: [
        {
          type: "doc",
          id: "api-reference/get-root",
          label: "Get ",
          className: "api-method get",
        },
      ],
    },
  ],
};

export default sidebar.apisidebar;
