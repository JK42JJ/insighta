/**
 * Prisma-backed adapter for `DomainFitServeCache` (see `./serve-enforce.ts`).
 *
 * Table `video_domain_fit_cache` — video-intrinsic per-mandala cache, a
 * DELIBERATELY SEPARATE table from `video_mandala_relevance` (never shares a
 * write path with the existing relevance-gate cache, so this addition
 * carries zero risk to that table's read/write semantics — see the schema
 * comment in prisma/schema.prisma and the migration SQL under
 * prisma/migrations/domain-fit-serve-cache/).
 *
 * Thin I/O layer only — no business logic here (that lives in
 * `serve-enforce.ts`'s pure `applyDomainFitServeEnforce`), kept separate so
 * the reorder logic is unit-testable with a simple in-memory fake cache
 * (`createNoopDomainFitServeCache` / a Map-based test double) without a real
 * Prisma client.
 */

import type { PrismaClient } from '@prisma/client';
import type { DomainFitLabel } from './client';
import type { DomainFitServeCache, DomainFitServeCacheEntry } from './serve-enforce';

/** Minimal Prisma surface this adapter needs (matches the raw-query style
 *  already used elsewhere in pool-serve-fill.ts for video_mandala_relevance). */
export type DomainFitServeCachePrisma = Pick<PrismaClient, '$queryRaw' | '$executeRaw'>;

interface CacheRow {
  fit: string | null;
  lexical_conflict: boolean;
  multiplier: number;
  model: string;
  scored_at: Date;
}

function isFitLabel(v: string | null): v is DomainFitLabel {
  return v === '적합' || v === '비적합';
}

/**
 * `video_domain_fit_cache`-backed cache, scoped to one mandala for the
 * lifetime of a single pool-serve-fill job (mandalaId is fixed per job —
 * see `handlePoolServeFill`'s `p.mandalaId`).
 */
export function createPrismaDomainFitServeCache(
  prisma: DomainFitServeCachePrisma,
  mandalaId: string
): DomainFitServeCache {
  return {
    async get(youtubeVideoId: string): Promise<DomainFitServeCacheEntry | null> {
      const rows = await prisma.$queryRaw<CacheRow[]>`
        SELECT fit, lexical_conflict, multiplier, model, scored_at
        FROM video_domain_fit_cache
        WHERE video_id = ${youtubeVideoId} AND mandala_id = ${mandalaId}::uuid`;
      const row = rows[0];
      if (!row || !isFitLabel(row.fit)) return null;
      return {
        fit: row.fit,
        lexicalConflict: row.lexical_conflict,
        multiplier: row.multiplier,
        model: row.model,
        scoredAt: row.scored_at.toISOString(),
      };
    },
    async set(youtubeVideoId: string, entry: DomainFitServeCacheEntry): Promise<void> {
      await prisma.$executeRaw`
        INSERT INTO video_domain_fit_cache
          (video_id, mandala_id, fit, lexical_conflict, multiplier, model, scored_at)
        VALUES (
          ${youtubeVideoId}, ${mandalaId}::uuid, ${entry.fit}, ${entry.lexicalConflict},
          ${entry.multiplier}, ${entry.model}, ${entry.scoredAt}::timestamptz
        )
        ON CONFLICT (video_id, mandala_id) DO UPDATE SET
          fit = EXCLUDED.fit,
          lexical_conflict = EXCLUDED.lexical_conflict,
          multiplier = EXCLUDED.multiplier,
          model = EXCLUDED.model,
          scored_at = EXCLUDED.scored_at`;
    },
  };
}
