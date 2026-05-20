/**
 * src/modules/chatbot-rag/user-context-loader.ts
 *
 * Loads the per-user session context block (Block U) for the chatbot
 * SFT-aligned system prompt.
 *
 * Source tables:
 *   - users                (join_date via created_at)
 *   - user_subscriptions   (tier; default 'free' on missing row)
 *   - user_mandalas        (title list + total count)
 *   - user_local_cards     (count within RECENT_DAYS_WINDOW)
 *
 * Failures degrade gracefully — the loader never throws. Each missing
 * source is silently substituted (tier→'free', titles→[], counts→0).
 * Justification: chatbot must still respond when a user just signed up
 * and has no subscription/mandala/card rows yet.
 *
 * Performance: all queries dispatch in a single Promise.all batch.
 * p50 expected < 50ms on a warm Supabase connection.
 *
 * Design: docs/design/insighta-chatbot-prompt-serving-design.md §3 (CP474 review).
 */

import { getPrismaClient } from '@/modules/database/client';
import type { Tier } from '@/config/quota';
import { MS_PER_DAY } from '@/utils/time-constants';
import { type UserContext, MAX_MANDALA_TITLES, RECENT_DAYS_WINDOW } from './types';
import type { Lang } from './prompt-builder';

// ---------------------------------------------------------------------------
// Constants / helpers
// ---------------------------------------------------------------------------

const VALID_TIERS: ReadonlySet<Tier> = new Set<Tier>(['free', 'pro', 'lifetime', 'admin']);

function normalizeTier(value: string | null | undefined): Tier {
  if (value && VALID_TIERS.has(value as Tier)) return value as Tier;
  return 'free';
}

function daysBetween(from: Date | null | undefined, to: Date): number {
  if (!from) return 0;
  const diffMs = to.getTime() - from.getTime();
  return Math.max(0, Math.floor(diffMs / MS_PER_DAY));
}

function isoDate(d: Date | null | undefined): string {
  if (!d) return '';
  return d.toISOString().slice(0, 10);
}

function deriveDisplayName(explicit: string | undefined, email: string): string {
  if (explicit && explicit.trim().length > 0) return explicit.trim();
  const local = email.split('@')[0];
  return local && local.length > 0 ? local : 'user';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface LoadUserContextParams {
  /** Supabase auth user id (from request.user.userId after JWT verify). */
  userId: string;
  /** Decoded JWT email; falls back to '' when absent. */
  email: string;
  /** Display name from JWT user_metadata. Optional — falls back to email local-part. */
  displayName?: string;
  /** Mandala the user is currently viewing; used to populate current_mandala_name. */
  currentMandalaId?: string;
  /** UI language (request from i18n.language); drives the prompt's KO/EN selection. */
  preferredLanguage: Lang;
  /** Reference timestamp for the recent-cards window. Injected for tests; defaults to now. */
  now?: Date;
}

/**
 * Returns the user's session context as a structured object. Never throws.
 *
 * @see UserContext for field-level documentation
 */
export async function loadUserContext(params: LoadUserContextParams): Promise<UserContext> {
  const prisma = getPrismaClient();
  const now = params.now ?? new Date();
  const recencyCutoff = new Date(now.getTime() - RECENT_DAYS_WINDOW * MS_PER_DAY);

  // All queries run in parallel — single round-trip in Prisma's connection pool.
  const [userRow, subscription, mandalaRows, mandalaCount, recentCardCount, currentMandala] =
    await Promise.all([
      prisma.users
        .findUnique({
          where: { id: params.userId },
          select: { created_at: true },
        })
        .catch(() => null),
      prisma.user_subscriptions
        .findUnique({
          where: { user_id: params.userId },
          select: { tier: true },
        })
        .catch(() => null),
      prisma.user_mandalas
        .findMany({
          where: { user_id: params.userId },
          select: { title: true },
          orderBy: { created_at: 'desc' },
          take: MAX_MANDALA_TITLES,
        })
        .catch(() => [] as Array<{ title: string }>),
      prisma.user_mandalas
        .count({
          where: { user_id: params.userId },
        })
        .catch(() => 0),
      prisma.user_local_cards
        .count({
          where: {
            user_id: params.userId,
            created_at: { gte: recencyCutoff },
          },
        })
        .catch(() => 0),
      params.currentMandalaId
        ? prisma.user_mandalas
            .findUnique({
              where: { id: params.currentMandalaId },
              select: { title: true },
            })
            .catch(() => null)
        : Promise.resolve(null),
    ]);

  const tier = normalizeTier(subscription?.tier);
  const joinDate = userRow?.created_at ?? null;

  return {
    user_id: params.userId,
    display_name: deriveDisplayName(params.displayName, params.email),
    email: params.email,
    tier,
    join_date: isoDate(joinDate),
    days_active: daysBetween(joinDate, now),
    mandala_count: mandalaCount,
    mandala_titles: mandalaRows.map((m) => m.title),
    current_mandala_name: currentMandala?.title,
    recent_card_count_7d: recentCardCount,
    preferred_language: params.preferredLanguage,
  };
}
