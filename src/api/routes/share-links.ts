/**
 * Share v2 routes (2026-07-14, docs/design/share-v2-2026-07-14.md).
 *
 * POST /api/v1/share-links      — mint a short link (auth, ownership checked)
 * GET  /api/v1/s/:code          — public resolver: every agent gets an OG-meta
 *                                 HTML page (SNS bots read the card) that
 *                                 immediately redirects humans to the target
 *                                 surface. Same pattern as og.ts.
 *
 * nginx maps insighta.one/s/ → ${API_URL}/api/v1/s/ so the short URL never
 * touches the SPA shell.
 */

import { FastifyInstance } from 'fastify';
import { getPrismaClient } from '@/modules/database/client';
import { config } from '@/config/index';
import {
  createShareLink,
  resolveShareLink,
  ShareLinkError,
  type ShareLinkRow,
  type ShareMode,
  type ShareTargetType,
} from '@/modules/share-links/manager';
import { resolveOgMeta } from './og';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function ogPage(opts: {
  title: string;
  description: string;
  image: string;
  pageUrl: string;
  redirectTo: string | null;
}): string {
  const t = escapeHtml(opts.title);
  const d = escapeHtml(opts.description);
  const img = escapeHtml(opts.image);
  const u = escapeHtml(opts.pageUrl);
  const redirect = opts.redirectTo
    ? `<meta http-equiv="refresh" content="0; url=${escapeHtml(opts.redirectTo)}">`
    : '';
  const redirectScript = opts.redirectTo
    ? `<script>window.location.replace(${JSON.stringify(opts.redirectTo)});</script>`
    : '';
  const body = opts.redirectTo
    ? `<p>이동 중… <a href="${escapeHtml(opts.redirectTo)}">${t}</a></p>`
    : `<main style="font-family:-apple-system,sans-serif;max-width:26rem;margin:18vh auto;padding:0 1.2rem;text-align:center">
<h1 style="font-size:1.15rem">${t}</h1>
<p style="color:#666;line-height:1.6">${d}</p>
<p><a href="${escapeHtml(config.share.publicOrigin)}" style="color:#CE5F30;font-weight:700">인사이타 시작하기</a></p>
</main>`;
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${t}</title>
<meta name="description" content="${d}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="다이얼 — Insighta">
<meta property="og:title" content="${t}">
<meta property="og:description" content="${d}">
<meta property="og:image" content="${img}">
<meta property="og:url" content="${u}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${t}">
<meta name="twitter:description" content="${d}">
<meta name="twitter:image" content="${img}">
${redirect}
</head>
<body>${body}${redirectScript}</body>
</html>`;
}

/** POST /api/v1/share-links — prefix '/share-links' */
export async function shareLinkMintRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post<{
    Body: {
      targetType?: ShareTargetType;
      targetId?: string;
      videoId?: string;
      mode?: ShareMode;
      expiresInDays?: number;
    };
  }>('/', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const userId = (request.user as { userId?: string } | undefined)?.userId;
    if (!userId) return reply.code(401).send({ status: 'error', error: 'Unauthorized' });

    const { targetType, targetId, videoId, mode, expiresInDays } = request.body ?? {};
    if (
      targetType !== 'note_episode' &&
      targetType !== 'learning_video' &&
      targetType !== 'mandala'
    ) {
      return reply.code(400).send({ status: 'error', error: 'invalid targetType' });
    }
    if (!targetId || !/^[0-9a-f-]{36}$/i.test(targetId)) {
      return reply.code(400).send({ status: 'error', error: 'invalid targetId' });
    }
    if (
      expiresInDays != null &&
      (typeof expiresInDays !== 'number' || expiresInDays <= 0 || expiresInDays > 365)
    ) {
      return reply.code(400).send({ status: 'error', error: 'invalid expiresInDays' });
    }

    try {
      const link = await createShareLink({
        targetType,
        targetId,
        videoId,
        mode,
        expiresInDays,
        userId,
      });
      return reply.code(200).send({ status: 'ok', data: link });
    } catch (err) {
      if (err instanceof ShareLinkError && err.code === 'TARGET_NOT_FOUND') {
        return reply.code(404).send({ status: 'error', error: 'Mandala not found' });
      }
      throw err;
    }
  });
}

/** GET /api/v1/s/:code — prefix '/s', public. */
export async function shareLinkResolverRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get<{ Params: { code: string } }>('/:code', async (request, reply) => {
    const origin = config.share.publicOrigin;
    const pageUrl = `${origin}/s/${encodeURIComponent(request.params.code)}`;
    const brandImage = `${origin}/dial/og.png`;

    const { state, row } = await resolveShareLink(request.params.code);

    if (state !== 'valid' || !row) {
      const title = state === 'expired' ? '공유 링크가 만료됐어요' : '열 수 없는 링크예요';
      const description =
        state === 'expired'
          ? '48시간 무료 청취 기간이 끝났어요. 로그인하면 나만의 지식노트를 만들 수 있어요.'
          : '링크가 철회됐거나 잘못된 주소예요.';
      return reply
        .code(state === 'unknown' ? 404 : 410)
        .header('Content-Type', 'text/html; charset=utf-8')
        .header('Cache-Control', 'no-store')
        .send(ogPage({ title, description, image: brandImage, pageUrl, redirectTo: null }));
    }

    const meta = await targetMeta(row, origin);
    return (
      reply
        .header('Content-Type', 'text/html; charset=utf-8')
        // Short cache: bots re-scrape fresh cards; humans redirect instantly.
        .header('Cache-Control', 'public, max-age=300')
        .send(ogPage({ image: brandImage, ...meta, pageUrl }))
    );
  });
}

async function targetMeta(
  row: ShareLinkRow,
  origin: string
): Promise<{ title: string; description: string; redirectTo: string; image?: string }> {
  const prisma = getPrismaClient();
  const mandala = await prisma.user_mandalas.findFirst({
    where: { id: row.target_id },
    select: { title: true },
  });
  const noteTitle = mandala?.title ?? '공유된 노트';

  switch (row.target_type) {
    case 'note_episode':
      return {
        title: `${noteTitle} — 다이얼`,
        description: '가입 없이 48시간 무료 청취 · AI가 유튜브 핵심 구간만 이어 만든 지식 팟캐스트',
        redirectTo: `${origin}/mobile/?s=${encodeURIComponent(row.code)}`,
      };
    case 'learning_video': {
      // Card parity with the legacy /og/learning route: video title,
      // AI one-liner, real thumbnail (og.ts is the single resolver).
      if (row.video_id) {
        const og = await resolveOgMeta(row.target_id, row.video_id);
        return {
          title: og.title,
          description: og.description,
          image: og.thumbnail,
          redirectTo: `${origin}${og.spaPath}`,
        };
      }
      return {
        title: `${noteTitle} — Insighta`,
        description: 'AI가 고른 유튜브 핵심 구간으로 배우는 나만의 커리큘럼',
        redirectTo: `${origin}/learning/${row.target_id}/${row.video_id ?? ''}`,
      };
    }
    case 'mandala': // Phase 3 — recipient page lands here
    default:
      return {
        title: `${noteTitle} — Insighta`,
        description: '공유된 만다라 — 나의 학습 목표가 유튜브를 큐레이션한다',
        redirectTo: origin,
      };
  }
}
