---
name: api-design-patterns
description: Fastify REST API 설계 패턴 및 YouTube Playlist API 구조
---

# API Design Patterns (Fastify)

## Core API Endpoints
```
GET    /api/playlists              # List all synced playlists
POST   /api/playlists              # Import new playlist
GET    /api/playlists/:id          # Get playlist details
PATCH  /api/playlists/:id          # Update playlist settings
DELETE /api/playlists/:id          # Remove playlist
POST   /api/playlists/:id/sync     # Trigger manual sync

GET    /api/videos                 # List videos (with filters)
GET    /api/videos/:id             # Get video details
PATCH  /api/videos/:id/state       # Update watch state/notes

GET    /api/sync/status            # Get sync status
POST   /api/sync/schedule          # Configure sync schedule
GET    /api/sync/history           # Get sync history

POST   /api/auth/login             # User authentication
POST   /api/auth/refresh           # Refresh access token
POST   /api/auth/logout            # Logout
```

## Fastify Route Structure
```typescript
// src/api/routes/playlist.routes.ts
import { FastifyInstance } from 'fastify';
import { PlaylistSchema } from '../schemas/playlist.schema';

export default async function playlistRoutes(app: FastifyInstance) {
  // GET /api/playlists
  app.get(
    '/playlists',
    {
      schema: {
        response: {
          200: PlaylistSchema.listResponse,
        },
      },
      onRequest: [app.authenticate], // JWT auth middleware
    },
    async (request, reply) => {
      const playlists = await playlistService.getAll(request.user.id);
      return reply.send({ success: true, data: playlists });
    }
  );

  // POST /api/playlists/:id/sync
  app.post(
    '/playlists/:id/sync',
    {
      schema: {
        params: PlaylistSchema.params,
        response: {
          200: PlaylistSchema.syncResponse,
        },
      },
      preHandler: app.authenticate,
    },
    async (request, reply) => {
      const { id } = request.params;
      const result = await syncService.syncPlaylist(id);
      return reply.send({ success: true, data: result });
    }
  );
}
```

## Fastify Plugins & Decorators
```typescript
// src/api/server.ts
import Fastify from 'fastify';
import fastifyJwt from '@fastify/jwt';
import fastifySwagger from '@fastify/swagger';
import fastifyCors from '@fastify/cors';

const app = Fastify({ logger: true });

// JWT authentication
await app.register(fastifyJwt, {
  secret: process.env.JWT_SECRET!,
});

// Decorate app with authenticate method
app.decorate('authenticate', async (request, reply) => {
  try {
    await request.jwtVerify();
  } catch (err) {
    reply.send(err);
  }
});

// CORS
await app.register(fastifyCors, {
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
});

// Swagger documentation
await app.register(fastifySwagger, {
  openapi: {
    info: {
      title: 'YouTube Playlist Sync API',
      version: '1.0.0',
    },
  },
});
```

## Authentication with @fastify/jwt
```typescript
// Login route
app.post('/auth/login', async (request, reply) => {
  const { email, password } = request.body;
  const user = await authService.validateCredentials(email, password);

  const token = app.jwt.sign(
    { userId: user.id, email: user.email },
    { expiresIn: '15m' }
  );

  const refreshToken = app.jwt.sign(
    { userId: user.id },
    { expiresIn: '7d' }
  );

  return reply.send({
    success: true,
    data: { token, refreshToken, user },
  });
});

// Protected route with authentication
app.get('/api/playlists', {
  onRequest: [app.authenticate],
}, async (request, reply) => {
  // request.user is available after authentication
  const userId = request.user.userId;
  // ...
});
```

## Zod Schema Validation
```typescript
// src/api/schemas/playlist.schema.ts
import { z } from 'zod';

export const PlaylistSchema = {
  create: z.object({
    url: z.string().url(),
    syncInterval: z.number().optional(),
  }),

  params: z.object({
    id: z.string().uuid(),
  }),

  listResponse: z.object({
    success: z.literal(true),
    data: z.array(z.object({
      id: z.string(),
      youtubeId: z.string(),
      title: z.string(),
      videoCount: z.number(),
      lastSyncedAt: z.date().nullable(),
    })),
  }),
};

// Use in route
app.post('/playlists', {
  schema: {
    body: PlaylistSchema.create,
    response: {
      200: PlaylistSchema.listResponse,
    },
  },
}, async (request, reply) => {
  const validated = PlaylistSchema.create.parse(request.body);
  // ...
});
```

## Error Handling
```typescript
// Global error handler
app.setErrorHandler((error, request, reply) => {
  const statusCode = error.statusCode || 500;

  reply.status(statusCode).send({
    success: false,
    error: {
      code: error.code || 'INTERNAL_ERROR',
      message: error.message,
      statusCode,
    },
  });
});

// Custom error classes
class ApiError extends Error {
  constructor(
    public code: string,
    public message: string,
    public statusCode: number = 500
  ) {
    super(message);
  }
}

// Usage in service
if (!playlist) {
  throw new ApiError('PLAYLIST_NOT_FOUND', 'Playlist not found', 404);
}
```

## Rate Limiting (Future)
```typescript
import rateLimit from '@fastify/rate-limit';

await app.register(rateLimit, {
  max: 100,
  timeWindow: '1 minute',
  errorResponseBuilder: (request, context) => ({
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests',
      statusCode: 429,
      retryAfter: context.ttl,
    },
  }),
});
```
