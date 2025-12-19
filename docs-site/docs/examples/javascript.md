# JavaScript Examples

Complete examples for using the TubeArchive API with JavaScript/TypeScript.

## Setup

### Using Fetch (Native)

```javascript
const API_URL = 'http://localhost:3000/api/v1';
let accessToken = '';

// Helper function for API calls
async function apiRequest(endpoint, options = {}) {
  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken && { 'Authorization': `Bearer ${accessToken}` }),
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'API request failed');
  }

  return response.json();
}
```

### Using Axios

```javascript
import axios from 'axios';

const api = axios.create({
  baseURL: 'http://localhost:3000/api/v1',
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add auth token to requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle token refresh
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      const refreshToken = localStorage.getItem('refreshToken');
      if (refreshToken) {
        const { data } = await axios.post('/api/v1/auth/refresh', { refreshToken });
        localStorage.setItem('accessToken', data.accessToken);
        error.config.headers.Authorization = `Bearer ${data.accessToken}`;
        return axios(error.config);
      }
    }
    return Promise.reject(error);
  }
);
```

## Authentication

### Register

```javascript
async function register(email, password, name) {
  const response = await apiRequest('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, name }),
  });

  accessToken = response.accessToken;
  localStorage.setItem('refreshToken', response.refreshToken);

  return response.user;
}

// Usage
const user = await register('user@example.com', 'SecurePassword123!', 'John Doe');
console.log('Registered:', user.email);
```

### Login

```javascript
async function login(email, password) {
  const response = await apiRequest('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });

  accessToken = response.accessToken;
  localStorage.setItem('refreshToken', response.refreshToken);

  return response.user;
}

// Usage
const user = await login('user@example.com', 'SecurePassword123!');
console.log('Logged in as:', user.name);
```

### Refresh Token

```javascript
async function refreshAccessToken() {
  const refreshToken = localStorage.getItem('refreshToken');

  const response = await apiRequest('/auth/refresh', {
    method: 'POST',
    body: JSON.stringify({ refreshToken }),
  });

  accessToken = response.accessToken;
  return accessToken;
}
```

## Playlists

### Import Playlist

```javascript
async function importPlaylist(url) {
  const response = await apiRequest('/playlists', {
    method: 'POST',
    body: JSON.stringify({ url }),
  });

  return response.playlist;
}

// Usage
const playlist = await importPlaylist(
  'https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf'
);
console.log(`Imported: ${playlist.title} (${playlist.videoCount} videos)`);
```

### List Playlists

```javascript
async function getPlaylists(page = 1, limit = 20) {
  const params = new URLSearchParams({ page, limit });
  return apiRequest(`/playlists?${params}`);
}

// Usage
const { playlists, total } = await getPlaylists();
playlists.forEach(p => console.log(`- ${p.title}: ${p.videoCount} videos`));
```

### Sync Playlist

```javascript
async function syncPlaylist(playlistId) {
  const response = await apiRequest(`/playlists/${playlistId}/sync`, {
    method: 'POST',
  });

  return response;
}

// Usage with progress monitoring
async function syncWithProgress(playlistId) {
  console.log('Starting sync...');
  const result = await syncPlaylist(playlistId);
  console.log(`Sync complete: +${result.videosAdded} -${result.videosRemoved}`);
  return result;
}
```

## Videos

### List Videos

```javascript
async function getVideos(options = {}) {
  const params = new URLSearchParams();

  if (options.playlistId) params.append('playlistId', options.playlistId);
  if (options.search) params.append('search', options.search);
  if (options.status) params.append('status', options.status);
  if (options.page) params.append('page', options.page);
  if (options.limit) params.append('limit', options.limit);

  return apiRequest(`/videos?${params}`);
}

// Usage
const { videos } = await getVideos({ status: 'in_progress', limit: 10 });
videos.forEach(v => console.log(`- ${v.title} (${v.progress}%)`));
```

### Get Video Details

```javascript
async function getVideo(videoId) {
  return apiRequest(`/videos/${videoId}`);
}

// Usage
const video = await getVideo('video-id');
console.log(`${video.title} by ${video.channelTitle}`);
console.log(`Duration: ${Math.floor(video.duration / 60)} minutes`);
```

### Get Captions

```javascript
async function getCaptions(videoId, language = 'en') {
  const params = new URLSearchParams({ language });
  return apiRequest(`/videos/${videoId}/captions?${params}`);
}

// Usage
const { captions, language } = await getCaptions('video-id', 'en');
captions.forEach(c => {
  const time = Math.floor(c.start);
  console.log(`[${time}s] ${c.text}`);
});
```

### Generate Summary

```javascript
async function generateSummary(videoId, level = 'detailed', language = 'en') {
  return apiRequest(`/videos/${videoId}/summary`, {
    method: 'POST',
    body: JSON.stringify({ level, language }),
  });
}

// Usage
const summary = await generateSummary('video-id', 'brief');
console.log(summary.content);
```

## Notes

### Create Note

```javascript
async function createNote(videoId, timestamp, content, tags = []) {
  return apiRequest(`/videos/${videoId}/notes`, {
    method: 'POST',
    body: JSON.stringify({ timestamp, content, tags }),
  });
}

// Usage
const note = await createNote(
  'video-id',
  120, // 2 minutes into video
  'Important concept: dependency injection',
  ['concept', 'di']
);
```

### List Notes

```javascript
async function getNotes(videoId, options = {}) {
  const params = new URLSearchParams();

  if (options.tags) params.append('tags', options.tags.join(','));
  if (options.startTime) params.append('startTime', options.startTime);
  if (options.endTime) params.append('endTime', options.endTime);

  return apiRequest(`/videos/${videoId}/notes?${params}`);
}

// Usage
const notes = await getNotes('video-id', { tags: ['important'] });
notes.forEach(n => {
  console.log(`[${n.timestamp}s] ${n.content}`);
});
```

### Export Notes

```javascript
async function exportNotes(format = 'markdown', videoId = null) {
  const params = new URLSearchParams({ format });
  if (videoId) params.append('videoId', videoId);

  return apiRequest(`/notes/export?${params}`);
}

// Usage
const markdown = await exportNotes('markdown');
console.log(markdown);
```

## Analytics

### Get Dashboard

```javascript
async function getDashboard() {
  return apiRequest('/analytics/dashboard');
}

// Usage
const { dashboard } = await getDashboard();
console.log(`Videos watched: ${dashboard.completedVideos}/${dashboard.totalVideos}`);
console.log(`Current streak: ${dashboard.learningStreak.currentStreak} days`);
console.log(`Total watch time: ${Math.floor(dashboard.totalWatchTime / 3600)} hours`);
```

### Record Watch Session

```javascript
async function recordWatchSession(videoId, startPos, endPos) {
  return apiRequest('/analytics/sessions', {
    method: 'POST',
    body: JSON.stringify({
      videoId,
      startPosition: startPos,
      endPosition: endPos,
      startTime: new Date(Date.now() - (endPos - startPos) * 1000).toISOString(),
      endTime: new Date().toISOString(),
    }),
  });
}

// Usage
await recordWatchSession('video-id', 0, 300); // Watched first 5 minutes
```

## Complete Example: Video Learning App

```javascript
class TubeArchiveClient {
  constructor(baseUrl = 'http://localhost:3000/api/v1') {
    this.baseUrl = baseUrl;
    this.accessToken = null;
  }

  async request(endpoint, options = {}) {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(this.accessToken && { 'Authorization': `Bearer ${this.accessToken}` }),
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Request failed');
    }

    return response.json();
  }

  async login(email, password) {
    const result = await this.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    this.accessToken = result.accessToken;
    return result.user;
  }

  async importPlaylist(url) {
    return this.request('/playlists', {
      method: 'POST',
      body: JSON.stringify({ url }),
    });
  }

  async getPlaylists() {
    return this.request('/playlists');
  }

  async syncPlaylist(playlistId) {
    return this.request(`/playlists/${playlistId}/sync`, { method: 'POST' });
  }

  async getVideos(playlistId) {
    return this.request(`/videos?playlistId=${playlistId}`);
  }

  async getDashboard() {
    return this.request('/analytics/dashboard');
  }
}

// Usage
async function main() {
  const client = new TubeArchiveClient();

  // Login
  await client.login('user@example.com', 'password');

  // Import a playlist
  const { playlist } = await client.importPlaylist(
    'https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf'
  );
  console.log(`Imported: ${playlist.title}`);

  // Sync the playlist
  await client.syncPlaylist(playlist.id);
  console.log('Sync complete!');

  // Get videos
  const { videos } = await client.getVideos(playlist.id);
  console.log(`Found ${videos.length} videos`);

  // Check dashboard
  const { dashboard } = await client.getDashboard();
  console.log(`Learning streak: ${dashboard.learningStreak.currentStreak} days`);
}

main().catch(console.error);
```

## TypeScript Types

```typescript
interface User {
  id: string;
  email: string;
  name: string;
}

interface Playlist {
  id: string;
  youtubeId: string;
  title: string;
  description?: string;
  videoCount: number;
  lastSyncedAt?: string;
}

interface Video {
  id: string;
  youtubeId: string;
  title: string;
  description?: string;
  duration: number;
  channelTitle: string;
  thumbnailUrl?: string;
  progress?: number;
  status?: 'unwatched' | 'in_progress' | 'completed';
}

interface Note {
  id: string;
  videoId: string;
  timestamp?: number;
  content: string;
  tags: string[];
  createdAt: string;
}

interface Dashboard {
  totalVideos: number;
  completedVideos: number;
  totalWatchTime: number;
  learningStreak: {
    currentStreak: number;
    longestStreak: number;
  };
}
```

## Next Steps

- [Python Examples](/docs/examples/python) - Python code examples
- [cURL Examples](/docs/examples/curl) - Command-line examples
- [API Reference](/docs/api-reference/tubearchive-api) - Full API documentation
