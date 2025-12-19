# API Documentation

Welcome to the YouTube Playlist Sync API documentation. This API provides comprehensive endpoints for managing YouTube playlists, videos, notes, and learning analytics.

## Overview

The YouTube Playlist Sync API is a RESTful API that enables:

- **Playlist Management**: Import, sync, and manage YouTube playlists
- **Video Operations**: Access video metadata, captions, and statistics
- **Learning Features**: Take notes, track watch progress, and analyze learning patterns
- **Sync Automation**: Schedule automatic playlist synchronization
- **Quota Management**: Monitor YouTube API quota usage and rate limits

## Quick Start

### 1. Authentication

All API endpoints (except health checks) require authentication using JWT tokens.

```bash
# Register a new user
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "SecurePassword123!",
    "name": "John Doe"
  }'

# Login to get access token
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "SecurePassword123!"
  }'
```

Response:
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": 900
}
```

### 2. Use the Access Token

Include the access token in the `Authorization` header for all subsequent requests:

```bash
curl -X GET http://localhost:3000/api/v1/playlists \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

### 3. Import a Playlist

```bash
curl -X POST http://localhost:3000/api/v1/playlists/import \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "playlistUrl": "https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf"
  }'
```

## API Endpoints

### Authentication
- `POST /api/v1/auth/register` - Register a new user
- `POST /api/v1/auth/login` - Login and get access token
- `POST /api/v1/auth/refresh` - Refresh access token
- `POST /api/v1/auth/logout` - Logout and invalidate tokens

### Playlists
- `GET /api/v1/playlists` - List all playlists
- `POST /api/v1/playlists/import` - Import a YouTube playlist
- `GET /api/v1/playlists/:id` - Get playlist details with videos
- `POST /api/v1/playlists/:id/sync` - Sync playlist with YouTube
- `DELETE /api/v1/playlists/:id` - Delete a playlist

### Videos
- `GET /api/v1/videos/:id` - Get video details
- `GET /api/v1/videos/:id/captions` - Get video captions/transcripts
- `PUT /api/v1/videos/:id/state` - Update watch status and position

### Notes
- `GET /api/v1/videos/:videoId/notes` - List notes for a video
- `POST /api/v1/videos/:videoId/notes` - Create a new note
- `GET /api/v1/notes/:id` - Get note details
- `PUT /api/v1/notes/:id` - Update a note
- `DELETE /api/v1/notes/:id` - Delete a note

### Analytics
- `GET /api/v1/analytics/summary` - Get learning analytics summary
- `GET /api/v1/analytics/watch-history` - Get watch history
- `GET /api/v1/analytics/progress` - Get learning progress

### Sync
- `POST /api/v1/sync/all` - Sync all playlists
- `GET /api/v1/sync/status` - Get sync status
- `POST /api/v1/sync/schedule` - Configure sync schedule

### Quota
- `GET /api/v1/quota/usage` - Get current quota usage
- `GET /api/v1/quota/limits` - Get quota limits and rate limit info

## Interactive Documentation

### Swagger UI
Navigate to `http://localhost:3000/documentation` for interactive Swagger UI documentation where you can:
- Browse all available endpoints
- View request/response schemas
- Try out API calls directly in the browser

### Scalar API Reference
Navigate to `http://localhost:3000/api-reference` for modern Scalar API reference with:
- Clean, modern interface
- Better user experience
- Code examples in multiple languages
- Search functionality

## Rate Limiting

The API implements rate limiting to ensure fair usage:

### Global Limits
- **100 requests per minute** per IP address or authenticated user

### Endpoint-Specific Limits

| Endpoint Category | Limit | Time Window |
|------------------|-------|-------------|
| Authentication (login) | 10 | 1 minute |
| Authentication (register) | 5 | 1 minute |
| Authentication (refresh) | 20 | 1 minute |
| Playlists | 50 | 1 minute |
| Videos | 100 | 1 minute |
| Analytics | 30 | 1 minute |
| Sync | 10 | 1 minute |

### Rate Limit Headers

All responses include rate limit information in headers:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 87
X-RateLimit-Reset: 1640995200
```

When rate limit is exceeded, you'll receive a `429 Too Many Requests` response:

```json
{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Rate limit exceeded. Maximum 100 requests per 1 minute. Try again later.",
    "details": {
      "limit": 100,
      "remaining": 0,
      "resetAt": "2023-12-31T12:00:00.000Z"
    },
    "timestamp": "2023-12-31T11:45:30.000Z",
    "path": "/api/v1/playlists"
  }
}
```

## YouTube API Quota

The API tracks YouTube API quota usage to prevent exceeding daily limits:

- **Daily Quota**: 10,000 units (default)
- Check current usage: `GET /api/v1/quota/usage`
- View quota costs: `GET /api/v1/quota/limits`

### Quota Costs

| Operation | Cost (units) |
|-----------|--------------|
| List playlists | 1 |
| List playlist items | 1 |
| Get video details | 1 |
| Search | 100 |
| Download captions | 200 |

## Error Handling

All errors follow a consistent format:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message",
    "details": {},
    "timestamp": "2023-12-31T12:00:00.000Z",
    "path": "/api/v1/endpoint"
  }
}
```

### Common Error Codes

| Code | Status | Description |
|------|--------|-------------|
| `UNAUTHORIZED` | 401 | Missing or invalid authentication token |
| `FORBIDDEN` | 403 | Insufficient permissions |
| `RESOURCE_NOT_FOUND` | 404 | Requested resource doesn't exist |
| `VALIDATION_ERROR` | 400 | Request validation failed |
| `RATE_LIMIT_EXCEEDED` | 429 | Too many requests |
| `QUOTA_EXCEEDED` | 429 | YouTube API quota exceeded |
| `INTERNAL_SERVER_ERROR` | 500 | Server error |

## Pagination

List endpoints support pagination using query parameters:

```bash
GET /api/v1/playlists?page=1&limit=20
```

Response includes pagination metadata:

```json
{
  "playlists": [...],
  "total": 150,
  "limit": 20,
  "offset": 0
}
```

## Filtering and Sorting

Many list endpoints support filtering and sorting:

```bash
# Filter by sync status
GET /api/v1/playlists?filter=COMPLETED

# Sort by last synced date
GET /api/v1/playlists?sortBy=lastSyncedAt&sortOrder=desc
```

## Best Practices

1. **Use Access Tokens Securely**
   - Store tokens securely (never in source code)
   - Use HTTPS in production
   - Implement token refresh logic

2. **Handle Rate Limits**
   - Check rate limit headers
   - Implement exponential backoff for retries
   - Monitor usage patterns

3. **Monitor Quota Usage**
   - Check quota regularly
   - Implement alerts for high usage
   - Cache API responses when possible

4. **Error Handling**
   - Always check response status codes
   - Parse error responses properly
   - Implement retry logic for transient errors

5. **Performance**
   - Use pagination for large datasets
   - Implement client-side caching
   - Batch operations when possible

## Support

- **Documentation**: See individual endpoint documentation files
- **OpenAPI Spec**: Available at `/api/v1/documentation/json`
- **Issues**: Report bugs and feature requests on GitHub

## Version History

- **v1.0.0** (Current)
  - Initial release
  - Core playlist and video management
  - Authentication and rate limiting
  - Quota tracking
