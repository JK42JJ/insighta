# Insighta

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20.x-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)

> Personal knowledge management platform — sync YouTube playlists, take notes, and manage your learning.

**Live**: [insighta.one](https://insighta.one)

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18.3, Vite, Tailwind CSS, Radix UI, dnd-kit |
| Backend | Node.js 20, Fastify, TypeScript |
| Database | PostgreSQL (Supabase Cloud), Prisma ORM |
| Auth | Supabase Auth (Google OAuth 2.0) |
| AI | Google Gemini |
| Edge Functions | Supabase Edge Functions (Deno) |
| Infra | AWS EC2, Docker, Nginx, GitHub Actions CI/CD |

## Quick Start

### Prerequisites

- Node.js 20.x
- npm >= 9.0.0

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

| Service | Dev URL |
|---------|---------|
| API | http://localhost:3000 |
| Frontend | http://localhost:5173 |
| API Docs (Scalar) | http://localhost:3000/api-reference |
| API Docs (Swagger) | http://localhost:3000/documentation |

### Environment Variables

Copy `.env.example` and fill in the required values:

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | Supabase Transaction Pooler URL (port 6543) |
| `DIRECT_URL` | Yes | Supabase Session Pooler URL (port 5432) |
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_ANON_KEY` | Yes | Supabase anon public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service_role key |
| `SUPABASE_JWT_SECRET` | Yes | Supabase JWT Secret (HS256) |
| `YOUTUBE_API_KEY` | Yes | YouTube Data API v3 key |
| `YOUTUBE_CLIENT_ID` | Yes | Google OAuth 2.0 Client ID |
| `YOUTUBE_CLIENT_SECRET` | Yes | Google OAuth 2.0 Client Secret |
| `ENCRYPTION_SECRET` | Yes | 64-character hex string |
| `GEMINI_API_KEY` | No | For AI summary generation |

## Project Structure

```
insighta/
├── src/                    # Backend (Fastify API)
│   ├── api/                #   REST API routes
│   ├── adapters/           #   Data source adapters
│   ├── modules/            #   Business logic
│   ├── cli/                #   CLI interface
│   └── config/             #   Configuration
├── frontend/               # React frontend (FSD architecture)
│   └── src/
│       ├── app/            #   App shell, providers, router
│       ├── entities/       #   Domain entities
│       ├── features/       #   Feature modules
│       ├── pages/          #   Page components
│       ├── shared/         #   Shared UI, utils, hooks
│       └── widgets/        #   Composite UI blocks
├── frontend-old/           # Archived v1 frontend (do not modify)
├── prisma/                 # Database schema & migrations
├── supabase/               # Edge Functions
│   └── functions/
│       ├── fetch-url-metadata/
│       ├── local-cards/
│       ├── youtube-auth/
│       └── youtube-sync/
├── deploy/                 # Nginx config, deployment files
├── docker/                 # Dockerfiles
├── terraform/              # Infrastructure as Code
├── tests/                  # Test suites
├── scripts/                # Dev & ops scripts
└── docs/                   # Documentation
```

## Deployment

Deployment is fully automated via GitHub Actions.

```
git push origin master:main
```

This triggers the CI/CD pipeline:

1. **CI** — lint, typecheck, test, build (parallel)
2. **Docker Build** — build & push images to GHCR
3. **DB Migration** — `prisma migrate deploy`
4. **Deploy** — SSH into EC2, pull images, restart containers

### Production Architecture

```
[insighta.one] → [EC2 t2.micro]
                      ├── Nginx (SSL, :443/:80)
                      ├── Docker: API (Fastify, :3000)
                      └── Docker: Frontend (Nginx, :8081)
                              ↓
                      [Supabase Cloud]
                        ├── PostgreSQL
                        ├── Auth (Google OAuth)
                        └── Edge Functions
```

### GitHub Actions Workflows

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `ci.yml` | Push to any branch | Lint, typecheck, test, build |
| `deploy.yml` | Push to `main` | Build images, migrate DB, deploy to EC2 |
| `rollback.yml` | Manual | Rollback to previous or specific version |
| `backup.yml` | Schedule / Manual | Database backup |
| `e2e.yml` | Manual | End-to-end tests (Playwright) |
| `terraform.yml` | Manual | Infrastructure provisioning |

## Documentation

- [Deployment Guide](./docs/DEPLOYMENT.md)
- [Operations Manual](./docs/operations-manual.md)
- [Architecture](./docs/spec/ARCHITECTURE.md)
- [OAuth Setup Guide](./docs/guides/SETUP_OAUTH.md)

## License

[MIT](./LICENSE)
