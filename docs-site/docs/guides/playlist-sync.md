# Playlist Synchronization

This guide covers how to import, sync, and manage YouTube playlists with TubeArchive.

## Overview

TubeArchive's sync engine keeps your local database synchronized with YouTube playlists. It detects:

- **New videos** added to playlists
- **Removed videos** from playlists
- **Reordered videos** in playlists
- **Updated metadata** (titles, descriptions, thumbnails)

## Importing a Playlist

### Via API

```bash
curl -X POST http://localhost:3000/api/v1/playlists \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -d '{
    "url": "https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf"
  }'
```

You can also use the playlist ID directly:

```bash
curl -X POST http://localhost:3000/api/v1/playlists \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -d '{
    "youtubeId": "PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf"
  }'
```

### Via CLI

```bash
npm run cli -- import "https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf"
```

## Manual Sync

### Sync a Single Playlist

```bash
# Via API
curl -X POST http://localhost:3000/api/v1/playlists/PLAYLIST_ID/sync \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"

# Via CLI
npm run cli -- sync PLAYLIST_ID
```

### Sync All Playlists

```bash
# Via CLI
npm run cli -- sync --all
```

## Automatic Sync

### Create a Sync Schedule

Set up automatic synchronization at regular intervals:

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

### Available Intervals

| Interval | Use Case |
|----------|----------|
| 15 min | Actively updated playlists |
| 60 min | Regular updates (recommended) |
| 360 min | Stable playlists |
| 1440 min | Archive playlists |

### Manage Schedules

```bash
# List all schedules
curl -X GET http://localhost:3000/api/v1/sync/schedule \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"

# Update a schedule
curl -X PATCH http://localhost:3000/api/v1/sync/schedule/SCHEDULE_ID \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -d '{
    "intervalMinutes": 120,
    "enabled": true
  }'

# Delete a schedule
curl -X DELETE http://localhost:3000/api/v1/sync/schedule/SCHEDULE_ID \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

## Sync Status

### Check Sync Status

```bash
# All playlists
curl -X GET http://localhost:3000/api/v1/sync/status \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"

# Specific playlist
curl -X GET http://localhost:3000/api/v1/sync/status/PLAYLIST_ID \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

### Sync States

| Status | Description |
|--------|-------------|
| `idle` | No sync in progress |
| `in_progress` | Currently syncing |
| `completed` | Last sync successful |
| `failed` | Last sync failed |

## Sync History

View past sync operations:

```bash
curl -X GET "http://localhost:3000/api/v1/sync/history?playlistId=PLAYLIST_ID&limit=10" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

Response includes:
- Videos added/removed
- Errors encountered
- Duration and timestamps

## YouTube API Quota

TubeArchive is designed to minimize YouTube API quota usage:

| Operation | Quota Cost |
|-----------|------------|
| Playlist details | 1 unit |
| Playlist items (50) | 1 unit |
| Video details (50) | 1 unit |

**Daily quota**: 10,000 units (default)

### Quota Management Tips

1. **Use incremental sync**: Only fetches changed items
2. **Set appropriate intervals**: Avoid over-syncing
3. **Batch operations**: Combine multiple playlist syncs
4. **Monitor usage**: Check quota with `npm run cli -- quota`

## Error Handling

### Common Errors

| Error | Solution |
|-------|----------|
| `PLAYLIST_NOT_FOUND` | Verify playlist URL/ID and visibility |
| `QUOTA_EXCEEDED` | Wait for quota reset (midnight PT) |
| `AUTH_EXPIRED` | Re-authenticate with `npm run cli -- auth` |
| `RATE_LIMITED` | Wait and retry with exponential backoff |

### Retry Logic

TubeArchive automatically retries failed operations:
- Maximum 5 attempts
- Exponential backoff (1s, 2s, 4s, 8s, 16s)
- Automatic quota exceeded handling

## Best Practices

1. **Start with manual sync** to verify playlist access
2. **Use reasonable intervals** (60+ minutes for most cases)
3. **Monitor sync history** for recurring errors
4. **Keep YouTube auth active** for private playlists
5. **Archive completed playlists** to reduce sync load

## Next Steps

- [Video Management](/docs/guides/video-management) - Work with synced videos
- [Learning Analytics](/docs/guides/learning-analytics) - Track your progress
- [API Reference](/docs/api-reference/tubearchive-api) - Explore all endpoints
