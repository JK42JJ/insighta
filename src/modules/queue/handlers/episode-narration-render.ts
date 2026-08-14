/**
 * Episode narration render worker — durable lane for ElevenLabs pre-produce.
 *
 * One job per mandala (singletonKey = mandalaId) so concurrent /episode-audio
 * requests cannot double-render (= double-bill). The renderer itself is
 * beat-incremental, so pg-boss retries resume instead of re-billing.
 */

import PgBoss from 'pg-boss';
import { logger } from '@/utils/logger';
import { getJobQueue } from '../manager';
import {
  JOB_NAMES,
  EPISODE_NARRATION_RENDER_OPTIONS,
  type EpisodeNarrationRenderPayload,
} from '../types';
import { richSummaryWorkOptions } from './rich-summary-work-options';

const log = logger.child({ module: 'queue/episode-narration-render' });

// External TTS API lane — keep it serial-ish; an episode is many sequential
// HTTP calls already and ElevenLabs rate-limits per account.
const NARRATION_RENDER_CONCURRENCY = 1;

export async function registerEpisodeNarrationRenderWorker(): Promise<void> {
  const boss = getJobQueue().getInstance();
  await boss.work<EpisodeNarrationRenderPayload>(
    JOB_NAMES.EPISODE_NARRATION_RENDER,
    richSummaryWorkOptions(NARRATION_RENDER_CONCURRENCY),
    handleEpisodeNarrationRender
  );
  log.info('episode-narration-render worker registered', {
    concurrency: NARRATION_RENDER_CONCURRENCY,
  });
}

export async function handleEpisodeNarrationRender(
  job: PgBoss.Job<EpisodeNarrationRenderPayload>
): Promise<void> {
  const { mandalaId } = job.data ?? ({} as EpisodeNarrationRenderPayload);
  if (!mandalaId) {
    log.warn('episode-narration-render: missing mandalaId, dropping', { jobId: job.id });
    return;
  }

  // Lazy import keeps the queue boot path free of the narration import chain.
  const { renderEpisodeNarration } = await import('@/modules/narration/render-episode');
  const result = await renderEpisodeNarration(mandalaId);

  if (!result.ok && result.action === 'failed') {
    // Throw → pg-boss retry with backoff; renderer resumes from the manifest.
    throw new Error(`episode narration render failed for ${mandalaId}`);
  }
}

export async function enqueueEpisodeNarrationRender(
  payload: EpisodeNarrationRenderPayload,
  options?: PgBoss.SendOptions
): Promise<string | null> {
  const boss = getJobQueue().getInstance();
  return boss.send(JOB_NAMES.EPISODE_NARRATION_RENDER, payload, {
    ...EPISODE_NARRATION_RENDER_OPTIONS,
    singletonKey: payload.mandalaId,
    ...options,
  });
}
