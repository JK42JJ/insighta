import { readFileSync } from 'node:fs';

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
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
  S1_BODY,
  S1_TITLE,
  S3_BODY,
  S3_TITLE,
  wallDomains,
  YT_CREDIT,
  YT_ICON_ALT,
  ytPageLabel,
} from '@/pages/intro/model/landing-content';
import {
  checkLandingExample,
  EXAMPLE_VIDEOS_MAX,
  EXAMPLE_VIDEOS_MIN,
  embedUrl,
  heroPlay,
  LANDING_EXAMPLE,
  THUMB_MISSING_W,
  timeToSeconds,
  withoutVideos,
} from '@/pages/intro/model/landing-example';
import {
  addSample,
  DRAG_SLOP_PX,
  dragOffset,
  judgeSwipe,
  releaseSpeed,
  SETTLE_MS,
  swipeValue,
  type Sample,
} from '@/pages/intro/model/landing-swipe';
import {
  BAND_H,
  BAR_H,
  BAR_IN_S,
  buildScene,
  dotsTopAbove,
  GROUND_EDGE,
  readGroup,
  STAGE_H,
  STAGE_W,
  DOT,
  DOTGO,
  fitStage,
  nextScene,
  PH1_MS,
  PLAY_RUN_S,
  sceneEventValue,
  SEQ,
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
/** The page settles (fake clock). */
function settled(): void {
  act(() => {
    vi.advanceTimersByTime(SETTLE_MS + 1);
  });
}
/** Settled, and late enough for a click to be a tap again. */
function waitLock(): void {
  act(() => {
    vi.advanceTimersByTime(SETTLE_MS + 400);
  });
}
/** One pointer event of a gesture with its own time (ms), for the speed. */
function ptr(type: 'Down' | 'Move' | 'Up' | 'Cancel', y: number, at: number, x = 200): void {
  const name = `pointer${type.toLowerCase()}`;
  const ev = new MouseEvent(name, { bubbles: true, cancelable: true, clientX: x, clientY: y });
  Object.defineProperty(ev, 'pointerId', { value: 1 });
  Object.defineProperty(ev, 'timeStamp', { value: at });
  act(() => {
    stage().dispatchEvent(ev);
  });
}
/** A finger moving evenly from y=500 by dy in ms, let go at the end (or held still before). */
function drag(
  dy: number,
  ms: number,
  opts: { dx?: number; hold?: number; end?: 'Up' | 'Cancel' } = {}
): void {
  const steps = 8;
  ptr('Down', 500, 1000);
  for (let i = 1; i <= steps; i++) {
    ptr(
      'Move',
      500 + (dy * i) / steps,
      1000 + (ms * i) / steps,
      200 + ((opts.dx ?? 0) * i) / steps
    );
  }
  ptr(
    opts.end ?? 'Up',
    opts.end === 'Cancel' ? 0 : 500 + dy,
    1000 + ms + (opts.hold ?? 0),
    200 + (opts.dx ?? 0)
  );
}
const track = (): HTMLElement => screen.getByTestId('lv-track');
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

// the embedded player's page is never loaded in tests
(
  window as unknown as { happyDOM?: { settings: { disableIframePageLoading: boolean } } }
).happyDOM!.settings.disableIframePageLoading = true;

/** The player is open on the landing with this video from this second. */
function expectPlays(id: string, start: number): void {
  const u = new URL((screen.getByTestId('lv-player-frame') as HTMLIFrameElement).src);
  expect(u.origin + u.pathname).toBe(`https://www.youtube.com/embed/${id}`);
  expect(Number(u.searchParams.get('start'))).toBe(start);
}

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

describe('swipe rules (James 2026-11-25)', () => {
  const H = 844;
  it('goes on by distance (12% of the height) or by speed (40% of it per second), both ways', () => {
    expect(judgeSwipe(-H * 0.12, 0, H)).toBe(1);
    expect(judgeSwipe(H * 0.12, 0, H)).toBe(-1);
    expect(judgeSwipe(-H * 0.119, 0, H)).toBeNull();
    expect(judgeSwipe(H * 0.119, 0, H)).toBeNull();
    expect(judgeSwipe(-20, -H * 0.4, H)).toBe(1); // a short flick
    expect(judgeSwipe(20, H * 0.4, H)).toBe(-1);
    expect(judgeSwipe(-20, -H * 0.39, H)).toBeNull();
    expect(judgeSwipe(-H * 0.5, H * 0.6, H)).toBeNull(); // thrown back
    expect(judgeSwipe(0, -H, H)).toBeNull();
  });

  it('measures the speed over the last 100 ms; a finger that rested has none', () => {
    let l: Sample[] = [];
    for (let i = 0; i <= 10; i++) l = addSample(l, { t: i * 20, y: 500 - i * 10 });
    expect(releaseSpeed(l, 200)).toBeCloseTo(-500, 0);
    expect(releaseSpeed(l, 400)).toBe(0);
    expect(l.length).toBeLessThanOrEqual(7);
  });

  it('follows the finger 1:1, with resistance only at the ends', () => {
    expect(dragOffset(-200, H, true, true)).toBe(-200);
    expect(dragOffset(300, H, true, true)).toBe(300);
    expect(dragOffset(200, H, false, true)).toBe(50);
    expect(dragOffset(-200, H, true, false)).toBe(-50);
    expect(dragOffset(-2000, H, true, true)).toBe(-H);
  });

  it('the usage value fits the server rule', () => {
    for (const v of [swipeValue(-34, -900, H, true), swipeValue(H * 20, H * 50, H, false)]) {
      expect(v).toMatch(/^[A-Za-z0-9_-]{1,16}$/);
    }
    expect(swipeValue(-84.4, -844, H, true)).toBe('ng_10_100');
    expect(swipeValue(84.4, 0, H, false)).toBe('pb_10_0');
  });
});

describe('paging', () => {
  it('a long slow drag and a short flick go on, a small slow drag comes back', () => {
    draw();
    drag(-200, 900);
    settled();
    expect(scene()).toBe(1);
    drag(-30, 60); // a flick
    settled();
    expect(scene()).toBe(2);
    drag(-30, 900);
    settled();
    expect(scene()).toBe(2);
    drag(30, 60); // a flick back
    settled();
    expect(scene()).toBe(1);
    drag(-200, 900, { hold: 400 }); // held still at the end: the distance decides
    settled();
    expect(scene()).toBe(2);
  });

  it('a slanted swipe goes on', () => {
    draw();
    drag(-60, 120, { dx: 70 });
    settled();
    expect(scene()).toBe(1);
  });

  it('while dragging the page follows 1:1 and the neighbour is beside it', () => {
    draw();
    ptr('Down', 500, 0);
    ptr('Move', 400, 100);
    const k = fitStage(window.innerWidth, window.innerHeight).k;
    const at = /translate3d\(0, (-?[\d.]+)px, 0\)/.exec(track().style.transform)!;
    expect(Number(at[1]) * k).toBeCloseTo(-(100 - DRAG_SLOP_PX), 3);
    expect(track().style.transition).toBe('none');
    const pages = [...document.querySelectorAll<HTMLElement>('.lv-page')];
    expect(pages.map((p) => [p.dataset['page'], p.style.top])).toEqual([
      ['0', '0%'],
      ['1', '100%'],
    ]);
    expect(pages[1]!.textContent).toContain(S1_TITLE); // the next scene's text comes along
    expect(pages[1]!.hasAttribute('inert')).toBe(true);
    ptr('Up', 400, 120);
    expect(track().style.transition).toContain(`${SETTLE_MS}ms`);
    settled();
    expect(scene()).toBe(1);
    expect(track().style.transform).toBe('none'); // the new page is the current one, in place
  });

  it('three quick swipes: three scenes (the one under way goes to its end at once)', () => {
    draw();
    for (let i = 0; i < 3; i++) drag(-60, 80);
    settled();
    expect(scene()).toBe(3);
    for (let i = 0; i < 3; i++) drag(60, 80);
    settled();
    expect(scene()).toBe(0);
  });

  it('pointercancel is judged by what the finger did; leaving the stage is not an end', () => {
    draw();
    drag(-60, 80, { end: 'Cancel' });
    settled();
    expect(scene()).toBe(1);
    ptr('Down', 500, 0);
    ptr('Move', 300, 300);
    fireEvent.pointerLeave(stage());
    expect(scene()).toBe(1);
    expect(track().style.transform).toContain('translate3d');
    ptr('Up', 300, 320);
    settled();
    expect(scene()).toBe(2);
  });

  it('the pressed element losing its implicit capture is not an end', () => {
    draw();
    ptr('Down', 500, 0);
    ptr('Move', 440, 200);
    const lost = new MouseEvent('lostpointercapture', { bubbles: true });
    Object.defineProperty(lost, 'pointerId', { value: 1 });
    act(() => {
      track().dispatchEvent(lost);
    });
    ptr('Move', 300, 600);
    expect(track().style.transition).toBe('none'); // still under the finger
    ptr('Up', 300, 900);
    settled();
    expect(scene()).toBe(1);
  });

  it('another finger does not disturb the gesture', () => {
    draw();
    ptr('Down', 500, 0);
    ptr('Move', 440, 60);
    fireEvent.pointerDown(stage(), { clientY: 100, pointerId: 2 });
    fireEvent.pointerUp(stage(), { clientY: 700, pointerId: 2 });
    ptr('Up', 420, 80);
    settled();
    expect(scene()).toBe(1);
  });

  it('the steps inside a scene start when its page is in place', () => {
    draw();
    waitLock();
    drag(-200, 200);
    expect(scene()).toBe(0); // still settling
    expect(stage().getAttribute('data-phase')).toBe('2');
    settled();
    expect([scene(), stage().getAttribute('data-phase')]).toEqual([1, '0']);
    act(() => {
      vi.advanceTimersByTime(PH1_MS + 1);
    });
    expect(stage().getAttribute('data-phase')).toBe('1');
  });

  it('a resize during a gesture waits for its end', () => {
    const [w, h] = [window.innerWidth, window.innerHeight];
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
    draw();
    const before = stage().style.height;
    ptr('Down', 500, 0);
    ptr('Move', 440, 60);
    Object.defineProperty(window, 'innerHeight', { value: h - 90, configurable: true });
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(stage().style.height).toBe(before);
    ptr('Up', 440, 70);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(stage().style.height).not.toBe(before);
    Object.defineProperty(window, 'innerHeight', { value: h, configurable: true });
    Object.defineProperty(window, 'innerWidth', { value: w, configurable: true });
  });

  it('every scene starts with one title and one text of the same two styles', () => {
    draw();
    for (const s of [0, 1, 2, 3, 4, 5, 7] as const) {
      goTo(s);
      const box = screen.getByTestId(`lv-text-${s === 7 ? 6 : s}`);
      const kids = [...box.children].map((c) => c.className);
      expect([s, kids]).toEqual([s, ['lv-title', 'lv-text']]);
    }
  });

  it('keeps each gesture as a usage event', () => {
    draw();
    drag(-200, 900);
    settled();
    drag(-30, 900);
    settled();
    const v = readLandingEvents()
      .filter((e) => e.kind === 'landing_swipe')
      .map((e) => e.value);
    expect(v).toHaveLength(2);
    expect(v[0]).toMatch(/^ng_\d+_\d+$/);
    expect(v[1]).toMatch(/^nb_\d+_\d+$/);
  });

  it('no pull-to-refresh while the landing is shown', () => {
    draw();
    expect(document.documentElement.style.overscrollBehavior).toBe('none');
    expect(document.body.style.overscrollBehavior).toBe('none');
    cleanup();
    expect(document.body.style.overscrollBehavior).toBe('');
  });

  it('wheel (one push = one scene) and keys page the same way and stop at the ends', () => {
    draw();
    fireEvent.wheel(stage(), { deltaY: 100 });
    fireEvent.wheel(stage(), { deltaY: 100 });
    settled();
    expect(scene()).toBe(1);
    fireEvent.keyDown(stage(), { key: 'ArrowDown' });
    settled();
    expect(scene()).toBe(2);
    fireEvent.keyDown(stage(), { key: 'ArrowUp' });
    settled();
    expect(scene()).toBe(1);
    fireEvent.keyDown(stage(), { key: 'PageUp' });
    settled();
    fireEvent.keyDown(stage(), { key: 'PageUp' });
    settled();
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

describe('header buttons (James 2026-11-25)', () => {
  const down = (el: HTMLElement, x = 40, y = 20): void => {
    fireEvent.pointerDown(el, { clientX: x, clientY: y });
  };
  it('both are buttons; the ground is on from the touch to the release', () => {
    draw();
    for (const id of ['lv-brand', 'lv-login']) {
      const b = screen.getByTestId(id);
      expect(b.tagName).toBe('BUTTON');
      down(b);
      expect(b.hasAttribute('data-pressed')).toBe(true);
      fireEvent.pointerUp(b, { clientX: 40, clientY: 20 });
      expect(b.hasAttribute('data-pressed')).toBe(false);
    }
  });

  it('Insighta goes to the first scene (nothing happens there)', () => {
    const onSignIn = draw();
    goTo(3);
    fireEvent.click(screen.getByTestId('lv-brand'));
    expect(scene()).toBe(0);
    fireEvent.click(screen.getByTestId('lv-brand'));
    expect(scene()).toBe(0);
    expect(onSignIn).not.toHaveBeenCalled();
  });

  it('a gesture that starts on a header button never turns the page; 10px cancels the press', () => {
    const onSignIn = draw();
    const b = screen.getByTestId('lv-login');
    down(b);
    fireEvent.pointerMove(b, { clientX: 40, clientY: 40 });
    expect(b.hasAttribute('data-pressed')).toBe(false);
    fireEvent.pointerMove(b, { clientX: 40, clientY: 300 });
    fireEvent.pointerUp(b, { clientX: 40, clientY: 300 });
    fireEvent.click(b, { detail: 1 });
    settled();
    expect(scene()).toBe(0);
    expect(onSignIn).not.toHaveBeenCalled();
    down(b);
    fireEvent.pointerUp(b, { clientX: 40, clientY: 20 });
    fireEvent.click(b, { detail: 1 });
    expect(onSignIn).toHaveBeenCalledTimes(1);
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
      '관심 있는 글을 가볍게 읽어요.' + '자세한 건 영상으로 확인하면 맥락이 만들어집니다.'
    );
    expect(S3_TITLE + ' ' + S3_BODY).not.toMatch(/관심있는|자세한건|만들어 집니다/);
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
    expect(heroPlay(LANDING_EXAMPLE)).toEqual({ video: hero, start: 65 });
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

  it('one icon per scene with videos and no words; the words are in the last sheet only', () => {
    draw();
    const page = (): HTMLElement => document.querySelector<HTMLElement>('[data-page="0"]')!;
    const icons = (): number =>
      [...page().querySelectorAll<HTMLElement>('a.lv-yt')].filter((a) => a.tabIndex === 0).length;
    for (const s of [0, 1, 2, 3, 4, 5] as const) {
      goTo(s);
      expect([s, icons()]).toEqual([s, 1]);
      const words = page().querySelector('[data-testid="lv-credit"]')!.textContent;
      expect([s, words]).toEqual([s, '']);
    }
    goTo(7);
    expect(icons()).toBe(0);
    expect(screen.getByTestId('lv-sheet-credit').textContent).toBe('영상 출처: YouTube');
  });

  it('a channel name is drawn only where one video is shown large (scenes 2 and 6)', () => {
    for (const s of SEQ) {
      const v = buildScene(s, 2, false, null);
      expect(v.cells.every((c) => c.no === 0)).toBe(true);
      expect([s, v.band.o]).toEqual([s, s === 1 || s === 5 ? 1 : 0]);
    }
  });

  it('the drawn background tiles have no play sign and stay low behind thumbnails', () => {
    draw();
    expect(document.querySelector('[class*="lv-wall-disc"], [class*="lv-wall-time"]')).toBeNull();
    for (const s of [1, 2] as const) {
      for (const ph of [0, 1, 2] as const) expect(buildScene(s, ph, true, null).wall.o).toBe(0.32);
    }
  });

  it('a thumbnail that does not load: hqdefault, then another evidence video takes its place', () => {
    example.swap = true;
    draw();
    goTo(2);
    const ids = (): string[] => [
      ...new Set(
        [...document.querySelectorAll<HTMLImageElement>('[data-page="0"] img.lv-thumb')].map(
          (i) => /vi\/([\w-]{11})/.exec(i.src)![1]!
        )
      ),
    ];
    const before = ids();
    const img = (): HTMLImageElement =>
      document.querySelector<HTMLImageElement>('[data-page="0"] [data-testid="lv-cell"] img')!;
    const gone = /vi\/([\w-]{11})/.exec(img().src)![1]!;
    expect(img().src).toContain('/mqdefault.jpg');
    fireEvent.error(img());
    expect(img().src).toContain(`${gone}/hqdefault.jpg`);
    // a missing picture answers 120px wide instead of an error
    Object.defineProperty(img(), 'naturalWidth', { value: THUMB_MISSING_W, configurable: true });
    fireEvent.load(img());
    expect(ids()).toEqual(before.filter((x) => x !== gone));
  });

  it('withoutVideos keeps the hero, the cited sources and at least three videos', () => {
    const ex = LANDING_EXAMPLE;
    const hero = ex.videos[ex.heroIndex]!;
    const other = ex.videos.find((v) => v !== hero)!;
    const cut = withoutVideos(ex, new Set([other.id, hero.id]));
    expect(cut.videos).not.toContain(other);
    expect(cut.videos[cut.heroIndex]).toBe(hero);
    expect(checkLandingExample(cut)).toEqual([]);
    expect(withoutVideos(ex, new Set(ex.videos.map((v) => v.id)))).toBe(ex);
  });

  it('the big card after the source tap plays on the landing from the source time', () => {
    draw();
    const hero = screen.getByTestId('lv-hero');
    expect(hero.tagName).toBe('BUTTON');
    expect(hero.style.pointerEvents).toBe('none');
    fireEvent.click(hero); // not in its scene: nothing plays
    expect(screen.queryByTestId('lv-player')).toBeNull();
    goTo(4);
    fireEvent.click(screen.getByTestId('lv-source'));
    expect(scene()).toBe(5);
    const open = screen.getByTestId('lv-hero');
    expect(open.style.pointerEvents).toBe('auto');
    expect(open.tabIndex).toBe(0);
    waitLock();
    fireEvent.click(open);
    const ex = LANDING_EXAMPLE;
    expectPlays(ex.videos[ex.heroIndex]!.id, timeToSeconds(ex.heroTime));
    // closing comes back to the same scene
    fireEvent.click(screen.getByTestId('lv-player-close'));
    expect(screen.queryByTestId('lv-player')).toBeNull();
    expect(scene()).toBe(5);
  });

  it('the player: Escape closes it; a swipe on it does not change the scene', () => {
    draw();
    goTo(5);
    waitLock();
    fireEvent.click(screen.getByTestId('lv-hero'));
    const p = screen.getByTestId('lv-player');
    fireEvent.pointerDown(p, { clientY: 400 });
    fireEvent.pointerUp(p, { clientY: 200 });
    fireEvent.wheel(p, { deltaY: 200 });
    expect(scene()).toBe(5);
    fireEvent.keyDown(p, { key: 'Escape' });
    expect(screen.queryByTestId('lv-player')).toBeNull();
  });

  it('only the icon leads to YouTube: videos and thumbnails play on the landing (James 2026-11-25)', () => {
    draw();
    for (const s of [0, 1, 2, 3, 4, 5, 7] as const) {
      goTo(s);
      const links = [...document.querySelectorAll<HTMLAnchorElement>('a[href], [target="_blank"]')];
      expect(links.every((a) => a.classList.contains('lv-yt'))).toBe(true);
    }
    cleanup();
    draw();
    goTo(5);
    waitLock();
    expect(screen.getByTestId('lv-hero').tagName).toBe('BUTTON');
    fireEvent.click(screen.getByTestId('lv-hero'));
    expect(screen.getByTestId('lv-player').querySelector('a')).toBeNull();
    expect(embedUrl(heroPlay())).toMatch(/^https:\/\/www\.youtube\.com\/embed\//);
    expect(embedUrl(heroPlay())).toContain('playsinline=1');
  });
});

describe('YouTube Icon next to the thumbnails (YouTube API branding guidelines)', () => {
  const HERO_ID = LANDING_EXAMPLE.videos[LANDING_EXAMPLE.heroIndex]!.id;
  const icon = (a: HTMLElement): HTMLImageElement => a.querySelector('img') as HTMLImageElement;
  /** The video's YouTube page, in a new tab. */
  const page = (id: string, start = 0): string =>
    `https://www.youtube.com/watch?v=${id}${start ? `&t=${start}s` : ''}`;
  function expectOfficial(a: HTMLElement): void {
    expect(a.tagName).toBe('A');
    expect((a as HTMLAnchorElement).target).toBe('_blank');
    expect((a as HTMLAnchorElement).rel).toContain('noopener');
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
    const a = screen.getByTestId('lv-yt-deck');
    expect(a.closest('.lv-deck-thumbs')).not.toBeNull();
    expectOfficial(a);
    expect(a.tabIndex).toBe(0);
    expect(a.getAttribute('aria-label')).toBe(
      ytPageLabel(LANDING_EXAMPLE.videos[LANDING_EXAMPLE.heroIndex]!.channel)
    );
    expect((a as HTMLAnchorElement).href).toBe(page(HERO_ID));
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
      const a = screen.getByTestId('lv-yt');
      expectOfficial(a);
      expect((a as HTMLAnchorElement).href).toBe(page(HERO_ID, s === 5 ? heroPlay().start : 0));
      expect(a.style.pointerEvents).toBe('auto');
      expect(a.tabIndex).toBe(0);
      // no plate of its own: the ground under the row is one solid colour (the hero card in scenes
      // 2 and 6, the paper / night ground in 3, 4, 5) and starts far enough above the row
      const credit = screen.getByTestId('lv-credit');
      expect(credit.style.backgroundColor).toBe('');
      const paper = screen.getByTestId('lv-ground-paper');
      const night = screen.getByTestId('lv-ground-night');
      expect([s, paper.style.opacity, night.style.opacity]).toEqual([
        s,
        s === 2 ? '1' : '0',
        s === 3 || s === 4 ? '1' : '0',
      ]);
      if (s === 2 || s === 3 || s === 4) {
        const top = parseFloat((s === 2 ? paper : night).style.top);
        expect(parseFloat(credit.style.top) - top).toBeCloseTo(GROUND_EDGE, 0);
      } else {
        expect(screen.getByTestId('lv-band').style.opacity).toBe('1');
      }
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
      const linked = v.credit.play !== null || (s === 0 && v.deck.some((d) => d.yt !== null));
      expect([s, linked]).toEqual([s, thumbs]);
    }
  });

  it('the links follow the example config (hero changes, links change)', () => {
    example.swap = true;
    draw();
    const ex = LANDING_EXAMPLE;
    const hero = ex.videos[ex.heroIndex]!;
    expect((screen.getByTestId('lv-yt-deck') as HTMLAnchorElement).href).toBe(page(hero.id));
    goTo(5);
    expect((screen.getByTestId('lv-yt') as HTMLAnchorElement).href).toBe(
      page(hero.id, timeToSeconds(ex.heroTime))
    );
  });

  it('a swipe that ends on the icon opens nothing', () => {
    draw();
    goTo(2);
    swipe(-80);
    const click = (): boolean => {
      const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
      screen.getByTestId('lv-yt').addEventListener('click', (e) => e.preventDefault(), {
        once: true,
        passive: false,
      });
      ev.preventDefault = vi.fn(ev.preventDefault.bind(ev));
      screen.getByTestId('lv-yt').dispatchEvent(ev);
      return vi.mocked(ev.preventDefault).mock.calls.length > 1; // the page's own, besides the test's
    };
    expect(click()).toBe(true);
    waitLock();
    expect(click()).toBe(false);
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
    expect(readLandingEvents().filter((e) => e.kind !== 'landing_swipe')).toEqual([
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
    expect(document.querySelector('[data-page="0"] .lv-blobs')!.hasAttribute('data-move')).toBe(
      false
    );
    const deckBefore = screen.getAllByTestId('lv-deck-card').map((d) => d.style.transform);
    act(() => {
      vi.advanceTimersByTime(8000);
    });
    expect(screen.getAllByTestId('lv-deck-card').map((d) => d.style.transform)).toEqual(deckBefore);
    swipe(-80);
    expect(scene()).toBe(1);
    expect(stage().getAttribute('data-phase')).toBe('2');
    expect(screen.getByTestId('lv-text-1').style.transition).toBe('none');
    expect(
      document.querySelector('[data-page="0"] .lv-wall-strip')!.hasAttribute('data-move')
    ).toBe(false);
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
    settled();
    expect(
      document.querySelector('[data-page="0"] .lv-wall-strip')!.hasAttribute('data-move')
    ).toBe(true);
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
      x.v.credit.c,
    ];
    expect(look(b)).toEqual(look(a));
    // only the label differs (and the dot)
    expect([a.bar.lo, b.bar.lo]).toEqual([0, 1]);
  });

  it('scene 5: the brief card is unscaled, under the text, its sentence kept above the video', () => {
    const { v, hero } = heroAt(5);
    for (const h of [160, 203, 284]) {
      const c = buildScene(5, 2, false, null, 0, LANDING_EXAMPLE, h).card;
      const top = 148 + n(/translateY\((-?[\d.]+)px\)/.exec(c.t)![1]!);
      const cut = n(/inset\(([\d.]+)px/.exec(c.clip)![1]!);
      expect(top + cut).toBeGreaterThanOrEqual(212); // the text (two title lines, one line) ends at 205
      if (cut > 0) expect(top + h).toBe(318 + 14); // its lower end is behind the video's edge
    }
    expect(n(hero.t)).toBe(318);
    expect(n(v.band.t) + BAND_H).toBeLessThanOrEqual(582);
    expect(v.credit.top + YT_ICON_BOX_H).toBeLessThanOrEqual(n(v.band.t) + BAND_H);
    expect(v.credit.top).toBeGreaterThan(n(v.bar.t) + BAR_H - 1);
  });

  it('text keeps its size: no scene scales the card, the source chip or a button', () => {
    for (const s of SEQ) {
      for (const ph of [0, 1, 2] as const) {
        expect(buildScene(s, ph, true, null, 0, LANDING_EXAMPLE, 208).card.t).not.toContain(
          'scale'
        );
      }
    }
    const css = readFileSync('src/pages/intro/ui/landing.css', 'utf8');
    const rule = (sel: string): string =>
      new RegExp(`(?:^|\\n)${sel.replace('.', '\\.')} \\{([^}]*)\\}`).exec(css)![1]!;
    for (const sel of ['.lv-title']) {
      expect(rule(sel)).toContain('font-size: 34px');
      expect(rule(sel)).toContain('line-height: 1.3;');
      expect(rule(sel)).toContain('letter-spacing: -0.045em');
    }
    // one rule places the top of every scene
    expect(css).toMatch(/\n\.lv-t0,\n\.lv-t1,\n\.lv-t2,\n\.lv-tn,\n\.lv-t6 \{[^}]*top: 80px/);
    for (const sel of ['.lv-text', '.lv-card-p']) {
      expect(rule(sel)).toContain('font-size: 17px');
    }
    for (const sel of ['.lv-deck-h', '.lv-card-h']) expect(rule(sel)).toContain('font-size: 22px');
    for (const sel of ['.lv-kicker', '.lv-src', '.lv-hint', '.lv-band', '.lv-credit']) {
      expect(rule(sel)).toContain('font-size: 13px');
    }
  });

  it('the thumbnail casts no shadow on the hero card (the card carries it)', () => {
    for (const s of [1, 5] as const) {
      const { v, hero } = heroAt(s);
      expect(hero.sh).toBe('none');
      expect(v.band.t).toBe(hero.t);
    }
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
    goTo(1);
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

describe('flaws seen in the stg captures (James 2026-11-25)', () => {
  it('scene 2: "알 수 있거든요" is never split over two lines', () => {
    expect(S1_BODY).toContain('알\u00a0수\u00a0있거든요.');
    draw();
    goTo(1);
    expect(screen.getByTestId('lv-text-1').textContent).toBe(S1_TITLE + S1_BODY);
  });

  it.each([3, 4, 5, 6])(
    'scenes 4/5, %i videos: card, chips, attribution are one group',
    (count) => {
      for (const h of [160, 202, 208]) {
        const g = readGroup(h, count);
        const gapAbove = g.card - 252;
        const chipsGap = g.chips - (g.card + h);
        const gapBelow = 585 - (g.credit + YT_ICON_BOX_H);
        expect(gapAbove).toBeGreaterThanOrEqual(0);
        expect(chipsGap).toBeCloseTo(20, 5);
        // the group stays above the Google button, the free height is on both sides of it
        expect(gapBelow).toBeGreaterThanOrEqual(0);
        expect(gapAbove).toBeCloseTo(((gapAbove + gapBelow) * 2) / 5, 5);
      }
    }
  );

  it('scenes 4/5: the chips fill the content column (28..362) and keep 16:9', () => {
    const cells = buildScene(3, 2, false, null, 0, LANDING_EXAMPLE, 202).cells;
    const last = cells[cells.length - 1]!;
    expect(parseFloat(cells[0]!.l)).toBe(28);
    expect(parseFloat(last.l) + parseFloat(last.w)).toBeCloseTo(362, 0);
    for (const c of cells) expect(parseFloat(c.w) / parseFloat(c.h)).toBeCloseTo(16 / 9, 1);
  });

  it('scenes 4 and 5 hold still between each other', () => {
    const a = buildScene(3, 2, false, null, 0, LANDING_EXAMPLE, 202);
    const b = buildScene(4, 2, false, null, 0, LANDING_EXAMPLE, 202);
    expect(b.card.t).toBe(a.card.t);
    expect(b.credit.top).toBe(a.credit.top);
    expect(b.cells.map((c) => [c.l, c.t])).toEqual(a.cells.map((c) => [c.l, c.t]));
  });

  it('last scene: the dots are between the header and the sheet, elsewhere at the middle', () => {
    const DOTS_H = 6 * 15;
    for (const [sheet, stage] of [
      [320, 650],
      [420, 650],
      [320, 844],
    ] as const) {
      const mid = dotsTopAbove(sheet, stage);
      expect(mid - DOTS_H / 2).toBeGreaterThanOrEqual(52);
      expect(mid + DOTS_H / 2).toBeLessThanOrEqual(stage - sheet);
    }
    const h = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(320);
    draw();
    expect(screen.getByTestId('lv-dots').style.top).toBe('');
    goTo(7);
    expect(screen.getByTestId('lv-dots').style.top).not.toBe('');
    h.mockRestore();
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
    // the tiles and the icon are one group, centred between the text (246) and the button (582)
    const top = Math.min(...tiles.map((x) => x.t));
    const end = buildScene(2, 2, false, null, 0, ex).credit.top + YT_ICON_BOX_H;
    expect(top - 246).toBeCloseTo(582 - end, 0);
    expect(top).toBeGreaterThanOrEqual(246);
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
      waitLock();
      fireEvent.click(screen.getByTestId('lv-hero'));
      expectPlays(ex.videos[2]!.id, 65);
    }
  );
});
