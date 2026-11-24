/**
 * @deprecated [LANDING-V4] Text of the replaced scroll landing; the v4 landing reads
 * `model/landing-content.ts` and `model/landing-example.ts`. Kept with the legacy page.
 */
/*
 * Landing page text and layout data, as written in the design "Insighta Intro.dc.html"
 * (2026-11-24). Two strings differ from the design by James's decision (2026-11-24): the hero
 * body (HERO_BODY) and the line under the last Google button, which is removed.
 */

export const BRAND = 'Insighta';
/** The hero title's two lines (the design breaks after the comma). */
export const HERO_TITLE = ['오늘 볼 영상,', '미리 골라 뒀어요'] as const;
export const HERO_BODY =
  '분야마다 최근 한 달 동안 올라온 영상을 살펴봤어요. 어떤 내용인지 먼저 읽어 보고, 마음에 드는 영상만 보세요.';

export const PROBLEM =
  '유튜브를 켜면 어제 본 것과 비슷한 영상이 먼저 나와요. 정작 일이나 진로 때문에 필요한 영상은 따로 찾아야 하죠. 겨우 찾아도 믿을 만한 영상인지는 끝까지 봐야 알 수 있고요.';
export const PROBLEM_ANSWER = '그 수고를 인사이타가 대신할게요.';

/** Captions of the three steps over the brief illustration. */
export const CAPTIONS = [
  '영상 세 편이 공통으로 이야기하는 내용이에요.',
  '취트키 TV 영상 3분 부분에 나온 내용이에요. 누르면 그 부분부터 볼 수 있어요.',
  '이 글에 쓴 영상 여섯 편이에요. 제목과 같은 이야기를 하는 영상이 위에 있어요.',
] as const;

/** The fixed example brief in the illustration (not live data, decision 2026-11-24). */
export const ILLU = {
  kicker: '오늘의 브리프 · 비즈니스/커리어',
  headline: 'AI에 많이 노출된 직업에서 경력자보다 청년 고용이 약해졌다',
  p1: '스탠퍼드대 연구진이 미국 급여 자료를 분석했더니, AI의 영향을 많이 받는 직업에서 22~25세의 고용은 비교 집단의 추세보다 19% 낮았고 경력이 많은 근로자에게서는 같은 현상이 뚜렷하지 않았다.',
  p1Cite: '취트키 TV 03:00',
  p1Cite2: '· AI 투데이 04:40',
  p2: '한국은행이 2026년 8월 발표한 연구로는 2022년 6월부터 2026년 6월까지 청년층 일자리가 28만 5천 개 줄었고, 그 가운데 약 94%가 AI 노출도가 높은 업종에서 나왔다.',
  p2Cite: '취트키 TV 04:00 · 백만수무강 02:40',
  more: '이어서 읽기',
  listLabel: '근거가 된 영상',
} as const;

/** The example brief's source channels, in list order. */
export const ILLU_CHANNELS = [
  '취트키 TV',
  '백만수무강',
  'AI 투데이',
  'Kushal Vijay',
  'AIM Network',
  '원빅월드쇼',
] as const;

export const PRINCIPLE_TITLE = '왜곡 없는 정보를 지향합니다';
export const PRINCIPLE_BODY =
  '그래서 모든 문장에 출처를 표시해 두었어요. 글은 어떤 영상을 볼지 고를 때 참고하시고, 궁금한 부분은 영상으로 직접 확인해 보세요.';

export const DOMAINS_LEAD = '지금은 8개 분야에서 골라 드려요.';
export const DOMAINS = [
  '비즈니스/커리어',
  '재테크/투자',
  '학습/교육',
  '건강/피트니스',
  '인간관계/커뮤니티',
  '창작/예술',
  '라이프스타일/여행',
  '기술/개발',
] as const;
export const ADD_LABEL = 'ADD';

export const FINAL_LINE = 'Google 계정으로 로그인하면 오늘의 영상을 바로 볼 수 있어요.';
// James 2026-11-24 (Slack R46): Google's branding allows only Sign in / Sign up / Continue with Google and their
// translations, so the design's "Google로 시작하기" became the translation of "Continue with Google".
// shared with the v4 landing (one definition)
export { CLOSE_LABEL, GOOGLE_LABEL, PRIVACY, TERMS } from '../model/landing-content';

/*
 * Wall of tiles above the hero (design: tiles in 4 columns; six light up). James 2026-11-24: the
 * wall is exactly 3 rows on every screen. The design's lit positions 1, 6, 8 and 11 are kept;
 * its 13 and 18 fall below row 3, so 3 and 4 take their place.
 *
 * Tiles show original YouTube thumbnails of one day's briefs (James 2026-11-24, "원본을 동적으로"):
 * unaltered images, each a link to the video, with YouTube named under the wall (YouTube API
 * policy). Until those arrive, or when there are none, the channel letter tiles are shown: the
 * lit tiles carry the first letter of a source channel of the example brief (ILLU_CHANNELS).
 */
export const WALL_COLS = 4;
export const WALL_ROWS = 3;
export const WALL_TILES = WALL_COLS * WALL_ROWS;
// The design lights six tiles on two parallel down-right diagonals of a 4 x 5 grid. On the 3-row wall
// (James 2026-11-24) the same diagonals are kept: (0,1)(1,2)(2,3), (1,0)(2,1) and the next one's (0,3),
// in the design's lighting order (top-left diagonal first).
export const WALL_PICK = [1, 6, 11, 4, 9, 3] as const;
/** Under the wall when it shows thumbnails (not in the design: James to confirm). */
export const WALL_CREDIT = '영상 출처: YouTube';

const YT_THUMB = 'https://i.ytimg.com/vi/';
/** mqdefault: 320x180, the tile's 16:9, so nothing is cropped. */
const YT_THUMB_FILE = '/mqdefault.jpg';
const YT_WATCH = 'https://www.youtube.com/watch?v=';
export const thumbUrl = (id: string): string =>
  `${YT_THUMB}${encodeURIComponent(id)}${YT_THUMB_FILE}`;
export const watchUrl = (id: string): string => `${YT_WATCH}${encodeURIComponent(id)}`;

/** The wall: per tile, the channel letter (lit tiles) or null. */
export function wallLetters(channels: readonly string[] = ILLU_CHANNELS): Array<string | null> {
  return Array.from({ length: WALL_TILES }, (_x, i) => {
    const k = (WALL_PICK as readonly number[]).indexOf(i);
    return k >= 0 ? (channels[k] ?? '').slice(0, 1) || null : null;
  });
}

export interface WallVideo {
  id: string;
  /** Accessible name: "<title> — <channel>". */
  label: string;
}

/** The thumbnail wall's input (GET /morning-feed/public/wall). */
export interface WallData {
  highlight: readonly string[];
  others: readonly string[];
  items: Readonly<Record<string, { title?: string; channel?: string } | undefined>>;
}

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

/**
 * Per tile: the highlighted brief's source videos on WALL_PICK in order; every other tile stays an empty
 * tile, as in the design where only the picked tiles show a picture (James 2026-11-24: "일부 영상에 대해
 * 썸네일이 들어가야 하는데 모두 들어가 버림"). null when the highlight cannot fill the picks (letter tiles then).
 */
export function wallVideos(data: WallData | null | undefined): Array<WallVideo | null> | null {
  if (!data) return null;
  const ok = (id: unknown): id is string => typeof id === 'string' && VIDEO_ID_RE.test(id);
  const seen = new Set<string>();
  const uniq = (ids: readonly unknown[]): string[] =>
    ids.filter(ok).filter((id) => (seen.has(id) ? false : (seen.add(id), true)));
  const hi = uniq(data.highlight ?? []);
  if (hi.length < WALL_PICK.length) return null;
  const label = (id: string): string => {
    const it = data.items?.[id];
    const title = it?.title?.trim() ?? '';
    const channel = it?.channel?.trim() ?? '';
    return title && channel ? `${title} — ${channel}` : title || channel;
  };
  return Array.from({ length: WALL_TILES }, (_x, i) => {
    const k = (WALL_PICK as readonly number[]).indexOf(i); // the brief's k-th video on the k-th lit tile
    if (k < 0) return null;
    const id = hi[k]!;
    return { id, label: label(id) };
  });
}
