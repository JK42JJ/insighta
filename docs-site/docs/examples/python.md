# Python Examples

Complete examples for using the TubeArchive API with Python.

## Setup

### Using Requests

```python
import requests
from datetime import datetime
from typing import Optional, List, Dict, Any

class TubeArchiveClient:
    def __init__(self, base_url: str = "http://localhost:3000/api/v1"):
        self.base_url = base_url
        self.access_token: Optional[str] = None
        self.refresh_token: Optional[str] = None
        self.session = requests.Session()

    def _get_headers(self) -> Dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.access_token:
            headers["Authorization"] = f"Bearer {self.access_token}"
        return headers

    def _request(
        self,
        method: str,
        endpoint: str,
        data: Optional[Dict] = None,
        params: Optional[Dict] = None
    ) -> Dict[str, Any]:
        url = f"{self.base_url}{endpoint}"
        response = self.session.request(
            method=method,
            url=url,
            json=data,
            params=params,
            headers=self._get_headers()
        )

        if not response.ok:
            error = response.json()
            raise Exception(error.get("error", {}).get("message", "Request failed"))

        return response.json()
```

## Authentication

### Register

```python
def register(self, email: str, password: str, name: str) -> Dict:
    """Register a new user account."""
    result = self._request("POST", "/auth/register", {
        "email": email,
        "password": password,
        "name": name
    })

    self.access_token = result["accessToken"]
    self.refresh_token = result["refreshToken"]

    return result["user"]

# Usage
client = TubeArchiveClient()
user = client.register("user@example.com", "SecurePassword123!", "John Doe")
print(f"Registered: {user['email']}")
```

### Login

```python
def login(self, email: str, password: str) -> Dict:
    """Login with email and password."""
    result = self._request("POST", "/auth/login", {
        "email": email,
        "password": password
    })

    self.access_token = result["accessToken"]
    self.refresh_token = result["refreshToken"]

    return result["user"]

# Usage
client = TubeArchiveClient()
user = client.login("user@example.com", "SecurePassword123!")
print(f"Logged in as: {user['name']}")
```

### Refresh Token

```python
def refresh_access_token(self) -> str:
    """Refresh the access token using the refresh token."""
    if not self.refresh_token:
        raise Exception("No refresh token available")

    result = self._request("POST", "/auth/refresh", {
        "refreshToken": self.refresh_token
    })

    self.access_token = result["accessToken"]
    return self.access_token
```

## Playlists

### Import Playlist

```python
def import_playlist(self, url: str) -> Dict:
    """Import a YouTube playlist by URL."""
    result = self._request("POST", "/playlists", {"url": url})
    return result["playlist"]

# Usage
playlist = client.import_playlist(
    "https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf"
)
print(f"Imported: {playlist['title']} ({playlist['videoCount']} videos)")
```

### List Playlists

```python
def get_playlists(self, page: int = 1, limit: int = 20) -> Dict:
    """Get all playlists for the current user."""
    return self._request("GET", "/playlists", params={
        "page": page,
        "limit": limit
    })

# Usage
result = client.get_playlists()
for playlist in result["playlists"]:
    print(f"- {playlist['title']}: {playlist['videoCount']} videos")
print(f"Total: {result['total']} playlists")
```

### Sync Playlist

```python
def sync_playlist(self, playlist_id: str) -> Dict:
    """Sync a playlist with YouTube."""
    return self._request("POST", f"/playlists/{playlist_id}/sync")

# Usage
result = client.sync_playlist("playlist-id")
print(f"Added: {result['videosAdded']}, Removed: {result['videosRemoved']}")
```

### Delete Playlist

```python
def delete_playlist(self, playlist_id: str) -> None:
    """Delete a playlist."""
    self._request("DELETE", f"/playlists/{playlist_id}")

# Usage
client.delete_playlist("playlist-id")
print("Playlist deleted")
```

## Videos

### List Videos

```python
def get_videos(
    self,
    playlist_id: Optional[str] = None,
    search: Optional[str] = None,
    status: Optional[str] = None,
    page: int = 1,
    limit: int = 20
) -> Dict:
    """Get videos with optional filters."""
    params = {"page": page, "limit": limit}

    if playlist_id:
        params["playlistId"] = playlist_id
    if search:
        params["search"] = search
    if status:
        params["status"] = status

    return self._request("GET", "/videos", params=params)

# Usage
result = client.get_videos(status="in_progress")
for video in result["videos"]:
    print(f"- {video['title']} ({video.get('progress', 0)}%)")
```

### Get Video Details

```python
def get_video(self, video_id: str) -> Dict:
    """Get video details."""
    return self._request("GET", f"/videos/{video_id}")

# Usage
video = client.get_video("video-id")
duration_min = video["duration"] // 60
print(f"{video['title']} ({duration_min} min)")
```

### Get Captions

```python
def get_captions(self, video_id: str, language: str = "en") -> Dict:
    """Get video captions in specified language."""
    return self._request("GET", f"/videos/{video_id}/captions", params={
        "language": language
    })

# Usage
result = client.get_captions("video-id", "en")
for caption in result["captions"][:5]:  # First 5 captions
    time = int(caption["start"])
    print(f"[{time}s] {caption['text']}")
```

### Generate Summary

```python
def generate_summary(
    self,
    video_id: str,
    level: str = "detailed",
    language: str = "en"
) -> Dict:
    """Generate an AI summary of the video."""
    return self._request("POST", f"/videos/{video_id}/summary", {
        "level": level,
        "language": language
    })

# Usage
summary = client.generate_summary("video-id", level="brief")
print(summary["content"])
```

## Notes

### Create Note

```python
def create_note(
    self,
    video_id: str,
    content: str,
    timestamp: Optional[int] = None,
    tags: Optional[List[str]] = None
) -> Dict:
    """Create a note for a video."""
    data = {"content": content}

    if timestamp is not None:
        data["timestamp"] = timestamp
    if tags:
        data["tags"] = tags

    return self._request("POST", f"/videos/{video_id}/notes", data)

# Usage
note = client.create_note(
    "video-id",
    "Key concept: dependency injection pattern",
    timestamp=120,  # 2 minutes in
    tags=["concept", "pattern"]
)
print(f"Note created: {note['id']}")
```

### List Notes

```python
def get_notes(
    self,
    video_id: str,
    tags: Optional[List[str]] = None,
    start_time: Optional[int] = None,
    end_time: Optional[int] = None
) -> List[Dict]:
    """Get notes for a video."""
    params = {}

    if tags:
        params["tags"] = ",".join(tags)
    if start_time is not None:
        params["startTime"] = start_time
    if end_time is not None:
        params["endTime"] = end_time

    return self._request("GET", f"/videos/{video_id}/notes", params=params)

# Usage
notes = client.get_notes("video-id")
for note in notes:
    time = note.get("timestamp", "N/A")
    print(f"[{time}s] {note['content']}")
```

### Export Notes

```python
def export_notes(
    self,
    format: str = "markdown",
    video_id: Optional[str] = None,
    tags: Optional[List[str]] = None
) -> str:
    """Export notes in specified format."""
    params = {"format": format}

    if video_id:
        params["videoId"] = video_id
    if tags:
        params["tags"] = ",".join(tags)

    return self._request("GET", "/notes/export", params=params)

# Usage
markdown = client.export_notes("markdown")
print(markdown)
```

## Analytics

### Get Dashboard

```python
def get_dashboard(self) -> Dict:
    """Get the learning dashboard."""
    return self._request("GET", "/analytics/dashboard")

# Usage
result = client.get_dashboard()
dashboard = result["dashboard"]

print(f"Videos: {dashboard['completedVideos']}/{dashboard['totalVideos']}")
print(f"Streak: {dashboard['learningStreak']['currentStreak']} days")
print(f"Watch time: {dashboard['totalWatchTime'] // 3600} hours")
```

### Record Watch Session

```python
def record_session(
    self,
    video_id: str,
    start_position: int,
    end_position: int
) -> None:
    """Record a watch session."""
    now = datetime.utcnow()
    duration = end_position - start_position
    start_time = datetime.fromtimestamp(now.timestamp() - duration)

    self._request("POST", "/analytics/sessions", {
        "videoId": video_id,
        "startPosition": start_position,
        "endPosition": end_position,
        "startTime": start_time.isoformat() + "Z",
        "endTime": now.isoformat() + "Z"
    })

# Usage
client.record_session("video-id", 0, 300)  # First 5 minutes
print("Session recorded")
```

### Get Playlist Progress

```python
def get_playlist_progress(self, playlist_id: str) -> Dict:
    """Get learning progress for a playlist."""
    return self._request("GET", f"/analytics/playlists/{playlist_id}")

# Usage
result = client.get_playlist_progress("playlist-id")
analytics = result["analytics"]

print(f"Progress: {analytics['completionRate']}%")
print(f"Completed: {analytics['completedVideos']}/{analytics['totalVideos']}")
```

## Complete Example

```python
#!/usr/bin/env python3
"""TubeArchive API client example."""

import requests
from datetime import datetime
from typing import Optional, List, Dict, Any


class TubeArchiveClient:
    """Client for the TubeArchive API."""

    def __init__(self, base_url: str = "http://localhost:3000/api/v1"):
        self.base_url = base_url
        self.access_token: Optional[str] = None
        self.refresh_token: Optional[str] = None
        self.session = requests.Session()

    def _get_headers(self) -> Dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.access_token:
            headers["Authorization"] = f"Bearer {self.access_token}"
        return headers

    def _request(
        self,
        method: str,
        endpoint: str,
        data: Optional[Dict] = None,
        params: Optional[Dict] = None
    ) -> Any:
        url = f"{self.base_url}{endpoint}"
        response = self.session.request(
            method=method,
            url=url,
            json=data,
            params=params,
            headers=self._get_headers()
        )

        if not response.ok:
            error = response.json()
            raise Exception(error.get("error", {}).get("message", "Request failed"))

        return response.json()

    def login(self, email: str, password: str) -> Dict:
        result = self._request("POST", "/auth/login", {
            "email": email,
            "password": password
        })
        self.access_token = result["accessToken"]
        self.refresh_token = result["refreshToken"]
        return result["user"]

    def import_playlist(self, url: str) -> Dict:
        return self._request("POST", "/playlists", {"url": url})["playlist"]

    def get_playlists(self) -> List[Dict]:
        return self._request("GET", "/playlists")["playlists"]

    def sync_playlist(self, playlist_id: str) -> Dict:
        return self._request("POST", f"/playlists/{playlist_id}/sync")

    def get_videos(self, playlist_id: str) -> List[Dict]:
        return self._request("GET", "/videos", params={
            "playlistId": playlist_id
        })["videos"]

    def get_dashboard(self) -> Dict:
        return self._request("GET", "/analytics/dashboard")["dashboard"]


def main():
    """Main example function."""
    client = TubeArchiveClient()

    # Login
    print("Logging in...")
    user = client.login("user@example.com", "password")
    print(f"Logged in as: {user['name']}")

    # Get playlists
    print("\nYour playlists:")
    playlists = client.get_playlists()
    for p in playlists:
        print(f"  - {p['title']} ({p['videoCount']} videos)")

    # Get dashboard
    print("\nLearning stats:")
    dashboard = client.get_dashboard()
    print(f"  Videos completed: {dashboard['completedVideos']}")
    print(f"  Current streak: {dashboard['learningStreak']['currentStreak']} days")
    print(f"  Total watch time: {dashboard['totalWatchTime'] // 3600} hours")


if __name__ == "__main__":
    main()
```

## Error Handling

```python
from requests.exceptions import RequestException

try:
    client.login("wrong@email.com", "wrongpassword")
except Exception as e:
    print(f"Login failed: {e}")

# With retry logic
import time

def retry_request(func, max_retries=3, delay=1):
    """Retry a function with exponential backoff."""
    for attempt in range(max_retries):
        try:
            return func()
        except Exception as e:
            if attempt == max_retries - 1:
                raise
            print(f"Attempt {attempt + 1} failed, retrying...")
            time.sleep(delay * (2 ** attempt))

# Usage
result = retry_request(lambda: client.sync_playlist("playlist-id"))
```

## Next Steps

- [JavaScript Examples](/docs/examples/javascript) - JavaScript code examples
- [cURL Examples](/docs/examples/curl) - Command-line examples
- [API Reference](/docs/api-reference/tubearchive-api) - Full API documentation
