<!--
README EDITING RULES — read before any edit. [CP490+ 2026-05-30]
WHY THIS EXISTS: 3+ prior public-surface violations. memory-only enforcement failed.
Full rationale + violation history + update path: docs/handoffs/readme-rewrite-cp490.md

NEVER include — each with WHY:

R1. Transcript-fetching tools (youtube-transcript-api / yt-dlp / "caption pipeline" / "transcript fetch")
    → WHY: voluntarily disclosing a ToS gray-zone hurts YouTube Data API review + quota-revocation risk
R2. Phrasing that implies "transcript stored" / "captions retained" / "caption ingest"
    → WHY: invites storage and copyright liability. API-review safe line = "metadata only"
R3. Mac Mini / Tailscale / claude -p / EC2 IP / instance id / .pem / SSH commands
    → WHY: production topology = attack surface. Zero value to reviewer, recon value to attacker
R4. Internal PR numbers / cost figures / user quotes
    → WHY: internal collaboration context. Zero value to README reader
R5. v4 LLM-arbiter framed as "production" / "shipped" — AND any paraphrase of the same claim
    → WHY: not in prod. False claim is caught the moment a reviewer opens the code
R6. Stack line on the first screen
    → WHY: reviewer's first impression becomes "another CRUD app". Stack must come after differentiation

POSITIONING: YouTube = "metadata only, transcript not stored"
v4 phrasing: "exploration" / "under measurement", never "production"

SELF-AUDIT: keyword match ❌, semantic ✅.
For each rule, brainstorm ≥3 paraphrases of the same forbidden meaning, then grep all of them.
Every feature name in Design decisions must be verified against code (path, env, deployment).

TO UPDATE THIS COMMENT: follow the update path in the handoff doc (§3).
When a WHY changes, update the handoff doc first, then sync this comment.
-->

# Insighta

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20.x-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)

A learning platform where **user goals curate YouTube**, not the algorithm.
Consumable streams (videos) accrete into a persistent knowledge graph
(Mandala-art 9×9 grid).

**Live**: [insighta.one](https://insighta.one)

## Why

Recommendation algorithms push whatever keeps users scrolling longest —
ads and clickbait get mixed in structurally. Insighta inverts the
direction: **the algorithm is subordinated to the user's goals**, and only
content the user intentionally saves, annotates, or revisits enters the
graph. Noise is filtered structurally by the user's own behavior, not by
an additional filter layer.

## How it's different

| Conventional feeds | Insighta |
|---|---|
| The algorithm **pulls** content for you | Your goals **push** content into your graph |
| Recommendations are ephemeral | The graph accumulates over time |
| Improvement = swap a better model | Improvement = the graph grows richer |
| Surface = feed (consumable) | Surface = mandala (persistent) |

Full vision: [docs/VISION.md](./docs/VISION.md)

## Design decisions

**Add Cards = LLM pick, not cosine** (`src/skills/plugins/video-discover/v5/`)
When a user requests cards, the backend fetches YouTube **metadata** in
parallel and a single LLM picker (default: Claude Haiku via OpenRouter)
selects videos that match the mandala cell. No cosine, no IKS heuristics —
the model decides directly. Model swap = one env line
(`LLM_PICKER_MODEL`). The pipeline handles metadata only; transcripts are
not stored.

**Service ≠ System domain separation** (`prisma/migrations/ontology/007_ontology_namespace_separation.sql`)
The ontology graph splits `service` (user-facing knowledge) from `system`
(developer-agent tooling) via a `domain` column on
`ontology.object_types` and `relation_types`. A cross-domain validation in
`src/modules/ontology/manager.ts` rejects edges between the two — user
data and developer-system data cannot mix.

**pgvector + Supabase Cloud**
Embeddings live in Postgres (`video_pool_embeddings`,
`mandala_embeddings`). No separate vector database; no separate operational
surface to run.

**v4 LLM-arbiter — exploration in progress**
A three-model arbiter (Haiku / Sonnet / Gemini) that compares and scores
candidates is under measurement: quality, cost, and latency. Not deployed
to production.

## Stack

React 18 / Fastify / TypeScript · Supabase Cloud (PostgreSQL + pgvector + Auth) · Redis · LLM via OpenRouter (Claude Haiku/Sonnet, Gemini, Qwen) · AWS EC2 + Docker + Nginx

## Quick Start

```bash
git clone https://github.com/JK42JJ/insighta.git
cd insighta
npm run install:all
cp .env.example .env  # fill in credentials
npx prisma generate && npx prisma db push
npm run dev:all       # API :3000 + Frontend :8081
```

API reference: `http://localhost:3000/api-reference`

## Deployment

`git push origin main` → GitHub Actions → CI (lint / typecheck / test / build) → Docker build → Prisma migrate → deploy.

## Docs

- [Vision](./docs/VISION.md) — product philosophy, persona model, trust graph
- [Architecture](./docs/architecture/) — system topology
- [SSOT](./docs/SSOT.md) — decision tracking
- [README rewrite rationale](./docs/handoffs/readme-rewrite-cp490.md) — editing rules SSOT for this README

## License

[MIT](./LICENSE)
