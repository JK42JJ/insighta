# Quick Start

Get up and running with TubeArchive in 5 minutes.

## Prerequisites

Make sure you have completed the [Installation](/docs/getting-started/installation) guide.

## Step 1: Start the API Server

```bash
npm run api:dev
```

The server will start at `http://localhost:3000`.

## Step 2: Create an Account

Register a new user account:

```bash
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "SecurePassword123!",
    "name": "Your Name"
  }'
```

Response:
```json
{
  "user": {
    "id": "...",
    "email": "user@example.com",
    "name": "Your Name"
  },
  "accessToken": "eyJhbGc...",
  "refreshToken": "eyJhbGc...",
  "expiresIn": 900
}
```

Save the `accessToken` for subsequent requests.

## Step 3: Import a Playlist

Import a YouTube playlist:

```bash
curl -X POST http://localhost:3000/api/v1/playlists \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -d '{
    "url": "https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf"
  }'
```

Response:
```json
{
  "playlist": {
    "id": "...",
    "youtubeId": "PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf",
    "title": "My Playlist",
    "videoCount": 25
  }
}
```

## Step 4: List Your Playlists

```bash
curl -X GET http://localhost:3000/api/v1/playlists \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

Response:
```json
{
  "playlists": [
    {
      "id": "...",
      "title": "My Playlist",
      "videoCount": 25,
      "lastSyncedAt": "2025-12-19T10:00:00Z"
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 20
}
```

## Step 5: Get Videos

List videos in a playlist:

```bash
curl -X GET "http://localhost:3000/api/v1/videos?playlistId=YOUR_PLAYLIST_ID" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

## Step 6: View Analytics Dashboard

Get your learning statistics:

```bash
curl -X GET http://localhost:3000/api/v1/analytics/dashboard \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

Response:
```json
{
  "dashboard": {
    "totalVideos": 25,
    "totalWatchTime": 3600,
    "completedVideos": 5,
    "learningStreak": {
      "currentStreak": 3
    }
  }
}
```

## Using the CLI

You can also use the CLI for common operations:

```bash
# Check authentication status
npm run cli -- auth-status

# Import a playlist
npm run cli -- import "https://www.youtube.com/playlist?list=..."

# Sync all playlists
npm run cli -- sync --all

# List playlists
npm run cli -- list

# Check quota usage
npm run cli -- quota
```

## Using the Interactive API Docs

TubeArchive provides interactive API documentation:

- **Swagger UI**: http://localhost:3000/documentation
- **Scalar API Reference**: http://localhost:3000/api-reference

These interfaces let you explore and test the API directly in your browser.

## Common Operations

### Add Notes to a Video

```bash
curl -X POST http://localhost:3000/api/v1/videos/VIDEO_ID/notes \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -d '{
    "timestamp": 120,
    "content": "Important concept explained here"
  }'
```

### Generate Video Summary

```bash
curl -X POST http://localhost:3000/api/v1/videos/VIDEO_ID/summary \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -d '{
    "level": "brief",
    "language": "en"
  }'
```

### Get Video Captions

```bash
curl -X GET "http://localhost:3000/api/v1/videos/VIDEO_ID/captions?language=en" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

### Schedule Automatic Sync

```bash
curl -X POST http://localhost:3000/api/v1/sync/schedule \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -d '{
    "playlistId": "PLAYLIST_ID",
    "intervalMinutes": 60,
    "enabled": true
  }'
```

## Next Steps

- [Authentication Guide](/docs/getting-started/authentication) - Set up YouTube API access
- [Playlist Sync Guide](/docs/guides/playlist-sync) - Advanced sync features
- [Video Management](/docs/guides/video-management) - Notes, summaries, and more
- [API Reference](/docs/api-reference/tubearchive-api) - Complete API documentation
