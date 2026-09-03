/**
 * Public brief pages, server-rendered.
 *
 * Server-rendered rather than fetched by the SPA because a brief exists to be
 * shared: a link with no preview card does not get forwarded, and a page that
 * needs JavaScript to show its first paragraph is not indexed. This is also
 * what removes the false 200 -- the static path under frontend/public falls
 * through to index.html, so a slug that does not exist answers 200 with the
 * app shell. Here a missing slug is a 404.
 *
 * Rendering happens per request rather than at publish, so raising the default
 * template re-skins every past issue. The response is cached by slug and
 * template version; because the key carries the version, publishing a new
 * template invalidates it by construction.
 */

import { FastifyInstance } from 'fastify';
import { getPrismaClient } from '@/modules/database/client';
import { IssueDocumentSchema } from '@/modules/newsletter/issue-schema';
import { renderWeb, renderCacheKey } from '@/modules/newsletter/render-web';
import { BRIEF_CATEGORIES, CATEGORY_KEYS, categoryLabel } from '@/modules/newsletter/categories';
import { userIdOf } from '@/api/utils/request-user';

const SLUG = /^[a-z0-9-]{3,80}$/;

/** An issue changes only when an editor republishes it, so this can be long. */
const CACHE_SECONDS = 300;

/**
 * Process-local. A brief is a few tens of kilobytes and there are at most a
 * few hundred, so this stays small; moving it to redis is a scaling decision,
 * not a correctness one, and the key shape does not change when it moves.
 */
const cache = new Map<string, string>();

export function clearBriefCache(): void {
  cache.clear();
}

export async function briefRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /api/v1/brief/subscribed
   *
   * The issues this reader can open, newest first, with whether each is read.
   *
   * The sidebar needs this to have anything to show. Without it the reading
   * surface was reachable only by typing a URL or following a link out of an
   * inbox: a subscriber who signed in and looked around found no way to the
   * brief they had just subscribed to.
   */
  fastify.get('/subscribed', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const userId = userIdOf(request);
    if (!userId) return reply.code(401).send({ status: 'error', error: 'unauthenticated' });

    const rows = await getPrismaClient().$queryRaw<
      Array<{
        slug: string;
        category_key: string;
        issue_no: number;
        published_at: Date;
        headline: string | null;
        dek: string | null;
        cover_video_id: string | null;
        issue_label: string | null;
        date_label: string | null;
        read_at: Date | null;
      }>
    >`
      SELECT i.slug,
             i.category_key,
             i.issue_no,
             i.published_at,
             i.content_json->'headline'->>0  AS headline,
             i.content_json->>'dek'          AS dek,
             -- The card's cover is the issue's lead pick. A brief has no
             -- artwork of its own, and inventing one would put a picture on
             -- the shelf that is in no way about what is inside it.
             i.content_json->'picks'->0->>'videoId' AS cover_video_id,
             i.content_json->>'issueLabel'   AS issue_label,
             i.content_json->>'dateLabel'    AS date_label,
             r.read_at
        FROM newsletter_issues i
        JOIN newsletter_subscriptions s
          ON s.category_key = i.category_key AND s.user_id = ${userId}::uuid
        LEFT JOIN newsletter_reads r
          ON r.slug = i.slug AND r.user_id = ${userId}::uuid
       WHERE i.published_at IS NOT NULL
       ORDER BY i.published_at DESC
       LIMIT 50
    `;

    return reply.send({
      status: 'ok',
      data: {
        issues: rows.map((r) => ({
          slug: r.slug,
          categoryKey: r.category_key,
          categoryLabel: categoryLabel(r.category_key),
          issueNo: r.issue_no,
          publishedAt: r.published_at.toISOString(),
          headline: r.headline ?? '',
          dek: r.dek ?? '',
          coverVideoId: r.cover_video_id,
          issueLabel: r.issue_label ?? `제${r.issue_no}호`,
          dateLabel: r.date_label ?? '',
          read: r.read_at !== null,
        })),
        unread: rows.filter((r) => r.read_at === null).length,
      },
    });
  });

  /**
   * GET /api/v1/brief/categories
   *
   * The ten briefs and whether this reader takes each one.
   *
   * Every category is listed, subscribed or not — a reader deciding what to
   * add needs to see what exists, and a list that shows only what they already
   * have cannot be that.
   */
  fastify.get('/categories', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const userId = userIdOf(request);
    if (!userId) return reply.code(401).send({ status: 'error', error: 'unauthenticated' });

    const rows = await getPrismaClient().$queryRaw<Array<{ category_key: string }>>`
      SELECT category_key FROM newsletter_subscriptions WHERE user_id = ${userId}::uuid
    `;
    const mine = new Set(rows.map((r) => r.category_key));

    // Which categories have ever published. A reader should not subscribe to a
    // brief that does not exist yet, and saying so is more honest than hiding
    // it — the list is the roadmap.
    const live = await getPrismaClient().$queryRaw<Array<{ category_key: string; n: bigint }>>`
      SELECT category_key, count(*) AS n
        FROM newsletter_issues WHERE published_at IS NOT NULL GROUP BY category_key
    `;
    const issueCount = new Map(live.map((l) => [l.category_key, Number(l.n)]));

    return reply.send({
      status: 'ok',
      data: {
        categories: BRIEF_CATEGORIES.map((c) => ({
          key: c.key,
          label: c.label,
          blurb: c.blurb,
          subscribed: mine.has(c.key),
          issues: issueCount.get(c.key) ?? 0,
        })),
      },
    });
  });

  /**
   * POST /api/v1/brief/unsubscribe
   *
   * Stop taking a brief, from inside the app.
   *
   * Distinct from `GET /u/:token`, which is the link in an email and takes no
   * login — someone who wants out of their inbox must not have to sign in
   * first. The two solve different problems and either has to work without the
   * other: this one ends a subscription, that one suppresses delivery.
   */
  fastify.post<{ Body: { categoryKey?: string } }>(
    '/unsubscribe',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const userId = userIdOf(request);
      if (!userId) return reply.code(401).send({ status: 'error', error: 'unauthenticated' });

      const categoryKey = request.body?.categoryKey;
      if (!categoryKey || !CATEGORY_KEYS.has(categoryKey)) {
        return reply.code(400).send({ status: 'error', error: 'invalid categoryKey' });
      }

      await getPrismaClient().$executeRaw`
        DELETE FROM newsletter_subscriptions
         WHERE user_id = ${userId}::uuid AND category_key = ${categoryKey}
      `;
      return reply.send({ status: 'ok', data: { subscribed: false, categoryKey } });
    }
  );

  /**
   * POST /api/v1/brief/:slug/read
   *
   * Mark an issue read. Recorded on arrival, not on scroll depth: a row here
   * means the reader opened it, and nothing more is claimed.
   */
  fastify.post<{ Params: { slug: string } }>(
    '/:slug/read',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const userId = userIdOf(request);
      if (!userId) return reply.code(401).send({ status: 'error', error: 'unauthenticated' });

      const { slug } = request.params;
      if (!SLUG.test(slug)) {
        return reply.code(400).send({ status: 'error', error: 'invalid slug' });
      }

      // The foreign key refuses a slug that is not an issue, so a typo cannot
      // create a read of nothing.
      await getPrismaClient().$executeRaw`
        INSERT INTO newsletter_reads (user_id, slug)
        VALUES (${userId}::uuid, ${slug})
        ON CONFLICT (user_id, slug) DO NOTHING
      `;
      return reply.send({ status: 'ok', data: { read: true, slug } });
    }
  );

  /**
   * POST /api/v1/brief/subscribe
   *
   * The CTA in an issue is the subscribe action.
   *
   * A reader gets a digest by mail, follows "전체 브리프 읽기", signs in if they
   * are not already, and lands on the issue in the note surface. That arrival
   * is the opt-in — asking them to press a second button after they have
   * already crossed from an inbox into an account would be asking twice.
   *
   * Keyed on the account rather than the delivered address: the two are not
   * always the same person's, and the account is who reads.
   *
   * Idempotent. A reader who opens three issues subscribes once, and the row
   * keeps the slug that first brought them.
   */
  fastify.post<{ Body: { categoryKey?: string; fromSlug?: string } }>(
    '/subscribe',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const userId = userIdOf(request);
      if (!userId) return reply.code(401).send({ status: 'error', error: 'unauthenticated' });

      const categoryKey = request.body?.categoryKey;
      if (!categoryKey || !/^[a-z0-9-]{2,40}$/.test(categoryKey)) {
        return reply.code(400).send({ status: 'error', error: 'invalid categoryKey' });
      }
      const fromSlug = request.body?.fromSlug;

      await getPrismaClient().$executeRaw`
        INSERT INTO newsletter_subscriptions (user_id, category_key, source, from_slug)
        VALUES (${userId}::uuid, ${categoryKey}, 'cta', ${fromSlug ?? null})
        ON CONFLICT (user_id, category_key) DO NOTHING
      `;

      return reply.send({ status: 'ok', data: { subscribed: true, categoryKey } });
    }
  );

  /**
   * GET /api/v1/brief/:slug/document
   *
   * The issue as data, for the surface that renders it itself.
   *
   * The HTML route beside this one is a review page and a shareable link. The
   * place a subscriber reads an issue is the note screen, which renders a
   * TipTap document — so it needs the issue, not a page. Handing it the HTML
   * would mean parsing a rendered page back into a document, which is how two
   * surfaces drift apart.
   *
   * Same access rule as the page: `published_at IS NULL` is unreachable, so a
   * draft cannot be read by guessing a slug here either.
   */
  fastify.get<{ Params: { slug: string } }>('/:slug/document', async (request, reply) => {
    const { slug } = request.params;
    if (!SLUG.test(slug)) {
      return reply.code(400).send({ status: 'error', error: 'invalid slug' });
    }

    const row = await getPrismaClient().newsletter_issues.findFirst({
      where: { slug, published_at: { not: null } },
      select: {
        content_json: true,
        template_version: true,
        locale: true,
        published_at: true,
        updated_at: true,
      },
    });
    if (!row) return reply.code(404).send({ status: 'error', error: 'not found' });

    const parsed = IssueDocumentSchema.safeParse(row.content_json);
    if (!parsed.success) {
      request.log.error(
        { slug, issues: parsed.error.issues.slice(0, 3) },
        'brief content_json failed schema validation'
      );
      return reply.code(500).send({ status: 'error', error: 'brief is unreadable' });
    }

    return reply
      .header('Cache-Control', `public, max-age=${CACHE_SECONDS}`)
      .header('Last-Modified', row.updated_at.toUTCString())
      .send({
        status: 'ok',
        data: {
          issue: {
            ...parsed.data,
            templateVersion: row.template_version,
            locale: row.locale === 'en' ? 'en' : 'ko',
            publishedAt: row.published_at?.toISOString() ?? parsed.data.publishedAt,
          },
        },
      });
  });

  fastify.get<{ Params: { slug: string } }>('/:slug', async (request, reply) => {
    const { slug } = request.params;
    if (!SLUG.test(slug)) {
      return reply.code(400).type('text/plain; charset=utf-8').send('invalid slug');
    }

    const row = await getPrismaClient().newsletter_issues.findFirst({
      // A draft has no published_at, so it cannot be reached by guessing a
      // slug -- the filter is the access control, not an ordering hint.
      where: { slug, published_at: { not: null } },
      select: { content_json: true, template_version: true, locale: true, updated_at: true },
    });
    if (!row) {
      return reply.code(404).type('text/plain; charset=utf-8').send('brief not found');
    }

    const parsed = IssueDocumentSchema.safeParse(row.content_json);
    if (!parsed.success) {
      // A stored issue that no longer matches the contract is a bug in whatever
      // wrote it, not something to paper over with a half-rendered page.
      request.log.error(
        { slug, issues: parsed.error.issues.slice(0, 3) },
        'brief content_json failed schema validation'
      );
      return reply.code(500).type('text/plain; charset=utf-8').send('brief is unreadable');
    }

    // The stored columns win over the copies inside the document: they are
    // what an operator edits to pin a template or correct an edition's
    // language without rewriting the JSON.
    const doc = {
      ...parsed.data,
      templateVersion: row.template_version,
      locale: row.locale === 'en' ? ('en' as const) : ('ko' as const),
    };
    const key = renderCacheKey(doc);
    let html = cache.get(key);
    if (html === undefined) {
      html = renderWeb(doc);
      cache.set(key, html);
    }

    return reply
      .header('Cache-Control', `public, max-age=${CACHE_SECONDS}`)
      .header('Last-Modified', row.updated_at.toUTCString())
      .type('text/html; charset=utf-8')
      .send(html);
  });
}

/**
 * Unsubscribe. No login: someone who wants out must not have to get in first,
 * and a link that demands a password is why people press the spam button
 * instead. The token is the whole credential, so it identifies exactly one
 * (email, category) pair and grants nothing else.
 *
 * GET rather than POST because mail clients cannot POST, and idempotent
 * because scanners prefetch links -- a second visit must not undo the first.
 */
export async function unsubscribeRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get<{ Params: { token: string } }>('/:token', async (request, reply) => {
    const { token } = request.params;
    const page = (code: number, title: string, body: string) =>
      reply
        .code(code)
        .type('text/html; charset=utf-8')
        .send(
          `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8">` +
            `<meta name="viewport" content="width=device-width,initial-scale=1">` +
            `<meta name="robots" content="noindex">` +
            `<title>${title}</title></head>` +
            `<body style="margin:0;background:#FBFAF7;color:#191A1C;` +
            `font-family:-apple-system,system-ui,sans-serif;display:flex;` +
            `min-height:100vh;align-items:center;justify-content:center">` +
            `<main style="max-width:34rem;padding:2rem;text-align:center;line-height:1.8">` +
            `<h1 style="font-size:1.25rem;margin:0 0 .75rem">${title}</h1>` +
            `<p style="margin:0;color:#54565B">${body}</p></main></body></html>`
        );

    if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) {
      return page(400, '링크가 올바르지 않습니다', '주소를 다시 확인해 주세요.');
    }

    const row = await getPrismaClient().newsletter_unsubscribes.findUnique({
      where: { token },
      select: { id: true, unsubscribed_at: true },
    });
    if (!row) {
      return page(404, '링크가 만료되었습니다', '이미 처리되었거나 없는 링크입니다.');
    }

    if (row.unsubscribed_at === null) {
      await getPrismaClient().newsletter_unsubscribes.update({
        where: { id: row.id },
        data: { unsubscribed_at: new Date() },
      });
    }

    // Same page whether this was the first visit or the fifth. A prefetching
    // scanner must not produce a different answer from the reader.
    return page(
      200,
      '수신을 해지했습니다',
      '주간 브리프를 더 보내지 않습니다. 다시 받고 싶으시면 인사이타에서 구독하실 수 있습니다.'
    );
  });
}
