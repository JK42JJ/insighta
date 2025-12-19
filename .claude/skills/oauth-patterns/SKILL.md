---
name: oauth-patterns
description: OAuth 2.0 인증 플로우 구현 패턴
---

# OAuth 2.0 Patterns

## Supported Providers
- Google (YouTube, Drive)
- Notion
- LinkedIn

## Flow Implementation
```typescript
// 1. Generate auth URL with state
const state = crypto.randomUUID();
const authUrl = provider.getAuthUrl({ state, scope });

// 2. Handle callback
const { code, state } = req.query;
verifyState(state);
const tokens = await provider.exchangeCode(code);

// 3. Store tokens securely
await storeEncryptedTokens(userId, provider, tokens);

// 4. Refresh tokens before expiry
const freshTokens = await provider.refreshToken(refreshToken);
```

## Security Requirements
- Use PKCE for public clients
- Validate state parameter
- Store tokens encrypted (AES-256)
- Implement token refresh before expiry
