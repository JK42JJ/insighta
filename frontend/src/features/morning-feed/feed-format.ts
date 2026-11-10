import type { FeedApiCard, FeedApiCardInfo } from '@/features/morning-cards/api';
import type { FeedCard, FeedCheck, FeedChapter } from '@/features/morning-feed/MorningFeed';

const MS_PER_DAY = 86_400_000;

/** m:ss, or h:mm:ss from one hour on (the reference shows 14:22). */
export function formatDuration(totalSeconds: number): string {
  const t = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** SPEC section 5.4: N일 전 (1~6), N주 전, N개월 전. Under 7 days the badge is orange. */
export function agoLabel(
  publishedAt: string,
  now: Date = new Date()
): { text: string; fresh: boolean } {
  const days = Math.max(
    0,
    Math.floor((now.getTime() - new Date(publishedAt).getTime()) / MS_PER_DAY)
  );
  if (days < 1) return { text: '오늘', fresh: true };
  if (days < 7) return { text: `${days}일 전`, fresh: true };
  if (days < 30) return { text: `${Math.floor(days / 7)}주 전`, fresh: false };
  return { text: `${Math.floor(days / 30)}개월 전`, fresh: false };
}

/** 1,234 -> 1,234회 / 12,345 -> 1.2만회 */
export function formatViews(n: number | null): string {
  if (n == null) return '';
  if (n >= 10_000) return `조회수 ${(n / 10_000).toFixed(1).replace(/\.0$/, '')}만회`;
  return `조회수 ${n.toLocaleString('ko-KR')}회`;
}

/** SPEC section 5.3: the channel circle takes one of the fixture colours, picked by a hash of the name. */
export function channelColor(name: string, palette: readonly string[]): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

const MIN_CHAPTERS = 3;
const KOREAN_AUDIO_PREFIX = 'ko';
const AUDIO_LANGUAGE_NAMES: Record<string, string> = { en: '영어', ja: '일본어', zh: '중국어' };

/** The only facts shown under "이 영상을 고른 이유". Host or speaker counts are never shown. */
export function buildChecks(info: FeedApiCardInfo | undefined): FeedCheck[] {
  if (!info) return [];
  const out: FeedCheck[] = [];
  const lang = (info.audio_language ?? '').trim().toLowerCase();
  if (lang) {
    if (lang.startsWith(KOREAN_AUDIO_PREFIX)) out.push({ text: '✓ 한국어 음성' });
    else out.push({ text: '음성 언어 ' + (AUDIO_LANGUAGE_NAMES[lang.split('-')[0]] ?? lang) });
  }
  if (typeof info.link_count === 'number' && info.link_count >= 1) {
    out.push({ text: '✓ 설명란 링크 ' + Math.floor(info.link_count) + '건' });
  }
  return out;
}

/** Lines split on \n, trimmed, empty ones dropped. */
export function splitReasonLines(reason: string | undefined): string[] {
  return (reason ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/** Chapters shown only when there are at least three valid entries. */
export function buildChapters(chapters: FeedApiCardInfo['chapters']): FeedChapter[] {
  const list = (chapters ?? []).filter(
    (c) =>
      c && Number.isFinite(c.sec) && c.sec >= 0 && typeof c.title === 'string' && c.title.trim()
  );
  if (list.length < MIN_CHAPTERS) return [];
  return list.map((c) => ({ at: formatDuration(c.sec), title: c.title.trim() }));
}

export function toFeedCard(
  c: FeedApiCard,
  palette: readonly string[],
  now: Date = new Date()
): FeedCard {
  const ago = agoLabel(c.published_at, now);
  const channel = c.channel ?? '';
  return {
    bg: channelColor(channel, palette),
    ini: channel.trim().charAt(0) || '?',
    thumb: '',
    dur: formatDuration(c.duration),
    ago: ago.text,
    fresh: ago.fresh,
    ch: channel,
    chMeta: formatViews(c.view_count),
    title: c.title,
    cell: c.cell,
    focus: c.focus.join(' · '),
    why: c.why,
    videoId: c.video_id,
    thumbUrl: c.thumbnail_url ?? undefined,
    ...infoFields(c.info),
  };
}

function infoFields(info: FeedApiCardInfo | undefined): Partial<FeedCard> {
  if (!info) return {};
  const out: Partial<FeedCard> = {};
  const one = (info.one_liner ?? '').trim();
  if (one) out.oneLiner = one;
  const lines = splitReasonLines(info.reason);
  if (lines.length) out.reasonLines = lines;
  const checks = buildChecks(info);
  if (checks.length) out.checks = checks;
  const chapters = buildChapters(info.chapters);
  if (chapters.length) out.chapters = chapters;
  return out;
}
