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
  fastify.get<{ Params: { slug: string } }>('/:slug', async (request, reply) => {
    const { slug } = request.params;
    if (!SLUG.test(slug)) {
      return reply.code(400).type('text/plain; charset=utf-8').send('invalid slug');
    }

    const row = await getPrismaClient().newsletter_issues.findFirst({
      // A draft has no published_at, so it cannot be reached by guessing a
      // slug -- the filter is the access control, not an ordering hint.
      where: { slug, published_at: { not: null } },
      select: { content_json: true, template_version: true, updated_at: true },
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

    // The stored template_version wins over the one inside the document: it is
    // the column an operator edits to pin or unpin a single issue.
    const doc = { ...parsed.data, templateVersion: row.template_version };
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
