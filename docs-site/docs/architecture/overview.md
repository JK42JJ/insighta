# Architecture Overview

TubeArchive is built with a modular architecture that separates concerns and enables easy extension.

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Client Layer                              │
├─────────────────┬─────────────────┬─────────────────────────────┤
│   REST API      │      CLI        │    Future: Web UI           │
│   (Fastify)     │  (Commander)    │    (React/Vue)              │
├─────────────────┴─────────────────┴─────────────────────────────┤
│                     Application Layer                            │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌──────────────┐  │
│  │  Playlist  │ │   Video    │ │    Sync    │ │   Analytics  │  │
│  │  Manager   │ │  Manager   │ │   Engine   │ │   Tracker    │  │
│  └────────────┘ └────────────┘ └────────────┘ └──────────────┘  │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌──────────────┐  │
│  │   Note     │ │  Caption   │ │ Summarizer │ │   Schedule   │  │
│  │  Manager   │ │ Extractor  │ │  (AI/LLM)  │ │   Manager    │  │
│  └────────────┘ └────────────┘ └────────────┘ └──────────────┘  │
├─────────────────────────────────────────────────────────────────┤
│                      Integration Layer                           │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐                   │
│  │  YouTube   │ │    AI      │ │   Cache    │                   │
│  │    API     │ │  Provider  │ │   Layer    │                   │
│  └────────────┘ └────────────┘ └────────────┘                   │
├─────────────────────────────────────────────────────────────────┤
│                        Data Layer                                │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                    Prisma ORM                               │ │
│  └────────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │              SQLite / PostgreSQL Database                   │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

## Layer Descriptions

### Client Layer

The client layer provides multiple interfaces for interacting with TubeArchive:

- **REST API (Fastify)**: Full-featured HTTP API with OpenAPI documentation
- **CLI (Commander)**: Command-line interface for terminal workflows
- **Web UI (Future)**: Browser-based interface

### Application Layer

Core business logic organized into focused modules:

| Module | Responsibility |
|--------|---------------|
| PlaylistManager | CRUD operations for playlists |
| VideoManager | Video metadata and state management |
| SyncEngine | YouTube synchronization logic |
| AnalyticsTracker | Watch progress and statistics |
| NoteManager | User notes and annotations |
| CaptionExtractor | Caption retrieval and parsing |
| Summarizer | AI-powered video summaries |
| ScheduleManager | Automated sync scheduling |

### Integration Layer

External service integrations:

- **YouTube API**: OAuth 2.0 authentication, playlist/video data
- **AI Provider**: LLM integration for summarization (Gemini)
- **Cache Layer**: Response caching for API efficiency

### Data Layer

Persistent storage:

- **Prisma ORM**: Type-safe database access
- **SQLite**: Default development database
- **PostgreSQL**: Production-ready option

## Design Principles

### 1. Singleton Managers

All managers use the singleton pattern with lazy initialization:

```typescript
class VideoManager {
  private static instance: VideoManager;

  static getInstance(prisma: PrismaClient): VideoManager {
    if (!this.instance) {
      this.instance = new VideoManager(prisma);
    }
    return this.instance;
  }
}
```

### 2. Dependency Injection

Managers receive dependencies through constructors:

```typescript
// In route handler
const videoManager = VideoManager.getInstance(fastify.prisma);
const result = await videoManager.getById(videoId, userId);
```

### 3. Schema-First API Design

Dual schema approach:
- **Zod schemas**: Runtime validation
- **Fastify schemas**: OpenAPI generation

```typescript
// Zod for validation
export const createPlaylistSchema = z.object({
  url: z.string().url(),
});

// Fastify for OpenAPI
export const createPlaylistFastifySchema = {
  body: { $ref: 'createPlaylist#' },
  response: { 201: { $ref: 'playlistResponse#' } }
};
```

### 4. Error Handling

Consistent error responses across the API:

```typescript
interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: Record<string, any>;
  };
}
```

### 5. Transaction Safety

Database operations use transactions for consistency:

```typescript
await prisma.$transaction(async (tx) => {
  await tx.playlist.update({ ... });
  await tx.playlistItem.createMany({ ... });
});
```

## Request Flow

A typical API request flows through these layers:

```
Client Request
     │
     ▼
┌─────────────┐
│   Fastify   │ ← Route matching, authentication
│   Router    │
└─────────────┘
     │
     ▼
┌─────────────┐
│   Schema    │ ← Zod validation
│ Validation  │
└─────────────┘
     │
     ▼
┌─────────────┐
│   Route     │ ← Business logic coordination
│   Handler   │
└─────────────┘
     │
     ▼
┌─────────────┐
│   Manager   │ ← Domain-specific operations
│   Layer     │
└─────────────┘
     │
     ▼
┌─────────────┐
│   Prisma    │ ← Database queries
│    ORM      │
└─────────────┘
     │
     ▼
┌─────────────┐
│  Database   │ ← Persistent storage
└─────────────┘
```

## Security Architecture

### Authentication Flow

```
User Login
     │
     ▼
┌─────────────┐
│   Verify    │ ← bcrypt password comparison
│ Credentials │
└─────────────┘
     │
     ▼
┌─────────────┐
│   Issue     │ ← JWT access + refresh tokens
│   Tokens    │
└─────────────┘
     │
     ▼
┌─────────────┐
│   Client    │ ← Bearer token in requests
│  Storage    │
└─────────────┘
```

### Authorization

- JWT-based authentication for all protected routes
- User-scoped data access (users only see their own data)
- Rate limiting per user/IP

## Scalability Considerations

### Current Design (Single Instance)

- SQLite for simplicity
- In-memory rate limiting
- Single-process scheduling

### Production Scale

- PostgreSQL for concurrent access
- Redis for distributed rate limiting
- Separate worker processes for sync jobs
- Horizontal scaling with load balancer

## Next Steps

- [Database Schema](/docs/architecture/database) - Data model details
- [Modules](/docs/architecture/modules) - Module specifications
- [API Reference](/docs/api-reference/tubearchive-api) - Endpoint documentation
