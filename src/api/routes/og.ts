/**
 * Learning-share Open Graph endpoint (CP454+ handoff §3, §5 Phase 5).
 *
 * Why a dedicated route: SPA `/learning/:mandalaId/:videoId` is rendered
 * client-side (Vite CSR). SNS crawlers (Twitter / Facebook / KakaoBot)
 * do not execute JS, so dynamic `og:*` meta is impossible at the SPA URL.
 *
 * This route returns a minimal static HTML with `og:title` / `og:description`
 * / `og:image` resolved from the BE database for each video, plus a meta
 * refresh + JS redirect so a regular browser hitting the URL ends up at the
 * SPA learning page seamlessly.
 *
 * Share URL ALWAYS points at `${origin}/api/v1/og/learning/:m/:v` —
 * `frontend/src/features/learning-share/lib/build-share-urls.ts` enforces
 * this. Recipient flow:
 *   - SNS bot   GET /api/v1/og/learning/:m/:v → reads og:* meta (done)
 *   - User      GET /api/v1/og/learning/:m/:v → meta refresh + JS redirect
 *                                              → SPA /learning/:m/:v
 *
 * Public route (no auth) — only video-level meta is exposed (title /
 * description / thumbnail) which is already publicly visible on YouTube.
 * Mandala ownership is NOT checked; the recipient may not be logged in,
 * and the OG meta carries zero user-scoped data.
 */

import type { FastifyInstance } from 'fastify';
import { getPrismaClient } from '../../modules/database/client';

/** Escape user-controlled strings for safe embedding in HTML attributes
 *  and element bodies. Mitigates HTML injection via title/description. */
function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Take first sentence (terminated by . ! ? or Korean .) or first 140 chars. */
function firstSentence(text: string): string {
  const match = text.match(/^[\s\S]*?[.!?。！？](\s|$)/);
  const candidate = match ? match[0].trim() : text.trim();
  return candidate.length > 140 ? candidate.slice(0, 140).trimEnd() + '…' : candidate;
}

const OG_DEFAULTS = {
  title: 'Insighta',
  description:
    'Organize, annotate, and gain insights from your saved content with AI-powered knowledge management.',
};

/** Resolve title / description / thumbnail / spaPath for a learning share
 *  target. Same logic feeds both the HTML response (SNS bot) and the
 *  `?format=json` response (FE preview card) so the two stay drift-free. */
async function resolveOgMeta(
  mandalaId: string,
  videoId: string
): Promise<{ title: string; description: string; thumbnail: string; spaPath: string }> {
  const prisma = getPrismaClient();

  // YouTube-id form (11 chars). Reject anything else so SQL is bounded.
  const safeVideoId = /^[A-Za-z0-9_-]{11}$/.test(videoId) ? videoId : null;
  const safeMandalaId = /^[0-9a-f-]{36}$/i.test(mandalaId) ? mandalaId : null;

  let title = OG_DEFAULTS.title;
  let description = OG_DEFAULTS.description;
  let thumbnail = '';

  if (safeVideoId) {
    // YouTube's hqdefault thumbnail is deterministic (always exists for
    // any valid video id) — avoid an extra DB read + the youtube_videos
    // schema's `thumbnails` jsonb shape variance (CP475).
    thumbnail = `https://i.ytimg.com/vi/${safeVideoId}/hqdefault.jpg`;

    const yv = await prisma.youtube_videos.findFirst({
      where: { youtube_video_id: safeVideoId },
      select: { title: true },
    });
    if (yv?.title) title = yv.title;

    const vrs = await prisma.video_rich_summaries.findFirst({
      where: { video_id: safeVideoId },
      select: { one_liner: true },
    });
    if (vrs?.one_liner) description = firstSentence(vrs.one_liner);
  }

  const spaPath = safeMandalaId && safeVideoId ? `/learning/${safeMandalaId}/${safeVideoId}` : '/';

  return { title, description, thumbnail, spaPath };
}

export default function ogRoutes(fastify: FastifyInstance): void {
  fastify.get<{
    Params: { mandalaId: string; videoId: string };
    Querystring: { format?: string };
  }>('/learning/:mandalaId/:videoId', async (request, reply) => {
    const { mandalaId, videoId } = request.params;
    const meta = await resolveOgMeta(mandalaId, videoId);

    // FE preview card path — returns the same fields the HTML response
    // would have embedded into og:* meta. Single source of truth so the
    // user-visible preview matches the actual SNS card byte-for-byte.
    if (request.query.format === 'json') {
      return reply
        .header('Content-Type', 'application/json; charset=utf-8')
        .header('Cache-Control', 'public, max-age=300')
        .send(meta);
    }

    const { title, description, thumbnail, spaPath } = meta;
    const safeTitle = escapeHtml(title);
    const safeDescription = escapeHtml(description);
    const safeThumbnail = escapeHtml(thumbnail);
    const safeSpaPath = escapeHtml(spaPath);

    const html = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${safeTitle}</title>
<meta name="description" content="${safeDescription}">
<meta property="og:type" content="video.other">
<meta property="og:title" content="${safeTitle}">
<meta property="og:description" content="${safeDescription}">
<meta property="og:image" content="${safeThumbnail}">
<meta property="og:url" content="${safeSpaPath}">
<meta property="og:site_name" content="Insighta">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${safeTitle}">
<meta name="twitter:description" content="${safeDescription}">
<meta name="twitter:image" content="${safeThumbnail}">
<meta http-equiv="refresh" content="0; url=${safeSpaPath}">
<link rel="canonical" href="${safeSpaPath}">
</head>
<body>
<p>Redirecting to <a href="${safeSpaPath}">${safeTitle}</a>…</p>
<script>window.location.replace(${JSON.stringify(spaPath)});</script>
</body>
</html>`;

    return (
      reply
        .header('Content-Type', 'text/html; charset=utf-8')
        // Short-cache so SNS bots can hit the freshly-published share URL
        // without seeing stale meta after a video re-title.
        .header('Cache-Control', 'public, max-age=300')
        .send(html)
    );
  });
}
