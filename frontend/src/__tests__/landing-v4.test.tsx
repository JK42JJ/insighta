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
// the sheets render the real pages; their i18n text is not under test here
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  Trans: ({ i18nKey }: { i18nKey: string }) => i18nKey,
}));
// the example config, replaced with other values: everything shown must follow it
const example = vi.hoisted(() => ({ swap: false }));
vi.mock('@/pages/intro/model/landing-example', async (orig) => {
  const actual = await orig<typeof import('@/pages/intro/model/landing-example')>();
  const OTHER: typeof actual.LANDING_EXAMPLE = {
    brief: {
      domain: '재테크/투자',
      headline: 'H-테스트 헤드라인',
      firstSentence: 'F-테스트 첫 문장.',
      sources: [
        { video: 2, time: '01:05' },
        { video: 4, time: '07:00' },
      ],
    },
    videos: Array.from({ length: 6 }, (_x, i) => ({
      id: `vid${i}abcdefg`.slice(0, 11),
      channel: `채널${i}`,
      title: `제목${i}`,
    })),
    heroIndex: 2,
    heroTime: '01:05',
    deck2: { domain: '기술/개발', headline: 'D2-테스트' },
  };
  return {
    ...actual,
    get LANDING_EXAMPLE() {
      return example.swap ? OTHER : actual.LANDING_EXAMPLE;
    },
  };
});

import {
  readLandingEvents,
  recordLandingEvent,
  type LandingEventValue,
} from '@/features/landing-intro';
import { IntroPage } from '@/pages/intro';
import { S3_TEXT, YT_CREDIT } from '@/pages/intro/model/landing-content';
import { heroWatchUrl, LANDING_EXAMPLE, timeToSeconds } from '@/pages/intro/model/landing-example';
import {
  buildScene,
  DOT,
  DOTGO,
  fitStage,
  nextScene,
  sceneEventValue,
  SEQ,
  STEP_LOCK_MS,
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

beforeEach(() => {
  sessionStorage.clear();
  toast.mockReset();
  example.swap = false;
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

  it('the placeholder config is the design values (TODO James), hero source = first source', () => {
    const ex = LANDING_EXAMPLE;
    expect(ex.videos).toHaveLength(6);
    for (const v of ex.videos) expect(v.id).toMatch(/^[A-Za-z0-9_-]{11}$/);
    expect(ex.brief.sources[0]).toEqual({ video: ex.heroIndex, time: ex.heroTime });
    expect(ex.heroTime).toBe('03:00');
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
    expect(chips).toHaveLength(5);
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
    const credit = screen.getByTestId('lv-credit');
    expect(credit.textContent).toBe(YT_CREDIT);
    for (const s of [0, 1, 2, 3, 4, 5] as const) {
      goTo(s);
      expect(credit.style.opacity).toBe('1');
      expect(credit.getAttribute('aria-hidden')).toBeNull();
    }
    goTo(7);
    expect(credit.style.opacity).toBe('0');
    expect(screen.getByTestId('lv-sheet-credit').textContent).toBe('영상 출처: YouTube');
  });

  it('the big card after the source tap opens YouTube from the source time (new tab)', () => {
    draw();
    const hero = screen.getByTestId('lv-hero') as HTMLAnchorElement;
    expect(hero.href).toBe('https://www.youtube.com/watch?v=A8GsHLubYwo&t=180s');
    expect(heroWatchUrl()).toBe('https://www.youtube.com/watch?v=A8GsHLubYwo&t=180s');
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
    const onSignIn = draw();
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
