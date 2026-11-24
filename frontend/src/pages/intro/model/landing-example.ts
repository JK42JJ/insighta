/*
 * The example brief the landing walks through (v4, 2026-11-24). Everything the landing shows about
 * the example reads from here: the deck in scene 1, the hero video, the card2 tiles, the chips,
 * the big card's title, the play bar's label and the source chip.
 *
 * TODO(James): replace. Every value below is the design's ("Insighta Intro v4.dc.html") as a
 * TEMPORARY placeholder so captures stay comparable with the design; James picks the real values.
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
    domain: string;
    headline: string;
    /** The brief's first sentence (the card text in scenes 4 and 5). */
    firstSentence: string;
    /** The first sentence's sources, in order; the first one is the hero's (tapped in scene 5). */
    sources: readonly ExampleSource[];
  };
  /** The six evidence videos, in the design's order (chips, tiles). */
  videos: readonly ExampleVideo[];
  /** Index into `videos` of the video the landing follows. */
  heroIndex: number;
  /** Where the hero source starts ("mm:ss"); the play bar's label and the YouTube link's t=. */
  heroTime: string;
  /** The second card of the rotating deck in scene 1. */
  deck2: { domain: string; headline: string };
}

// TODO(James): replace — the design's placeholder values.
export const LANDING_EXAMPLE: LandingExample = {
  brief: {
    domain: '비즈니스/커리어',
    headline: 'AI에 많이 노출된 직업에서 경력자보다 청년 고용이 약해졌다',
    firstSentence:
      '스탠퍼드대 연구진이 미국 급여 자료를 분석했더니, AI의 영향을 많이 받는 직업에서 22~25세의 고용은 비교 집단의 추세보다 19% 낮았고 경력이 많은 근로자에게서는 같은 현상이 뚜렷하지 않았다.',
    sources: [
      { video: 0, time: '03:00' },
      { video: 2, time: '04:40' },
    ],
  },
  videos: [
    { id: 'A8GsHLubYwo', channel: '취트키 TV', title: '[영상 제목]' },
    { id: 'u8np18LTK4s', channel: '백만수무강', title: '[영상 제목]' },
    { id: 'UUg5oij7ptw', channel: 'AI 투데이', title: '[영상 제목]' },
    { id: 'ppOqYmyhfIA', channel: 'Kushal Vijay', title: '[영상 제목]' },
    { id: 'Mb7HQRl9J1A', channel: 'AIM Network', title: '[영상 제목]' },
    { id: 'YfqcPoNFMWg', channel: '원빅월드쇼', title: '[영상 제목]' },
  ],
  heroIndex: 0,
  heroTime: '03:00',
  deck2: { domain: '기술/개발', headline: '에이전트의 성패는 모델보다 평가 체계에서 갈린다' },
};

const SEC_PER_MIN = 60;
const YT_THUMB = 'https://i.ytimg.com/vi/';
/** mqdefault: 320x180 (16:9), the boxes' ratio, so nothing is cropped. */
const YT_THUMB_FILE = '/mqdefault.jpg';
const YT_WATCH = 'https://www.youtube.com/watch?v=';

/** "mm:ss" (or "h:mm:ss") -> seconds; 0 when it is not a time. */
export function timeToSeconds(t: string): number {
  const parts = t.trim().split(':');
  if (!parts.length || parts.some((p) => !/^\d+$/.test(p))) return 0;
  return parts.reduce((acc, p) => acc * SEC_PER_MIN + Number(p), 0);
}

export const thumbUrl = (id: string): string =>
  `${YT_THUMB}${encodeURIComponent(id)}${YT_THUMB_FILE}`;

/** A video on YouTube (opens the YouTube app or site). */
export const watchUrl = (id: string): string => `${YT_WATCH}${encodeURIComponent(id)}`;

/** The hero video on YouTube from its source time. */
export function heroWatchUrl(ex: LandingExample = LANDING_EXAMPLE): string {
  const hero = ex.videos[ex.heroIndex];
  const id = encodeURIComponent(hero?.id ?? '');
  return `${YT_WATCH}${id}&t=${timeToSeconds(ex.heroTime)}s`;
}

/** The hero video (the first video when the index is out of range). */
export function heroVideo(ex: LandingExample = LANDING_EXAMPLE): ExampleVideo {
  return ex.videos[ex.heroIndex] ?? ex.videos[0]!;
}

/** "<channel> <time>" for a source. */
export function sourceLabel(ex: LandingExample, s: ExampleSource): string {
  return `${ex.videos[s.video]?.channel ?? ''} ${s.time}`.trim();
}
