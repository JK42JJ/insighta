---
name: sync-youtube-conventions
description: sync-youtube-playlists 프로젝트 코딩 컨벤션 및 아키텍처 가이드. 모든 코드 작업 시 자동 로드
---

# Sync YouTube Playlists Coding Conventions

## Project Structure
src/
├── adapters/           # Data source adapters (YouTube only)
│   ├── data-source-adapter.ts
│   ├── youtube-adapter.ts
│   ├── adapter-factory.ts
│   └── adapter-registry.ts
├── api/                # Fastify REST API routes
│   ├── routes/         # Route handlers
│   ├── schemas/        # Zod validation schemas
│   └── server.ts       # Fastify server setup
├── cli/                # Commander CLI interface
│   ├── index.ts
│   ├── commands/       # CLI command handlers
│   ├── api-client.ts   # API client for CLI
│   └── token-storage.ts
├── modules/            # Core business logic modules
│   ├── analytics/      # Usage analytics
│   ├── caption/        # YouTube caption handling
│   ├── database/       # Database operations
│   ├── note/           # User notes management
│   ├── playlist/       # Playlist sync logic
│   ├── quota/          # API quota management
│   ├── scheduler/      # Sync scheduling
│   ├── summarization/  # AI video summarization
│   ├── sync/           # Sync orchestration
│   └── video/          # Video metadata
├── config/             # Configuration management
├── types/              # TypeScript type definitions
└── utils/              # Shared utilities

prisma/
├── schema.prisma       # Database schema
└── migrations/         # Database migrations

## TypeScript Style
- Strict mode enabled
- Use `interface` for object shapes
- Use `type` for unions and intersections
- Explicit return types for functions
- No `any` - use `unknown` if needed

## Naming Conventions
- Files: kebab-case (user-service.ts)
- Classes: PascalCase (UserService)
- Functions/Variables: camelCase (getUserById)
- Constants: SCREAMING_SNAKE_CASE (MAX_RETRY_COUNT)
- Types/Interfaces: PascalCase with prefix (IUserService, TUserResponse)

## Error Handling
```typescript
// Custom error classes in src/errors/
class AppError extends Error {
  constructor(
    public code: string,
    public message: string,
    public statusCode: number = 500
  ) {
    super(message);
  }
}
```

## API Response Format (Fastify)
```typescript
// Success
{ success: true, data: T }

// Error (handled by Fastify error handler)
{ success: false, error: { code: string, message: string, statusCode: number } }

// Fastify route example
app.get('/api/playlists', async (request, reply) => {
  const playlists = await playlistService.getAll();
  return reply.send({ success: true, data: playlists });
});
```

## Tech Stack
- **Framework**: Fastify (with plugins: @fastify/jwt, @fastify/cors, @fastify/swagger)
- **Database**: Prisma ORM + PostgreSQL (SQLite for dev)
- **CLI**: Commander.js
- **Auth**: JWT with @fastify/jwt
- **Validation**: Zod
- **Testing**: Jest (with ts-jest)
- **API**: YouTube Data API v3 (googleapis)
- **AI**: OpenAI, Google Gemini (Phase 2)
- **Scheduling**: node-cron

## Git Commit Format
<type>(<scope>): <subject>
Types: feat, fix, docs, style, refactor, test, chore
Scope: adapter, api, cli, module, sync, etc.

Examples:
- feat(playlist): add incremental sync support
- fix(quota): handle API quota exceeded error
- test(video): add metadata collection tests
