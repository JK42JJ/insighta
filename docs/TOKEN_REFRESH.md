# Automatic Token Refresh System

This document describes the automatic token refresh implementation for the YouTube Playlist Sync project.

## Overview

The YouTube API uses OAuth 2.0 authentication with short-lived access tokens (15 minutes) and long-lived refresh tokens (varies). To maintain seamless API access, the system automatically refreshes expired tokens before API calls.

## Architecture

### Components

1. **TokenManager** (`/src/modules/auth/token-manager.ts`)
   - Singleton class managing OAuth token lifecycle
   - Thread-safe refresh operations
   - Automatic expiration detection
   - Configurable refresh buffer (default: 5 minutes before expiry)

2. **YouTubeClient** (`/src/api/client.ts`)
   - Integrates TokenManager for automatic token refresh
   - Validates tokens before API calls
   - Handles 401 errors with automatic retry after refresh

3. **TokenStorage** (`/src/cli/token-storage.ts`)
   - Secure local filesystem storage for CLI
   - Expiration checking utilities

## Key Features

### 1. Automatic Token Refresh

Tokens are automatically refreshed when:
- Token will expire within 5 minutes (configurable buffer)
- Token is already expired
- API returns 401 Unauthorized error

```typescript
// Example: Automatic refresh before API call
const client = getYouTubeClient();
client.setCredentials({
  access_token: 'old-token',
  refresh_token: 'refresh-token',
  expiry_date: Date.now() + 60000, // 1 minute left
});

// Token automatically refreshed before playlist fetch
const playlist = await client.getPlaylist('PLxxx');
```

### 2. Thread-Safe Operations

Multiple concurrent API calls share the same refresh operation to prevent race conditions:

```typescript
// All three calls will share the same token refresh
const [playlist1, playlist2, playlist3] = await Promise.all([
  client.getPlaylist('PL1'),
  client.getPlaylist('PL2'),
  client.getPlaylist('PL3'),
]);
```

### 3. Token Expiration Detection

The system checks token expiration in three ways:
1. **Proactive**: Before each API call
2. **Buffer-based**: Refresh 5 minutes before actual expiry
3. **Reactive**: Handle 401 errors with automatic retry

### 4. Secure Credential Storage

- CLI tokens stored in `~/.yt-sync-tokens.json` with 0600 permissions
- OAuth refresh tokens encrypted at rest (future enhancement)
- Never log sensitive token values

## Usage

### Backend API Integration

```typescript
import { getYouTubeClient } from './api/client';

// Initialize client
const client = getYouTubeClient();

// Set credentials (typically from database)
client.setCredentials({
  access_token: user.youtubeAccessToken,
  refresh_token: user.youtubeRefreshToken,
  expiry_date: user.youtubeTokenExpiry,
});

// Tokens automatically refreshed before API calls
const playlists = await client.getPlaylist('PLxxx');

// Check if token needs refresh
if (client.needsTokenRefresh()) {
  console.log('Token will expire soon');
}

// Get valid token explicitly
const validToken = await client.getValidAccessToken();
```

### CLI Integration

```typescript
import { getTokenStorage } from './cli/token-storage';
import { getYouTubeClient } from './api/client';

const storage = getTokenStorage();
const client = getYouTubeClient();

// Load stored tokens
const tokens = await storage.loadTokens();

if (!tokens) {
  console.log('Please login first');
  return;
}

// Check if expired
if (storage.isExpired(tokens)) {
  console.log('Token expired, please login again');
  return;
}

// Set credentials with expiry date
client.setCredentials({
  access_token: tokens.accessToken,
  refresh_token: tokens.refreshToken,
  expiry_date: tokens.expiresAt,
});

// Tokens automatically refreshed
const playlist = await client.getPlaylist('PLxxx');

// Get updated tokens after refresh
const updatedCredentials = client.getCredentials();
if (updatedCredentials) {
  await storage.updateAccessToken(
    updatedCredentials.access_token,
    updatedCredentials.refresh_token,
    (updatedCredentials.expiry_date - Date.now()) / 1000
  );
}
```

### TokenManager Direct Usage

```typescript
import { getTokenManager } from './modules/auth/token-manager';
import { OAuth2Client } from 'google-auth-library';

// Initialize TokenManager
const tokenManager = getTokenManager({
  refreshBuffer: 5 * 60 * 1000, // 5 minutes
  autoRefresh: true,
  onTokenRefresh: async (credentials) => {
    // Save new tokens to database
    await saveToDatabase(credentials);
  },
  onRefreshError: async (error) => {
    // Handle refresh failure (e.g., refresh token expired)
    console.error('Token refresh failed:', error);
  },
});

// Initialize with OAuth client and credentials
const oauth2Client = new OAuth2Client(clientId, clientSecret, redirectUri);
tokenManager.initialize(oauth2Client, {
  access_token: 'access-token',
  refresh_token: 'refresh-token',
  expiry_date: Date.now() + 3600000,
});

// Check token validity
const validation = tokenManager.validateToken();
console.log('Is valid:', validation.isValid);
console.log('Needs refresh:', validation.needsRefresh);
console.log('Time until expiry:', validation.timeUntilExpiry);

// Get valid token (automatically refreshes if needed)
const validToken = await tokenManager.getValidToken();

// Force refresh
await tokenManager.refreshToken();

// Get current credentials
const credentials = tokenManager.getCredentials();
```

## Configuration

### TokenManager Configuration

```typescript
interface TokenManagerConfig {
  /**
   * Time buffer before token expiration to trigger refresh (milliseconds)
   * Default: 5 minutes (300000 ms)
   */
  refreshBuffer?: number;

  /**
   * Enable automatic token refresh
   * Default: true
   */
  autoRefresh?: boolean;

  /**
   * Callback when tokens are refreshed
   */
  onTokenRefresh?: (credentials: OAuthCredentials) => void | Promise<void>;

  /**
   * Callback when refresh fails (e.g., refresh token expired)
   */
  onRefreshError?: (error: Error) => void | Promise<void>;
}
```

### Example: Custom Configuration

```typescript
const tokenManager = getTokenManager({
  refreshBuffer: 10 * 60 * 1000, // 10 minutes before expiry
  autoRefresh: true,
  onTokenRefresh: async (credentials) => {
    // Save to database
    await db.user.update({
      where: { id: userId },
      data: {
        youtubeAccessToken: credentials.access_token,
        youtubeRefreshToken: credentials.refresh_token,
        youtubeTokenExpiry: credentials.expiry_date,
      },
    });
  },
  onRefreshError: async (error) => {
    // Notify user to re-authenticate
    await notifyUser('Please re-authenticate with YouTube');
  },
});
```

## Error Handling

### Token Refresh Errors

```typescript
try {
  await tokenManager.refreshToken();
} catch (error) {
  if (error instanceof InvalidCredentialsError) {
    if (error.details?.reason === 'Refresh token expired or revoked') {
      // Trigger re-authentication flow
      console.log('Please login again');
    } else {
      // Other credential errors (network, etc.)
      console.error('Failed to refresh token:', error.message);
    }
  }
}
```

### API Call Errors

The YouTube client automatically handles 401 errors:

```typescript
// Automatic retry on 401 with token refresh
try {
  const playlist = await client.getPlaylist('PLxxx');
} catch (error) {
  if (error instanceof AuthenticationError) {
    // After automatic retry failed
    console.error('Authentication failed after token refresh');
  }
}
```

## Token Lifecycle

```
1. Initial Authentication
   ↓
2. Store tokens (access + refresh + expiry)
   ↓
3. Use access token for API calls
   ↓
4. Check expiration before each call
   ↓ (if expiring soon)
5. Refresh using refresh token
   ↓
6. Update stored tokens
   ↓
7. Use new access token
   ↓
   (repeat from step 3)

If refresh fails (refresh token expired):
   → Trigger re-authentication
```

## Testing

### Unit Tests

Run TokenManager unit tests:

```bash
npm test tests/unit/modules/token-manager.test.ts
```

Test coverage includes:
- Token expiration detection
- Automatic refresh logic
- Thread-safe concurrent refresh
- Error handling
- Configuration management
- Callbacks

### Integration Tests

Example test for automatic refresh:

```typescript
describe('Automatic Token Refresh', () => {
  it('should refresh token before API call', async () => {
    const client = new YouTubeClient();

    // Set credentials expiring in 1 minute
    client.setCredentials({
      access_token: 'old-token',
      refresh_token: 'refresh-token',
      expiry_date: Date.now() + 60000,
    });

    // Mock refresh to return new token
    mockRefresh('new-token');

    // API call should trigger refresh
    await client.getPlaylist('PLxxx');

    // Verify new token used
    expect(usedToken).toBe('new-token');
  });
});
```

## Performance Considerations

### Token Refresh Overhead

- **First API call after expiry**: +200-500ms (one refresh request)
- **Subsequent API calls**: No overhead (cached valid token)
- **Concurrent API calls**: Shared refresh operation (no duplicate refreshes)

### Optimization Strategies

1. **Proactive Refresh**: Refresh 5 minutes before expiry (reduces chance of expired token during API call)
2. **Thread-Safe Caching**: Single refresh operation for concurrent requests
3. **Retry with Backoff**: Handle transient network failures during refresh

## Security Best Practices

1. **Secure Storage**
   - Store refresh tokens encrypted in database
   - Use 0600 permissions for CLI token files
   - Never log access or refresh tokens

2. **Token Rotation**
   - Google may issue new refresh tokens during refresh
   - Always save updated refresh tokens

3. **Revocation Handling**
   - Detect refresh token expiration/revocation
   - Trigger user re-authentication flow
   - Clear invalid tokens from storage

4. **Network Security**
   - Use HTTPS for all OAuth flows
   - Validate SSL certificates
   - Implement request timeout (30s)

## Troubleshooting

### Common Issues

#### 1. "Refresh token expired or revoked"

**Cause**: User revoked access or token expired (typically after 6 months of inactivity)

**Solution**: Trigger re-authentication flow

```typescript
tokenManager.updateConfig({
  onRefreshError: async (error) => {
    if (error.message.includes('expired or revoked')) {
      await promptUserReauth();
    }
  },
});
```

#### 2. "Token refresh failed: Network error"

**Cause**: Transient network failure

**Solution**: Implement retry with exponential backoff (already built into `retry` utility)

#### 3. "OAuth2Client not initialized"

**Cause**: TokenManager used before initialization

**Solution**: Always call `initialize()` before using TokenManager:

```typescript
tokenManager.initialize(oauth2Client, credentials);
```

#### 4. Concurrent refresh deadlock

**Cause**: Multiple processes trying to refresh simultaneously

**Solution**: TokenManager handles this automatically with promise caching

## Future Enhancements

1. **Token Blacklist**: Track revoked refresh tokens in Redis
2. **Refresh Token Rotation**: Implement refresh token rotation for enhanced security
3. **Multi-User Support**: Manage tokens for multiple YouTube accounts
4. **Metric Tracking**: Monitor token refresh frequency and failures
5. **Automatic Re-authentication**: Seamless browser-based re-auth when refresh tokens expire

## References

- [Google OAuth 2.0 Documentation](https://developers.google.com/identity/protocols/oauth2)
- [YouTube Data API Authentication](https://developers.google.com/youtube/v3/guides/authentication)
- [OAuth 2.0 Token Refresh Flow](https://www.oauth.com/oauth2-servers/access-tokens/refreshing-access-tokens/)
