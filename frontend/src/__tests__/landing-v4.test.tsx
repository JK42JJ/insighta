import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// no network in tests: the font links are not added
vi.mock('@/features/morning-feed/watch-home-fonts', () => ({
  ensureHomeFonts: () => undefined,
  waitHomeFonts: () => Promise.resolve('late'),
  FONT_WAIT_MS: 1500,
}));
const toast = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast }));
// the landing wall (public endpoint): the last sheet's domain list; fails by default
const fetchLandingWall = vi.hoisted(() => vi.fn());
vi.mock('@/features/morning-cards/api', () => ({ fetchLandingWall }));
// the sheets render the real pages; their i18n text is not under test here
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  Trans: ({ i18nKey }: { i18nKey: string }) => i18nKey,
}));
// the example config, replaced with other values: everything shown must follow it
// (`count` = how many evidence videos the replacement has, 3..6)
const example = vi.hoisted(() => ({ swap: false, count: 6 }));
vi.mock('@/pages/intro/model/landing-example', async (orig) => {
  const actual = await orig<typeof import('@/pages/intro/model/landing-example')>();
  const other = (n: number): typeof actual.LANDING_EXAMPLE => ({
    brief: {
      date: '2026-11-01',
      domain: '재테크/투자',
      headline: 'H-테스트 헤드라인',
      firstSentence: 'F-테스트 첫 문장.',
      sources: [
        { video: 2, time: '01:05' },
        { video: n - 2, time: '07:00' },
      ],
    },
    videos: Array.from({ length: n }, (_x, i) => ({
      id: `vid${i}abcdefg`.slice(0, 11),
      channel: `채널${i}`,
      title: `제목${i}`,
    })),
    heroIndex: 2,
    heroTime: '01:05',
    heroDurationSec: 260,
    deck2: { domain: '기술/개발', headline: 'D2-테스트' },
  });
  return {
    ...actual,
    get LANDING_EXAMPLE() {
      return example.swap ? other(example.count) : actual.LANDING_EXAMPLE;
    },
  };
});

import {
  readLandingEvents,
  recordLandingEvent,
  type LandingEventValue,
} from '@/features/landing-intro';
import { IntroPage } from '@/pages/intro';
import {
  S3_TEXT,
  wallDomains,
  YT_CREDIT,
  YT_ICON_ALT,
  ytLinkLabel,
} from '@/pages/intro/model/landing-content';
import {
  checkLandingExample,
  EXAMPLE_VIDEOS_MAX,
  EXAMPLE_VIDEOS_MIN,
  heroWatchUrl,
  LANDING_EXAMPLE,
  timeToSeconds,
} from '@/pages/intro/model/landing-example';
import {
  BAND_H,
  BAR_H,
  BAR_IN_S,
  buildScene,
  CN_H,
  STAGE_H,
  STAGE_W,
  DOT,
  DOTGO,
  fitStage,
  nextScene,
  PLAY_RUN_S,
  sceneEventValue,
  SEQ,
  STEP_LOCK_MS,
  YT_ICON_BOX_H,
  YT_ICON_BOX_W,
  YT_ICON_FILE_H,
  YT_ICON_FILE_W,
  YT_ICON_MARK_FILE_H,
  YT_ICON_MARK_PX,
  type Scene,
} from '@/pages/intro/model/landing-scene';

/*
 * Landing v4 ("Insighta Intro v4.dc.html", decisions 2026-11-24): one swipe = one scene with a
 * 700 ms lock, 7 scenes on 6 dots, example data from one config, events kept until sign-in,
 * YouTube thumbnails unaltered and attributed, the hero opens on YouTube at its source time, and
 * reduced motion without motion.
 */

const IOS_INSTAGRAM =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 300.0.0.0';

function setReduced(reduce: boolean): void {
  window.matchMedia = ((q: string) => ({
    matches: reduce && q.includes('reduce'),
    media: q,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

function draw(onSignIn = vi.fn(() => Promise.resolve())) {
  render(
    <MemoryRouter>
      <IntroPage onSignIn={onSignIn} />
    </MemoryRouter>
  );
  return onSignIn;
}
const stage = (): HTMLElement => screen.getByTestId('lv-stage');
const scene = (): number => Number(stage().getAttribute('data-scene'));
function swipe(dy: number): void {
  fireEvent.pointerDown(stage(), { clientY: 400 });
  fireEvent.pointerMove(stage(), { clientY: 400 + dy / 2 });
  fireEvent.pointerUp(stage(), { clientY: 400 + dy });
}
/** Past the step lock (fake clock). */
function waitLock(): void {
  act(() => {
    vi.advanceTimersByTime(STEP_LOCK_MS + 1);
  });
}
function goTo(target: Scene): void {
  for (let guard = 0; scene() !== target; guard++) {
    if (guard > 10) throw new Error(`stuck at scene ${scene()} going to ${target}`);
    if (scene() === 4 && target === 5) {
      fireEvent.click(screen.getByTestId('lv-source'));
    } else swipe(-80);
    waitLock();
  }
}

/** The wall answer's shown domains (MORNING_HIDDEN_CELLS left out): five of the eight. */
const SHOWN_CELLS = [
  '기술/개발',
  '비즈니스/커리어',
  '재테크/투자',
  '창작/예술',
  '라이프스타일/여행',
];
const HIDDEN_CELLS = ['학습/교육', '건강/피트니스', '인간관계/커뮤니티'];
const wallWith = (cells: string[]) => ({ cells, date: null, highlight: [], others: [], items: {} });
/** Lets the wall answer (a resolved promise) reach the page. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  sessionStorage.clear();
  toast.mockReset();
  fetchLandingWall.mockReset();
  fetchLandingWall.mockRejectedValue(new Error('offline'));
  example.swap = false;
  example.count = 6;
  setReduced(false);
  vi.useFakeTimers({
    toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('scene order and dots (design SEQ / DOT / DOTGO)', () => {
  it('maps the 7 scenes on 6 dots and back', () => {
    expect(SEQ).toEqual([0, 1, 2, 3, 4, 5, 7]);
    expect(SEQ.map((s) => sceneEventValue(s))).toEqual(['s1', 's2', 's3', 's4', 's5', 's5', 's6']);
    expect(DOTGO.map((s) => DOT[s])).toEqual([0, 1, 2, 3, 4, 5]);
    expect(nextScene(0, -1)).toBeNull();
    expect(nextScene(7, 1)).toBeNull();
    expect(nextScene(5, 1)).toBe(7);
    expect(nextScene(7, -1)).toBe(5);
  });
});

describe('swipe: one swipe = one scene, 700 ms lock', () => {
  it('steps on a swipe, ignores a second one inside the lock, and a short drag', () => {
    draw();
    expect(scene()).toBe(0);
    swipe(-80);
    expect(scene()).toBe(1);
    swipe(-80); // inside the lock
    expect(scene()).toBe(1);
    waitLock();
    swipe(-20); // shorter than the swipe threshold
    expect(scene()).toBe(1);
    swipe(-80);
    expect(scene()).toBe(2);
    waitLock();
    swipe(80); // back
    expect(scene()).toBe(1);
  });

  it('wheel and keys step the same way and stop at the ends', () => {
    draw();
    fireEvent.wheel(stage(), { deltaY: 100 });
    fireEvent.wheel(stage(), { deltaY: 100 });
    expect(scene()).toBe(1);
    waitLock();
    fireEvent.keyDown(stage(), { key: 'ArrowDown' });
    expect(scene()).toBe(2);
    waitLock();
    fireEvent.keyDown(stage(), { key: 'ArrowUp' });
    expect(scene()).toBe(1);
    waitLock();
    fireEvent.keyDown(stage(), { key: 'PageUp' });
    waitLock();
    fireEvent.keyDown(stage(), { key: 'PageUp' });
    expect(scene()).toBe(0);
  });

  it('the dots go to their scene; the swipe hint goes to scene 2', () => {
    draw();
    const dots = screen.getAllByTestId('lv-dot');
    expect(dots).toHaveLength(6);
    fireEvent.click(dots[5]!);
    expect(scene()).toBe(7);
    expect(dots[5]!.getAttribute('aria-current')).toBe('step');
    fireEvent.click(dots[0]!);
    expect(scene()).toBe(0);
  });

  it('the source tap in scene 5 opens the video part (s=5); elsewhere it does nothing', () => {
    draw();
    goTo(3);
    fireEvent.click(screen.getByTestId('lv-source'));
    expect(scene()).toBe(3);
    goTo(4);
    fireEvent.click(screen.getByTestId('lv-source'));
    expect(scene()).toBe(5);
  });
});

describe('a swipe that ends on a button is not a tap', () => {
  it('ignores the click right after a swipe, accepts a tap (or keyboard press) after it', () => {
    const onSignIn = draw();
    goTo(2);
    swipe(-80); // ends on the sticky button
    fireEvent.click(screen.getByTestId('lv-google-sticky'));
    expect(onSignIn).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(400);
    });
    fireEvent.click(screen.getByTestId('lv-google-sticky'));
    expect(onSignIn).toHaveBeenCalledTimes(1);
  });
});

describe('text', () => {
  it('scene 4 has the James-confirmed spacing and both Google buttons say 계속하기', () => {
    draw();
    expect(screen.getByTestId('lv-text-3').textContent).toBe(
      '관심 있는 글을 가볍게 읽어요. 자세한 건 영상으로 확인하면 맥락이 만들어집니다.'
    );
    expect(S3_TEXT).not.toMatch(/관심있는|자세한건|만들어 집니다/);
    expect(screen.getByTestId('lv-google-sticky').textContent).toBe('Google로 계속하기');
    expect(screen.getByTestId('lv-google-final').textContent).toBe('Google로 계속하기');
    expect(stage().textContent).not.toMatch(/시작하기/);
  });
});

describe('example data comes from the one config', () => {
  it('deck, card, source chip, band, hero title, bar label and thumbnails follow it', () => {
    example.swap = true;
    draw();
    const ex = LANDING_EXAMPLE;
    const hero = ex.videos[ex.heroIndex]!;
    const deck = screen.getAllByTestId('lv-deck-card');
    expect(deck[0]!.textContent).toContain('H-테스트 헤드라인');
    expect(deck[0]!.textContent).toContain('재테크/투자');
    expect(deck[1]!.textContent).toContain('D2-테스트');
    const card = screen.getByTestId('lv-card').textContent ?? '';
    expect(card).toContain('F-테스트 첫 문장.');
    expect(screen.getByTestId('lv-source').textContent).toBe('채널2 01:05');
    expect(card).toContain('· 채널4 07:00');
    expect(screen.getByTestId('lv-hero-title').textContent).toBe('제목2');
    expect(screen.getByTestId('lv-bar-label').textContent).toBe('01:05');
    expect(stage().textContent).toContain('채널2');
    // the hero takes slot 0 (the design's hero place); its thumbnail is the hero's
    const heroImg = screen.getByTestId('lv-hero').querySelector('img')!;
    expect(heroImg.getAttribute('src')).toBe(`https://i.ytimg.com/vi/${hero.id}/mqdefault.jpg`);
    expect((screen.getByTestId('lv-hero') as HTMLAnchorElement).href).toBe(
      `https://www.youtube.com/watch?v=${hero.id}&t=65s`
    );
  });

  it('the shipped config is drawable (3..6 videos, hero source = first source at heroTime)', () => {
    const ex = LANDING_EXAMPLE;
    expect(checkLandingExample(ex)).toEqual([]);
    expect(ex.videos.length).toBeGreaterThanOrEqual(EXAMPLE_VIDEOS_MIN);
    expect(ex.videos.length).toBeLessThanOrEqual(EXAMPLE_VIDEOS_MAX);
    expect(ex.brief.sources[0]).toEqual({ video: ex.heroIndex, time: ex.heroTime });
    expect(timeToSeconds(ex.heroTime)).toBeGreaterThan(0);
  });

  it('the config check names what the scenes cannot draw', () => {
    const ex = LANDING_EXAMPLE;
    const two = { ...ex, videos: ex.videos.slice(0, 2), heroIndex: 0 };
    expect(checkLandingExample(two).join('|')).toMatch(/videos: 2/);
    const seven = {
      ...ex,
      videos: [...ex.videos, { id: 'zzzzzzzzzzz', channel: 'c', title: 't' }],
    };
    if (ex.videos.length === EXAMPLE_VIDEOS_MAX) {
      expect(checkLandingExample(seven).join('|')).toMatch(/videos: 7/);
    }
    const offHero = {
      ...ex,
      brief: { ...ex.brief, sources: [{ video: ex.heroIndex, time: '9:59' }] },
    };
    expect(checkLandingExample(offHero).join('|')).toMatch(/sources\[0\]/);
    const badTime = { ...ex, heroTime: 'soon' };
    expect(checkLandingExample(badTime).join('|')).toMatch(/heroTime/);
    const badSrc = {
      ...ex,
      brief: { ...ex.brief, sources: [...ex.brief.sources, { video: 9, time: '1:00' }] },
    };
    expect(checkLandingExample(badSrc).join('|')).toMatch(/is not a video/);
  });

  it('the play dot sits where the source is in the real video', () => {
    const ex = LANDING_EXAMPLE;
    const at = timeToSeconds(ex.heroTime) / ex.heroDurationSec;
    for (const [ph, frac] of [
      [1, at],
      [2, (timeToSeconds(ex.heroTime) + PLAY_RUN_S) / ex.heroDurationSec],
    ] as const) {
      const bar = buildScene(5, ph, true, null, 0, ex).bar;
      expect(parseFloat(bar.dl) / parseFloat(bar.w)).toBeCloseTo(frac, 2);
    }
    const still = buildScene(5, 2, false, null, 0, ex).bar;
    expect(parseFloat(still.dl) / parseFloat(still.w)).toBeCloseTo(at, 2);
    expect(checkLandingExample({ ...ex, heroDurationSec: 1 }).join('|')).toMatch(/heroDuration/);
  });

  it('one source in the config: no second source is drawn', () => {
    draw();
    expect(document.querySelectorAll('.lv-src-rest')).toHaveLength(
      LANDING_EXAMPLE.brief.sources.length > 1 ? 1 : 0
    );
  });

  it('time strings', () => {
    expect(timeToSeconds('03:00')).toBe(180);
    expect(timeToSeconds('1:02:03')).toBe(3723);
    expect(timeToSeconds('x')).toBe(0);
  });
});

describe('YouTube policy', () => {
  it('thumbnails carry no filter or opacity, also the non-hero chips in scene 5', () => {
    draw();
    goTo(4);
    for (const img of screen.getAllByTestId('lv-thumb')) {
      expect(img.getAttribute('style')).toBeNull();
      expect(img.className).toBe(img.className.includes('deck') ? 'lv-deck-thumb' : 'lv-thumb');
    }
    const chips = screen.getAllByTestId('lv-cell');
    expect(chips).toHaveLength(LANDING_EXAMPLE.videos.length - 1);
    for (const c of chips) expect(c.style.opacity).toBe('1');
    // the hero chip is marked by outline + shadow only
    const hero = screen.getByTestId('lv-hero');
    expect(hero.style.opacity).toBe('1');
    expect(hero.style.boxShadow).toBe('var(--lv-sh-chip-hero)');
    // the model too: no scene dims a shown video
    for (const s of SEQ) {
      for (const c of buildScene(s, 2, false, null).cells) {
        expect([0, 1]).toContain(c.o);
        expect(c.so).toBe(1);
      }
    }
  });

  it('attribution is shown in every scene with thumbnails, and in the last sheet', () => {
    draw();
    // the row is drawn anew per scene
    const credit = (): HTMLElement => screen.getByTestId('lv-credit');
    expect(credit().textContent).toBe(YT_CREDIT);
    for (const s of [0, 1, 2, 3, 4, 5] as const) {
      goTo(s);
      expect(credit().style.opacity).toBe('1');
      expect(credit().getAttribute('aria-hidden')).toBeNull();
      expect(credit().textContent).toBe(YT_CREDIT);
    }
    goTo(7);
    expect(credit().style.opacity).toBe('0');
    expect(screen.getByTestId('lv-sheet-credit').textContent).toBe('영상 출처: YouTube');
  });

  it('the big card after the source tap opens YouTube from the source time (new tab)', () => {
    draw();
    const hero = screen.getByTestId('lv-hero') as HTMLAnchorElement;
    const ex = LANDING_EXAMPLE;
    const at = `https://www.youtube.com/watch?v=${ex.videos[ex.heroIndex]!.id}&t=${timeToSeconds(ex.heroTime)}s`;
    expect(hero.href).toBe(at);
    expect(heroWatchUrl()).toBe(at);
    expect(hero.target).toBe('_blank');
    expect(hero.rel).toContain('noopener');
    expect(hero.style.pointerEvents).toBe('none');
    goTo(4);
    fireEvent.click(screen.getByTestId('lv-source'));
    expect(scene()).toBe(5);
    expect(hero.style.pointerEvents).toBe('auto');
    expect(hero.tabIndex).toBe(0);
  });
});

describe('YouTube Icon link next to the thumbnails (YouTube API branding guidelines)', () => {
  const HERO_PLAIN = `https://www.youtube.com/watch?v=${LANDING_EXAMPLE.videos[LANDING_EXAMPLE.heroIndex]!.id}`;
  const icon = (a: HTMLElement): HTMLImageElement => a.querySelector('img') as HTMLImageElement;
  function expectOfficial(a: HTMLAnchorElement): void {
    expect(a.target).toBe('_blank');
    expect(a.rel).toContain('noopener');
    const img = icon(a);
    // the official file, whole, in its own proportions, nothing applied to it
    expect(img.getAttribute('src')).toContain('yt_icon_red_digital');
    expect(img.alt).toBe(YT_ICON_ALT);
    expect(Number(img.getAttribute('width')) / Number(img.getAttribute('height'))).toBeCloseTo(
      YT_ICON_FILE_W / YT_ICON_FILE_H,
      6
    );
    expect(img.style.filter).toBe('');
    expect(img.style.opacity).toBe('');
    expect(a.style.opacity).toBe('');
  }

  it('the icon body is at least 24 CSS px tall at a 375px-wide screen (published minimum 24dp)', () => {
    const k = fitStage(375, 812).k;
    expect((YT_ICON_BOX_H * YT_ICON_MARK_FILE_H) / YT_ICON_FILE_H).toBeCloseTo(YT_ICON_MARK_PX, 6);
    expect(YT_ICON_MARK_PX * k).toBeGreaterThanOrEqual(24);
    expect(YT_ICON_BOX_W / YT_ICON_BOX_H).toBeCloseTo(YT_ICON_FILE_W / YT_ICON_FILE_H, 6);
  });

  it('scene 1: the deck thumbnails carry the icon link to their first video', () => {
    draw();
    const a = screen.getByTestId('lv-yt-deck') as HTMLAnchorElement;
    expect(a.closest('.lv-deck-thumbs')).not.toBeNull();
    expect(a.href).toBe(HERO_PLAIN);
    expectOfficial(a);
    expect(a.tabIndex).toBe(0);
    expect(a.getAttribute('aria-label')).toBe(
      ytLinkLabel(LANDING_EXAMPLE.videos[LANDING_EXAMPLE.heroIndex]!.channel)
    );
    // the row icon is not in scene 1 (the deck has its own)
    expect(screen.queryByTestId('lv-yt')).toBeNull();
    goTo(1);
    expect(screen.getByTestId('lv-yt-deck').tabIndex).toBe(-1);
    expect(screen.getByTestId('lv-yt-deck').style.pointerEvents).toBe('none');
  });

  it('scenes 2 to 6: the attribution row carries the icon link; scene 6 from the source time', () => {
    draw();
    for (const s of [1, 2, 3, 4, 5] as const) {
      goTo(s);
      const a = screen.getByTestId('lv-yt') as HTMLAnchorElement;
      expectOfficial(a);
      expect(a.href).toBe(s === 5 ? heroWatchUrl() : HERO_PLAIN);
      expect(a.style.pointerEvents).toBe('auto');
      expect(a.tabIndex).toBe(0);
      // the row sits on one solid colour (a token, never a literal)
      expect(screen.getByTestId('lv-credit').style.backgroundColor).toMatch(
        /^var\(--lv-(white|paper|night)\)$/
      );
    }
    goTo(7);
    // the last sheet has no thumbnails: no icon, the sheet keeps its text attribution
    expect(screen.queryByTestId('lv-yt')).toBeNull();
    expect(screen.getByTestId('lv-sheet-credit').textContent).toBe(YT_CREDIT);
  });

  it('every scene with a visible thumbnail has an icon link (model)', () => {
    for (const s of SEQ) {
      const v = buildScene(s, 2, false, null);
      const thumbs =
        v.cells.some((c) => c.o > 0) || (s === 0 && v.deck.some((d) => d.thumbs.length));
      const linked = v.credit.href !== null || (s === 0 && v.deck.some((d) => d.yt !== null));
      expect([s, linked]).toEqual([s, thumbs]);
    }
  });

  it('the links follow the example config (hero changes, links change)', () => {
    example.swap = true;
    draw();
    const ex = LANDING_EXAMPLE;
    const hero = ex.videos[ex.heroIndex]!;
    expect((screen.getByTestId('lv-yt-deck') as HTMLAnchorElement).href).toBe(
      `https://www.youtube.com/watch?v=${hero.id}`
    );
    goTo(5);
    expect((screen.getByTestId('lv-yt') as HTMLAnchorElement).href).toBe(
      `https://www.youtube.com/watch?v=${hero.id}&t=${timeToSeconds(ex.heroTime)}s`
    );
  });

  it('a swipe that ends on the icon does not open YouTube', () => {
    draw();
    goTo(2);
    swipe(-80); // to scene 4 (s=3); the click that ends a swipe is cancelled
    const a = screen.getByTestId('lv-yt');
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    a.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    waitLock();
    const ok = new MouseEvent('click', { bubbles: true, cancelable: true });
    screen.getByTestId('lv-yt').dispatchEvent(ok);
    expect(ok.defaultPrevented).toBe(false);
  });
});

describe('events (kept in the tab until sign-in)', () => {
  it('landing_open once, each dot once, the source tap once', () => {
    draw();
    goTo(4);
    swipe(80); // back to scene 4 (s=3), already counted
    waitLock();
    goTo(4);
    fireEvent.click(screen.getByTestId('lv-source'));
    waitLock();
    goTo(7);
    expect(readLandingEvents()).toEqual([
      { kind: 'landing_open' },
      { kind: 'landing_scene', value: 's1' },
      { kind: 'landing_scene', value: 's2' },
      { kind: 'landing_scene', value: 's3' },
      { kind: 'landing_scene', value: 's4' },
      { kind: 'landing_scene', value: 's5' },
      { kind: 'source_click' },
      { kind: 'landing_scene', value: 's6' },
    ]);
    for (const e of readLandingEvents()) {
      if (e.value !== undefined) expect(e.value).toMatch(/^[A-Za-z0-9_-]{1,16}$/);
    }
  });

  it('header, sticky and final start sign-in with their value; ADD too; a double tap starts once', async () => {
    fetchLandingWall.mockResolvedValue(wallWith(SHOWN_CELLS));
    const onSignIn = draw();
    await flush();
    fireEvent.click(screen.getByTestId('lv-login'));
    fireEvent.click(screen.getByTestId('lv-login'));
    expect(onSignIn).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem('insighta-landing-arrival')).toMatch(/^google:\d+$/);
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    goTo(2);
    fireEvent.click(screen.getByTestId('lv-google-sticky'));
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    goTo(7);
    fireEvent.click(screen.getByTestId('lv-google-final'));
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    fireEvent.click(screen.getByTestId('lv-add'));
    expect(onSignIn).toHaveBeenCalledTimes(4);
    expect(sessionStorage.getItem('insighta-landing-arrival')).toMatch(/^add:\d+$/);
    const kept = readLandingEvents().filter(
      (e) => e.kind === 'start_click' || e.kind === 'add_click'
    );
    expect(kept).toEqual([
      { kind: 'start_click', value: 'header' },
      { kind: 'start_click', value: 'sticky' },
      { kind: 'start_click', value: 'final' },
      { kind: 'add_click' },
    ]);
  });

  it('keeps only short-token values (the server rule), nothing else', () => {
    recordLandingEvent('landing_scene', 'not a token' as LandingEventValue);
    recordLandingEvent('landing_scene', 's1');
    recordLandingEvent('landing_scene', 's1');
    recordLandingEvent('source_click');
    recordLandingEvent('source_click');
    expect(readLandingEvents()).toEqual([
      { kind: 'landing_scene', value: 's1' },
      { kind: 'source_click' },
    ]);
  });

  it('inside an in-app browser: no Google sign-in, a notice instead', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(IOS_INSTAGRAM);
    const onSignIn = draw();
    fireEvent.click(screen.getByTestId('lv-login'));
    expect(onSignIn).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem('insighta-landing-arrival')).toBeNull();
  });

  it('the privacy link opens the existing legal sheet', async () => {
    vi.useRealTimers();
    draw();
    fireEvent.click(screen.getAllByTestId('lv-dot')[5]!);
    fireEvent.click(screen.getByTestId('lv-privacy'));
    const sheet = await screen.findByTestId('li-sheet-privacy');
    // scrolling or pressing keys in the sheet (a portal) does not change the scene behind it
    fireEvent.wheel(sheet, { deltaY: -200 });
    fireEvent.keyDown(sheet, { key: 'ArrowUp' });
    fireEvent.pointerDown(sheet, { clientY: 200 });
    fireEvent.pointerUp(sheet, { clientY: 400 });
    expect(scene()).toBe(7);
  });
});

describe('reduced motion', () => {
  it('scenes change without motion; no blob, deck or wall animation', () => {
    setReduced(true);
    draw();
    expect(stage().hasAttribute('data-motion')).toBe(false);
    expect(document.querySelector('.lv-blobs')!.hasAttribute('data-move')).toBe(false);
    const deckBefore = screen.getAllByTestId('lv-deck-card').map((d) => d.style.transform);
    act(() => {
      vi.advanceTimersByTime(8000);
    });
    expect(screen.getAllByTestId('lv-deck-card').map((d) => d.style.transform)).toEqual(deckBefore);
    swipe(-80);
    expect(scene()).toBe(1);
    expect(stage().getAttribute('data-phase')).toBe('2');
    expect(screen.getByTestId('lv-text-1').style.transition).toBe('none');
    expect(document.querySelector('.lv-wall-strip')!.hasAttribute('data-move')).toBe(false);
    for (const c of buildScene(2, 2, false, null).cells) expect(c.tr).toBe('none');
  });

  it('with motion: the deck rotates in scene 1 and the wall moves in scene 2', () => {
    draw();
    const before = screen
      .getAllByTestId('lv-deck-card')
      .map((d) => d.style.transform)
      .join('|');
    act(() => {
      vi.advanceTimersByTime(3900);
    });
    expect(
      screen
        .getAllByTestId('lv-deck-card')
        .map((d) => d.style.transform)
        .join('|')
    ).not.toBe(before);
    swipe(-80);
    expect(document.querySelector('.lv-wall-strip')!.hasAttribute('data-move')).toBe(true);
  });
});

describe('stage fit', () => {
  it('scales by width, never past the visible height, and stretches the height', () => {
    expect(fitStage(390, 650)).toEqual({ k: 1, w: 390, h: 650 });
    expect(fitStage(390, 844)).toEqual({ k: 1, w: 390, h: 844 });
    const a = fitStage(375, 650);
    expect(a.w).toBeCloseTo(390);
    expect(a.h).toBeCloseTo(676);
    const b = fitStage(430, 650);
    expect(b.k).toBe(1);
    expect(b.w).toBe(430);
  });
});

describe('last sheet domains = the wall answer `cells` (MORNING_HIDDEN_CELLS)', () => {
  it('lists exactly the shown domains, in order, with their count', async () => {
    fetchLandingWall.mockResolvedValue(wallWith(SHOWN_CELLS));
    draw();
    await flush();
    fireEvent.click(screen.getAllByTestId('lv-dot')[5]!);
    const chips = screen.getAllByTestId('lv-dom');
    expect(chips.map((c) => c.textContent)).toEqual(SHOWN_CELLS);
    expect(screen.getByTestId('lv-domains-lead').textContent).toBe(
      '지금은 5개 분야에서 골라 드려요.'
    );
    const page = screen.getByTestId('lv-intro').textContent ?? '';
    expect(page).not.toContain('8개 분야');
    for (const h of HIDDEN_CELLS) expect(page).not.toContain(h);
    expect(screen.getByTestId('lv-add')).toBeTruthy();
  });

  it('while loading and when the wall fails: no chip row and no count (nothing hardcoded)', async () => {
    let answer: (v: unknown) => void = () => undefined;
    fetchLandingWall.mockReturnValue(new Promise((r) => (answer = r)));
    draw();
    fireEvent.click(screen.getAllByTestId('lv-dot')[5]!);
    expect(screen.queryByTestId('lv-doms')).toBeNull();
    expect(screen.queryByTestId('lv-domains-lead')).toBeNull();
    expect(screen.getByTestId('lv-sheet').textContent).not.toMatch(/개 분야/);
    // the rest of the sheet stays usable
    expect(screen.getByTestId('lv-google-final')).toBeTruthy();
    answer(wallWith(['기술/개발', '재테크/투자']));
    await flush();
    expect(screen.getAllByTestId('lv-dom')).toHaveLength(2);
    expect(screen.getByTestId('lv-domains-lead').textContent).toBe(
      '지금은 2개 분야에서 골라 드려요.'
    );
  });

  it('failed request (default mock) and an older server without `cells`: no row', async () => {
    draw();
    await flush();
    expect(screen.queryByTestId('lv-doms')).toBeNull();
    expect(wallDomains({})).toEqual([]);
    expect(wallDomains({ cells: ['a', '', 3, ' '] })).toEqual(['a']);
    expect(wallDomains(null)).toEqual([]);
  });
});

describe('nothing over a thumbnail (James 2026-11-25)', () => {
  const n = parseFloat;
  const heroAt = (s: 1 | 5) => {
    const v = buildScene(s, 2, false, null, 0, LANDING_EXAMPLE, 202);
    return { v, hero: v.cells[0]!, bar: v.bar };
  };

  it('no play button; the scan line has no layer above the tiles', () => {
    draw();
    for (const s of [0, 1, 2, 3, 4, 5, 7] as const) {
      goTo(s);
      expect(document.querySelector('[class*="lv-play"]')).toBeNull();
      // a thumbnail's box holds its image only
      for (const surf of document.querySelectorAll('.lv-surf')) {
        expect([...surf.children].map((c) => c.tagName)).toEqual(['IMG']);
      }
    }
  });

  it('the bar row is below the thumbnail, and hero and bar are the same in scenes 2 and 5', () => {
    const a = heroAt(1);
    const b = heroAt(5);
    for (const x of [a, b]) expect(n(x.bar.t)).toBeGreaterThanOrEqual(n(x.hero.t) + n(x.hero.h));
    const look = (x: typeof a) => [
      x.hero.l,
      x.hero.w,
      x.hero.h,
      x.bar.l,
      x.bar.w,
      n(x.bar.t) - n(x.hero.t) - n(x.hero.h),
      n(x.v.band.t) - n(x.hero.t),
      x.v.credit.top - n(x.hero.t),
      x.v.credit.right,
      x.v.credit.plate,
      x.v.credit.c,
    ];
    expect(look(b)).toEqual(look(a));
    // only the label differs (and the dot)
    expect([a.bar.lo, b.bar.lo]).toEqual([0, 1]);
  });

  it('scene 5: brief card, line, hero card in order, above the Google button', () => {
    const { v, hero } = heroAt(5);
    const bottom = (h: number): number => {
      const m = /translate\((-?[\d.]+)px,(-?[\d.]+)px\) scale\(([\d.]+)\)/.exec(
        buildScene(5, 2, false, null, 0, LANDING_EXAMPLE, h).card.t
      )!;
      const top = 148 + n(m[2]!);
      expect(top).toBeGreaterThanOrEqual(120); // the two text lines end there
      return top + n(m[3]!) * h;
    };
    for (const h of [160, 202, 284]) expect(bottom(h)).toBeCloseTo(n(v.cn.t), 0);
    expect(n(v.cn.t) + CN_H).toBeCloseTo(n(hero.t), 1);
    expect(n(v.band.t) + BAND_H).toBeLessThanOrEqual(580);
    expect(v.credit.top + YT_ICON_BOX_H).toBeLessThanOrEqual(n(v.band.t) + BAND_H);
    expect(v.credit.top).toBeGreaterThan(n(v.bar.t) + BAR_H - 1);
  });

  it('in flight: hidden thumbnails are gone at once, the bar, name and credit come after', () => {
    for (const s of [0, 1, 5, 7] as const) {
      for (const c of buildScene(s, 0, true, null).cells.filter((x) => !x.hero)) {
        expect(c.o).toBe(0);
        expect(c.tr).toMatch(/opacity 0s/);
      }
    }
    expect(buildScene(5, 0, true, null).bar.tr).toBe(`opacity .25s ${BAR_IN_S}s`);
    expect(BAR_IN_S).toBeGreaterThanOrEqual(0.6); // the cells' flight
    expect(buildScene(4, 0, true, null).bar.tr).toBe('opacity 0s');
    for (const c of buildScene(3, 0, true, null).cells) expect(c.trn).toBe('opacity 0s');
    draw();
    expect(screen.getByTestId('lv-credit').hasAttribute('data-in')).toBe(true);
  });

  it('deck: the thumbnails show only on the uncovered front card; the blank card has no text', () => {
    const on = (d: { lv: number; ar: number } | null, di: number): boolean =>
      buildScene(0, 2, true, d, di).deck[0]!.thumbsOn;
    expect(on({ lv: -1, ar: -1 }, 0)).toBe(true);
    expect(on({ lv: 0, ar: -1 }, 0)).toBe(true); // leaving, on top of the others
    expect(on({ lv: -1, ar: 0 }, 1)).toBe(false);
    expect(on({ lv: -1, ar: -1 }, 1)).toBe(false); // behind the other card
    expect(on({ lv: 1, ar: -1 }, 1)).toBe(false); // the other card is sliding over it
    draw();
    expect(screen.getAllByTestId('lv-deck-card')[2]!.textContent).toBe('');
  });
});

describe('3 to 6 evidence videos: every scene lays them out', () => {
  type Rect = { l: number; t: number; w: number; h: number };
  const rect = (c: { l: string; t: string; w: string; h: string }): Rect => ({
    l: parseFloat(c.l),
    t: parseFloat(c.t),
    w: parseFloat(c.w),
    h: parseFloat(c.h),
  });
  const overlap = (a: Rect, b: Rect): boolean =>
    a.l < b.l + b.w && b.l < a.l + a.w && a.t < b.t + b.h && b.t < a.t + a.h;

  it.each([3, 4, 5, 6])('%i videos: model positions fit the stage and never overlap', (n) => {
    example.swap = true;
    example.count = n;
    const ex = LANDING_EXAMPLE;
    expect(checkLandingExample(ex)).toEqual([]);
    for (const s of SEQ) {
      const v = buildScene(s, 2, false, null, 0, ex);
      expect(v.cells).toHaveLength(n);
      // every video once, the hero first (its place in the design)
      expect(new Set(v.cells.map((c) => c.video.id)).size).toBe(n);
      expect(v.cells[0]!.video).toBe(ex.videos[ex.heroIndex]);
      const shown = v.cells.filter((c) => c.o > 0).map(rect);
      for (const r of shown) {
        expect(r.l).toBeGreaterThanOrEqual(0);
        expect(r.l + r.w).toBeLessThanOrEqual(STAGE_W);
        expect(r.t).toBeGreaterThanOrEqual(0);
        expect(r.t + r.h).toBeLessThanOrEqual(STAGE_H);
      }
      if (s === 2 || s === 3 || s === 4) {
        expect(shown).toHaveLength(n);
        for (let i = 0; i < shown.length; i++)
          for (let j = i + 1; j < shown.length; j++)
            expect([s, i, j, overlap(shown[i]!, shown[j]!)]).toEqual([s, i, j, false]);
        // the attribution row is under the thumbnails and clear of them
        const bottom = Math.max(...shown.map((r) => r.t + r.h));
        expect(v.credit.on).toBe(true);
        expect(v.credit.top).toBeGreaterThanOrEqual(bottom);
      }
    }
    // scene 3's tiles: the last row is centred on the content column
    const tiles = buildScene(2, 2, false, null, 0, ex).cells.map(rect);
    const lastTop = Math.max(...tiles.map((r) => r.t));
    const last = tiles.filter((r) => r.t === lastTop);
    const mid = (Math.min(...last.map((r) => r.l)) + Math.max(...last.map((r) => r.l + r.w))) / 2;
    expect(mid).toBeCloseTo(STAGE_W / 2, 0);
    // five and six keep the design's attribution row (458); four are 2x2, larger tiles
    expect(buildScene(2, 2, false, null, 0, ex).credit.top).toBe(
      { 3: 354, 4: 522, 5: 458, 6: 458 }[n]
    );
    if (n === 4) expect(new Set(tiles.map((r) => r.t)).size).toBe(2);
    // the thumbnails are 16:9 (YouTube thumbnails unaltered)
    for (const c of buildScene(2, 2, false, null, 0, ex).cells) {
      expect(Math.abs(parseFloat(c.sw) / parseFloat(c.sh2) - 16 / 9)).toBeLessThan(0.02);
    }
  });

  it.each([3, 4, 6])(
    '%i videos: the page draws each thumbnail once, unaltered, with links',
    (n) => {
      example.swap = true;
      example.count = n;
      const ex = LANDING_EXAMPLE;
      draw();
      expect(screen.getAllByTestId('lv-cell')).toHaveLength(n - 1);
      goTo(2);
      const srcs = [screen.getByTestId('lv-hero'), ...screen.getAllByTestId('lv-cell')].map((el) =>
        el.querySelector('img')!.getAttribute('src')
      );
      expect(new Set(srcs)).toEqual(
        new Set(ex.videos.map((v) => `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`))
      );
      for (const img of screen.getAllByTestId('lv-thumb'))
        expect(img.getAttribute('style')).toBeNull();
      // the deck shows the first three (hero first) and its icon link
      expect(
        screen.getAllByTestId('lv-deck-card')[0]!.querySelectorAll('img.lv-deck-thumb')
      ).toHaveLength(3);
      expect(screen.getByTestId('lv-yt')).toBeTruthy();
      goTo(4);
      expect(screen.getByTestId('lv-source').textContent).toBe('채널2 01:05');
      expect(screen.getByTestId('lv-card').textContent).toContain(`· 채널${n - 2} 07:00`);
      for (const c of screen.getAllByTestId('lv-cell')) expect(c.style.opacity).toBe('1');
      fireEvent.click(screen.getByTestId('lv-source'));
      expect((screen.getByTestId('lv-yt') as HTMLAnchorElement).href).toBe(
        `https://www.youtube.com/watch?v=${ex.videos[2]!.id}&t=65s`
      );
    }
  );
});
