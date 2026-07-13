/**
 * Episode narration renderer — book_json → per-beat ElevenLabs mp3 + manifest.
 *
 * Lazy pre-produce: rendered once per (mandala, book version, host) and cached
 * in Supabase Storage; playback never bills. Beat-incremental: the manifest is
 * persisted after every beat, so a retried job re-renders only missing beats
 * (no double billing). Voice/recipe: src/modules/narration/preset.ts.
 */

import { getPrismaClient } from '@/modules/database/client';
import { logger } from '@/utils/logger';
import { config } from '@/config/index';
import { HOSTS, NARRATION_TEMPO, classifyHost, type NarrationHost } from './preset';
import { flattenBook, type BookJson } from './flatten-book';
import { sentences, beatTextHash } from './sentences';
import { ttsWithTimestamps } from './elevenlabs';
import {
  ensureEpisodeAudioBucket,
  uploadEpisodeAudio,
  episodeAudioPublicUrl,
} from './audio-storage';

const log = logger.child({ module: 'narration/render-episode' });

export interface ManifestBeat {
  /** Beat index in the player's flatten() order. */
  i: number;
  /** sha256(joined sentences) first 12 hex — player-side lookup key. */
  h: string;
  /** Public mp3 URL. */
  f: string;
  /** Duration in seconds (media timeline, 1.0x). */
  d: number;
  /** Sentence start times in seconds (media timeline, 1.0x). */
  s: number[];
}

export interface EpisodeManifest {
  v: 1;
  host: NarrationHost;
  voiceId: string;
  tempo: number;
  bookVersion: number;
  beats: ManifestBeat[];
}

interface EpisodeRow {
  mandala_id: string;
  status: string;
  host: string;
  book_version: number;
  manifest_json: EpisodeManifest | null;
}

async function readRow(mandalaId: string): Promise<EpisodeRow | null> {
  // Raw SQL — same regen-lag-proof stance as the /book route.
  const rows = await getPrismaClient().$queryRawUnsafe<EpisodeRow[]>(
    `SELECT mandala_id, status, host, book_version, manifest_json
     FROM mandala_episode_audio WHERE mandala_id = $1::uuid LIMIT 1`,
    mandalaId
  );
  return rows[0] ?? null;
}

async function upsertRow(
  mandalaId: string,
  fields: {
    status: string;
    host: string;
    bookVersion: number;
    manifest: EpisodeManifest | null;
    error?: string | null;
  }
): Promise<void> {
  await getPrismaClient().$executeRawUnsafe(
    `INSERT INTO mandala_episode_audio (mandala_id, status, host, book_version, manifest_json, error, updated_at)
     VALUES ($1::uuid, $2, $3, $4, $5::jsonb, $6, now())
     ON CONFLICT (mandala_id) DO UPDATE SET
       status = EXCLUDED.status, host = EXCLUDED.host, book_version = EXCLUDED.book_version,
       manifest_json = EXCLUDED.manifest_json, error = EXCLUDED.error, updated_at = now()`,
    mandalaId,
    fields.status,
    fields.host,
    fields.bookVersion,
    JSON.stringify(fields.manifest),
    fields.error ?? null
  );
}

export interface RenderResult {
  ok: boolean;
  action: 'rendered' | 'fresh' | 'skipped-no-book' | 'skipped-over-budget' | 'failed';
  renderedBeats?: number;
}

export async function renderEpisodeNarration(mandalaId: string): Promise<RenderResult> {
  const prisma = getPrismaClient();

  const mandala = await prisma.user_mandalas.findFirst({
    where: { id: mandalaId },
    select: { id: true, title: true, domain: true },
  });
  if (!mandala) return { ok: false, action: 'skipped-no-book' };

  const books = await prisma.$queryRawUnsafe<Array<{ book_json: BookJson; version: number }>>(
    `SELECT book_json, version FROM mandala_books WHERE mandala_id = $1::uuid LIMIT 1`,
    mandalaId
  );
  if (!books[0]) return { ok: false, action: 'skipped-no-book' };
  const { book_json: book, version: bookVersion } = books[0];

  const existing = await readRow(mandalaId);
  // Series keeps its host across episodes/versions; classify only once.
  const host: NarrationHost =
    existing && (existing.host === 'jun' || existing.host === 'seah')
      ? existing.host
      : classifyHost(mandala.title ?? '', mandala.domain);
  const preset = HOSTS[host];

  if (existing?.status === 'ready' && existing.book_version === bookVersion) {
    return { ok: true, action: 'fresh' };
  }

  const beats = flattenBook(book);
  const narrBeats = beats
    .map((b, i) => ({ b, i }))
    .filter((x): x is { b: { t: 'n'; title?: string; text: string }; i: number } => x.b.t === 'n');

  const totalChars = narrBeats.reduce((n, x) => n + x.b.text.length, 0);
  if (totalChars > config.narration.maxCharsPerEpisode) {
    log.warn('episode over char budget — skipping render', { mandalaId, totalChars });
    await upsertRow(mandalaId, {
      status: 'failed',
      host,
      bookVersion,
      manifest: null,
      error: `over char budget: ${totalChars} > ${config.narration.maxCharsPerEpisode}`,
    });
    return { ok: false, action: 'skipped-over-budget' };
  }

  await ensureEpisodeAudioBucket();

  // Resume: keep beats whose (index, hash) already match — no double billing.
  const prior = new Map<string, ManifestBeat>(
    (existing?.manifest_json?.beats ?? []).map((m) => [`${m.i}:${m.h}`, m])
  );
  const manifest: EpisodeManifest = {
    v: 1,
    host,
    voiceId: preset.voiceId,
    tempo: NARRATION_TEMPO,
    bookVersion,
    beats: [],
  };
  await upsertRow(mandalaId, { status: 'rendering', host, bookVersion, manifest });

  let rendered = 0;
  try {
    for (const { b, i } of narrBeats) {
      const sents = sentences(b.text);
      if (!sents.length) continue;
      const hash = beatTextHash(sents);
      const kept = prior.get(`${i}:${hash}`);
      if (kept) {
        manifest.beats.push(kept);
        continue;
      }

      const joined = sents.join(' ');
      const tts = await ttsWithTimestamps(preset, joined);

      // Sentence start offsets in the joined text → start times.
      const starts: number[] = [];
      let offset = 0;
      for (const sent of sents) {
        starts.push(tts.charStartTimes(offset));
        offset += sent.length + 1; // + joining space
      }

      const path = `mandala/${mandalaId}/v${bookVersion}/${host}/narr-${i}.mp3`;
      await uploadEpisodeAudio(path, tts.audio);
      manifest.beats.push({
        i,
        h: hash,
        f: episodeAudioPublicUrl(path),
        d: tts.durationSec,
        s: starts,
      });
      rendered++;

      // Persist incrementally so a crash/retry resumes instead of re-billing.
      await upsertRow(mandalaId, { status: 'rendering', host, bookVersion, manifest });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error('episode render failed mid-way', { mandalaId, rendered, error: message });
    await upsertRow(mandalaId, { status: 'failed', host, bookVersion, manifest, error: message });
    return { ok: false, action: 'failed', renderedBeats: rendered };
  }

  await upsertRow(mandalaId, { status: 'ready', host, bookVersion, manifest });
  log.info('episode narration ready', {
    mandalaId,
    host,
    bookVersion,
    beats: manifest.beats.length,
    rendered,
  });
  return { ok: true, action: 'rendered', renderedBeats: rendered };
}
