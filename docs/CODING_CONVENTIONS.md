# Insighta Coding Conventions

> **SSOT**: This document is the single source of truth for all coding conventions.
> Distributed rules from CLAUDE.md, memory/feedback-*.md, CONTRIBUTING.md are consolidated here.
> Tool configs (.eslintrc.json, .prettierrc, tsconfig.json) remain authoritative for their domain.

**Last updated**: 2026-03-19

---

## Phase 1 — Code Style (Immediate)

### 1-1. Import Rules

**Order** (groups separated by blank line):

```typescript
// 1. External packages
import { FastifyInstance } from 'fastify';
import { z } from 'zod';

// 2. Framework-level (@prisma, @fastify, @tanstack)
import { user_mandalas } from '@prisma/client';

// 3. Internal modules via @/ alias
import { config } from '@/config';
import { logger } from '@/utils/logger';
import { createErrorResponse, ErrorCode } from '@/api/schemas/common.schema';

// 4. Relative imports (same directory or one level up only)
import type { MandalaLevelData } from './types';
```

**Path aliases** (tsconfig.json):

| Backend (`src/`) | Frontend (`frontend/src/`) |
|-------------------|---------------------------|
| `@/api/*` | `@/*` (all src) |
| `@/modules/*` | `@app/*`, `@pages/*` |
| `@/cli/*` | `@widgets/*`, `@features/*` |
| `@/config/*` | `@entities/*`, `@shared/*` |
| `@/utils/*` | |

```typescript
// ✅ Good
import { TIER_LIMITS } from '@/config/quota';
import { AuthProvider } from '@/features/auth/model/AuthContext';

// ❌ Bad — 3+ levels of relative path
import { TIER_LIMITS } from '../../../config/quota';
```

**Type-only imports**:

```typescript
// ✅ Good
import type { Tier } from '@/config/quota';
import { getMandalaLimit, type Tier } from '@/config/quota';

// ❌ Bad
import { Tier } from '@/config/quota'; // Tier is only used as a type
```

**Migration**: Convert deep relative imports to `@/` when modifying a file. No bulk conversion.

### 1-2. Naming

| Target | Convention | Example |
|--------|-----------|---------|
| Files (backend) | kebab-case | `rate-limit.ts`, `common.schema.ts` |
| Files (UI primitives) | kebab-case | `alert-dialog.tsx`, `scroll-area.tsx` |
| Files (React components) | PascalCase | `MandalaSelector.tsx`, `GraphView.tsx` |
| Files (hooks) | camelCase with `use` prefix | `useCardOrchestrator.ts` |
| Classes | PascalCase | `MandalaManager`, `OllamaEmbeddingProvider` |
| Functions / variables | camelCase | `getMandalaLimit`, `cachedProvider` |
| Constants | UPPER_SNAKE_CASE | `DEFAULT_TIER`, `RATE_LIMIT_CONFIG` |
| DB columns | snake_case | `user_id`, `mandala_limit`, `created_at` |
| Types / Interfaces | PascalCase (no `I` prefix) | `Tier`, `GenerateOptions` |
| Enums | PascalCase (members too) | `ErrorCode.RateLimitExceeded` |
| Environment variables | UPPER_SNAKE_CASE | `OLLAMA_URL`, `LLM_PROVIDER` |

```typescript
// ✅ Good
const DEFAULT_PANEL_SPLIT_RATIO = 65;
type GenerateOptions = { temperature?: number };

// ❌ Bad
const defaultPanelSplitRatio = 65;  // Should be UPPER_SNAKE_CASE for constants
interface IGenerateOptions { ... }   // No "I" prefix
```

### 1-3. Constants — No Magic Numbers

All non-trivial numbers, strings, URLs must be defined as named constants.

```typescript
// ✅ Good
const CACHE_STALE_TIME_MS = 60 * 1000;
const limit = subscription?.mandala_limit ?? getMandalaLimit(tier);

// ❌ Bad
const staleTime = 60 * 1000;     // What is 60?
const limit = subscription?.mandala_limit ?? 3;  // Why 3?
```

**Placement**:
- Tier/quota constants: `src/config/quota.ts` (SSOT: `docs/policies/quota-policy.md`)
- Feature-local constants: top of the file they're used
- Shared constants: `shared/config/constants.ts` (frontend) or `src/config/` (backend)

**Exceptions**: `0`, `1`, `100` (self-explanatory), CSS classes, i18n keys, array indices.

### 1-4. Error Handling

**API errors** — use `createErrorResponse` + `ErrorCode`:

```typescript
// ✅ Good
import { createErrorResponse, ErrorCode } from '@/api/schemas/common.schema';

if (!result.success) {
  return reply.code(404).send(
    createErrorResponse(ErrorCode.RESOURCE_NOT_FOUND, 'Video not found', request.url)
  );
}

// ❌ Bad — raw object without ErrorCode
return reply.code(404).send({ error: 'not found' });
```

**try/catch** — type `unknown`, narrow before use:

```typescript
// ✅ Good
try {
  await generate(prompt);
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : 'Unknown error';
  logger.error('Generation failed', { error: message });
}

// ❌ Bad
} catch (error: any) {
  console.log(error.message);
}
```

**API response format** (standard structure):

```typescript
// Success
{ success: true, data: { ... } }

// Error
{ error: { code: 'RESOURCE_NOT_FOUND', message: '...', timestamp: '...', path: '...' } }

// Paginated
{ success: true, data: [...], pagination: { page, limit, total, totalPages } }
```

### 1-5. Code Structure

**Function length**: Aim for <50 lines. Extract helpers for complex logic.

**Single responsibility**: One export per file for major classes/components. Small utilities can share a file.

**Barrel exports**: Use `index.ts` for public API of a module directory. Internal files should not be imported directly from outside.

```
features/auth/
  model/
    AuthContext.tsx
    useAuth.ts
    index.ts          ← re-exports public API
  ui/
    LoginForm.tsx
    index.ts
  index.ts            ← top-level barrel
```

---

## Phase 2 — Security + DB/Performance + API Contract (Before MA-2)

### 2-1. Security

**Environment variables**:
- Never hardcode secrets — use `.env` + `config/index.ts` (Zod-validated)
- Never log API keys, passwords, tokens, or PII
- Client-side code must never contain service role keys

```typescript
// ✅ Good — Zod-validated config
import { config } from '@/config';
const apiKey = config.openrouter.apiKey;

// ❌ Bad — direct process.env without validation
const apiKey = process.env.OPENROUTER_API_KEY;
```

**Bot Domain Restriction**:
- User-facing bots (Clawbot, persona characters, notification bots) operate in service domain only
- Bots read only `domain='service'` data, call only service APIs, never access system domain (pattern, decision, problem)
- Dev automation (Agent, CI/CD, MCP Server) is a tool, not a bot — operates in system domain
- See `memory/project-principle-service-system.md` rule #6

**Authentication**: All API routes require `onRequest: [fastify.authenticate]` except:
- `/health`, `/api/v1/auth/login`, `/api/v1/auth/register`, `/api/v1/auth/refresh`
- Public endpoints (shared mandala view)

**Input validation**: Every route handler must validate input with Zod `.parse()`:

```typescript
// ✅ Good
const validated = ListVideosQuerySchema.parse(request.query);

// ❌ Bad — trusting raw input
const { playlistId } = request.query as any;
```

**SQL injection**: Use Prisma ORM or parameterized queries (`$queryRawUnsafe` with `$1`, `$2`). Never concatenate user input into SQL.

### 2-2. DB / Performance

**Query patterns**:

```typescript
// ✅ Good — Prisma include for related data
const mandala = await prisma.user_mandalas.findUnique({
  where: { id: mandalaId },
  include: { levels: true },
});

// ❌ Bad — N+1 query
const mandalas = await prisma.user_mandalas.findMany();
for (const m of mandalas) {
  m.levels = await prisma.mandala_levels.findMany({ where: { mandala_id: m.id } });
}
```

**Pagination**: All list endpoints must paginate. Use `PaginationQuerySchema`:

```typescript
const { page, limit } = PaginationQuerySchema.parse(request.query);
const offset = (page - 1) * limit;
```

**Transactions**: Multi-table mutations require `$transaction`:

```typescript
// ✅ Good — atomic
await prisma.$transaction(async (tx) => {
  await tx.user_mandalas.delete({ where: { id: mandalaId } });
  await tx.user_local_cards.updateMany({ where: { mandala_id: mandalaId }, data: { mandala_id: null } });
});
```

**Migration order** (absolute rule):
1. Local `prisma db push` → verify locally
2. Commit + merge to main
3. CI/CD runs migration on production
4. **Never** push directly to production DB

### 2-3. API Contract

**Response helpers** (`src/api/schemas/common.schema.ts`):
- `createSuccessResponse(data)` → `{ success: true, data }`
- `createPaginatedResponse(data, pagination)` → `{ success: true, data, pagination }`
- `createErrorResponse(code, message, path, details?)` → `{ error: { code, message, ... } }`

**New ErrorCode registration**: Add to `ErrorCode` enum in `common.schema.ts`, then update the doc comment.

**Rate limiting** (SSOT: `docs/policies/quota-policy.md`):
- Per-tier limits defined in `src/config/quota.ts`
- Category-specific limits in `src/api/plugins/rate-limit.ts`

---

## Phase 3 — Incident Response + Monitoring (Before Beta)

### 3-1. Error Classification

| Category | Examples | Response |
|----------|---------|----------|
| Recoverable | Network timeout, temporary DB connection failure | Retry with backoff (max 3 attempts) |
| Fatal | Data integrity violation, auth system failure | Alert immediately, stop operation |
| Degraded | LLM provider unavailable, external API down | Fallback to alternative, log warning |

### 3-2. Logging

**Framework**: Winston (structured JSON) via `src/utils/logger.ts`.

```typescript
import { logger, createLogger } from '@/utils/logger';

const log = createLogger('MandalaManager');
log.info('Mandala created', { mandalaId, userId });
log.error('Failed to create mandala', { error: err.message, userId });
```

**Level guidelines**:

| Level | Use Case |
|-------|---------|
| `debug` | Dev-only: variable values, flow tracing |
| `info` | Normal operations: API requests, successful operations |
| `warn` | Expected exceptions: rate limit hit, deprecated API call |
| `error` | Unexpected failures: uncaught exceptions, data corruption |

**Forbidden to log**: Passwords, API keys, JWT tokens, email addresses, full request bodies containing PII.

### 3-3. Health Check

**Endpoint**: `GET /api/v1/admin/health`

Checks: API uptime, DB connection + latency, memory usage. Located at `src/api/routes/admin/health.ts`.

### 3-4. Fallback Patterns

**LLM provider**: `auto` mode tries Ollama → OpenRouter → Gemini (see `src/modules/llm/index.ts`).

**AI summary failure**: Show "Summary generation in progress" status, not empty string.

**Circuit breaker**: If external service fails 3+ times in 1 minute, stop retrying for cooldown period. See `memory/troubleshooting.md` for known patterns.

### 3-5. YouTube Caption Extraction

**Policy**: YouTube 공개 자막만 추출. youtube-transcript npm 패키지(Innertube API) 단독 사용.

| Environment | Extraction Route | Rationale |
|-------------|-----------------|-----------|
| **Dev (local)** | youtube-transcript (Innertube API) | 공개 자막만 추출 |
| **Prod (EC2)** | youtube-transcript (Innertube API) | 동일 — 공개 자막만 추출 |

**구현**: `CaptionExtractor.extractCaptions()`에서 youtube-transcript 시도 → 실패 시 `success: false` 반환.

**금지**: yt-dlp, 프록시 서비스, 영상 다운로드 도구 사용 금지 (YouTube TOS 위반, Google OAuth 심사 거부 사유).

### 3-6. Code Review Standards

| Criterion | Threshold |
|-----------|----------|
| PR size | < 10 files or < 300 lines (split if larger) |
| Breaking changes | Title must include `[BREAKING]` |
| Migration included | Separate review step required |
| Mandala/card changes | Loading test mandatory (critical path) |

---

## Phase 4 — Frontend + Accessibility + Deployment (Before Launch)

### 4-1. Frontend Architecture

**Structure** (Feature-Sliced Design variant):

```
frontend/src/
├── app/           # App shell, providers, router, global styles
├── pages/         # Route page components
├── widgets/       # Composite UI blocks (offline-banner, video-player)
├── features/      # Feature modules (auth, mandala, search, card-management)
├── entities/      # Domain entities (content types, renderers)
├── shared/        # Reusable UI, hooks, config, i18n, integrations
└── components/    # Standalone components (graph view)
```

**State management**: React Query v5 (`@tanstack/react-query`) for server state. Local `useState`/`useReducer` for UI state.

```typescript
// ✅ Good — server state via React Query
const { data: mandalas } = useQuery({ queryKey: ['mandalas'], queryFn: fetchMandalas });

// ❌ Bad — storing server data in useState
const [mandalas, setMandalas] = useState([]);
useEffect(() => { fetchMandalas().then(setMandalas); }, []);
```

### 4-2. React Patterns

**Reference stability** — wrap arrays/objects in `useMemo`:

```typescript
// ✅ Good
const displayCards = useMemo(() => cards.filter(c => c.visible), [cards]);

// ❌ Bad — new reference every render
const displayCards = cards.filter(c => c.visible);
```

**Fallback values** — use `?? EMPTY_CONST`, not `|| []`:

```typescript
// ✅ Good
const EMPTY_CARDS: Card[] = [];
const items = cards ?? EMPTY_CARDS;

// ❌ Bad — creates new array reference each render
const items = cards || [];
```

**useEffect filter-only** — never clear entire state on data change:

```typescript
// ✅ Good — filter out non-existent IDs only
useEffect(() => {
  setSelected(prev => {
    const validIds = new Set(cards.map(c => c.id));
    const filtered = new Set([...prev].filter(id => validIds.has(id)));
    return filtered.size !== prev.size ? filtered : prev;
  });
}, [cards]);

// ❌ Bad — full clear destroys user selection
useEffect(() => { setSelected(new Set()); }, [cards]);
```

**Twin Fix Rule** — these component pairs must be updated together:

| Component A | Component B |
|------------|------------|
| `CardList.tsx` | `FloatingScratchPad.tsx` |
| `handleCardDrop` | `handleScratchPadCardDrop` |
| optimistic updates in `useLocalCards` | optimistic updates in `useBatchMoveCards` |

### 4-3. Styling

- **Framework**: Tailwind CSS + shadcn/ui primitives
- **Dark mode**: Must support both themes. Test color contrast in both.
- **Responsive breakpoints**: mobile (< 768px), tablet (768-1024px), desktop (> 1024px)

### 4-4. Accessibility (a11y)

- Keyboard navigation: all interactive elements focusable via Tab
- Images: `alt` text required
- Color contrast: WCAG 2.1 AA minimum (4.5:1 for text)
- ARIA labels on icon-only buttons

### 4-5. Deployment

**Order**: Local dev → PR → CI checks → Merge to main → Production deploy

**Pre-deploy checklist**:
- [ ] `tsc --noEmit` pass
- [ ] `npm run build` pass
- [ ] No new ESLint errors
- [ ] Migration tested locally first

**Rollback safety**:
```bash
# ✅ Good — stash before rollback
git stash
git checkout -- <file>

# ❌ Bad — destroys uncommitted changes
git checkout -- <file>   # without stash
```

---

## Code Modification Hierarchy (L0-L6)

> Detailed rules: `memory/code-modification-convention.md`

**Principle**: Fix at the highest (most upstream) level possible.

```
L0: DB Schema → L1: Edge Function → L2: Type → L3: Converter → L4: Hook → L5: Orchestrator → L6: UI
```

When modifying any layer, check all downstream layers for propagation impact.
When a change can be solved at L1, do not patch at L6.

---

## Git & Contribution

**Commit format**: Conventional Commits (English only)

```
feat(llm): add OpenRouter provider with auto-fallback
fix(api): handle null mandala_id in card move
docs: update quota policy implementation status
```

**Language**: GitHub Issues, PRs, commit messages — **English only**. Korean communication is for Slack/chat only.

**Pre-commit**: `tsc --noEmit` + `npm run build` must pass.

---

## Quick Reference

| Rule | Source |
|------|--------|
| Formatting: 100 chars, 2-space indent, single quotes, semicolons | `.prettierrc` |
| Type safety: full strict mode, no `any` | `tsconfig.json` |
| Imports: `@/` alias, no 3+ level relative | `tsconfig.json` paths |
| Constants: named, not magic numbers | `src/config/quota.ts` pattern |
| Errors: `createErrorResponse` + `ErrorCode` | `src/api/schemas/common.schema.ts` |
| API response: `{ success, data }` or `{ error: {...} }` | `common.schema.ts` |
| DB mutations: verify DB state, not just UI | Testing rule |
| Async: no floating promises, handle all errors | `.eslintrc.json` |
| React state: `useMemo` for references, `?? CONST` not `\|\| []` | Frontend rule |
| Modification order: L0 (DB) → L6 (UI), upstream first | L0-L6 hierarchy |
| Git: Conventional Commits, English only | Contribution rule |
| Quota values: `src/config/quota.ts` | `docs/policies/quota-policy.md` |

---

## Change Log

| Date | Change |
|------|--------|
| 2026-03-19 | Initial document — consolidated from CLAUDE.md, memory/feedback-*.md, CONTRIBUTING.md |
