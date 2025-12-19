# Authentication

TubeArchive uses JWT-based authentication for the API and OAuth 2.0 for YouTube API access.

## API Authentication

### JWT Tokens

The API uses JWT (JSON Web Token) for authentication:

- **Access Token**: Short-lived (15 minutes), used for API requests
- **Refresh Token**: Long-lived (7 days), used to get new access tokens

### Register a New Account

```bash
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "SecurePassword123!",
    "name": "Your Name"
  }'
```

**Password Requirements:**
- Minimum 8 characters
- At least one uppercase letter
- At least one lowercase letter
- At least one number
- At least one special character

### Login

```bash
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
  "expiresIn": 900,
  "user": {
    "id": "...",
    "email": "user@example.com",
    "name": "Your Name"
  }
}
```

### Using the Access Token

Include the access token in the `Authorization` header:

```bash
curl -X GET http://localhost:3000/api/v1/playlists \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

### Refreshing Tokens

When the access token expires, use the refresh token:

```bash
curl -X POST http://localhost:3000/api/v1/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{
    "refreshToken": "YOUR_REFRESH_TOKEN"
  }'
```

### Logout

Invalidate your tokens:

```bash
curl -X POST http://localhost:3000/api/v1/auth/logout \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

## YouTube API Setup

To use YouTube synchronization features, you need to configure OAuth 2.0 credentials.

### Step 1: Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click the project dropdown and select "New Project"
3. Enter a project name (e.g., "youtube-playlist-sync")
4. Click "Create"

### Step 2: Enable YouTube Data API v3

1. Navigate to "APIs & Services" → "Library"
2. Search for "YouTube Data API v3"
3. Click on it and click "Enable"

### Step 3: Configure OAuth Consent Screen

1. Go to "APIs & Services" → "OAuth consent screen"
2. Select "External" and click "Create"
3. Fill in the required fields:
   - App name: "YouTube Playlist Sync"
   - User support email: Your email
   - Developer contact email: Your email
4. Click "Save and Continue"
5. Add scopes:
   - `https://www.googleapis.com/auth/youtube.readonly`
   - `https://www.googleapis.com/auth/youtube.force-ssl`
6. Add test users (your email)
7. Complete the setup

### Step 4: Create OAuth Credentials

1. Go to "APIs & Services" → "Credentials"
2. Click "Create Credentials" → "OAuth client ID"
3. Select "Desktop app" as application type
4. Name it (e.g., "YouTube Playlist Sync CLI")
5. Click "Create"
6. Download or copy the Client ID and Client Secret

### Step 5: Configure Environment

Add the credentials to your `.env` file:

```env
YOUTUBE_CLIENT_ID=your_client_id.apps.googleusercontent.com
YOUTUBE_CLIENT_SECRET=GOCSPX-your_client_secret
YOUTUBE_REDIRECT_URI=http://localhost:3000/oauth2callback
```

### Step 6: Authenticate with YouTube

Check authentication status:

```bash
npm run cli -- auth-status
```

Start the OAuth flow:

```bash
npm run cli -- auth
```

This will display a URL. Open it in your browser, authorize the app, and copy the authorization code from the redirect URL.

Complete authentication:

```bash
npm run cli -- auth-callback "YOUR_AUTHORIZATION_CODE"
```

## Rate Limiting

Authentication endpoints have specific rate limits:

| Endpoint | Limit |
|----------|-------|
| `/auth/register` | 5 requests/minute |
| `/auth/login` | 10 requests/minute |
| `/auth/refresh` | 20 requests/minute |

When rate limited, you'll receive:

```json
{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many requests",
    "retryAfter": 60
  }
}
```

## Security Best Practices

### Token Storage

- **Do not** store tokens in localStorage (XSS vulnerable)
- Use httpOnly cookies or secure in-memory storage
- Clear tokens on logout

### Password Security

- Use strong, unique passwords
- Enable HTTPS in production
- Rotate JWT secrets periodically

### Environment Security

- Never commit `.env` files to version control
- Use different secrets for development and production
- Rotate credentials if exposed

## Token Refresh Strategy

Implement automatic token refresh in your client:

```javascript
async function apiRequest(url, options = {}) {
  let accessToken = getAccessToken();

  options.headers = {
    ...options.headers,
    'Authorization': `Bearer ${accessToken}`
  };

  let response = await fetch(url, options);

  if (response.status === 401) {
    // Token expired, refresh it
    const newToken = await refreshAccessToken();
    options.headers['Authorization'] = `Bearer ${newToken}`;
    response = await fetch(url, options);
  }

  return response;
}

async function refreshAccessToken() {
  const refreshToken = getRefreshToken();
  const response = await fetch('/api/v1/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken })
  });

  const { accessToken } = await response.json();
  saveAccessToken(accessToken);
  return accessToken;
}
```

## Error Handling

Common authentication errors:

| Error Code | Description | Solution |
|------------|-------------|----------|
| `UNAUTHORIZED` | Missing or invalid token | Login or refresh token |
| `TOKEN_EXPIRED` | Token has expired | Use refresh token |
| `INVALID_CREDENTIALS` | Wrong email/password | Check credentials |
| `RATE_LIMIT_EXCEEDED` | Too many requests | Wait and retry |

## Next Steps

- [Quick Start](/docs/getting-started/quickstart) - Start using TubeArchive
- [Playlist Sync Guide](/docs/guides/playlist-sync) - Sync YouTube playlists
- [API Reference](/docs/api-reference/tubearchive-api) - Explore all endpoints
