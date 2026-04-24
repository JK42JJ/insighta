import { FastifyPluginCallback } from 'fastify';
import { getMandalaManager } from '../../modules/mandala';
import { getMood } from '../../modules/mandala/mood';
import { triggerMandalaPostCreationAsync } from '../../modules/mandala/mandala-post-creation';
import { getPrismaClient } from '../../modules/database/client';
import {
  generateMandalaRace,
  generateMandalaStructure,
  generateLabels,
  getCachedMandala,
  setCachedMandala,
  MandalaGenError,
} from '../../modules/mandala/generator';
import { searchMandalasByGoal, MandalaSearchError } from '../../modules/mandala/search';
import {
  EXPLORE_SOURCES,
  EXPLORE_SORTS,
  EXPLORE_LANGUAGES,
  MAX_PAGINATION_LIMIT,
  EXPLORE_CACHE_TTL_MS,
} from '../../config/explore';
import {
  RECOMMENDATION_FETCH_LIMIT,
  RECOMMENDATION_DEFAULT_STATUS,
  RECOMMENDATION_DEFAULT_MODE,
} from '../../config/recommendations';
import { MemoryCache } from '../../utils/memory-cache';
import { cardPublisher, type CardPayload } from '../../modules/recommendations/publisher';
import { generateMandalaActions } from '../../modules/mandala/generator';

// Explore results cache — templates are near-immutable, 10-min TTL
const exploreCache = new MemoryCache({ defaultTTLMs: EXPLORE_CACHE_TTL_MS, maxEntries: 100 });

interface MandalaLevelBody {
  levelKey: string;
  centerGoal: string;
  subjects: string[];
  position: number;
  depth: number;
  color?: string | null;
  parentLevelKey?: string | null;
}

interface UpsertMandalaBody {
  title: string;
  levels: MandalaLevelBody[];
}

interface CreateMandalaBody {
  title: string;
  levels?: MandalaLevelBody[];
}

interface UpdateMandalaBody {
  title?: string;
  isDefault?: boolean;
  position?: number;
}

interface UpdateMandalaLevelsBody {
  levels: MandalaLevelBody[];
}

interface UpdateLevelBody {
  centerGoal?: string;
  subjects?: string[];
  color?: string | null;
}

interface EditorBlock {
  name: string;
  isCenter: boolean;
  items: string[]; // length 8
}

function getUserId(request: any, reply: any): string | null {
  if (!request.user || !('userId' in request.user)) {
    reply.code(401).send({ error: 'Unauthorized' });
    return null;
  }
  return request.user.userId;
}

/**
 * Build skill_config rows for a freshly created mandala. Always ensures
 * video_discover is enabled with auto_add=true unless the caller explicitly
 * passed enabled=false. CP357 onboarding default: every new mandala lands
 * the user on a populated dashboard.
 */
function buildSkillConfigRows(
  userId: string,
  mandalaId: string,
  userSkills: Record<string, unknown> | null | undefined
): any[] {
  const rows = new Map<
    string,
    { user_id: string; mandala_id: string; skill_type: string; enabled: boolean; config: any }
  >();

  if (userSkills && typeof userSkills === 'object') {
    for (const [skillType, enabled] of Object.entries(userSkills)) {
      rows.set(skillType, {
        user_id: userId,
        mandala_id: mandalaId,
        skill_type: skillType,
        enabled: Boolean(enabled),
        config: skillType === 'video_discover' ? { auto_add: true } : {},
      });
    }
  }

  // CP357 fallback: ensure video_discover is present and enabled by default
  // so the post-creation pipeline runs auto-add. Caller can override by
  // passing { video_discover: false } explicitly.
  if (!rows.has('video_discover')) {
    rows.set('video_discover', {
      user_id: userId,
      mandala_id: mandalaId,
      skill_type: 'video_discover',
      enabled: true,
      config: { auto_add: true },
    });
  }

  return Array.from(rows.values());
}

export const mandalaRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  // ─── Backward-compatible endpoints (Story #59) ───

  /**
   * GET /api/v1/mandalas - Get user's default mandala with all levels
   */
  fastify.get('/', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const userId = getUserId(request, reply);
    if (!userId) return;

    const mandala = await getMandalaManager().getMandala(userId);

    if (!mandala) {
      return reply.code(404).send({ error: 'Mandala not found' });
    }

    return reply.send({ mandala });
  });

  /**
   * PUT /api/v1/mandalas - Upsert default mandala with all levels (backward-compatible)
   */
  fastify.put<{ Body: UpsertMandalaBody }>(
    '/',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const userId = getUserId(request, reply);
      if (!userId) return;

      const { title, levels } = request.body;

      if (!title || !Array.isArray(levels)) {
        return reply.code(400).send({ error: 'title and levels are required' });
      }

      const manager = getMandalaManager();
      try {
        const mandala = await manager.upsertMandala(userId, title, levels);

        // Link unlinked cards to this mandala (migration from localStorage)
        // Non-fatal: mandala_id columns may not exist yet in video_states/local_cards
        let linked = { videoStates: 0, localCards: 0 };
        try {
          linked = await manager.linkCardsToMandala(userId, mandala.id);
        } catch (linkErr: any) {
          fastify.log.warn(
            { err: linkErr, userId },
            'linkCardsToMandala skipped (column may not exist)'
          );
        }

        // Upsert may change sub_goal labels → embeddings + recommendations
        // stale. Trigger refresh; the 5-min dedup guard inside the pipeline
        // absorbs rapid successive upserts.
        triggerMandalaPostCreationAsync(userId, mandala.id);

        return reply.send({ mandala, linked });
      } catch (err: any) {
        fastify.log.error({ err, userId }, 'upsertMandala failed');
        return reply.code(500).send({ error: err.message });
      }
    }
  );

  /**
   * PATCH /api/v1/mandalas/levels/:levelKey - Update a single level (backward-compatible)
   */
  fastify.patch<{ Params: { levelKey: string }; Body: UpdateLevelBody }>(
    '/levels/:levelKey',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const userId = getUserId(request, reply);
      if (!userId) return;

      const mandalaId = await getMandalaManager().updateLevel(
        userId,
        request.params.levelKey,
        request.body
      );

      // Editing one sub_goal label invalidates that cell's embedding.
      // The dedup guard absorbs rapid successive edits.
      triggerMandalaPostCreationAsync(userId, mandalaId);

      return reply.send({ success: true });
    }
  );

  // ─── Share & Public endpoints (Story #85) ───
  // These must be registered BEFORE /:id to avoid path conflicts

  /**
   * GET /api/v1/mandalas/public/:slug - Get a public mandala by share slug (no auth)
   */
  fastify.get<{ Params: { slug: string } }>('/public/:slug', async (request, reply) => {
    const mandala = await getMandalaManager().getPublicMandala(request.params.slug);

    if (!mandala) {
      return reply.code(404).send({ error: 'Mandala not found' });
    }

    return reply.send({ mandala });
  });

  /**
   * GET /api/v1/mandalas/explore - List public mandalas for explore page (no auth)
   */
  fastify.get<{
    Querystring: {
      q?: string;
      domain?: string;
      language?: string;
      source?: string;
      sort?: string;
      page?: string;
      limit?: string;
    };
  }>('/explore', async (request, reply) => {
    const { q, domain, language, source, sort } = request.query;
    const page = request.query.page ? parseInt(request.query.page, 10) : undefined;
    const limit = request.query.limit ? parseInt(request.query.limit, 10) : undefined;

    if (
      (page !== undefined && (isNaN(page) || page < 1)) ||
      (limit !== undefined && (isNaN(limit) || limit < 1 || limit > MAX_PAGINATION_LIMIT))
    ) {
      return reply.code(400).send({ error: 'Invalid pagination parameters' });
    }

    const parsedFilters = {
      q: q || undefined,
      domain: domain || undefined,
      language: EXPLORE_LANGUAGES.includes(language as (typeof EXPLORE_LANGUAGES)[number])
        ? language
        : undefined,
      source: EXPLORE_SOURCES.includes(source as (typeof EXPLORE_SOURCES)[number])
        ? (source as (typeof EXPLORE_SOURCES)[number])
        : undefined,
      sort: EXPLORE_SORTS.includes(sort as (typeof EXPLORE_SORTS)[number])
        ? (sort as (typeof EXPLORE_SORTS)[number])
        : undefined,
      page,
      limit,
    };

    // Skip cache for search queries (results vary per request)
    const cacheKey = parsedFilters.q
      ? null
      : MemoryCache.buildKey({
          domain: parsedFilters.domain,
          source: parsedFilters.source,
          sort: parsedFilters.sort,
          language: parsedFilters.language,
          page: parsedFilters.page,
          limit: parsedFilters.limit,
        });

    if (cacheKey) {
      const cached = exploreCache.get(cacheKey);
      if (cached) return reply.send(cached);
    }

    const result = await getMandalaManager().listExploreMandalas(parsedFilters);

    if (cacheKey) {
      exploreCache.set(cacheKey, result);
    }

    return reply.send(result);
  });

  /**
   * POST /api/v1/mandalas/:id/like - Toggle like on a public mandala (auth required)
   */
  fastify.post<{ Params: { id: string } }>(
    '/:id/like',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const userId = getUserId(request, reply);
      if (!userId) return;

      try {
        const result = await getMandalaManager().toggleLike(userId, request.params.id);
        return reply.send({ success: true, data: result });
      } catch {
        return reply.code(404).send({ error: 'Mandala not found' });
      }
    }
  );

  /**
   * POST /api/v1/mandalas/:id/clone - Clone a public mandala (auth required)
   */
  fastify.post<{ Params: { id: string } }>(
    '/:id/clone',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const userId = getUserId(request, reply);
      if (!userId) return;

      try {
        const result = await getMandalaManager().clonePublicMandala(request.params.id, userId);
        return reply.send({ success: true, data: result });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Clone failed';
        if (message === 'MANDALA_NOT_FOUND') {
          return reply.code(404).send({ error: 'Mandala not found or not public' });
        }
        return reply.code(500).send({ error: message });
      }
    }
  );

  /**
   * GET /api/v1/mandalas/subscriptions - List user's subscriptions
   */
  fastify.get<{ Querystring: { page?: string; limit?: string } }>(
    '/subscriptions',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const userId = getUserId(request, reply);
      if (!userId) return;

      const page = request.query.page ? parseInt(request.query.page, 10) : undefined;
      const limit = request.query.limit ? parseInt(request.query.limit, 10) : undefined;

      const result = await getMandalaManager().listSubscriptions(userId, { page, limit });
      return reply.send(result);
    }
  );

  // ─── Multi-Mandala CRUD endpoints (Story #60) ───

  /**
   * GET /api/v1/mandalas/quota - Get user's mandala quota info
   */
  fastify.get('/quota', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const userId = getUserId(request, reply);
    if (!userId) return;

    const quota = await getMandalaManager().getUserQuota(userId);

    // Daily mandala creation limit (per-day cap separate from total quota)
    const DAILY_MANDALA_LIMIT = 5;
    const adminCheck = await getPrismaClient().$queryRaw<Array<{ is_super_admin: boolean | null }>>`
      SELECT is_super_admin FROM auth.users WHERE id = ${userId}::uuid
    `;
    const isSuperAdmin = adminCheck[0]?.is_super_admin === true;
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const todayCount = await getPrismaClient().user_mandalas.count({
      where: { user_id: userId, created_at: { gte: startOfDay } },
    });
    const daily = {
      limit: DAILY_MANDALA_LIMIT,
      used: todayCount,
      remaining: isSuperAdmin ? Infinity : Math.max(0, DAILY_MANDALA_LIMIT - todayCount),
      isAdmin: isSuperAdmin,
    };

    return reply.send({ quota, daily });
  });

  // ═══ Source-Mandala Mappings (must be before /:id routes) ═══

  fastify.get('/source-mappings', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const userId = getUserId(request, reply);
    if (!userId) return;

    const mappings = await getPrismaClient().source_mandala_mappings.findMany({
      where: { user_id: userId },
      include: { mandala: { select: { id: true, title: true } } },
      orderBy: { created_at: 'desc' },
    });

    return reply.send({ mappings });
  });

  fastify.post<{
    Body: { sourceType: string; sourceIds: string[]; mandalaId: string };
  }>('/source-mappings', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const userId = getUserId(request, reply);
    if (!userId) return;

    const { sourceType, sourceIds, mandalaId } = request.body;

    if (!sourceType || !sourceIds?.length || !mandalaId) {
      return reply.code(400).send({ error: 'sourceType, sourceIds, and mandalaId are required' });
    }

    const VALID_SOURCE_TYPES = ['playlist', 'channel', 'hashtag'];
    if (!VALID_SOURCE_TYPES.includes(sourceType)) {
      return reply
        .code(400)
        .send({ error: `sourceType must be one of: ${VALID_SOURCE_TYPES.join(', ')}` });
    }

    const mandala = await getPrismaClient().user_mandalas.findFirst({
      where: { id: mandalaId, user_id: userId },
    });
    if (!mandala) {
      return reply.code(404).send({ error: 'Mandala not found' });
    }

    const created = [];
    for (const sourceId of sourceIds) {
      try {
        const mapping = await getPrismaClient().source_mandala_mappings.create({
          data: {
            user_id: userId,
            source_type: sourceType,
            source_id: sourceId,
            mandala_id: mandalaId,
          },
        });
        created.push(mapping);
      } catch (err: any) {
        if (err.code === 'P2002') continue;
        throw err;
      }
    }

    return reply.send({ created: created.length, mappings: created });
  });

  fastify.delete<{
    Body: { sourceType: string; sourceId: string; mandalaId: string };
  }>('/source-mappings', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const userId = getUserId(request, reply);
    if (!userId) return;

    const { sourceType, sourceId, mandalaId } = request.body;

    if (!sourceType || !sourceId || !mandalaId) {
      return reply.code(400).send({ error: 'sourceType, sourceId, and mandalaId are required' });
    }

    await getPrismaClient().source_mandala_mappings.deleteMany({
      where: {
        user_id: userId,
        source_type: sourceType,
        source_id: sourceId,
        mandala_id: mandalaId,
      },
    });

    return reply.send({ deleted: true });
  });

  /**
   * POST /api/v1/mandalas/create-from-template - Create mandala from template with skill config
   */
  fastify.post<{
    Body: {
      templateId: string;
      skills: Record<string, boolean>;
      focusTags?: string[];
      targetLevel?: string;
    };
  }>(
    '/create-from-template',
    {
      onRequest: [fastify.authenticate],
      config: { rateLimit: { max: 3, timeWindow: '10 seconds' } },
    },
    async (request, reply) => {
      const userId = getUserId(request, reply);
      if (!userId) return;

      const { templateId, skills, focusTags, targetLevel } = request.body;

      if (!templateId || typeof templateId !== 'string') {
        return reply.code(400).send({ error: 'templateId is required' });
      }

      // Daily mandala creation limit (Phase 0-5) — admins bypass
      const DAILY_MANDALA_LIMIT = 5;
      const adminCheck = await getPrismaClient().$queryRaw<
        Array<{ is_super_admin: boolean | null }>
      >`
      SELECT is_super_admin FROM auth.users WHERE id = ${userId}::uuid
    `;
      const isSuperAdmin = adminCheck[0]?.is_super_admin === true;
      if (!isSuperAdmin) {
        const startOfDay = new Date();
        startOfDay.setUTCHours(0, 0, 0, 0);
        const todayCount = await getPrismaClient().user_mandalas.count({
          where: { user_id: userId, created_at: { gte: startOfDay } },
        });
        if (todayCount >= DAILY_MANDALA_LIMIT) {
          return reply.code(429).send({
            status: 429,
            code: 'DAILY_LIMIT_REACHED',
            message: `Daily mandala creation limit reached (${todayCount}/${DAILY_MANDALA_LIMIT})`,
          });
        }
      }

      try {
        // Reuse existing clone logic
        const result = await getMandalaManager().clonePublicMandala(templateId, userId);

        // Set source_template_id, focus_tags, target_level on the cloned mandala
        const prisma = getPrismaClient();
        const updateData: {
          source_template_id: string;
          focus_tags?: string[];
          target_level?: string;
        } = {
          source_template_id: templateId,
        };
        if (focusTags?.length) updateData.focus_tags = focusTags;
        if (targetLevel) updateData.target_level = targetLevel;
        await prisma.user_mandalas.update({
          where: { id: result.mandalaId, user_id: userId },
          data: updateData,
        });

        // Create skill config rows (CP357: video_discover defaults ON with auto_add=true)
        await prisma.user_skill_config.createMany({
          data: buildSkillConfigRows(
            userId,
            result.mandalaId,
            (skills as Record<string, unknown> | null | undefined) ?? null
          ),
          skipDuplicates: true,
        });

        // Fire-and-forget post-creation pipeline for the cloned mandala.
        // Opt-in via user_skill_config; safe if not enabled.
        triggerMandalaPostCreationAsync(userId, result.mandalaId);

        return reply.send({ mandalaId: result.mandalaId });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Create from template failed';
        if (message === 'MANDALA_NOT_FOUND') {
          return reply.code(404).send({ error: 'Template not found' });
        }
        if (message === 'Mandala quota exceeded') {
          const anyErr = err as Error & { quota?: number; current?: number };
          return reply.code(409).send({
            error: 'Mandala quota exceeded',
            quota: anyErr.quota,
            current: anyErr.current,
          });
        }
        request.log.error({ err, userId, templateId }, 'Failed to create from template');
        return reply.code(500).send({ error: message });
      }
    }
  );

  /**
   * GET /api/v1/mandalas/list - List all user mandalas with pagination
   */
  fastify.get<{ Querystring: { page?: string; limit?: string } }>(
    '/list',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const userId = getUserId(request, reply);
      if (!userId) return;

      const page = request.query.page ? parseInt(request.query.page, 10) : undefined;
      const limit = request.query.limit ? parseInt(request.query.limit, 10) : undefined;

      if (
        (page !== undefined && (isNaN(page) || page < 1)) ||
        (limit !== undefined && (isNaN(limit) || limit < 1 || limit > MAX_PAGINATION_LIMIT))
      ) {
        return reply.code(400).send({ error: 'Invalid pagination parameters' });
      }

      try {
        const result = await getMandalaManager().listMandalas(userId, { page, limit });
        return reply.send(result);
      } catch (err: any) {
        request.log.error({ err, userId }, 'Failed to list mandalas');
        return reply.code(500).send({ error: 'Failed to load mandalas' });
      }
    }
  );

  /**
   * POST /api/v1/mandalas/prewarm - Fire-and-forget Ollama model warm-up
   *
   * Called by the FE wizard when the user enters Step 1 (Goal). Triggers
   * Ollama to load the LoRA model into VRAM/RAM with `keep_alive: 24h`,
   * eliminating the ~45s cold-start that would otherwise blow past the
   * /generate timeout. Returns immediately with status — never blocks the
   * FE on completion (the actual model load happens server-side asynchronously
   * within ~60s, but most of the time it's cached and returns in <1s).
   */
  fastify.post('/prewarm', { onRequest: [fastify.authenticate] }, async (_request, reply) => {
    // LoRA prewarm disabled — mandala generation now uses Claude Haiku via
    // OpenRouter directly. No model warm-up required.
    return reply.send({ status: 'skipped', reason: 'LoRA prewarm disabled — using Haiku' });
  });

  /**
   * POST /api/v1/mandalas/wizard-stream — parallel wizard SSE endpoint
   *
   * P0 (2026-04-21 redesign) — additive, flag-gated via client choice.
   * Existing POST /generate + GET /:id/recommendations endpoints are
   * untouched. Frontend opts in by calling this endpoint; default
   * legacy path is preserved.
   *
   * Contract: on `goal` submission, the handler fires two independent
   * LLM/pgvector tasks in parallel and streams SSE events as each
   * completes:
   *   - `template_found`   — pgvector similarity result (300-1000ms)
   *   - `structure_ready`  — Haiku structure-only generation (2-5s)
   *   - `error`            — terminal, connection closes
   *   - `complete`         — all streamed stages done
   *
   * Design constraint: DO NOT add new logic. This endpoint is a thin
   * parallel orchestrator over `searchMandalasByGoal` +
   * `generateMandalaStructure` — both already in production use.
   *
   * Subsequent phases:
   *   P0-beta: add mandala save + post-creation pipeline trigger.
   *   P1:      frontend useWizardStream hook + flag-gated UI.
   */
  fastify.post<{
    Body: {
      goal: string;
      language?: 'ko' | 'en';
      previewOnly?: boolean;
      focus_tags?: string[];
      target_level?: string;
      // CP424.2 wizard precompute: client-generated UUID for correlating
      // /wizard-stream pre-compute with /create-with-data consume. Optional —
      // when absent, precompute is skipped (backward-compat). Flag-gated by
      // WIZARD_PRECOMPUTE_ENABLED at the trigger site.
      session_id?: string;
    };
  }>(
    '/wizard-stream',
    {
      onRequest: [fastify.authenticate],
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const userId = getUserId(request, reply);
      if (!userId) return;

      const {
        goal,
        language = 'ko',
        previewOnly = false,
        focus_tags: focusTags,
        target_level: targetLevel,
        session_id: sessionId,
      } = request.body;
      if (!goal || typeof goal !== 'string' || goal.trim().length === 0) {
        return reply.code(400).send({
          status: 400,
          code: 'INVALID_INPUT',
          message: 'goal is required',
        });
      }

      const trimmedGoal = goal.trim();
      const lang: 'ko' | 'en' = language === 'en' ? 'en' : 'ko';

      void reply.hijack();
      const raw = reply.raw;
      raw.setHeader('Content-Type', 'text/event-stream');
      raw.setHeader('Cache-Control', 'no-cache');
      raw.setHeader('Connection', 'keep-alive');
      raw.setHeader('X-Accel-Buffering', 'no');
      raw.statusCode = 200;
      raw.write('retry: 5000\n\n');
      raw.write(`: connected goal-length=${trimmedGoal.length}\n\n`);

      let closed = false;
      const write = (event: string, data: unknown): void => {
        if (closed || raw.destroyed) return;
        raw.write(`event: ${event}\n`);
        raw.write(`data: ${JSON.stringify(data)}\n\n`);
      };
      request.raw.on('close', () => {
        closed = true;
      });

      // Parallel fan-out: template search + structure generation.
      // Both take `goal` as their only dependency, so neither waits on
      // the other. Wall-clock becomes max() of the two rather than
      // their sum.
      const t0 = Date.now();
      const templatePromise = searchMandalasByGoal(trimmedGoal, {
        limit: 4,
        threshold: 0.3,
        language: lang,
      })
        .then((templates) => {
          write('template_found', {
            templates,
            duration_ms: Date.now() - t0,
          });
          return templates;
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          write('template_error', { message: msg, duration_ms: Date.now() - t0 });
          return [];
        });

      const structurePromise = generateMandalaStructure({
        goal: trimmedGoal,
        language: lang,
        focusTags,
        targetLevel,
      })
        .then((structure) => {
          write('structure_ready', {
            structure,
            duration_ms: Date.now() - t0,
          });
          // CP424.2 wizard precompute trigger — fire-and-forget after structure
          // resolves so we have real sub_goals. No await: the wizard SSE stream
          // is not blocked by discover latency (Tier 2 YouTube search ~5-15s).
          // Feature-flag + session_id gated inside startPrecompute; callers pass
          // unconditionally.
          if (sessionId && Array.isArray(structure.sub_goals) && structure.sub_goals.length === 8) {
            setImmediate(() => {
              // eslint-disable-next-line @typescript-eslint/no-floating-promises
              import('../../modules/mandala/wizard-precompute').then(({ startPrecompute }) =>
                startPrecompute({
                  sessionId,
                  userId,
                  goal: structure.center_goal,
                  language: lang,
                  focusTags: focusTags ?? [],
                  targetLevel,
                  subGoals: structure.sub_goals,
                }).catch((err) => {
                  request.log.warn(
                    { err, sessionId, userId },
                    'wizard-precompute startPrecompute threw (fire-and-forget)'
                  );
                })
              );
            });
          }
          return structure;
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          write('structure_error', { message: msg, duration_ms: Date.now() - t0 });
          return null;
        });

      // P0-beta: after structure completes, save the mandala + fire
      // the post-creation pipeline (which dispatches the v3 discover
      // skill). Subscribe to cardPublisher for the new mandala so
      // each `recommendation_cache.upsert` streams as a `card_added`
      // event.
      let mandalaId: string | null = null;
      let unsubscribe: (() => void) | null = null;

      try {
        const [_templates, structure] = await Promise.all([templatePromise, structurePromise]);

        // Phase 1 preview mode (2026-04-22): the legacy `useWizard` hook
        // calls this route with `previewOnly: true` to replace the slow
        // one-shot Haiku `/mandalas/generate` call with the faster
        // structure-only path. When preview mode is active we emit the
        // template + structure events (already done above via the
        // parallel promises) and short-circuit before the save + post-
        // creation pipeline. The user's "완료" click in the legacy
        // wizard Step 3 still drives the real save via the existing
        // `createMandalaWithData` flow — no changes to that path.
        if (previewOnly) {
          write('complete', { duration_ms: Date.now() - t0, previewOnly: true });
          return;
        }

        if (structure && !closed) {
          // Build levels from the structure: 1 root + 8 sub-goals.
          const levels: MandalaLevelBody[] = [
            {
              levelKey: 'root',
              centerGoal: structure.center_goal,
              subjects: [],
              position: 0,
              depth: 0,
            },
            ...structure.sub_goals.map((sg, i) => ({
              levelKey: `cell-${i}`,
              centerGoal: sg,
              subjects: [],
              position: i,
              depth: 1,
              parentLevelKey: 'root',
            })),
          ];

          const tSaveStart = Date.now();
          try {
            const manager = getMandalaManager();
            const saved = await manager.createMandala(userId, structure.center_goal, levels);
            mandalaId = saved.id;
            write('mandala_saved', {
              mandalaId: saved.id,
              duration_ms: Date.now() - tSaveStart,
            });

            // Subscribe BEFORE triggering the post-creation pipeline
            // so we don't miss the early card_added events.
            unsubscribe = cardPublisher.subscribe(saved.id, (payload: CardPayload) => {
              write('card_added', payload);
            });

            // Fire-and-forget: v3 discover skill runs async and
            // upserts into recommendation_cache, each upsert calls
            // notifyCardAdded(mandalaId, payload) → our subscriber
            // above → SSE card_added.
            triggerMandalaPostCreationAsync(userId, saved.id);

            // Fire-and-forget: generate 64 actions in background.
            // The post-creation pipeline does NOT need actions, so
            // actions fill in later as a separate concern. Retry 1x
            // on failure; log + continue if both attempts fail (no
            // silent 0/8 — the UI must surface the failure state
            // downstream).
            void (async () => {
              const attemptActions = async (): Promise<Record<string, string[]> | null> => {
                try {
                  return await generateMandalaActions(
                    structure.sub_goals,
                    lang,
                    structure.center_goal,
                    undefined,
                    undefined
                  );
                } catch (err) {
                  request.log.warn(
                    { err, mandalaId: saved.id },
                    'wizard-stream: actions generation attempt failed'
                  );
                  return null;
                }
              };
              const actions = (await attemptActions()) ?? (await attemptActions());
              if (!closed && actions) {
                write('actions_ready', { actions });
              } else if (!closed && !actions) {
                write('actions_error', {
                  message: 'actions generation failed after retry',
                });
              }
            })();
          } catch (saveErr) {
            const msg = saveErr instanceof Error ? saveErr.message : String(saveErr);
            request.log.error({ err: saveErr, userId }, 'wizard-stream: save failed');
            write('save_error', { message: msg });
          }
        }

        // Keep the stream open until the client disconnects OR a
        // 90s hard ceiling (covers skill run + a few buffer
        // seconds). After close, subscribers get cleaned up.
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            if (!closed) {
              write('complete', {
                duration_ms: Date.now() - t0,
                mandalaId,
              });
            }
            resolve();
          }, 90_000);
          request.raw.once('close', () => {
            clearTimeout(timer);
            resolve();
          });
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        request.log.error({ err, userId, goal }, 'wizard-stream: orchestrator failed');
        write('error', { message: msg });
      } finally {
        if (unsubscribe) unsubscribe();
        if (!raw.destroyed) raw.end();
      }
    }
  );

  /**
   * POST /api/v1/mandalas/generate - AI-generate a mandala from a goal using v13 model
   */
  fastify.post<{
    Body: { goal: string; domain?: string; language?: 'ko' | 'en' };
  }>(
    '/generate',
    {
      onRequest: [fastify.authenticate],
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const userId = getUserId(request, reply);
      if (!userId) return;

      const { goal, domain, language } = request.body;

      if (!goal || typeof goal !== 'string' || goal.trim().length === 0) {
        return reply.code(400).send({
          status: 400,
          code: 'INVALID_INPUT',
          message: 'goal is required',
        });
      }

      const trimmedGoal = goal.trim();
      const cacheInput = { goal: trimmedGoal, domain, language };

      // Cache lookup: identical normalized goal returns instantly (skips ~80s LoRA)
      const cached = getCachedMandala(cacheInput);
      if (cached) {
        return reply.send({
          status: 200,
          data: { mandala: cached.mandala, source: cached.source, cached: true },
        });
      }

      // Race fallback: LoRA + LLM in parallel, 30s LoRA budget.
      // - LoRA wins (<=30s, valid) → return LoRA, cancel LLM
      // - LoRA times out or invalid → return LLM (already in flight)
      // - Both fail → 503
      // Even on LoRA-loss, LoRA continues in the background and its result is
      // captured to generation_log for fine-tuning + quality analysis.
      try {
        const { mandala, source, duration_ms } = await generateMandalaRace(cacheInput, {
          userId,
        });
        setCachedMandala(cacheInput, { mandala, source });
        return reply.send({
          status: 200,
          data: { mandala, source, cached: false, duration_ms },
        });
      } catch (err) {
        const code =
          err instanceof MandalaGenError
            ? err.code
            : err instanceof MandalaSearchError
              ? err.code
              : 'GENERATION_FAILED';
        const message = err instanceof Error ? err.message : 'Mandala generation failed';
        request.log.error({ err, userId, goal }, 'Mandala race failed (both branches)');
        return reply.code(503).send({ status: 503, code, message });
      }
    }
  );

  /**
   * POST /api/v1/mandalas/create-with-data - Create a mandala from full data (search result or AI-generated)
   *
   * Unlike /create-from-template which clones an existing DB template by ID,
   * this endpoint takes the full mandala structure (title, subjects, actions) and
   * creates a new user mandala. Used by the hybrid wizard (search result + AI generated).
   */
  fastify.post<{
    Body: {
      title: string;
      centerGoal: string;
      subjects: string[]; // 8 sub-goals
      subDetails?: Record<string, string[]>; // depth=1 actions keyed by subject index
      skills?: Record<string, boolean>;
      centerLabel?: string;
      subLabels?: string[];
      language?: string;
      focusTags?: string[];
      targetLevel?: string;
      /**
       * CP416 Phase C (2026-04-22): when true, the created mandala is
       * marked `is_default=true` atomically in the same transaction and
       * the previous default is demoted. Wizard sends this so the user
       * lands on the newly-created mandala in the dashboard instead of
       * the prior default. Defaults to false to preserve explicit
       * caller semantics for other (non-wizard) call paths.
       */
      setAsDefault?: boolean;
      /**
       * CP424.2 wizard precompute: the same UUID sent to /wizard-stream at
       * Step 1. When present AND WIZARD_PRECOMPUTE_ENABLED AND row status=done,
       * we consume it into recommendation_cache and skip the legacy
       * post-creation discover path (still fires fill-missing-actions etc).
       * Miss (not-found / expired / not-done / goal-mismatch) → fallback to
       * full `triggerMandalaPostCreationAsync` (legacy behavior).
       */
      session_id?: string;
    };
  }>(
    '/create-with-data',
    {
      onRequest: [fastify.authenticate],
      config: { rateLimit: { max: 3, timeWindow: '10 seconds' } },
    },
    async (request, reply) => {
      // Observability: per-stage timing for dev/prod diagnostic comparison.
      // Added 2026-04-17. No behavior change; emits Server-Timing header.
      const t0 = Date.now();
      const stages: Array<{ name: string; ms: number }> = [];
      const stage = (name: string) => stages.push({ name, ms: Date.now() - t0 });

      const userId = getUserId(request, reply);
      if (!userId) return;

      const {
        title,
        centerGoal,
        subjects,
        subDetails,
        skills,
        centerLabel,
        subLabels,
        focusTags,
        targetLevel,
        setAsDefault,
        session_id: sessionId,
      } = request.body;

      if (!title || typeof title !== 'string' || title.trim().length === 0) {
        return reply
          .code(400)
          .send({ status: 400, code: 'INVALID_INPUT', message: 'title is required' });
      }
      if (!Array.isArray(subjects) || subjects.length !== 8) {
        return reply.code(400).send({
          status: 400,
          code: 'INVALID_INPUT',
          message: 'subjects must be an array of 8 items',
        });
      }
      stage('validation');

      // Daily mandala creation limit (Phase 0-5) — admins bypass
      const DAILY_MANDALA_LIMIT = 5;
      const adminCheck = await getPrismaClient().$queryRaw<
        Array<{ is_super_admin: boolean | null }>
      >`
      SELECT is_super_admin FROM auth.users WHERE id = ${userId}::uuid
    `;
      const isSuperAdmin = adminCheck[0]?.is_super_admin === true;
      if (!isSuperAdmin) {
        const startOfDay = new Date();
        startOfDay.setUTCHours(0, 0, 0, 0);
        const todayCount = await getPrismaClient().user_mandalas.count({
          where: { user_id: userId, created_at: { gte: startOfDay } },
        });
        if (todayCount >= DAILY_MANDALA_LIMIT) {
          return reply.code(429).send({
            status: 429,
            code: 'DAILY_LIMIT_REACHED',
            message: `Daily mandala creation limit reached (${todayCount}/${DAILY_MANDALA_LIMIT})`,
          });
        }
      }
      stage('quota_check');

      try {
        // Build levels: depth=0 root with 8 subjects, depth=1 for each subject with actions
        const levels: Array<{
          levelKey: string;
          centerGoal: string;
          centerLabel?: string;
          subjects: string[];
          subjectLabels?: string[];
          position: number;
          depth: number;
          parentLevelKey?: string | null;
        }> = [
          {
            levelKey: 'root',
            centerGoal: centerGoal || title,
            centerLabel: centerLabel || undefined,
            subjects,
            subjectLabels: subLabels || undefined,
            position: 0,
            depth: 0,
            parentLevelKey: null,
          },
        ];

        // Always create 8 depth=1 scaffold rows regardless of whether
        // subDetails (actions) arrived with this request. The Phase 1
        // wizard flow (wizard-stream previewOnly=true, CP415) ships the
        // structure ahead of actions, and actions arrive asynchronously
        // — fill-missing-actions later needs a depth=1 row per cell to
        // write into. Previously, the bug skipped the push when
        // subDetails was absent or empty, so depth=1 rows never existed,
        // leaving mandalas permanently stuck at 0/64 actions.
        //
        // If subDetails is provided (legacy one-shot flow), merge the
        // actions into the matching row; otherwise store empty subjects
        // as a scaffold for the async fill path.
        subjects.forEach((subject, idx) => {
          const rawActions =
            subDetails?.[String(idx)] ?? subDetails?.[idx as unknown as string] ?? [];
          const provided = Array.isArray(rawActions) ? rawActions : [];
          // Scaffold with [] when no actions were provided so the async
          // fill-missing-actions job can detect the cell (subjects.length
          // < 8 gate). When partial actions were provided, keep legacy
          // behavior of padding to 8 with empty strings.
          let cellSubjects: string[];
          if (provided.length === 0) {
            cellSubjects = [];
          } else {
            const padded = [...provided];
            while (padded.length < 8) padded.push('');
            cellSubjects = padded.slice(0, 8);
          }
          levels.push({
            levelKey: `sub_${idx}`,
            centerGoal: subject ?? '',
            subjects: cellSubjects,
            position: idx,
            depth: 1,
            parentLevelKey: 'root',
          });
        });

        const result = await getMandalaManager().createMandala(userId, title, levels, {
          promoteToDefault: setAsDefault === true,
        });
        stage('create_mandala');

        // Save focus_tags and target_level if provided
        if (focusTags?.length || targetLevel) {
          const updateData: { focus_tags?: string[]; target_level?: string } = {};
          if (focusTags?.length) updateData.focus_tags = focusTags;
          if (targetLevel) updateData.target_level = targetLevel;
          await getPrismaClient().user_mandalas.update({
            where: { id: result.id, user_id: userId },
            data: updateData,
          });
          stage('focus_update');
        }

        // Skip label generation if FE already provided labels (e.g., from AI generation).
        // Otherwise fire-and-forget to generate them asynchronously.
        if (!centerLabel || !subLabels || subLabels.length === 0) {
          setImmediate(() => {
            void (async () => {
              try {
                const labels = await generateLabels({
                  center_goal: centerGoal || title,
                  sub_goals: subjects,
                });
                const prismaLabels = getPrismaClient();
                await prismaLabels.user_mandala_levels.updateMany({
                  where: { mandala_id: result.id, depth: 0 },
                  data: {
                    center_label: labels.center_label,
                    subject_labels: labels.sub_labels,
                  },
                });
              } catch {
                // Non-fatal — sidebar falls back to sub_goals.
              }
            })();
          });
        }

        // Create skill config rows (CP357: video_discover defaults ON with auto_add=true)
        const prisma = getPrismaClient();
        await prisma.user_skill_config.createMany({
          data: buildSkillConfigRows(
            userId,
            result.id,
            (skills as Record<string, unknown> | null | undefined) ?? null
          ),
          skipDuplicates: true,
        });
        stage('skill_config');

        // Action population has two supported flows:
        //  - Legacy one-shot: FE runs `generateMandalaWithHaiku` and sends
        //    all 64 actions via `subDetails` — saved directly.
        //  - Phase 1 (CP415): FE takes the `wizard-stream?previewOnly=true`
        //    structure and calls `/create-with-data` without `subDetails`.
        //    `fill-missing-actions` (invoked by `triggerMandalaPostCreationAsync`)
        //    populates the depth=1 rows asynchronously in the background.
        //
        // Either way, depth=1 scaffold rows are always created above so the
        // async fill path has a target to write into. An empty `subDetails`
        // is expected under the Phase 1 flow and is not a bug.

        // CP424.2 wizard precompute consume — if flag enabled + session_id
        // present + row status=done + goal matches, copy pre-computed slots
        // into recommendation_cache under the new mandala_id and fire
        // card_added events. Miss → no-op; post-creation pipeline fills the
        // gap below (legacy behavior). On hit, pipeline-runner's checkDiscoverPreconditions
        // will still see existing rec_cache rows and skip step 2 (video-discover)
        // via the existing dedup-window guard; steps 1/3/4/5 still run.
        if (sessionId) {
          try {
            const { consumePrecompute } = await import('../../modules/mandala/wizard-precompute');
            const outcome = await consumePrecompute({
              sessionId,
              userId,
              mandalaId: result.id,
              centerGoal: centerGoal ?? title,
            });
            stage('precompute_consume');
            request.log.info(
              { mandalaId: result.id, sessionId, userId, outcome },
              'wizard-precompute consume outcome'
            );
          } catch (err) {
            request.log.warn(
              { err, sessionId, userId, mandalaId: result.id },
              'wizard-precompute consumePrecompute threw (non-fatal, falling through)'
            );
          }
        }

        triggerMandalaPostCreationAsync(userId, result.id);
        stage('trigger_pipeline');

        void reply.header('Server-Timing', stages.map((s) => `${s.name};dur=${s.ms}`).join(', '));
        request.log.info(
          { mandalaId: result.id, userId, stages, totalMs: Date.now() - t0 },
          'create-with-data timing'
        );
        return reply.send({ status: 200, data: { mandalaId: result.id } });
      } catch (err) {
        const anyErr = err as Error & { quota?: number; current?: number };
        if (anyErr.message === 'Mandala quota exceeded') {
          return reply.code(429).send({
            status: 429,
            code: 'QUOTA_EXCEEDED',
            message: `Mandala limit reached (${anyErr.current}/${anyErr.quota})`,
          });
        }
        if (anyErr.message === 'DUPLICATE_TITLE') {
          return reply.code(409).send({
            status: 409,
            code: 'DUPLICATE_TITLE',
            message: 'A mandala with this title already exists',
          });
        }
        request.log.error({ err, userId, title }, 'Failed to create mandala from data');
        return reply.code(500).send({
          status: 500,
          code: 'CREATE_FAILED',
          message: 'Failed to create mandala',
        });
      }
    }
  );

  /**
   * POST /api/v1/mandalas/generate-labels - Generate short labels (center + sub) via OpenRouter
   *
   * Used as fallback when search results or AI-generated mandalas have no labels.
   */
  fastify.post<{
    Body: { center_goal: string; sub_goals: string[]; language?: 'ko' | 'en' };
  }>('/generate-labels', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const userId = getUserId(request, reply);
    if (!userId) return;

    const { center_goal, sub_goals, language } = request.body;

    if (!center_goal || !Array.isArray(sub_goals) || sub_goals.length === 0) {
      return reply.code(400).send({
        status: 400,
        code: 'INVALID_INPUT',
        message: 'center_goal and sub_goals are required',
      });
    }

    try {
      const labels = await generateLabels({ center_goal, sub_goals, language });
      return reply.send({ status: 200, data: labels });
    } catch (err) {
      if (err instanceof MandalaGenError) {
        const statusCode = err.code === 'SERVICE_UNAVAILABLE' || err.code === 'TIMEOUT' ? 503 : 422;
        return reply.code(statusCode).send({
          status: statusCode,
          code: err.code,
          message: err.message,
        });
      }
      request.log.error({ err, userId, center_goal }, 'Label generation failed');
      return reply.code(500).send({
        status: 500,
        code: 'GENERATION_FAILED',
        message: 'Label generation failed',
      });
    }
  });

  /**
   * POST /api/v1/mandalas/search-by-goal - Embedding search for similar mandalas
   */
  fastify.post<{
    Body: { goal: string; limit?: number; threshold?: number; language?: string };
  }>(
    '/search-by-goal',
    {
      onRequest: [fastify.authenticate],
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const userId = getUserId(request, reply);
      if (!userId) return;

      const { goal, limit, threshold, language } = request.body;

      if (!goal || typeof goal !== 'string' || goal.trim().length === 0) {
        return reply.code(400).send({
          status: 400,
          code: 'INVALID_INPUT',
          message: 'goal is required',
        });
      }

      try {
        const results = await searchMandalasByGoal(goal.trim(), { limit, threshold, language });
        return reply.send({ status: 200, data: { results } });
      } catch (err) {
        if (err instanceof MandalaSearchError) {
          const statusCode =
            err.code === 'SERVICE_UNAVAILABLE' || err.code === 'TIMEOUT' ? 503 : 422;
          return reply.code(statusCode).send({
            status: statusCode,
            code: err.code,
            message: err.message,
          });
        }
        request.log.error({ err, userId, goal }, 'Mandala search failed');
        return reply.code(500).send({
          status: 500,
          code: 'SEARCH_FAILED',
          message: 'Mandala search failed',
        });
      }
    }
  );

  /**
   * POST /api/v1/mandalas/create - Create a new mandala
   */
  fastify.post<{ Body: CreateMandalaBody }>(
    '/create',
    {
      onRequest: [fastify.authenticate],
      config: { rateLimit: { max: 3, timeWindow: '10 seconds' } },
    },
    async (request, reply) => {
      const userId = getUserId(request, reply);
      if (!userId) return;

      const { title, levels } = request.body;

      if (!title || typeof title !== 'string' || title.trim().length === 0) {
        return reply.code(400).send({ error: 'title is required' });
      }

      if (title.length > 200) {
        return reply.code(400).send({ error: 'title must be 200 characters or less' });
      }

      try {
        const manager = getMandalaManager();
        // Auto-create default root level with 8 empty sectors if no levels provided
        const effectiveLevels =
          levels && levels.length > 0
            ? levels
            : [
                {
                  levelKey: 'root',
                  centerGoal: title.trim(),
                  subjects: ['', '', '', '', '', '', '', ''],
                  position: 0,
                  depth: 0,
                },
              ];
        const mandala = await manager.createMandala(userId, title.trim(), effectiveLevels);

        // If this is the first (default) mandala, link unlinked cards (non-fatal)
        if (mandala.isDefault) {
          try {
            await manager.linkCardsToMandala(userId, mandala.id);
          } catch {
            // mandala_id columns may not exist yet
          }
        }

        // Fire-and-forget post-creation pipeline. /create doesn't write
        // skill config, so the video-discover step typically logs
        // "not enabled" and exits cleanly.
        triggerMandalaPostCreationAsync(userId, mandala.id);

        return reply.code(201).send({ mandala });
      } catch (err: any) {
        if (err.message === 'Mandala quota exceeded') {
          return reply.code(409).send({
            code: 'QUOTA_EXCEEDED',
            message: 'Mandala quota exceeded',
            quota: err.quota,
            current: err.current,
          });
        }
        if (err.message === 'DUPLICATE_TITLE') {
          return reply.code(409).send({
            code: 'DUPLICATE_TITLE',
            message: 'A mandala with this title already exists',
          });
        }
        throw err;
      }
    }
  );

  // ─── Dashboard endpoint (must be before /:id to avoid path conflicts) ───

  /**
   * GET /api/v1/mandalas/:id/dashboard - Get dashboard view data for a mandala
   */
  fastify.get<{ Params: { id: string } }>(
    '/:id/dashboard',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const userId = getUserId(request, reply);
      if (!userId) return;

      const mandala = await getMandalaManager().getMandalaById(userId, request.params.id);
      if (!mandala) {
        return reply.code(404).send({ error: 'Mandala not found' });
      }

      const levels: any[] = (mandala as any).levels ?? [];
      const rootLevel = levels.find((l: any) => l.depth === 0);
      const childLevels = levels
        .filter((l: any) => l.depth === 1)
        .sort((a: any, b: any) => a.position - b.position);

      const centerLabel =
        rootLevel?.centerLabel || rootLevel?.centerGoal || (mandala as any).title || '';
      const subLabels: string[] = rootLevel?.subjects ?? [];

      // Count cards per cell — single unified query instead of 4 separate Prisma calls.
      // Combines user_local_cards + user_video_states, handles both level_id-based
      // and root+cell_index mapping in one SQL round-trip.
      const prisma = getPrismaClient();
      const mandalaId = request.params.id;

      // Build level_id → position lookup
      const levelKeyToPosition = new Map<string, number>();
      for (const child of childLevels) {
        levelKeyToPosition.set(child.levelKey, child.position);
      }

      const cardCountRows: Array<{ cell_pos: number; cnt: number }> = await prisma.$queryRaw`
        SELECT cell_pos, SUM(cnt)::int AS cnt FROM (
          -- local cards with level_id mapping
          SELECT CASE
            WHEN level_id = 'root' THEN cell_index
            ELSE (SELECT position FROM user_mandala_levels WHERE level_key = level_id AND mandala_id = ${mandalaId}::uuid LIMIT 1)
          END AS cell_pos, 1 AS cnt
          FROM user_local_cards
          WHERE mandala_id = ${mandalaId}::uuid AND user_id = ${userId}::uuid
            AND (level_id IS NOT NULL AND level_id != 'scratchpad' AND level_id != '')
          UNION ALL
          -- video states with level_id mapping
          SELECT CASE
            WHEN level_id = 'root' THEN cell_index
            ELSE (SELECT position FROM user_mandala_levels WHERE level_key = level_id AND mandala_id = ${mandalaId}::uuid LIMIT 1)
          END AS cell_pos, 1 AS cnt
          FROM user_video_states
          WHERE mandala_id = ${mandalaId}::uuid AND user_id = ${userId}::uuid
            AND (level_id IS NOT NULL AND level_id != 'scratchpad' AND level_id != '')
        ) combined
        WHERE cell_pos >= 0 AND cell_pos < 8
        GROUP BY cell_pos
      `;

      const cardCountByPosition = new Map<number, number>();
      for (const row of cardCountRows) {
        cardCountByPosition.set(row.cell_pos, row.cnt);
      }

      // Build cells from child levels (8 slots, positions 0-7)
      const cells = Array.from({ length: 8 }, (_, pos) => {
        const child = childLevels.find((l: any) => l.position === pos);
        if (!child) {
          return {
            label: subLabels[pos] ?? '',
            videoCount: cardCountByPosition.get(pos) ?? 0,
            totalSlots: 8,
            isActive: (cardCountByPosition.get(pos) ?? 0) > 0,
          };
        }
        const cardCount = cardCountByPosition.get(pos) ?? 0;
        return {
          label: child.centerGoal || subLabels[pos] || '',
          videoCount: cardCount,
          totalSlots: 8,
          isActive: cardCount > 0,
        };
      });

      const filledCells = cells.filter((c) => c.videoCount > 0).length;
      const totalVideos = cells.reduce((sum, c) => sum + c.videoCount, 0);

      // Skills from user_skill_config
      const skillConfigs = await getPrismaClient().user_skill_config.findMany({
        where: { user_id: userId, mandala_id: request.params.id },
        select: { skill_type: true, enabled: true },
      });
      const skills: Record<string, boolean> = {};
      for (const sc of skillConfigs) {
        skills[sc.skill_type] = sc.enabled;
      }

      return reply.send({
        mandala: {
          id: (mandala as any).id,
          title: (mandala as any).title,
          centerLabel,
          subLabels,
        },
        cells,
        skills,
        stats: {
          filledCells,
          totalCells: 64,
          totalVideos,
          streakDays: 0,
        },
      });
    }
  );

  /**
   * GET /api/v1/mandalas/:id/recommendations - Read-only recommendation feed
   *
   * Returns recommendation_cache rows for the given mandala, optionally filtered
   * by cell_index. Rows are produced by the video-discover skill plugin
   * (Phase 3) and may be empty for most mandalas until that pipeline runs.
   *
   * Response 200 always returns a `items: []` shape (never 404 for empty).
   * 404 is reserved for "mandala not owned by user".
   */
  fastify.get<{
    Params: { id: string };
    Querystring: { cell_index?: string };
  }>('/:id/recommendations', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const userId = getUserId(request, reply);
    if (!userId) return;

    const mandalaId = request.params.id;

    // Ownership check (returns 404 if not owned, matching dashboard endpoint)
    const mandala = await getMandalaManager().getMandalaById(userId, mandalaId);
    if (!mandala) {
      return reply.code(404).send({ error: 'Mandala not found' });
    }

    // Optional cell_index filter
    let cellIndexFilter: number | undefined;
    if (request.query.cell_index !== undefined) {
      const parsed = Number(request.query.cell_index);
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > 7) {
        return reply.code(400).send({ error: 'cell_index must be an integer in [0, 7]' });
      }
      cellIndexFilter = parsed;
    }

    const prisma = getPrismaClient();

    // Build cell_index → cell_label lookup from depth=1 child levels
    const childLevels = ((mandala as any).levels ?? []).filter((l: any) => l.depth === 1);
    const cellLabelByPosition = new Map<number, string>();
    for (const child of childLevels) {
      if (typeof child.position === 'number' && child.centerGoal) {
        cellLabelByPosition.set(child.position, child.centerGoal);
      }
    }

    // Read pending, unexpired recs ordered by **relevance first, cell second**.
    // CP416 Phase A (2026-04-22): user directive requires relevance-desc
    // sort across all cells, with cell_index as a stable tie-break only.
    // Previous order ([cell_index asc, rec_score desc]) clustered cards by
    // cell, which forced the worst card of cell 0 ahead of the best card
    // of cell 1 — opposite of what relevance-first viewing wants.
    //
    // The `idx_recommendation_cache_rec_score_desc` index on rec_score
    // already exists (see `schema.prisma`), so the re-ordered query hits
    // the index for the primary sort.
    const rows = await prisma.recommendation_cache.findMany({
      where: {
        user_id: userId,
        mandala_id: mandalaId,
        status: RECOMMENDATION_DEFAULT_STATUS,
        expires_at: { gt: new Date() },
        ...(cellIndexFilter !== undefined ? { cell_index: cellIndexFilter } : {}),
      },
      orderBy: [{ rec_score: 'desc' }, { cell_index: 'asc' }],
      take: RECOMMENDATION_FETCH_LIMIT,
    });

    const items = rows.map((row) => ({
      id: row.id,
      videoId: row.video_id,
      title: row.title,
      channel: row.channel,
      thumbnail: row.thumbnail,
      durationSec: row.duration_sec,
      recScore: row.rec_score,
      cellIndex: row.cell_index,
      cellLabel: row.cell_index != null ? (cellLabelByPosition.get(row.cell_index) ?? null) : null,
      keyword: row.keyword,
      source: row.weight_version === 0 ? ('manual' as const) : ('auto_recommend' as const),
      recReason: row.rec_reason,
    }));

    const firstRow = rows[0];
    const lastRefreshed = firstRow
      ? rows
          .reduce((max, r) => (r.created_at > max ? r.created_at : max), firstRow.created_at)
          .toISOString()
      : null;

    return reply.send({
      mandalaId,
      mode: RECOMMENDATION_DEFAULT_MODE,
      items,
      lastRefreshed,
    });
  });

  /**
   * PATCH /api/v1/mandalas/:id/skills - Toggle skill config for a mandala
   *
   * Side effect (CP357): toggling video_discover ON triggers the
   * post-creation pipeline so existing mandalas can backfill recommendations
   * + auto-add cells without requiring a fake mandala edit. The 5-min
   * recent-discover dedup gate (mandala-post-creation.ts) protects
   * YouTube quota against rapid toggle bursts.
   */
  fastify.patch<{
    Params: { id: string };
    Body: { skillType: string; enabled: boolean };
  }>('/:id/skills', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const userId = getUserId(request, reply);
    if (!userId) return;

    const { skillType, enabled } = request.body;

    if (!skillType || typeof enabled !== 'boolean') {
      return reply.code(400).send({ error: 'skillType and enabled (boolean) are required' });
    }

    const prisma = getPrismaClient();

    // Default config payload — wizard fallback uses same shape so the
    // selective-replace pipeline finds {auto_add:true} when first toggled.
    const defaultConfig = skillType === 'video_discover' ? { auto_add: true } : {};

    await prisma.user_skill_config.upsert({
      where: {
        user_id_mandala_id_skill_type: {
          user_id: userId,
          mandala_id: request.params.id,
          skill_type: skillType,
        },
      },
      update: { enabled },
      create: {
        user_id: userId,
        mandala_id: request.params.id,
        skill_type: skillType,
        enabled,
        config: defaultConfig,
      },
    });

    // Backfill trigger: if user just enabled video_discover, kick off the
    // post-creation pipeline. Fire-and-forget — the dedup gate inside
    // runVideoDiscover handles repeated toggles cheaply.
    if (skillType === 'video_discover' && enabled) {
      triggerMandalaPostCreationAsync(userId, request.params.id);
    }

    return reply.send({ success: true, skillType, enabled });
  });

  // ─── Editor endpoints (must be before /:id to avoid path conflicts) ───

  /**
   * GET /api/v1/mandalas/:id/edit-data - Get mandala data in blocks format for the editor
   *
   * Converts the user_mandala_levels structure into 9 EditorBlocks:
   *   blocks[0..3]  = child levels at position 0..3 (depth=1)
   *   blocks[4]     = root level (depth=0, isCenter=true)
   *   blocks[5..8]  = child levels at position 4..7 (depth=1)
   */
  fastify.get<{ Params: { id: string } }>(
    '/:id/edit-data',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const userId = getUserId(request, reply);
      if (!userId) return;

      const mandala = await getMandalaManager().getMandalaById(userId, request.params.id);
      if (!mandala) {
        return reply.code(404).send({ error: 'Mandala not found' });
      }

      const levels: any[] = (mandala as any).levels ?? [];

      const rootLevel = levels.find((l: any) => l.depth === 0);
      const childLevels = levels
        .filter((l: any) => l.depth === 1)
        .sort((a: any, b: any) => a.position - b.position);

      const emptyBlock = (): EditorBlock => ({
        name: '',
        isCenter: false,
        items: ['', '', '', '', '', '', '', ''],
      });

      // Build 8 child slots (positions 0–7); fill missing positions with empty blocks
      const childSlots: EditorBlock[] = Array.from({ length: 8 }, (_, pos) => {
        const child = childLevels.find((l: any) => l.position === pos);
        if (!child) return emptyBlock();
        return {
          name: child.centerGoal ?? '',
          isCenter: false,
          items: Array.isArray(child.subjects) ? child.subjects : ['', '', '', '', '', '', '', ''],
        };
      });

      const centerBlock: EditorBlock = rootLevel
        ? {
            name: rootLevel.centerGoal ?? '',
            isCenter: true,
            items: Array.isArray(rootLevel.subjects)
              ? rootLevel.subjects
              : ['', '', '', '', '', '', '', ''],
          }
        : { name: '', isCenter: true, items: ['', '', '', '', '', '', '', ''] };

      // Final block order: children[0..3], center, children[4..7]
      const blocks: EditorBlock[] = [
        ...childSlots.slice(0, 4),
        centerBlock,
        ...childSlots.slice(4, 8),
      ];

      return reply.send({ blocks });
    }
  );

  /**
   * PUT /api/v1/mandalas/:id/edit-data - Save mandala from blocks format (editor)
   *
   * Converts 9 EditorBlocks back into MandalaLevelBody[] and calls updateMandalaLevels:
   *   blocks[4]     → root level (depth=0, levelKey='root')
   *   blocks[0..3]  → child levels at position 0..3 (depth=1)
   *   blocks[5..8]  → child levels at position 4..7 (depth=1)
   */
  fastify.put<{ Params: { id: string }; Body: { blocks: EditorBlock[] } }>(
    '/:id/edit-data',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const userId = getUserId(request, reply);
      if (!userId) return;

      const { blocks } = request.body;

      if (!Array.isArray(blocks) || blocks.length !== 9) {
        return reply.code(400).send({ error: 'blocks must be an array of exactly 9 items' });
      }

      // Verify ownership before writing
      const mandala = await getMandalaManager().getMandalaById(userId, request.params.id);
      if (!mandala) {
        return reply.code(404).send({ error: 'Mandala not found' });
      }

      // Length guard above (=== 9) ensures these indices are always defined
      const centerBlock = blocks[4] as EditorBlock;

      const rootLevel: MandalaLevelBody = {
        levelKey: 'root',
        depth: 0,
        position: 0,
        centerGoal: centerBlock.name,
        subjects: centerBlock.items,
        parentLevelKey: null,
      };

      // blocks[0..3] → child positions 0..3; blocks[5..8] → child positions 4..7
      const childIndices = [0, 1, 2, 3, 5, 6, 7, 8];
      const childLevels: MandalaLevelBody[] = childIndices.map((blockIdx, childPos) => {
        const block = blocks[blockIdx] as EditorBlock;
        return {
          levelKey: `sector_${childPos}`,
          depth: 1,
          position: childPos,
          centerGoal: block.name,
          subjects: block.items,
          parentLevelKey: 'root',
        };
      });

      try {
        await getMandalaManager().updateMandalaLevels(userId, request.params.id, [
          rootLevel,
          ...childLevels,
        ]);
        return reply.send({ success: true });
      } catch (err: any) {
        if (err.message === 'Mandala not found') {
          return reply.code(404).send({ error: 'Mandala not found' });
        }
        throw err;
      }
    }
  );

  /**
   * GET /api/v1/mandalas/:id - Get specific mandala by ID
   */
  fastify.get<{ Params: { id: string } }>(
    '/:id',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const userId = getUserId(request, reply);
      if (!userId) return;

      const mandala = await getMandalaManager().getMandalaById(userId, request.params.id);

      if (!mandala) {
        return reply.code(404).send({ error: 'Mandala not found' });
      }

      return reply.send({ mandala });
    }
  );

  /**
   * PUT /api/v1/mandalas/:id - Update mandala metadata
   */
  fastify.put<{ Params: { id: string }; Body: UpdateMandalaBody }>(
    '/:id',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const userId = getUserId(request, reply);
      if (!userId) return;

      const { title, isDefault, position } = request.body;

      if (title !== undefined && (typeof title !== 'string' || title.trim().length === 0)) {
        return reply.code(400).send({ error: 'title must be a non-empty string' });
      }

      if (title !== undefined && title.length > 200) {
        return reply.code(400).send({ error: 'title must be 200 characters or less' });
      }

      try {
        const mandala = await getMandalaManager().updateMandala(userId, request.params.id, {
          title: title?.trim(),
          isDefault,
          position,
        });

        return reply.send({ mandala });
      } catch (err: any) {
        if (err.message === 'Mandala not found') {
          return reply.code(404).send({ error: 'Mandala not found' });
        }
        throw err;
      }
    }
  );

  /**
   * PUT /api/v1/mandalas/:id/levels - Replace all levels of a specific mandala
   */
  fastify.put<{ Params: { id: string }; Body: UpdateMandalaLevelsBody }>(
    '/:id/levels',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const userId = getUserId(request, reply);
      if (!userId) return;

      const { levels } = request.body;

      if (!Array.isArray(levels)) {
        return reply.code(400).send({ error: 'levels array is required' });
      }

      try {
        const mandala = await getMandalaManager().updateMandalaLevels(
          userId,
          request.params.id,
          levels
        );

        // Replacing all levels invalidates every sub_goal embedding.
        // The dedup guard absorbs rapid successive level replacements.
        triggerMandalaPostCreationAsync(userId, mandala.id);

        return reply.send({ mandala });
      } catch (err: any) {
        if (err.message === 'Mandala not found') {
          return reply.code(404).send({ error: 'Mandala not found' });
        }
        throw err;
      }
    }
  );

  /**
   * DELETE /api/v1/mandalas/:id - Delete a mandala (cascade deletes levels)
   */
  fastify.delete<{ Params: { id: string } }>(
    '/:id',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const userId = getUserId(request, reply);
      if (!userId) return;

      try {
        await getMandalaManager().deleteMandala(userId, request.params.id);
        return reply.code(204).send();
      } catch (err: any) {
        if (err.message === 'Mandala not found') {
          return reply.code(404).send({ error: 'Mandala not found' });
        }
        request.log.error(
          { err, userId, mandalaId: request.params.id },
          'Failed to delete mandala'
        );
        return reply.code(500).send({
          status: 500,
          code: 'DELETE_FAILED',
          message: 'Failed to delete mandala',
        });
      }
    }
  );

  /**
   * PATCH /api/v1/mandalas/:id/share - Toggle mandala public visibility
   */
  fastify.patch<{ Params: { id: string }; Body: { isPublic: boolean } }>(
    '/:id/share',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const userId = getUserId(request, reply);
      if (!userId) return;

      const { isPublic } = request.body;

      if (typeof isPublic !== 'boolean') {
        return reply.code(400).send({ error: 'isPublic (boolean) is required' });
      }

      try {
        const manager = getMandalaManager();
        const mandala = await manager.togglePublic(userId, request.params.id, isPublic);

        await manager.logActivity(
          request.params.id,
          userId,
          isPublic ? 'share_enabled' : 'share_disabled',
          'mandala'
        );

        return reply.send({ mandala });
      } catch (err: any) {
        if (err.message === 'Mandala not found') {
          return reply.code(404).send({ error: 'Mandala not found' });
        }
        throw err;
      }
    }
  );

  /**
   * POST /api/v1/mandalas/:id/subscribe - Subscribe to a public mandala
   */
  fastify.post<{ Params: { id: string } }>(
    '/:id/subscribe',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const userId = getUserId(request, reply);
      if (!userId) return;

      try {
        await getMandalaManager().subscribe(userId, request.params.id);
        return reply.code(201).send({ success: true });
      } catch (err: any) {
        if (err.message === 'Mandala not found or not public') {
          return reply.code(404).send({ error: 'Mandala not found or not public' });
        }
        if (err.message === 'Cannot subscribe to own mandala') {
          return reply.code(400).send({ error: 'Cannot subscribe to own mandala' });
        }
        if (err.code === 'P2002') {
          return reply.code(409).send({ error: 'Already subscribed' });
        }
        throw err;
      }
    }
  );

  /**
   * DELETE /api/v1/mandalas/:id/subscribe - Unsubscribe from a mandala
   */
  fastify.delete<{ Params: { id: string } }>(
    '/:id/subscribe',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const userId = getUserId(request, reply);
      if (!userId) return;

      try {
        await getMandalaManager().unsubscribe(userId, request.params.id);
        return reply.code(204).send();
      } catch (err: any) {
        if (err.message === 'Subscription not found') {
          return reply.code(404).send({ error: 'Subscription not found' });
        }
        throw err;
      }
    }
  );

  /**
   * GET /api/v1/mandalas/:id/mood - Get mood state for a mandala
   */
  fastify.get<{ Params: { id: string } }>(
    '/:id/mood',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const userId = getUserId(request, reply);
      if (!userId) return;

      const result = await getMood(request.params.id, userId);
      return reply.send(result);
    }
  );

  /**
   * GET /api/v1/mandalas/:id/activity - Get activity log for a public mandala
   */
  fastify.get<{ Params: { id: string }; Querystring: { page?: string; limit?: string } }>(
    '/:id/activity',
    async (request, reply) => {
      const page = request.query.page ? parseInt(request.query.page, 10) : undefined;
      const limit = request.query.limit ? parseInt(request.query.limit, 10) : undefined;

      try {
        const result = await getMandalaManager().getActivityLog(request.params.id, { page, limit });
        return reply.send(result);
      } catch (err: any) {
        if (err.message === 'Mandala not found or not public') {
          return reply.code(404).send({ error: 'Mandala not found or not public' });
        }
        throw err;
      }
    }
  );

  /**
   * POST /api/v1/mandalas/:id/trigger-pipeline — Manual pipeline re-trigger
   * Used by the Retry button when card recommendations fail.
   * Checks ownership + 5-min dedup gate to prevent quota abuse.
   */
  fastify.post<{ Params: { id: string } }>(
    '/:id/trigger-pipeline',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const userId = getUserId(request, reply);
      if (!userId) return;

      const mandalaId = request.params.id;

      // Ownership check
      const db = getPrismaClient();
      const mandala = await db.user_mandalas.findFirst({
        where: { id: mandalaId, user_id: userId },
        select: { id: true },
      });
      if (!mandala) {
        return reply
          .code(404)
          .send({ status: 404, code: 'NOT_FOUND', message: 'Mandala not found' });
      }

      // 5-min dedup gate — prevent rapid re-triggers
      const recentRun = await db.mandala_pipeline_runs.findFirst({
        where: {
          mandala_id: mandalaId,
          created_at: { gte: new Date(Date.now() - 5 * 60 * 1000) },
        },
        orderBy: { created_at: 'desc' },
      });
      if (recentRun) {
        return reply.code(429).send({
          status: 429,
          code: 'PIPELINE_COOLDOWN',
          message: 'Pipeline was triggered recently. Please wait 5 minutes.',
        });
      }

      triggerMandalaPostCreationAsync(userId, mandalaId, 'manual-retry');
      return reply.send({ status: 200, message: 'Pipeline triggered' });
    }
  );

  /**
   * GET /api/v1/mandalas/:id/pipeline-status — Pipeline run status
   * Returns latest pipeline run with per-step status for frontend polling.
   */
  fastify.get<{ Params: { id: string } }>(
    '/:id/pipeline-status',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      if (!request.user || !('userId' in request.user)) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      const db = getPrismaClient();
      const run = await db.mandala_pipeline_runs.findFirst({
        where: { mandala_id: request.params.id, user_id: request.user.userId },
        orderBy: { created_at: 'desc' },
      });

      if (!run) {
        return reply.send({ status: 'none', steps: {}, cardCount: 0 });
      }

      const cardCount = await db.userVideoState.count({
        where: { mandala_id: request.params.id, user_id: request.user.userId },
      });

      return reply.send({
        status: run.status,
        steps: {
          embeddings: {
            status: run.step1_status ?? 'pending',
            startedAt: run.step1_started_at,
            endedAt: run.step1_ended_at,
          },
          discover: {
            status: run.step2_status ?? 'pending',
            startedAt: run.step2_started_at,
            endedAt: run.step2_ended_at,
          },
          autoAdd: {
            status: run.step3_status ?? 'pending',
            startedAt: run.step3_started_at,
            endedAt: run.step3_ended_at,
          },
        },
        cardCount,
        retryCount: run.retry_count,
        createdAt: run.created_at,
        completedAt: run.completed_at,
      });
    }
  );

  /**
   * GET /api/v1/mandalas/:id/videos/stream — SSE card stream
   *
   * Phase 1 slice 2 (post-SGNL-parity audit): clients subscribe to
   * live card events for a mandala. Each time the v3 executor
   * upserts a row into recommendation_cache, `notifyCardAdded`
   * publishes a `card_added` event which this handler forwards as
   * a Server-Sent Event. First card visible ~1-2s instead of
   * waiting for the whole discover pipeline to complete.
   *
   * Events:
   *   - `card_added`  — one recommendation_cache row (CardPayload)
   *   - `heartbeat`   — every 20s; keeps ALB / CDN from idle-closing
   *   - `end`         — server explicitly closes; client stops
   *                     listening and may fall back to polling
   *                     `/recommendations` for stragglers.
   *
   * Fallback: on SSE failure (browser unsupported, network, server
   * down), the client should gracefully degrade to the existing
   * `GET /recommendations` polling path. This handler is purely
   * additive — the read-only `/recommendations` endpoint continues
   * to serve the canonical recommendation_cache view.
   *
   * Auth: requires the same ownership check as /recommendations.
   * Non-owners receive 404.
   */
  fastify.get<{ Params: { id: string } }>(
    '/:id/videos/stream',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const userId = getUserId(request, reply);
      if (!userId) return;

      const mandalaId = request.params.id;
      const mandala = await getMandalaManager().getMandalaById(userId, mandalaId);
      if (!mandala) {
        return reply.code(404).send({ error: 'Mandala not found' });
      }

      // Tell Fastify we're taking over the socket for a long-lived
      // SSE stream. Without hijack(), Fastify would try to send a
      // JSON body on handler return and double-close the response.
      // `void` suppresses the eslint no-floating-promises check —
      // hijack() is synchronous but typed as returning the reply.
      void reply.hijack();

      const raw = reply.raw;
      raw.setHeader('Content-Type', 'text/event-stream');
      raw.setHeader('Cache-Control', 'no-cache');
      raw.setHeader('Connection', 'keep-alive');
      // Disables buffering on nginx + some CDNs so events flush
      // immediately instead of after N bytes.
      raw.setHeader('X-Accel-Buffering', 'no');
      raw.statusCode = 200;
      // Initial retry hint + comment so the stream is open for
      // EventSource (it waits for the first \n\n before firing
      // `open`).
      raw.write('retry: 5000\n\n');
      raw.write(`: connected mandala=${mandalaId}\n\n`);

      const write = (event: string, data: unknown): void => {
        if (raw.destroyed) return;
        raw.write(`event: ${event}\n`);
        raw.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      // CP416 Phase B (2026-04-22): emit the backlog of already-upserted
      // recommendation_cache rows before attaching the live subscriber.
      // Without this, a client connecting after the wizard-stream
      // pipeline has already finished (e.g. user navigating to dashboard
      // a few seconds post-creation) would see an empty stream until the
      // next upsert fires — and the initial `useRecommendations` poll
      // carries a 5-minute stale-time window that can delay the backlog
      // arrival further.
      //
      // Ordering: `rec_score DESC, cell_index ASC` matches the
      // canonical /recommendations ordering set by CP416 Phase A so the
      // client sees the same relevance-first sort whether it's hitting
      // the poll or the stream backlog.
      //
      // Build a `cellIndex → cellLabel` lookup the same way
      // /recommendations does, so the payload shape is identical to the
      // live push path.
      const childLevelsForStream = ((mandala as any).levels ?? []).filter(
        (l: any) => l.depth === 1
      );
      const cellLabelByPosition = new Map<number, string>();
      for (const child of childLevelsForStream) {
        if (typeof child.position === 'number' && child.centerGoal) {
          cellLabelByPosition.set(child.position, child.centerGoal);
        }
      }

      const backlogRows = await getPrismaClient().recommendation_cache.findMany({
        where: {
          user_id: userId,
          mandala_id: mandalaId,
          status: RECOMMENDATION_DEFAULT_STATUS,
          expires_at: { gt: new Date() },
        },
        orderBy: [{ rec_score: 'desc' }, { cell_index: 'asc' }],
        take: RECOMMENDATION_FETCH_LIMIT,
      });

      for (const row of backlogRows) {
        const payload: CardPayload = {
          id: row.id,
          videoId: row.video_id,
          title: row.title,
          channel: row.channel,
          thumbnail: row.thumbnail,
          durationSec: row.duration_sec,
          recScore: row.rec_score,
          cellIndex: row.cell_index ?? -1,
          cellLabel:
            row.cell_index != null ? (cellLabelByPosition.get(row.cell_index) ?? null) : null,
          keyword: row.keyword,
          source: row.weight_version === 0 ? 'manual' : 'auto_recommend',
          recReason: row.rec_reason,
        };
        write('card_added', payload);
      }
      write('backlog_done', { count: backlogRows.length });

      const unsubscribe = cardPublisher.subscribe(mandalaId, (payload: CardPayload) => {
        write('card_added', payload);
      });

      const heartbeatInterval = setInterval(() => {
        if (raw.destroyed) return;
        raw.write(`event: heartbeat\ndata: {"ts":${Date.now()}}\n\n`);
      }, 20_000);

      const cleanup = (): void => {
        unsubscribe();
        clearInterval(heartbeatInterval);
      };

      request.raw.on('close', cleanup);
      request.raw.on('error', cleanup);

      // Keep the handler promise pending until the client
      // disconnects, otherwise Fastify resolves the route and some
      // middleware stacks interpret that as "response done" even
      // after hijack(). This await resolves in cleanup when the
      // close listener fires.
      await new Promise<void>((resolve) => {
        request.raw.once('close', resolve);
      });
    }
  );

  /**
   * POST /api/v1/mandalas/:id/rich-summary-trigger — CP423 Trigger 1 entrypoint.
   *
   * Called fire-and-forget by the wizard after mandala creation. Reads the
   * user's cards for that mandala and enqueues enrich-video jobs with
   * withRichSummary=true. Idempotent: repeated calls are safe.
   *
   * Previously lived under videoRoutes (/videos prefix) causing a URL
   * mismatch — FE called /mandalas/:id/... but route resolved to
   * /videos/mandalas/:id/... → silent 404. Moved here CP426.
   */
  fastify.post<{ Params: { id: string } }>(
    '/:id/rich-summary-trigger',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const userId = getUserId(request, reply);
      if (!userId) return;

      const { id: mandalaId } = request.params;

      const owned = await getPrismaClient().user_mandalas.findFirst({
        where: { id: mandalaId, user_id: userId },
        select: { id: true },
      });
      if (!owned) {
        return reply.code(404).send({ status: 'error', error: 'Mandala not found' });
      }

      const { enqueueRichSummaryForMandalaCards } =
        await import('../../modules/skills/rich-summary-trigger');
      const result = await enqueueRichSummaryForMandalaCards({ userId, mandalaId });
      return reply.code(202).send({ status: 'ok', data: result });
    }
  );

  done();
};
