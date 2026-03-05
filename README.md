# Insighta

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20.x-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)

**Personal knowledge management platform powered by YouTube playlists.** Sync playlists, extract captions, generate AI summaries, take timestamped notes, and track your learning progress.

**Live**: [insighta.one](https://insighta.one)

## Features

- **Playlist Sync** — Import YouTube playlists and keep them in sync automatically
- **AI Summaries** — Generate multi-level summaries from video captions (Gemini)
- **Timestamped Notes** — Take markdown notes tied to specific video timestamps
- **Learning Analytics** — Track watch progress, completion rates, and study streaks
- **REST API** — Full-featured Fastify API with JWT auth, OpenAPI docs, and rate limiting
- **React Frontend** — Modern UI with shadcn/ui, React Query, and drag-and-drop
- **CLI** — Command-line interface for all operations

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js, Fastify, TypeScript |
| Frontend | React 18, Vite, Tailwind CSS, shadcn/ui |
| Database | SQLite (dev) / PostgreSQL (prod), Prisma ORM |
| AI | Google Gemini, OpenAI GPT-4 |
| Auth | JWT (access + refresh tokens), Google OAuth 2.0 |
| Infra | EC2, Docker, Nginx, Supabase Edge Functions |

## Quick Start

### Prerequisites

- Node.js 20.x
- npm >= 9.0.0
- YouTube Data API v3 credentials ([setup guide](./docs/guides/SETUP_OAUTH.md))

### Installation

```bash
git clone https://github.com/JK42JJ/insighta.git
cd insighta

# Install all dependencies (backend + frontend)
npm run install:all

# Configure environment
cp .env.example .env
# Edit .env with your API credentials

# Set up database
npx prisma generate
npx prisma db push
```

### Development

```bash
# Run backend + frontend together
npm run dev:all

# Backend API only (http://localhost:3000)
npm run api:dev

# Frontend only (http://localhost:5173)
npm run dev:frontend
```

### Build & Deploy

```bash
# Build everything
npm run build:all

# Docker
npm run docker:build
npm run docker:up
```

## Project Structure

```
insighta/
├── src/                  # Backend source
│   ├── api/              # Fastify REST API
│   ├── adapters/         # Data source adapters
│   ├── modules/          # Business logic
│   │   ├── playlist/     # Playlist management
│   │   ├── video/        # Video metadata
│   │   ├── sync/         # Sync engine
│   │   ├── caption/      # Caption extraction
│   │   ├── summarization/# AI summaries
│   │   ├── note/         # Timestamped notes
│   │   └── analytics/    # Learning analytics
│   ├── cli/              # CLI interface
│   └── config/           # Configuration
├── frontend/             # React frontend
│   └── src/
│       ├── components/   # UI components
│       ├── hooks/        # React Query hooks
│       ├── pages/        # Page components
│       └── lib/          # API client
├── prisma/               # Database schema
├── tests/                # Test suites
├── docs/                 # Documentation
└── scripts/              # Dev scripts
```

## API Reference

When running locally, API docs are available at:
- **Scalar UI**: http://localhost:3000/api-reference
- **Swagger UI**: http://localhost:3000/documentation

### Key Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/auth/register` | Register user |
| POST | `/api/v1/auth/login` | Login |
| POST | `/api/v1/playlists/import` | Import playlist |
| GET | `/api/v1/playlists` | List playlists |
| POST | `/api/v1/playlists/:id/sync` | Sync playlist |
| GET | `/api/v1/videos` | List videos |
| POST | `/api/v1/videos/:id/summary` | Generate summary |

## CLI Usage

```bash
# Auth
npm run cli -- user-login
npm run cli -- auth           # YouTube OAuth

# Playlists
npm run cli -- sync <playlist-url>
npm run cli -- list

# Captions & Summaries
npm run cli -- caption-download <video-id> -l ko
npm run cli -- summarize <video-id> -l medium

# Notes
npm run cli -- note-add <video-id> 150 "Important concept" -t "tag1,tag2"

# Analytics
npm run cli -- analytics-dashboard
```

## Testing

```bash
npm test                # All tests
npm run test:unit       # Unit tests
npm run test:integration # Integration tests
npm run test:cov        # Coverage report
```

## Documentation

- [OAuth Setup Guide](./docs/guides/SETUP_OAUTH.md)
- [Operations Manual](./docs/OPERATIONS.md)
- [Architecture](./docs/spec/ARCHITECTURE.md)
- [Changelog](./CHANGELOG.md)

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## License

[MIT](./LICENSE)
