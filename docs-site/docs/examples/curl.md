# cURL Examples

Command-line examples using cURL for the TubeArchive API.

## Setup

Set your base URL and token as environment variables:

```bash
export API_URL="http://localhost:3000/api/v1"
export TOKEN=""  # Will be set after login
```

## Authentication

### Register

```bash
curl -X POST "$API_URL/auth/register" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "SecurePassword123!",
    "name": "John Doe"
  }'
```

Response:
```json
{
  "user": {
    "id": "clxx...",
    "email": "user@example.com",
    "name": "John Doe"
  },
  "accessToken": "eyJhbGc...",
  "refreshToken": "eyJhbGc...",
  "expiresIn": 900
}
```

### Login

```bash
# Login and capture token
response=$(curl -s -X POST "$API_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "SecurePassword123!"
  }')

# Extract and export token
export TOKEN=$(echo $response | jq -r '.accessToken')
echo "Token set: ${TOKEN:0:20}..."
```

### Refresh Token

```bash
curl -X POST "$API_URL/auth/refresh" \
  -H "Content-Type: application/json" \
  -d '{
    "refreshToken": "YOUR_REFRESH_TOKEN"
  }'
```

### Logout

```bash
curl -X POST "$API_URL/auth/logout" \
  -H "Authorization: Bearer $TOKEN"
```

### Get Current User

```bash
curl -X GET "$API_URL/auth/me" \
  -H "Authorization: Bearer $TOKEN"
```

## Playlists

### Import Playlist

```bash
curl -X POST "$API_URL/playlists" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "url": "https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf"
  }'
```

### List Playlists

```bash
# Basic list
curl -X GET "$API_URL/playlists" \
  -H "Authorization: Bearer $TOKEN"

# With pagination
curl -X GET "$API_URL/playlists?page=1&limit=10" \
  -H "Authorization: Bearer $TOKEN"

# Search
curl -X GET "$API_URL/playlists?search=typescript" \
  -H "Authorization: Bearer $TOKEN"
```

### Get Playlist

```bash
curl -X GET "$API_URL/playlists/PLAYLIST_ID" \
  -H "Authorization: Bearer $TOKEN"
```

### Sync Playlist

```bash
curl -X POST "$API_URL/playlists/PLAYLIST_ID/sync" \
  -H "Authorization: Bearer $TOKEN"
```

### Delete Playlist

```bash
curl -X DELETE "$API_URL/playlists/PLAYLIST_ID" \
  -H "Authorization: Bearer $TOKEN"
```

## Videos

### List Videos

```bash
# All videos
curl -X GET "$API_URL/videos" \
  -H "Authorization: Bearer $TOKEN"

# Filter by playlist
curl -X GET "$API_URL/videos?playlistId=PLAYLIST_ID" \
  -H "Authorization: Bearer $TOKEN"

# Filter by status
curl -X GET "$API_URL/videos?status=in_progress" \
  -H "Authorization: Bearer $TOKEN"

# Search videos
curl -X GET "$API_URL/videos?search=react%20hooks" \
  -H "Authorization: Bearer $TOKEN"

# Pagination and sorting
curl -X GET "$API_URL/videos?page=1&limit=20&sort=duration&order=desc" \
  -H "Authorization: Bearer $TOKEN"
```

### Get Video

```bash
curl -X GET "$API_URL/videos/VIDEO_ID" \
  -H "Authorization: Bearer $TOKEN"
```

### Get Captions

```bash
# Default language (English)
curl -X GET "$API_URL/videos/VIDEO_ID/captions" \
  -H "Authorization: Bearer $TOKEN"

# Specific language
curl -X GET "$API_URL/videos/VIDEO_ID/captions?language=ko" \
  -H "Authorization: Bearer $TOKEN"
```

### Get Available Languages

```bash
curl -X GET "$API_URL/videos/VIDEO_ID/captions/languages" \
  -H "Authorization: Bearer $TOKEN"
```

### Get Summary

```bash
curl -X GET "$API_URL/videos/VIDEO_ID/summary" \
  -H "Authorization: Bearer $TOKEN"
```

### Generate Summary

```bash
curl -X POST "$API_URL/videos/VIDEO_ID/summary" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "level": "detailed",
    "language": "en"
  }'
```

## Notes

### Create Note

```bash
curl -X POST "$API_URL/videos/VIDEO_ID/notes" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "timestamp": 120,
    "content": "Important concept explained here",
    "tags": ["concept", "important"]
  }'
```

### List Notes for Video

```bash
# All notes
curl -X GET "$API_URL/videos/VIDEO_ID/notes" \
  -H "Authorization: Bearer $TOKEN"

# Filter by tags
curl -X GET "$API_URL/videos/VIDEO_ID/notes?tags=important,concept" \
  -H "Authorization: Bearer $TOKEN"

# Filter by timestamp range
curl -X GET "$API_URL/videos/VIDEO_ID/notes?startTime=60&endTime=300" \
  -H "Authorization: Bearer $TOKEN"
```

### Get Note

```bash
curl -X GET "$API_URL/notes/NOTE_ID" \
  -H "Authorization: Bearer $TOKEN"
```

### Update Note

```bash
curl -X PATCH "$API_URL/notes/NOTE_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "content": "Updated note content",
    "tags": ["updated", "important"]
  }'
```

### Delete Note

```bash
curl -X DELETE "$API_URL/notes/NOTE_ID" \
  -H "Authorization: Bearer $TOKEN"
```

### Export Notes

```bash
# Markdown format
curl -X GET "$API_URL/notes/export?format=markdown" \
  -H "Authorization: Bearer $TOKEN"

# JSON format for specific video
curl -X GET "$API_URL/notes/export?format=json&videoId=VIDEO_ID" \
  -H "Authorization: Bearer $TOKEN"

# CSV with tag filter
curl -X GET "$API_URL/notes/export?format=csv&tags=important" \
  -H "Authorization: Bearer $TOKEN"
```

## Analytics

### Get Dashboard

```bash
curl -X GET "$API_URL/analytics/dashboard" \
  -H "Authorization: Bearer $TOKEN"
```

### Get Video Analytics

```bash
curl -X GET "$API_URL/analytics/videos/VIDEO_ID" \
  -H "Authorization: Bearer $TOKEN"
```

### Get Playlist Progress

```bash
curl -X GET "$API_URL/analytics/playlists/PLAYLIST_ID" \
  -H "Authorization: Bearer $TOKEN"
```

### Record Watch Session

```bash
curl -X POST "$API_URL/analytics/sessions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "videoId": "VIDEO_ID",
    "startPosition": 0,
    "endPosition": 300,
    "startTime": "2025-12-19T10:00:00Z",
    "endTime": "2025-12-19T10:05:00Z"
  }'
```

## Sync

### Get Sync Status

```bash
# All playlists
curl -X GET "$API_URL/sync/status" \
  -H "Authorization: Bearer $TOKEN"

# Specific playlist
curl -X GET "$API_URL/sync/status/PLAYLIST_ID" \
  -H "Authorization: Bearer $TOKEN"
```

### Get Sync History

```bash
curl -X GET "$API_URL/sync/history?playlistId=PLAYLIST_ID&limit=10" \
  -H "Authorization: Bearer $TOKEN"
```

### Create Sync Schedule

```bash
curl -X POST "$API_URL/sync/schedule" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "playlistId": "PLAYLIST_ID",
    "intervalMinutes": 60,
    "enabled": true
  }'
```

### Update Schedule

```bash
curl -X PATCH "$API_URL/sync/schedule/SCHEDULE_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "intervalMinutes": 120,
    "enabled": false
  }'
```

### Delete Schedule

```bash
curl -X DELETE "$API_URL/sync/schedule/SCHEDULE_ID" \
  -H "Authorization: Bearer $TOKEN"
```

## Quota

### Get Usage

```bash
curl -X GET "$API_URL/quota/usage" \
  -H "Authorization: Bearer $TOKEN"
```

### Get Limits

```bash
curl -X GET "$API_URL/quota/limits" \
  -H "Authorization: Bearer $TOKEN"
```

## Shell Script Example

Complete example script for common workflows:

```bash
#!/bin/bash
# TubeArchive API Script

API_URL="http://localhost:3000/api/v1"

# Login function
login() {
  local email=$1
  local password=$2

  response=$(curl -s -X POST "$API_URL/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\": \"$email\", \"password\": \"$password\"}")

  TOKEN=$(echo $response | jq -r '.accessToken')

  if [ "$TOKEN" == "null" ]; then
    echo "Login failed"
    exit 1
  fi

  echo "Logged in successfully"
}

# Import playlist
import_playlist() {
  local url=$1

  curl -s -X POST "$API_URL/playlists" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d "{\"url\": \"$url\"}" | jq
}

# List playlists
list_playlists() {
  curl -s -X GET "$API_URL/playlists" \
    -H "Authorization: Bearer $TOKEN" | jq '.playlists[] | {title, videoCount}'
}

# Sync playlist
sync_playlist() {
  local id=$1

  curl -s -X POST "$API_URL/playlists/$id/sync" \
    -H "Authorization: Bearer $TOKEN" | jq
}

# Get dashboard
get_dashboard() {
  curl -s -X GET "$API_URL/analytics/dashboard" \
    -H "Authorization: Bearer $TOKEN" | jq '.dashboard'
}

# Main
login "user@example.com" "password"

echo "Your playlists:"
list_playlists

echo "Dashboard:"
get_dashboard
```

## Useful One-Liners

### Get all video titles in a playlist

```bash
curl -s "$API_URL/videos?playlistId=PLAYLIST_ID" \
  -H "Authorization: Bearer $TOKEN" | \
  jq -r '.videos[].title'
```

### Count videos by status

```bash
for status in unwatched in_progress completed; do
  count=$(curl -s "$API_URL/videos?status=$status" \
    -H "Authorization: Bearer $TOKEN" | jq '.total')
  echo "$status: $count"
done
```

### Export all notes to file

```bash
curl -s "$API_URL/notes/export?format=markdown" \
  -H "Authorization: Bearer $TOKEN" > notes.md
```

### Sync all playlists

```bash
curl -s "$API_URL/playlists" -H "Authorization: Bearer $TOKEN" | \
  jq -r '.playlists[].id' | \
  while read id; do
    echo "Syncing $id..."
    curl -s -X POST "$API_URL/playlists/$id/sync" \
      -H "Authorization: Bearer $TOKEN" | jq '.status'
  done
```

## Next Steps

- [JavaScript Examples](/docs/examples/javascript) - JavaScript code examples
- [Python Examples](/docs/examples/python) - Python code examples
- [API Reference](/docs/api-reference/tubearchive-api) - Full API documentation
