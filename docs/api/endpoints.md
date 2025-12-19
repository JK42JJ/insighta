# API Endpoints Reference

Comprehensive reference for all REST API endpoints in the YouTube Playlist Sync API.

## Table of Contents

- [Authentication](#authentication)
- [Playlists](#playlists)
- [Videos](#videos)
- [Notes](#notes)
- [Analytics](#analytics)
- [Sync](#sync)
- [Quota](#quota)
- [Health](#health)

---

## Authentication

All authentication endpoints are located under `/api/v1/auth`.

### Register User
`POST /api/v1/auth/register`

Create a new user account.

**Rate Limit**: 5 requests/minute

**Request Body**:
```json
{
  "email": "user@example.com",
  "password": "SecurePassword123!",
  "name": "John Doe"
}
```

**Response** (201):
```json
{
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "John Doe",
    "createdAt": "2023-12-31T12:00:00.000Z"
  },
  "accessToken": "jwt-token",
  "refreshToken": "jwt-token",
  "expiresIn": 900
}
```

### Login
`POST /api/v1/auth/login`

Authenticate and receive JWT tokens.

**Rate Limit**: 10 requests/minute

**Request Body**:
```json
{
  "email": "user@example.com",
  "password": "SecurePassword123!"
}
```

**Response** (200):
```json
{
  "accessToken": "jwt-token",
  "refreshToken": "jwt-token",
  "expiresIn": 900,
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "John Doe"
  }
}
```

### Refresh Token
`POST /api/v1/auth/refresh`

Get a new access token.

**Rate Limit**: 20 requests/minute

**Request Body**:
```json
{
  "refreshToken": "jwt-token"
}
```

**Response** (200):
```json
{
  "accessToken": "jwt-token",
  "expiresIn": 900
}
```

### Logout
`POST /api/v1/auth/logout`

Invalidate current session.

**Authentication**: Required

**Response** (200):
```json
{
  "message": "Logged out successfully"
}
```

---

## Playlists

All playlist endpoints are located under `/api/v1/playlists`.

### List Playlists
`GET /api/v1/playlists`

Get all playlists with pagination and filtering.

**Authentication**: Required

**Rate Limit**: 50 requests/minute

**Query Parameters**:
- `page` (integer, default: 1): Page number
- `limit` (integer, default: 20, max: 100): Items per page
- `filter` (string): Filter by sync status (`PENDING`, `IN_PROGRESS`, `COMPLETED`, `FAILED`)
- `sortBy` (string): Sort field (`title`, `lastSyncedAt`, `createdAt`, `updatedAt`)
- `sortOrder` (string): Sort order (`asc`, `desc`)

**Response** (200):
```json
{
  "playlists": [
    {
      "id": "uuid",
      "youtubeId": "PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf",
      "title": "Playlist Title",
      "description": "Playlist description",
      "channelId": "UCxxxxxx",
      "channelTitle": "Channel Name",
      "thumbnailUrl": "https://...",
      "itemCount": 50,
      "syncStatus": "COMPLETED",
      "lastSyncedAt": "2023-12-31T12:00:00.000Z",
      "createdAt": "2023-12-01T12:00:00.000Z",
      "updatedAt": "2023-12-31T12:00:00.000Z"
    }
  ],
  "total": 10,
  "limit": 20,
  "offset": 0
}
```

### Import Playlist
`POST /api/v1/playlists/import`

Import a YouTube playlist.

**Authentication**: Required

**Rate Limit**: 10 requests/minute

**Request Body**:
```json
{
  "playlistUrl": "https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf"
}
```

**Response** (200):
```json
{
  "playlist": {
    "id": "uuid",
    "youtubeId": "PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf",
    "title": "Playlist Title",
    "description": "Playlist description",
    "channelId": "UCxxxxxx",
    "channelTitle": "Channel Name",
    "thumbnailUrl": "https://...",
    "itemCount": 50,
    "syncStatus": "COMPLETED",
    "lastSyncedAt": "2023-12-31T12:00:00.000Z",
    "createdAt": "2023-12-31T12:00:00.000Z",
    "updatedAt": "2023-12-31T12:00:00.000Z"
  }
}
```

### Get Playlist Details
`GET /api/v1/playlists/:id`

Get playlist with all videos.

**Authentication**: Required

**Rate Limit**: 50 requests/minute

**URL Parameters**:
- `id` (string): Playlist ID

**Response** (200):
```json
{
  "playlist": {
    "id": "uuid",
    "youtubeId": "PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf",
    "title": "Playlist Title",
    "description": "Playlist description",
    "channelId": "UCxxxxxx",
    "channelTitle": "Channel Name",
    "thumbnailUrl": "https://...",
    "itemCount": 50,
    "syncStatus": "COMPLETED",
    "lastSyncedAt": "2023-12-31T12:00:00.000Z",
    "createdAt": "2023-12-01T12:00:00.000Z",
    "updatedAt": "2023-12-31T12:00:00.000Z",
    "items": [
      {
        "id": "uuid",
        "position": 0,
        "addedAt": "2023-12-01T12:00:00.000Z",
        "video": {
          "id": "uuid",
          "youtubeId": "dQw4w9WgXcQ",
          "title": "Video Title",
          "description": "Video description",
          "channelTitle": "Channel Name",
          "duration": 213,
          "thumbnailUrls": "{\"default\":\"https://...\"}",
          "viewCount": 1000000,
          "publishedAt": "2023-01-01T12:00:00.000Z"
        }
      }
    ]
  }
}
```

### Sync Playlist
`POST /api/v1/playlists/:id/sync`

Synchronize playlist with YouTube.

**Authentication**: Required

**Rate Limit**: 10 requests/minute

**URL Parameters**:
- `id` (string): Playlist ID

**Response** (200):
```json
{
  "result": {
    "playlistId": "uuid",
    "status": "COMPLETED",
    "itemsAdded": 5,
    "itemsRemoved": 2,
    "itemsReordered": 3,
    "duration": 2500,
    "quotaUsed": 15,
    "error": null
  }
}
```

### Delete Playlist
`DELETE /api/v1/playlists/:id`

Delete a playlist and all associated data.

**Authentication**: Required

**Rate Limit**: 50 requests/minute

**URL Parameters**:
- `id` (string): Playlist ID

**Response** (200):
```json
{
  "message": "Playlist deleted successfully"
}
```

---

## Videos

All video endpoints are located under `/api/v1/videos`.

### Get Video Details
`GET /api/v1/videos/:id`

Get detailed information about a video.

**Authentication**: Required

**Rate Limit**: 100 requests/minute

**URL Parameters**:
- `id` (string): Video ID

**Response** (200):
```json
{
  "video": {
    "id": "uuid",
    "youtubeId": "dQw4w9WgXcQ",
    "title": "Video Title",
    "description": "Video description",
    "channelId": "UCxxxxxx",
    "channelTitle": "Channel Name",
    "publishedAt": "2023-01-01T12:00:00.000Z",
    "duration": 213,
    "thumbnailUrls": "{\"default\":\"https://...\"}",
    "viewCount": 1000000,
    "likeCount": 50000,
    "commentCount": 1000,
    "tags": "[\"music\",\"entertainment\"]",
    "categoryId": "10",
    "language": "en",
    "userState": {
      "watchStatus": "WATCHING",
      "lastPosition": 120,
      "watchCount": 3,
      "rating": 5
    }
  }
}
```

### Get Video Captions
`GET /api/v1/videos/:id/captions`

Get video transcripts/captions.

**Authentication**: Required

**Rate Limit**: 100 requests/minute

**URL Parameters**:
- `id` (string): Video ID

**Query Parameters**:
- `language` (string, optional): Language code (e.g., 'en', 'ko')

**Response** (200):
```json
{
  "captions": [
    {
      "id": "uuid",
      "language": "en",
      "text": "Full transcript text...",
      "segments": "[{\"text\":\"Hello\",\"start\":0,\"duration\":2}]",
      "createdAt": "2023-12-31T12:00:00.000Z"
    }
  ]
}
```

### Update Video State
`PUT /api/v1/videos/:id/state`

Update watch status and position.

**Authentication**: Required

**Rate Limit**: 100 requests/minute

**URL Parameters**:
- `id` (string): Video ID

**Request Body**:
```json
{
  "watchStatus": "WATCHING",
  "lastPosition": 120,
  "rating": 5
}
```

**Response** (200):
```json
{
  "state": {
    "id": "uuid",
    "videoId": "uuid",
    "watchStatus": "WATCHING",
    "lastPosition": 120,
    "watchCount": 3,
    "rating": 5,
    "updatedAt": "2023-12-31T12:00:00.000Z"
  }
}
```

---

## Notes

All note endpoints are located under `/api/v1/videos/:videoId/notes` and `/api/v1/notes`.

### List Notes
`GET /api/v1/videos/:videoId/notes`

Get all notes for a video.

**Authentication**: Required

**Rate Limit**: 50 requests/minute

**URL Parameters**:
- `videoId` (string): Video ID

**Response** (200):
```json
{
  "notes": [
    {
      "id": "uuid",
      "videoId": "uuid",
      "timestamp": 120,
      "content": "This is an important point",
      "tags": "[\"important\",\"review\"]",
      "createdAt": "2023-12-31T12:00:00.000Z",
      "updatedAt": "2023-12-31T12:00:00.000Z"
    }
  ]
}
```

### Create Note
`POST /api/v1/videos/:videoId/notes`

Create a new note for a video.

**Authentication**: Required

**Rate Limit**: 50 requests/minute

**URL Parameters**:
- `videoId` (string): Video ID

**Request Body**:
```json
{
  "timestamp": 120,
  "content": "This is an important point",
  "tags": ["important", "review"]
}
```

**Response** (201):
```json
{
  "note": {
    "id": "uuid",
    "videoId": "uuid",
    "timestamp": 120,
    "content": "This is an important point",
    "tags": "[\"important\",\"review\"]",
    "createdAt": "2023-12-31T12:00:00.000Z",
    "updatedAt": "2023-12-31T12:00:00.000Z"
  }
}
```

### Update Note
`PUT /api/v1/notes/:id`

Update an existing note.

**Authentication**: Required

**Rate Limit**: 50 requests/minute

**URL Parameters**:
- `id` (string): Note ID

**Request Body**:
```json
{
  "content": "Updated note content",
  "tags": ["updated", "review"]
}
```

**Response** (200):
```json
{
  "note": {
    "id": "uuid",
    "videoId": "uuid",
    "timestamp": 120,
    "content": "Updated note content",
    "tags": "[\"updated\",\"review\"]",
    "createdAt": "2023-12-31T12:00:00.000Z",
    "updatedAt": "2023-12-31T13:00:00.000Z"
  }
}
```

### Delete Note
`DELETE /api/v1/notes/:id`

Delete a note.

**Authentication**: Required

**Rate Limit**: 50 requests/minute

**URL Parameters**:
- `id` (string): Note ID

**Response** (200):
```json
{
  "message": "Note deleted successfully"
}
```

---

## Analytics

All analytics endpoints are located under `/api/v1/analytics`.

### Get Summary
`GET /api/v1/analytics/summary`

Get learning analytics summary.

**Authentication**: Required

**Rate Limit**: 30 requests/minute

**Response** (200):
```json
{
  "summary": {
    "totalVideos": 150,
    "watchedVideos": 50,
    "totalWatchTime": 36000,
    "averageRating": 4.2,
    "totalNotes": 75,
    "completionRate": 33.3
  }
}
```

### Get Watch History
`GET /api/v1/analytics/watch-history`

Get watch history with pagination.

**Authentication**: Required

**Rate Limit**: 30 requests/minute

**Query Parameters**:
- `page` (integer, default: 1): Page number
- `limit` (integer, default: 20): Items per page
- `startDate` (string, optional): ISO date
- `endDate` (string, optional): ISO date

**Response** (200):
```json
{
  "sessions": [
    {
      "id": "uuid",
      "videoId": "uuid",
      "videoTitle": "Video Title",
      "startedAt": "2023-12-31T12:00:00.000Z",
      "endedAt": "2023-12-31T12:30:00.000Z",
      "duration": 1800
    }
  ],
  "total": 100,
  "page": 1,
  "limit": 20
}
```

### Get Progress
`GET /api/v1/analytics/progress`

Get learning progress statistics.

**Authentication**: Required

**Rate Limit**: 30 requests/minute

**Response** (200):
```json
{
  "progress": {
    "daily": [
      {
        "date": "2023-12-31",
        "videosWatched": 5,
        "watchTime": 3600
      }
    ],
    "weekly": {
      "videosWatched": 25,
      "watchTime": 18000
    },
    "monthly": {
      "videosWatched": 100,
      "watchTime": 72000
    }
  }
}
```

---

## Sync

All sync endpoints are located under `/api/v1/sync`.

### Sync All Playlists
`POST /api/v1/sync/all`

Synchronize all playlists.

**Authentication**: Required

**Rate Limit**: 10 requests/minute

**Response** (200):
```json
{
  "results": [
    {
      "playlistId": "uuid",
      "status": "COMPLETED",
      "itemsAdded": 5,
      "itemsRemoved": 2,
      "duration": 2500
    }
  ],
  "summary": {
    "total": 10,
    "succeeded": 9,
    "failed": 1,
    "quotaUsed": 150
  }
}
```

### Get Sync Status
`GET /api/v1/sync/status`

Get current sync status.

**Authentication**: Required

**Rate Limit**: 30 requests/minute

**Response** (200):
```json
{
  "status": {
    "isRunning": false,
    "lastSync": "2023-12-31T12:00:00.000Z",
    "nextSync": "2023-12-31T18:00:00.000Z",
    "activeJobs": 0
  }
}
```

### Configure Schedule
`POST /api/v1/sync/schedule`

Configure automatic sync schedule.

**Authentication**: Required

**Rate Limit**: 10 requests/minute

**Request Body**:
```json
{
  "playlistId": "uuid",
  "interval": 21600000,
  "enabled": true
}
```

**Response** (200):
```json
{
  "schedule": {
    "id": "uuid",
    "playlistId": "uuid",
    "interval": 21600000,
    "enabled": true,
    "nextRun": "2023-12-31T18:00:00.000Z"
  }
}
```

---

## Quota

All quota endpoints are located under `/api/v1/quota`.

### Get Quota Usage
`GET /api/v1/quota/usage`

Get current YouTube API quota usage.

**Authentication**: Required

**Rate Limit**: 100 requests/minute

**Response** (200):
```json
{
  "quota": {
    "date": "2023-12-31T00:00:00.000Z",
    "used": 1500,
    "limit": 10000,
    "remaining": 8500,
    "percentage": 15.0,
    "resetAt": "2024-01-01T00:00:00.000Z"
  }
}
```

### Get Quota Limits
`GET /api/v1/quota/limits`

Get quota limits and rate limit configurations.

**Authentication**: Required

**Rate Limit**: 100 requests/minute

**Response** (200):
```json
{
  "limits": {
    "youtube": {
      "dailyLimit": 10000,
      "quotaCosts": {
        "playlists.list": 1,
        "playlistItems.list": 1,
        "videos.list": 1,
        "search.list": 100
      }
    },
    "rateLimits": [
      {
        "endpoint": "/api/v1/auth/login",
        "max": 10,
        "timeWindow": "1 minute",
        "timeWindowMs": 60000
      }
    ]
  }
}
```

---

## Health

Health check endpoints.

### Health Check
`GET /health`

Basic health check.

**Authentication**: Not required

**Response** (200):
```json
{
  "status": "ok",
  "timestamp": "2023-12-31T12:00:00.000Z",
  "uptime": 3600,
  "version": "1.0.0"
}
```

### Readiness Check
`GET /health/ready`

Kubernetes readiness probe.

**Authentication**: Not required

**Response** (200):
```json
{
  "status": "ready"
}
```

---

## Common Response Codes

| Code | Meaning | Description |
|------|---------|-------------|
| 200 | OK | Request successful |
| 201 | Created | Resource created successfully |
| 400 | Bad Request | Invalid request parameters |
| 401 | Unauthorized | Missing or invalid authentication |
| 403 | Forbidden | Insufficient permissions |
| 404 | Not Found | Resource not found |
| 409 | Conflict | Resource already exists |
| 429 | Too Many Requests | Rate limit exceeded |
| 500 | Internal Server Error | Server error |
| 503 | Service Unavailable | Service temporarily unavailable |

## Rate Limits Summary

| Endpoint Category | Limit | Window |
|------------------|-------|--------|
| Global | 100 | 1 minute |
| Auth (login) | 10 | 1 minute |
| Auth (register) | 5 | 1 minute |
| Auth (refresh) | 20 | 1 minute |
| Playlists | 50 | 1 minute |
| Videos | 100 | 1 minute |
| Notes | 50 | 1 minute |
| Analytics | 30 | 1 minute |
| Sync | 10 | 1 minute |
| Quota | 100 | 1 minute |
