/**
 * YouTube OAuth preHandler Plugin
 *
 * Loads authenticated user's YouTube OAuth credentials from DB
 * and sets them on the singleton YouTubeClient before any YouTube API call.
 *
 * Apply to any route that directly or indirectly calls YouTube Data API.
 * This ensures the YouTubeClient uses OAuth (not API key) for all requests,
 * avoiding GCP referer-based API key restrictions on server-side calls.
 */

import { FastifyRequest } from 'fastify';
import { getPrismaClient } from '../../modules/database/client';
import { getYouTubeClient } from '../client';
import { logger } from '../../utils/logger';

/**
 * Fastify preHandler that loads YouTube OAuth credentials for the authenticated user.
 * Must be used AFTER `fastify.authenticate` (requires `request.user.userId`).
 *
 * Usage: fastify.addHook('preHandler', loadYouTubeOAuth);
 */
export async function loadYouTubeOAuth(request: FastifyRequest): Promise<void> {
  const user = request.user as { userId?: string } | undefined;
  if (!user?.userId) return;

  try {
    const db = getPrismaClient();
    const settings = await db.youtube_sync_settings.findUnique({
      where: { user_id: user.userId },
    });

    if (settings?.youtube_access_token) {
      getYouTubeClient().setCredentials({
        access_token: settings.youtube_access_token,
        refresh_token: settings.youtube_refresh_token,
        expiry_date: settings.youtube_token_expires_at?.getTime() ?? null,
      });
    }
  } catch (error) {
    logger.warn('Failed to load YouTube OAuth credentials (continuing with API key)', {
      userId: user.userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
