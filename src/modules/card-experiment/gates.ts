/**
 * Card-experiment gates — pure composition of the engine's EXISTING filters.
 * No new judgment logic: every verdict comes from an engine function; this
 * module only adds the three missing field reads (embeddable, live, age) and
 * the cosine cut. Evaluates ALL filters so the trace shows every failure.
 */

import {
  CELL_CHANNEL_CAP,
  CELL_CHANNEL_CAP_FLAG,
  EXPERIMENT_MIN_DURATION_SEC,
  KO_HANGUL_RATIO_MIN,
  KO_RATIO_TEXT_CHARS,
  KO_TITLE_MIN_HANGUL,
  LIVE_NONE,
  RESCUE_AUDIO_LANGS,
  YT_AGE_RESTRICTED,
} from '@/config/card-experiment';
import {
  DURATION_MAX_SEC,
  DURATION_MIN_SEC,
  TITLE_MIN_LEN,
  applyQualityGate,
  type VideoMeta,
} from '@/modules/video-pool/ingest-quality-gate';
import {
  SHORTS_MAX_DURATION_SEC,
  V2_TITLE_BLOCKLIST,
  isShortsByDuration,
  parseIsoDuration,
  titleHitsBlocklist,
  titleIndicatesShorts,
  type YouTubeVideoFullMetadata,
} from '@/skills/plugins/video-discover/v2/youtube-client';
import { isOffLanguageTitleToggled } from '@/skills/plugins/video-discover/v5/youtube-fanout';
import { MS_PER_DAY } from '@/utils/time-constants';
import type {
  CandidateEvaluation,
  CandidateMargins,
  CapItem,
  CapResult,
  FailureValue,
  FilterFailure,
  GateContext,
  SheetAssertionResult,
} from './types';

const HANGUL_RE = /[가-힣]/g;
const LATIN_RE = /[A-Za-z]/g;

function toNum(s: string | undefined): number | null {
  if (s === undefined || s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function countMatches(s: string, re: RegExp): number {
  return (s.match(re) ?? []).length;
}

/** Threshold shown for each ingest-gate rejection reason. */
function ingestThreshold(reason: string): FailureValue {
  if (reason === 'title_too_short') return TITLE_MIN_LEN;
  if (reason === 'too_short') return DURATION_MIN_SEC;
  if (reason === 'too_long') return DURATION_MAX_SEC;
  if (reason.startsWith('blocklist:')) return reason.slice('blocklist:'.length);
  return null;
}

export function computeMargins(
  meta: YouTubeVideoFullMetadata,
  now: Date,
  cosine: number | null
): CandidateMargins {
  const published = meta.snippet?.publishedAt ? Date.parse(meta.snippet.publishedAt) : NaN;
  return {
    durationSec: parseIsoDuration(meta.contentDetails?.duration),
    viewCount: toNum(meta.statistics?.viewCount),
    ageDays: Number.isFinite(published) ? (now.getTime() - published) / MS_PER_DAY : null,
    cosine,
    titleLen: (meta.snippet?.title ?? '').trim().length,
  };
}

export function evaluateCandidate(
  meta: YouTubeVideoFullMetadata,
  ctx: GateContext
): CandidateEvaluation {
  const title = meta.snippet?.title ?? '';
  const durationSec = parseIsoDuration(meta.contentDetails?.duration);
  const failures: FilterFailure[] = [];
  const fail = (
    filter: FilterFailure['filter'],
    value: FailureValue,
    threshold: FailureValue
  ): void => {
    failures.push({ filter, value, threshold });
  };

  // 1. ingest quality gate (identical function the bulk-upsert route uses)
  const ingestMeta: VideoMeta = {
    youtube_video_id: meta.id,
    title,
    duration_seconds: durationSec,
  };
  const gate = applyQualityGate([ingestMeta]);
  for (const f of gate.filtered) fail('ingest_quality_gate', f.reason, ingestThreshold(f.reason));

  // 2-4. shorts / blocklist (youtube-client functions)
  if (isShortsByDuration(durationSec)) {
    fail('shorts_duration_75', durationSec, SHORTS_MAX_DURATION_SEC);
  }
  if (titleIndicatesShorts(title)) fail('shorts_title', title, '#shorts marker');
  if (titleHitsBlocklist(title)) {
    const lower = title.toLowerCase();
    const hit = V2_TITLE_BLOCKLIST.find((t) => lower.includes(t.toLowerCase())) ?? null;
    fail('title_blocklist', hit, 'V2_TITLE_BLOCKLIST');
  }

  // 5. language of the title (v5 fan-out rule, ko grid, EN chip off, drop on)
  if (isOffLanguageTitleToggled(title, 'ko', false, true)) {
    fail('off_language_title', title, 'ko');
  }

  // 6-8. the three missing field reads
  if (meta.status?.embeddable !== true) {
    fail('not_embeddable', meta.status?.embeddable ?? null, true);
  }
  const live = meta.snippet?.liveBroadcastContent;
  if (live !== LIVE_NONE) fail('live_or_upcoming', live ?? null, LIVE_NONE);
  const rating = meta.contentDetails?.contentRating?.['ytRating'];
  if (rating === YT_AGE_RESTRICTED) fail('age_restricted', rating, `!= ${YT_AGE_RESTRICTED}`);

  // 9. channel blocklist (sets resolved by the caller from the DB)
  const chId = meta.snippet?.channelId;
  const chName = meta.snippet?.channelTitle;
  if (
    (chId && ctx.blockedChannelIds?.has(chId)) ||
    (chName && ctx.blockedChannelNames?.has(chName))
  ) {
    fail('channel_blocked', chId ?? chName ?? null, 'channel_blocklist');
  }

  // 10. relevance cut (best-cell cosine); null = embedding failed
  let cosine: number | null = null;
  if (ctx.relevance) {
    cosine = ctx.relevance.cosine;
    if (cosine === null || cosine < ctx.relevance.threshold) {
      fail('relevance_cut', cosine, ctx.relevance.threshold);
    }
  }

  return {
    pass: failures.length === 0,
    failures,
    firstFailure: failures[0] ?? null,
    margins: computeMargins(meta, ctx.now, cosine),
  };
}

/**
 * Keep the first `cap` items per (cell, channelId) in input order; flag the
 * rest. Items without a channelId are never capped.
 */
export function capPerCellChannel<T extends CapItem>(
  items: readonly T[],
  cap: number = CELL_CHANNEL_CAP
): CapResult<T>[] {
  const counts = new Map<string, number>();
  return items.map((item) => {
    if (!item.channelId) return { item, capped: false, flag: null };
    const key = `${item.cell ?? ''}\u0000${item.channelId}`;
    const n = (counts.get(key) ?? 0) + 1;
    counts.set(key, n);
    return n <= cap
      ? { item, capped: false, flag: null }
      : { item, capped: true, flag: CELL_CHANNEL_CAP_FLAG };
  });
}

/** Experiment-sheet assertions (stricter than the engine; reporting only). */
export function sheetAssertions(meta: YouTubeVideoFullMetadata): SheetAssertionResult {
  const title = meta.snippet?.title ?? '';
  const description = meta.snippet?.description ?? '';
  const durationSec = parseIsoDuration(meta.contentDetails?.duration);
  const audio = (meta.snippet?.defaultAudioLanguage ?? '').toLowerCase();

  const titleHangul = countMatches(title, HANGUL_RE);
  const ratioText = `${title} ${description.slice(0, KO_RATIO_TEXT_CHARS)}`;
  const hangul = countMatches(ratioText, HANGUL_RE);
  const latin = countMatches(ratioText, LATIN_RE);
  const ratio = hangul + latin === 0 ? 0 : hangul / (hangul + latin);
  const hangulRule = titleHangul >= KO_TITLE_MIN_HANGUL && ratio >= KO_HANGUL_RATIO_MIN;

  const checks = {
    duration: durationSec !== null && durationSec >= EXPERIMENT_MIN_DURATION_SEC,
    notShorts: !titleIndicatesShorts(title),
    embeddable: meta.status?.embeddable === true,
    language: audio.startsWith('ko') || hangulRule,
  };
  const failed = (Object.keys(checks) as (keyof typeof checks)[]).filter((k) => !checks[k]);
  return {
    pass: failed.length === 0,
    checks,
    failed,
    lang_rescue: RESCUE_AUDIO_LANGS.includes(audio) && hangulRule,
  };
}
