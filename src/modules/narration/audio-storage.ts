/**
 * Supabase Storage helper for episode narration audio.
 *
 * Self-contained on purpose: the general storage wrapper
 * (src/modules/storage/supabase-storage.ts) ships in the unmerged
 * sales-resources branch — consolidate onto it once that lands.
 * Uploads are upsert (re-render replaces stale beats idempotently).
 */

import { config } from '@/config/index';

export const EPISODE_AUDIO_BUCKET = 'episode-audio';

function requireStorage(): { url: string; key: string } {
  const url = config.supabase.url;
  const key = config.supabase.serviceRoleKey;
  if (!url || !key) {
    throw new Error(
      'Supabase storage not configured: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing'
    );
  }
  return { url, key };
}

/** Create the public bucket if it does not exist (idempotent). */
export async function ensureEpisodeAudioBucket(): Promise<void> {
  const { url, key } = requireStorage();
  const res = await fetch(`${url}/storage/v1/bucket`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ id: EPISODE_AUDIO_BUCKET, name: EPISODE_AUDIO_BUCKET, public: true }),
  });
  // 409 = already exists — fine. Anything else non-2xx is a real failure.
  if (!res.ok && res.status !== 409) {
    const detail = (await res.text()).slice(0, 200);
    if (!/already exists/i.test(detail)) {
      throw new Error(`ensureEpisodeAudioBucket HTTP ${res.status}: ${detail}`);
    }
  }
}

export async function uploadEpisodeAudio(path: string, body: Buffer): Promise<void> {
  const { url, key } = requireStorage();
  const res = await fetch(`${url}/storage/v1/object/${EPISODE_AUDIO_BUCKET}/${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${key}`,
      'content-type': 'audio/mpeg',
      'x-upsert': 'true',
    },
    body: new Uint8Array(body),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 200);
    throw new Error(`uploadEpisodeAudio ${path} HTTP ${res.status}: ${detail}`);
  }
}

/** Public URL for a stored object (bucket is public). */
export function episodeAudioPublicUrl(path: string): string {
  const { url } = requireStorage();
  return `${url}/storage/v1/object/public/${EPISODE_AUDIO_BUCKET}/${path}`;
}
