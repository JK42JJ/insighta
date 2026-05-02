# Insighta

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20.x-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)

Mandala-Art 기반 학습 자산 플랫폼. YouTube 콘텐츠를 큐레이션·구조화·주석해서 개인 지식 그래프로 축적.

**Live**: [insighta.one](https://insighta.one)

## Stack

React 18 / Fastify / TypeScript · Supabase Cloud (PostgreSQL + pgvector + Auth + Edge Functions) · Redis · Anthropic Claude / Google Gemini / OpenRouter · AWS EC2 + Docker + Nginx · Mac Mini worker (yt-dlp + claude -p, Tailscale-bound)

자세한 토폴로지: [Wiki Home](https://github.com/JK42JJ/insighta/wiki) · [docs/architecture/](./docs/architecture/)

## Quick Start

```bash
git clone https://github.com/JK42JJ/insighta.git
cd insighta
npm run install:all
cp .env.example .env  # fill in credentials
npx prisma generate && npx prisma db push
npm run dev:all       # API :3000 + Frontend :8081
```

API docs: `http://localhost:3000/api-reference`

## Deployment

`git push origin main` → GitHub Actions → CI (lint/typecheck/test/build) → Docker build → Prisma migrate → SSH deploy to EC2.

## Docs

- [Operations Manual](./docs/operations-manual.md)
- [Architecture](./docs/architecture/)
- [Boot Sequence](./docs/BOOT_SEQUENCE.md)
- [SSOT](./docs/SSOT.md)

## License

[MIT](./LICENSE)
