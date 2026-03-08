import { FastifyPluginCallback } from 'fastify';
import sharp from 'sharp';
import { logger } from '../../utils/logger';

const ALLOWED_HOSTS = ['img.youtube.com', 'i.ytimg.com'];
const MAX_WIDTH = 1280;
const DEFAULT_WIDTH = 480;
const SUPPORTED_FORMATS = ['webp', 'jpeg'] as const;
type ImageFormat = (typeof SUPPORTED_FORMATS)[number];

export const imageRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.get<{
    Querystring: { url: string; w?: string; format?: string };
  }>(
    '/proxy',
    {
      schema: {
        description: 'Proxy and optimize thumbnail images (WebP conversion + resize)',
        tags: ['images'],
        querystring: {
          type: 'object',
          required: ['url'],
          properties: {
            url: { type: 'string', description: 'Encoded original image URL' },
            w: { type: 'string', description: 'Target width (default 480, max 1280)' },
            format: {
              type: 'string',
              enum: ['webp', 'jpeg'],
              description: 'Output format (default webp)',
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { url, w, format: formatParam } = request.query;

      // Validate URL is from YouTube
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(url);
      } catch {
        return reply.code(302).redirect(url);
      }

      if (!ALLOWED_HOSTS.includes(parsedUrl.hostname)) {
        logger.warn('Image proxy: blocked non-YouTube host', { host: parsedUrl.hostname });
        return reply.code(302).redirect(url);
      }

      const width = Math.min(parseInt(w || String(DEFAULT_WIDTH), 10) || DEFAULT_WIDTH, MAX_WIDTH);
      const format: ImageFormat = SUPPORTED_FORMATS.includes(formatParam as ImageFormat)
        ? (formatParam as ImageFormat)
        : 'webp';

      try {
        const response = await fetch(url, {
          headers: { 'User-Agent': 'Insighta-Image-Proxy/1.0' },
          signal: AbortSignal.timeout(5000),
        });

        if (!response.ok) {
          return reply.code(302).redirect(url);
        }

        const buffer = Buffer.from(await response.arrayBuffer());

        const processed = await sharp(buffer)
          .resize(width, undefined, { withoutEnlargement: true })
          [format]({ quality: format === 'webp' ? 80 : 85 })
          .toBuffer();

        const contentType = format === 'webp' ? 'image/webp' : 'image/jpeg';

        return reply
          .header('Content-Type', contentType)
          .header('Cache-Control', 'public, max-age=86400, immutable')
          .header('Vary', 'Accept')
          .send(processed);
      } catch (err) {
        logger.warn('Image proxy: processing failed, redirecting to original', {
          url,
          error: (err as Error).message,
        });
        return reply.code(302).redirect(url);
      }
    }
  );

  fastify.log.info('Image routes registered');
  done();
};

export default imageRoutes;
