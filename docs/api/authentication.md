# Authentication Guide

The YouTube Playlist Sync API uses JWT (JSON Web Token) based authentication to secure endpoints and track user sessions.

## Overview

- **Authentication Method**: JWT Bearer tokens
- **Token Types**: Access tokens (short-lived) and refresh tokens (long-lived)
- **Security**: Bcrypt password hashing, secure token storage
- **Rate Limiting**: Strict limits on authentication endpoints

## Authentication Flow

```mermaid
sequenceDiagram
    participant Client
    participant API
    participant Database

    Client->>API: POST /auth/register
    API->>Database: Create user with hashed password
    Database-->>API: User created
    API-->>Client: 201 Created

    Client->>API: POST /auth/login
    API->>Database: Verify credentials
    Database-->>API: User verified
    API->>API: Generate JWT tokens
    API-->>Client: Access + Refresh tokens

    Client->>API: GET /playlists (with access token)
    API->>API: Verify token
    API-->>Client: 200 OK (data)

    Client->>API: POST /auth/refresh (when access token expires)
    API->>API: Verify refresh token
    API->>API: Generate new access token
    API-->>Client: New access token
```

## Endpoints

### 1. Register

Create a new user account.

**Endpoint**: `POST /api/v1/auth/register`

**Rate Limit**: 5 requests per minute

**Request Body**:
```json
{
  "email": "user@example.com",
  "password": "SecurePassword123!",
  "name": "John Doe"
}
```

**Password Requirements**:
- Minimum 8 characters
- At least one uppercase letter
- At least one lowercase letter
- At least one number
- At least one special character

**Response** (201 Created):
```json
{
  "user": {
    "id": "uuid-string",
    "email": "user@example.com",
    "name": "John Doe",
    "createdAt": "2023-12-31T12:00:00.000Z"
  },
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": 900
}
```

**Errors**:
- `400 VALIDATION_ERROR`: Invalid email or password format
- `409 RESOURCE_ALREADY_EXISTS`: Email already registered
- `429 RATE_LIMIT_EXCEEDED`: Too many registration attempts

**Example**:
```bash
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "SecurePassword123!",
    "name": "John Doe"
  }'
```

### 2. Login

Authenticate and receive JWT tokens.

**Endpoint**: `POST /api/v1/auth/login`

**Rate Limit**: 10 requests per minute

**Request Body**:
```json
{
  "email": "user@example.com",
  "password": "SecurePassword123!"
}
```

**Response** (200 OK):
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": 900,
  "user": {
    "id": "uuid-string",
    "email": "user@example.com",
    "name": "John Doe"
  }
}
```

**Errors**:
- `400 VALIDATION_ERROR`: Missing email or password
- `401 INVALID_CREDENTIALS`: Invalid email or password
- `429 RATE_LIMIT_EXCEEDED`: Too many login attempts

**Example**:
```bash
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "SecurePassword123!"
  }'
```

### 3. Refresh Token

Get a new access token using refresh token.

**Endpoint**: `POST /api/v1/auth/refresh`

**Rate Limit**: 20 requests per minute

**Request Body**:
```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Response** (200 OK):
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": 900
}
```

**Errors**:
- `400 VALIDATION_ERROR`: Missing refresh token
- `401 INVALID_TOKEN`: Invalid or expired refresh token
- `429 RATE_LIMIT_EXCEEDED`: Too many refresh requests

**Example**:
```bash
curl -X POST http://localhost:3000/api/v1/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{
    "refreshToken": "YOUR_REFRESH_TOKEN"
  }'
```

### 4. Logout

Invalidate current session tokens.

**Endpoint**: `POST /api/v1/auth/logout`

**Authentication**: Required (Bearer token)

**Request Headers**:
```
Authorization: Bearer YOUR_ACCESS_TOKEN
```

**Response** (200 OK):
```json
{
  "message": "Logged out successfully"
}
```

**Errors**:
- `401 UNAUTHORIZED`: Missing or invalid access token

**Example**:
```bash
curl -X POST http://localhost:3000/api/v1/auth/logout \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

## Token Details

### Access Token

- **Purpose**: Authenticate API requests
- **Lifetime**: 15 minutes (900 seconds)
- **Storage**: Client-side (memory or secure storage)
- **Usage**: Include in `Authorization` header as Bearer token

**Payload**:
```json
{
  "userId": "uuid-string",
  "email": "user@example.com",
  "type": "access",
  "iat": 1640995200,
  "exp": 1640996100
}
```

### Refresh Token

- **Purpose**: Obtain new access tokens
- **Lifetime**: 7 days (604800 seconds)
- **Storage**: Secure client-side storage only
- **Usage**: Send to `/auth/refresh` endpoint

**Payload**:
```json
{
  "userId": "uuid-string",
  "type": "refresh",
  "iat": 1640995200,
  "exp": 1641600000
}
```

## Using Tokens

### Include in Request Headers

All protected endpoints require the access token in the `Authorization` header:

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### Example Request

```bash
curl -X GET http://localhost:3000/api/v1/playlists \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

### Token Refresh Strategy

Implement automatic token refresh in your client:

```javascript
async function apiRequest(url, options = {}) {
  let accessToken = localStorage.getItem('accessToken');

  // Add token to request
  options.headers = {
    ...options.headers,
    'Authorization': `Bearer ${accessToken}`
  };

  let response = await fetch(url, options);

  // If token expired, refresh and retry
  if (response.status === 401) {
    const refreshToken = localStorage.getItem('refreshToken');
    const refreshResponse = await fetch('/api/v1/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken })
    });

    if (refreshResponse.ok) {
      const { accessToken: newToken } = await refreshResponse.json();
      localStorage.setItem('accessToken', newToken);

      // Retry original request
      options.headers['Authorization'] = `Bearer ${newToken}`;
      response = await fetch(url, options);
    }
  }

  return response;
}
```

## Security Best Practices

### Password Security

1. **Strong Passwords**: Enforce minimum requirements
2. **Hashing**: Use bcrypt with salt rounds (configured in environment)
3. **Never Log**: Don't log passwords or tokens
4. **Secure Transmission**: Always use HTTPS in production

### Token Security

1. **Short-Lived Access Tokens**: 15-minute expiration reduces risk
2. **Secure Storage**:
   - Never store in localStorage (XSS vulnerable)
   - Use httpOnly cookies or secure in-memory storage
   - For refresh tokens, use secure httpOnly cookies
3. **Token Rotation**: Refresh tokens should be single-use (rotate on refresh)
4. **Invalidation**: Implement logout to invalidate tokens

### Rate Limiting

Authentication endpoints have strict rate limits:

- **Register**: 5 requests/minute
- **Login**: 10 requests/minute
- **Refresh**: 20 requests/minute

This prevents:
- Brute force attacks
- Credential stuffing
- Account enumeration

## Error Handling

### Common Authentication Errors

#### 401 Unauthorized

Token is missing, invalid, or expired:

```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Authentication required",
    "timestamp": "2023-12-31T12:00:00.000Z",
    "path": "/api/v1/playlists"
  }
}
```

**Solution**: Include valid access token in `Authorization` header

#### 401 Invalid Token

Token signature is invalid or corrupted:

```json
{
  "error": {
    "code": "INVALID_TOKEN",
    "message": "Invalid authentication token",
    "timestamp": "2023-12-31T12:00:00.000Z",
    "path": "/api/v1/playlists"
  }
}
```

**Solution**: Login again to get new tokens

#### 401 Token Expired

Access token has expired:

```json
{
  "error": {
    "code": "TOKEN_EXPIRED",
    "message": "Authentication token has expired",
    "timestamp": "2023-12-31T12:00:00.000Z",
    "path": "/api/v1/playlists"
  }
}
```

**Solution**: Use refresh token to get new access token

#### 401 Invalid Credentials

Login credentials are incorrect:

```json
{
  "error": {
    "code": "INVALID_CREDENTIALS",
    "message": "Invalid email or password",
    "timestamp": "2023-12-31T12:00:00.000Z",
    "path": "/api/v1/auth/login"
  }
}
```

**Solution**: Check email and password, or reset password

## Environment Variables

Configure authentication settings via environment variables:

```bash
# JWT Configuration
JWT_SECRET=your-super-secret-jwt-key-change-in-production
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d

# Password Hashing
BCRYPT_SALT_ROUNDS=10

# Rate Limiting
RATE_LIMIT_AUTH_LOGIN=10
RATE_LIMIT_AUTH_REGISTER=5
RATE_LIMIT_AUTH_REFRESH=20
```

## Testing Authentication

### Example Test Flow

```bash
# 1. Register
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "Test123!@#",
    "name": "Test User"
  }'

# 2. Login
LOGIN_RESPONSE=$(curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "Test123!@#"
  }')

# 3. Extract token
ACCESS_TOKEN=$(echo $LOGIN_RESPONSE | jq -r '.accessToken')

# 4. Use token
curl -X GET http://localhost:3000/api/v1/playlists \
  -H "Authorization: Bearer $ACCESS_TOKEN"

# 5. Refresh token
REFRESH_TOKEN=$(echo $LOGIN_RESPONSE | jq -r '.refreshToken')
curl -X POST http://localhost:3000/api/v1/auth/refresh \
  -H "Content-Type: application/json" \
  -d "{\"refreshToken\": \"$REFRESH_TOKEN\"}"
```

## FAQs

### Q: How long are tokens valid?
A: Access tokens expire after 15 minutes, refresh tokens after 7 days.

### Q: Can I extend token expiration?
A: Configure via `JWT_ACCESS_EXPIRY` and `JWT_REFRESH_EXPIRY` environment variables.

### Q: What happens if my refresh token expires?
A: You must login again to get new tokens.

### Q: How do I implement "Remember Me"?
A: Extend refresh token lifetime via environment configuration.

### Q: Are tokens invalidated on logout?
A: Yes, logout invalidates both access and refresh tokens.

### Q: Can I use API keys instead of JWT?
A: The API supports API key authentication for service-to-service communication (see `X-API-Key` header).
