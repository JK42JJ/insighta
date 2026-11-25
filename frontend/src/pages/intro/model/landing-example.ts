/*
 * The example brief the landing walks through (v4, 2026-11-24). Everything the landing shows about
 * the example reads from here: the deck in scene 1, the hero video, the card2 tiles, the chips,
 * the big card's title, the play bar's label and the source chip.
 */

export interface ExampleVideo {
  /** YouTube video id (11 chars). */
  id: string;
  channel: string;
  title: string;
}

export interface ExampleSource {
  /** Index into `videos`. */
  video: number;
  /** As shown ("mm:ss"). */
  time: string;
}

export interface LandingExample {
  brief: {
    /** The brief's day ('YYYY-MM-DD'); kept for reference, the design draws no date. */
    date: string;
    domain: string;
    headline: string;
    /** The brief's first sentence (the card text in scenes 4 and 5). */
    firstSentence: string;
    /** The first sentence's sources, in order; the first one is the hero's (tapped in scene 5). */
    sources: readonly ExampleSource[];
  };
  /**
   * The evidence videos (EXAMPLE_VIDEOS_MIN..EXAMPLE_VIDEOS_MAX), in the brief's order (chips,
   * tiles); the scenes lay out any count in that range.
   */
  videos: readonly ExampleVideo[];
  /** Index into `videos` of the video the landing follows. */
  heroIndex: number;
  /**
   * Where the hero source starts ("mm:ss" or "h:mm:ss"): the play bar's label and the YouTube
   * links' t=. The same as the first source's time (`brief.sources[0]`).
   */
  heroTime: string;
  /** The hero video's length (s): the play dot sits at heroTime / heroDurationSec. */
  heroDurationSec: number;
  /** The second card of the rotating deck in scene 1. */
  deck2: { domain: string; headline: string };
}

// CC's choice (2026-11-25): the 기술/개발 brief of that day, support first. Replace here to swap it.
export const LANDING_EXAMPLE: LandingExample = {
  brief: {
    date: '2026-11-25',
    domain: '기술/개발',
    headline: '이미지 생성 속도는 맥보다 그래픽카드 PC가 빠르다',
    firstSentence:
      '플럭스 2로 이미지 한 장을 만들 때 RTX 5090 그래픽카드는 1초도 걸리지 않지만, M1 Max 맥은 20~30초 넘게 걸린다.',
    sources: [{ video: 0, time: '07:40' }],
  },
  videos: [
    {
      id: 'VC5cHNVlzDU',
      channel: '로컬리',
      title: '맥 로컬 AI, 지금 어디까지 왔나 — M1~M5 실측과 CUDA 생태계의 벽',
    },
    // the brief's second sentence cites it at 05:40 (that sentence is not drawn here)
    {
      id: 'W9Nmw0YeGfM',
      channel: '혼잡스',
      title: '내 컴퓨터로 AI 공짜로 돌리면 어디까지 될까? | 9분만에 모든 로컬 AI 비교분석',
    },
    {
      id: 'dBkPixj7I5c',
      channel: '메타코드M',
      title:
        '회사 문서, 외부 AI에 올리기 찜찜했다면 | 내 PC에서만 돌아가는 사내 AI 위키 (Ollama+Obsidian 30분 완성)',
    },
    {
      id: '3OB-nsIZg5s',
      channel: '소울시커 Soul Seeker',
      title: '로컬 AI PC는 리눅스! 설치만 하고 드라이버 설치도 보안점검도 AI로 "해줘"',
    },
  ],
  heroIndex: 0,
  heroTime: '07:40',
  heroDurationSec: 588,
  deck2: {
    domain: '재테크/투자',
    headline: '파이어 뒤 생활비 몫의 현금성 자산은 주식과 따로 떼어 둔다',
  },
};

/** The landing draws 3 to 6 evidence videos (the deck shows the first three). */
export const EXAMPLE_VIDEOS_MIN = 3;
export const EXAMPLE_VIDEOS_MAX = 6;
/** Three lines of the card (17px): more would push the card into the Google button in scenes 4 and 5. */
export const FIRST_SENTENCE_MAX = 78;
/** Two lines of the card's headline (22px). */
export const HEADLINE_MAX = 30;
const YT_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const TIME_RE = /^(\d+:)?\d{1,2}:\d{2}$/;

/**
 * What is wrong with an example config ([] = usable). The landing test runs it on LANDING_EXAMPLE,
 * so a config edit that the scenes cannot draw fails before it ships.
 */
export function checkLandingExample(ex: LandingExample): string[] {
  const bad: string[] = [];
  const n = ex.videos.length;
  if (n < EXAMPLE_VIDEOS_MIN || n > EXAMPLE_VIDEOS_MAX) {
    bad.push(`videos: ${n}, needs ${EXAMPLE_VIDEOS_MIN}..${EXAMPLE_VIDEOS_MAX}`);
  }
  ex.videos.forEach((v, i) => {
    if (!YT_ID_RE.test(v.id)) bad.push(`videos[${i}].id is not a YouTube id`);
    if (!v.channel.trim()) bad.push(`videos[${i}].channel is empty`);
    if (!v.title.trim()) bad.push(`videos[${i}].title is empty`);
  });
  if (new Set(ex.videos.map((v) => v.id)).size !== n) bad.push('videos: an id is repeated');
  if (!Number.isInteger(ex.heroIndex) || ex.heroIndex < 0 || ex.heroIndex >= n) {
    bad.push('heroIndex is not a video');
  }
  if (!TIME_RE.test(ex.heroTime) || timeToSeconds(ex.heroTime) <= 0) {
    bad.push('heroTime is not a time after 0:00');
  }
  if (!(ex.heroDurationSec > timeToSeconds(ex.heroTime))) {
    bad.push('heroDurationSec must be longer than heroTime');
  }
  if (!ex.brief.domain.trim() || !ex.brief.headline.trim() || !ex.brief.firstSentence.trim()) {
    bad.push('brief: domain, headline and first sentence are needed');
  }
  if (ex.brief.firstSentence.length > FIRST_SENTENCE_MAX) {
    bad.push(`brief.firstSentence is longer than ${FIRST_SENTENCE_MAX}`);
  }
  if (ex.brief.headline.length > HEADLINE_MAX) {
    bad.push(`brief.headline is longer than ${HEADLINE_MAX}`);
  }
  if (!ex.brief.sources.length) bad.push('brief.sources is empty');
  ex.brief.sources.forEach((src, i) => {
    if (!Number.isInteger(src.video) || src.video < 0 || src.video >= n) {
      bad.push(`brief.sources[${i}] is not a video`);
    }
    if (!TIME_RE.test(src.time)) bad.push(`brief.sources[${i}].time is not a time`);
  });
  const first = ex.brief.sources[0];
  if (first && (first.video !== ex.heroIndex || first.time !== ex.heroTime)) {
    bad.push('brief.sources[0] must be the hero at heroTime (the source tapped in scene 5)');
  }
  return bad;
}

const SEC_PER_MIN = 60;
const YT_THUMB = 'https://i.ytimg.com/vi/';
/** mqdefault: 320x180 (16:9), the boxes' ratio, so nothing is cropped. */
const YT_THUMB_FILE = '/mqdefault.jpg';
/** Tried when mqdefault does not load (480x360, drawn whole). */
const YT_THUMB_RETRY = '/hqdefault.jpg';
/** A missing thumbnail answers with a 120px wide grey picture instead of an error. */
export const THUMB_MISSING_W = 120;
/** The embedded player: the landing plays videos on itself and never opens YouTube (James 2026-11-25). */
/** A video's own page: the YouTube Icon goes there (branding rule, James 2026-11-25); cards never do. */
const YT_WATCH = 'https://www.youtube.com/watch?v=';
const YT_EMBED = 'https://www.youtube.com/embed/';

/** "mm:ss" (or "h:mm:ss") -> seconds; 0 when it is not a time. */
export function timeToSeconds(t: string): number {
  const parts = t.trim().split(':');
  if (!parts.length || parts.some((p) => !/^\d+$/.test(p))) return 0;
  return parts.reduce((acc, p) => acc * SEC_PER_MIN + Number(p), 0);
}

export const thumbUrl = (id: string): string =>
  `${YT_THUMB}${encodeURIComponent(id)}${YT_THUMB_FILE}`;

/** What a tap plays inside the landing: a video and where it starts (s). */
export interface PlayTarget {
  video: ExampleVideo;
  start: number;
}

/** The embedded player's address: inline on phones, from `start`, related videos of the channel. */
export function embedUrl(t: PlayTarget): string {
  const q = new URLSearchParams({
    autoplay: '1',
    playsinline: '1',
    rel: '0',
    start: String(Math.max(0, Math.floor(t.start))),
  });
  return `${YT_EMBED}${encodeURIComponent(t.video.id)}?${q.toString()}`;
}

/** The video's YouTube page, from `start` when there is one (the icon's link only). */
export function youtubePage(t: PlayTarget): string {
  const at = Math.max(0, Math.floor(t.start));
  return `${YT_WATCH}${encodeURIComponent(t.video.id)}${at > 0 ? `&t=${at}s` : ''}`;
}

/** The hero video from its source time. */
export function heroPlay(ex: LandingExample = LANDING_EXAMPLE): PlayTarget {
  return { video: heroVideo(ex), start: timeToSeconds(ex.heroTime) };
}

/** The hero video (the first video when the index is out of range). */
export function heroVideo(ex: LandingExample = LANDING_EXAMPLE): ExampleVideo {
  return ex.videos[ex.heroIndex] ?? ex.videos[0]!;
}

export const thumbRetryUrl = (id: string): string =>
  `${YT_THUMB}${encodeURIComponent(id)}${YT_THUMB_RETRY}`;

/**
 * The example without the videos whose thumbnail cannot be loaded: their place goes to the next
 * evidence video. The hero (the source the text cites) and the fewest drawable count stay.
 */
export function withoutVideos(ex: LandingExample, dead: ReadonlySet<string>): LandingExample {
  if (!dead.size) return ex;
  const hero = heroVideo(ex);
  const rest = ex.videos.filter((v) => v === hero || !dead.has(v.id));
  if (rest.length === ex.videos.length || rest.length < EXAMPLE_VIDEOS_MIN) return ex;
  const cited = new Map(ex.brief.sources.map((s) => [s, ex.videos[s.video]]));
  return {
    ...ex,
    videos: rest,
    heroIndex: rest.indexOf(hero),
    brief: {
      ...ex.brief,
      sources: ex.brief.sources
        .filter((s) => rest.includes(cited.get(s)!))
        .map((s) => ({ ...s, video: rest.indexOf(cited.get(s)!) })),
    },
  };
}

/** "<channel> <time>" for a source. */
export function sourceLabel(ex: LandingExample, s: ExampleSource): string {
  return `${ex.videos[s.video]?.channel ?? ''} ${s.time}`.trim();
}

/** How far into the hero video a moment is (0..1), `afterSec` past its source time. */
export function heroFraction(ex: LandingExample, afterSec = 0): number {
  return Math.min(1, (timeToSeconds(ex.heroTime) + afterSec) / ex.heroDurationSec);
}
