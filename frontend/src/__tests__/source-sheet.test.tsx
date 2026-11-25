import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MorningPage } from '@/features/morning-cards/api';
import * as events from '@/features/morning-feed/brief-events';
import { PageWithWatch, type SheetUsage } from '@/features/morning-feed/PageWithWatch';
import { PlaySeconds } from '@/features/morning-feed/play-seconds';

vi.mock('@/features/morning-feed/watch-home-fonts', () => ({
  ensureHomeFonts: () => undefined,
}));
// the video screen's own player; the sheet's player is driven through a stand-in YouTube API
vi.mock('@/features/morning-feed/WatchPlayer', () => ({ WatchPlayer: () => null }));
const progress = vi.hoisted(() => ({ post: vi.fn(() => Promise.resolve()) }));
vi.mock('@/features/morning-cards/api', async (actual) => ({
  ...(await actual<typeof import('@/features/morning-cards/api')>()),
  postWatchProgress: progress.post,
}));

/*
 * Orders 2026-11-25 B5 and B5-2: a sentence opens its sources' sheet under the article with one
 * YouTube player, kept for every later sentence; the article stays readable; the sheet dragged down
 * is a bar; the browser's back closes the sheet only.
 */

const FRAME = { vh: 664, safeTop: 0, safeBottom: 0, playerH: 219, width: 390 };
const A = 'aaaaaaaaaaa';
const B = 'bbbbbbbbbbb';
const PAGE: MorningPage = {
  domain: '기술/개발',
  seen_date: '2026-11-25',
  headline: '헤드라인',
  core: [
    { text: '첫 문장이다.', sources: [{ video_id: A, t: 200 }], para: 1 },
    { text: '둘째 문장이다.', sources: [{ video_id: B, t: 0 }], para: 1 },
    { text: '셋째 문장이다.', sources: [{ video_id: A, t: 260 }], para: 1 },
  ],
  note: [{ heading: '소제목', paragraphs: [{ text: '문단.', sources: [{ video_id: B, t: 30 }] }] }],
  videos: [
    { video_id: A, title: '영상 A', channel: '채널A', useful_for: '' },
    { video_id: B, title: '영상 B', channel: '채널B', useful_for: '' },
  ],
};

const CUED = 5;
const PLAYING = 1;
const PAUSED = 2;
const SLIDE_MS = 350;

class FakeYt {
  static all: FakeYt[] = [];
  calls: string[] = [];
  time = 0;
  destroyed = false;
  opts: {
    videoId: string;
    playerVars: Record<string, string | number>;
    events: Record<string, (e?: unknown) => void>;
  };
  constructor(_el: HTMLElement, opts: FakeYt['opts']) {
    this.opts = opts;
    FakeYt.all.push(this);
  }
  loadVideoById(a: { videoId: string; startSeconds: number }): void {
    this.calls.push(`load ${a.videoId} ${a.startSeconds}`);
  }
  seekTo(t: number): void {
    this.time = t;
    this.calls.push(`seek ${t}`);
  }
  cueVideoById(a: { videoId: string; startSeconds: number }): void {
    this.calls.push(`cue ${a.videoId} ${a.startSeconds}`);
  }
  mute(): void {
    this.calls.push('mute');
  }
  unMute(): void {
    this.calls.push('unMute');
  }
  playVideo(): void {
    this.calls.push('play');
  }
  pauseVideo(): void {
    this.calls.push('pause');
  }
  getCurrentTime(): number {
    return this.time;
  }
  destroy(): void {
    this.destroyed = true;
  }
}

function draw() {
  const usage: Array<[string, string, string | undefined]> = [];
  const evidence: string[] = [];
  const onBack = vi.fn();
  const onPast = vi.fn(() => window.history.pushState({ mfScreen: 2 }, ''));
  render(
    <PageWithWatch
      frame={FRAME}
      page={PAGE}
      domainTitle="기술·개발"
      order={[]}
      others={[]}
      today="2026-11-25"
      back={{ label: '홈', onBack }}
      onPast={onPast}
      loadCards={() => new Promise(() => undefined)}
      sound={false}
      onSound={() => undefined}
      onJudge={() => undefined}
      onEvidence={(id, from) => evidence.push(id + ' ' + from)}
      onSheet={(e: SheetUsage) => usage.push([e.kind, e.videoId, e.value])}
    />
  );
  const cites = screen.getAllByTestId('mf-page-sent');
  return { usage, evidence, onBack, onPast, cites };
}

const lit = (): Element | null => document.querySelector('.mf-page-sent[data-lit]');

const formOf = (): string | undefined => screen.getByTestId('mf-src-sheet').dataset.form;
/** The cued video is in the player. */
const cued = (yt: FakeYt): void => act(() => yt.opts.events.onStateChange!({ data: CUED }));
const shownYt = (): boolean => screen.getByTestId('mf-src-yt').hasAttribute('data-shown');
const lineOf = (): string | null => screen.getByTestId('mf-src-line').textContent;

const tick = async (ms: number): Promise<void> => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

async function openFirst(cites: HTMLElement[]): Promise<FakeYt> {
  fireEvent.click(cites[0]!);
  await tick(SLIDE_MS);
  const yt = FakeYt.all[FakeYt.all.length - 1]!;
  act(() => yt.opts.events.onReady!({ target: yt }));
  return yt;
}

/** jsdom delivers popstate later; the browser's own back as one step. */
async function pop(): Promise<void> {
  await act(async () => {
    window.history.back();
    await vi.advanceTimersByTimeAsync(50);
  });
}

const animate = Element.prototype.animate;
beforeEach(() => {
  // happy-dom's animations run on real time: the states without them
  (Element.prototype as { animate?: unknown }).animate = undefined;
  FakeYt.all = [];
  (window as unknown as { YT: unknown }).YT = { Player: FakeYt };
  window.history.replaceState({ mfScreen: 1 }, '');
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  });
});
afterEach(() => {
  vi.useRealTimers();
  Element.prototype.animate = animate;
  delete (window as unknown as { YT?: unknown }).YT;
});

describe('source sheet', () => {
  it('opens over the article: one player at the second, the texts, the sentence marked, the article not locked', async () => {
    const { usage, evidence, cites } = draw();
    cites[0]!.focus();
    fireEvent.click(cites[0]!);
    expect(formOf()).toBe('base');
    const sheet = screen.getByRole('dialog');
    expect(sheet.getAttribute('aria-label')).toContain('영상 A');
    // one line: the channel and the second
    expect(lineOf()).toBe('채널A3:20부터');
    expect(screen.getByTestId('mf-src-full').getAttribute('aria-label')).toBe('영상 전체 보기');
    expect(document.activeElement).toBe(screen.getByTestId('mf-src-close'));
    expect(lit()?.textContent).toBe('첫 문장이다.');
    expect(screen.getByTestId('mf-page-scroll').hasAttribute('data-locked')).toBe(false);
    expect(screen.queryByTestId('mf-page-watch')).toBeNull();
    await tick(0);
    expect(FakeYt.all).toHaveLength(1);
    const yt = FakeYt.all[0]!;
    expect(yt.opts.videoId).toBe(A);
    expect(yt.opts.playerVars).toMatchObject({ start: 200, controls: 1, playsinline: 1 });
    act(() => yt.opts.events.onReady!({ target: yt }));
    // nothing plays before the sheet is in view; the thumbnail gives way to the ready player
    expect(shownYt()).toBe(true);
    expect(yt.calls).toEqual(['unMute']);
    await tick(SLIDE_MS);
    // with sound, never muted
    expect(yt.calls).toEqual(['unMute', 'play']);
    expect(evidence).toEqual([A + ' body']);
    expect(usage).toEqual([['source_sheet_open', A, 'body']]);
    expect(window.history.state).toEqual({ mfScreen: 1, mfSourceSheet: true });
  });

  it('a blocked start leaves the video cued (play button) and never plays muted; later sources are cued too', async () => {
    const { cites } = draw();
    const yt = await openFirst(cites);
    act(() => yt.opts.events.onAutoplayBlocked!());
    expect(yt.calls).toEqual(['unMute', 'play', `cue ${A} 200`]);
    fireEvent.click(cites[1]!);
    expect(yt.calls[yt.calls.length - 1]).toBe(`cue ${B} 0`);
    cued(yt);
    expect(shownYt()).toBe(true);
    expect(yt.calls[yt.calls.length - 1]).toBe(`cue ${B} 0`);
    // played by the reader once: the next source starts by itself again
    act(() => yt.opts.events.onStateChange!({ data: PLAYING }));
    fireEvent.click(cites[0]!);
    cued(yt);
    expect(yt.calls.slice(-2)).toEqual([`cue ${A} 200`, 'play']);
    expect(yt.calls).not.toContain('mute');
  });

  it('another source switches the video in the same player; the same entry, one record per tap', async () => {
    const { usage, evidence, cites } = draw();
    const push = vi.spyOn(window.history, 'pushState');
    const yt = await openFirst(cites);
    act(() => yt.opts.events.onStateChange!({ data: PLAYING }));
    await tick(7300);
    fireEvent.click(cites[1]!);
    expect(FakeYt.all).toHaveLength(1);
    // put into the same player under its thumbnail, shown, and only then played
    expect(yt.calls[yt.calls.length - 1]).toBe(`cue ${B} 0`);
    expect(shownYt()).toBe(false);
    cued(yt);
    expect(shownYt()).toBe(true);
    expect(yt.calls[yt.calls.length - 1]).toBe('play');
    // no time in the video: no second
    expect(lineOf()).toBe('채널B');
    expect(lit()?.textContent).toBe('둘째 문장이다.');
    expect(evidence).toEqual([A + ' body', B + ' body']);
    expect(usage).toEqual([
      ['source_sheet_open', A, 'body'],
      ['source_sheet_watch', A, '7'],
    ]);
    expect(push).toHaveBeenCalledTimes(1);
    push.mockRestore();
  });

  it('close button: pauses, records seconds and how, drops its entry, focus back, the place read to stays', async () => {
    const { usage, cites, onBack } = draw();
    const scroll = screen.getByTestId('mf-page-scroll');
    const yt = await openFirst(cites);
    act(() => yt.opts.events.onStateChange!({ data: PLAYING }));
    await tick(3000);
    act(() => yt.opts.events.onStateChange!({ data: PAUSED }));
    // read on while the sheet was open
    scroll.scrollTop = 420;
    fireEvent.click(screen.getByTestId('mf-src-close'));
    expect(yt.calls[yt.calls.length - 1]).toBe('pause');
    expect(scroll.scrollTop).toBe(420);
    expect(document.activeElement).toBe(cites[0]);
    expect(lit()).toBeNull();
    await tick(600);
    expect(formOf()).toBe('closed');
    // the player is kept for the next sentence
    expect(yt.destroyed).toBe(false);
    expect(scroll.scrollTop).toBe(420);
    expect(usage.slice(1)).toEqual([
      ['source_sheet_watch', A, '3'],
      ['source_sheet_close', A, 'button'],
    ]);
    expect(onBack).not.toHaveBeenCalled();
    expect(window.history.state).toEqual({ mfScreen: 1 });
  });

  it('a tap on the article does what it does: plain text nothing, a screen change puts the sheet away first', async () => {
    const { usage, cites, onBack, onPast } = draw();
    const yt = await openFirst(cites);
    fireEvent.click(screen.getByTestId('mf-page-headline'));
    expect(formOf()).toBe('base');
    fireEvent.click(screen.getByTestId('mf-page-past'));
    // its entry is dropped first, then the screen is pushed on the article's own entry
    expect(yt.calls[yt.calls.length - 1]).toBe('pause');
    expect(usage[usage.length - 1]).toEqual(['source_sheet_close', A, 'leave']);
    await tick(100);
    expect(onPast).toHaveBeenCalledTimes(1);
    expect(window.history.state).toEqual({ mfScreen: 2 });
    expect(onBack).not.toHaveBeenCalled();
  });

  it('the back button leaves the article in one press', async () => {
    const { cites, onBack } = draw();
    await openFirst(cites);
    fireEvent.click(screen.getByTestId('mf-page-home'));
    await tick(100);
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(window.history.state).toEqual({ mfScreen: 1 });
  });

  it('a list row under the open sheet opens the video screen in the same entry', async () => {
    const { usage, cites } = draw();
    const push = vi.spyOn(window.history, 'pushState');
    await openFirst(cites);
    fireEvent.click(screen.getAllByTestId('mf-page-video')[1]!);
    expect(usage[usage.length - 1]).toEqual(['source_sheet_close', A, 'list']);
    expect(window.history.state).toEqual({ mfScreen: 1, mfPageWatch: true });
    expect(push).toHaveBeenCalledTimes(1);
    push.mockRestore();
  });

  it('a sentence tapped right after closing opens it again, in the same player', async () => {
    const { usage, cites } = draw();
    const yt = await openFirst(cites);
    fireEvent.click(screen.getByTestId('mf-src-close'));
    // the entry is still being dropped: the next opening waits for it and then has its own
    fireEvent.click(cites[1]!);
    await tick(600);
    expect(formOf()).toBe('base');
    expect(lineOf()).toBe('채널B');
    expect(FakeYt.all).toHaveLength(1);
    expect(yt.calls[yt.calls.length - 1]).toBe(`cue ${B} 0`);
    expect(window.history.state).toEqual({ mfScreen: 1, mfSourceSheet: true });
    expect(usage.filter((u) => u[0] === 'source_sheet_open')).toHaveLength(2);
    expect(usage.filter((u) => u[0] === 'source_sheet_close')).toHaveLength(1);
  });

  it('another sentence of the same video only moves to its second', async () => {
    const { cites } = draw();
    const yt = await openFirst(cites);
    act(() => yt.opts.events.onStateChange!({ data: PLAYING }));
    fireEvent.click(cites[2]!);
    expect(yt.calls.slice(-2)).toEqual(['seek 260', 'play']);
    expect(yt.calls.some((c) => c.startsWith('cue'))).toBe(false);
    expect(shownYt()).toBe(true);
    expect(lineOf()).toBe('채널A4:20부터');
  });

  it('a player that never says it has the video is shown and played all the same', async () => {
    const { cites } = draw();
    const yt = await openFirst(cites);
    act(() => yt.opts.events.onStateChange!({ data: PLAYING }));
    fireEvent.click(cites[1]!);
    expect(shownYt()).toBe(false);
    await tick(1500);
    expect(shownYt()).toBe(true);
    expect(yt.calls[yt.calls.length - 1]).toBe('play');
  });

  it("the browser's back closes the sheet only, at once; forward does not bring a dead entry", async () => {
    const { usage, cites, onBack } = draw();
    await openFirst(cites);
    await pop();
    expect(formOf()).toBe('closed');
    expect(screen.getByTestId('mf-page')).toBeTruthy();
    expect(onBack).not.toHaveBeenCalled();
    expect(usage[usage.length - 1]).toEqual(['source_sheet_close', A, 'back']);
    expect(document.activeElement).toBe(cites[0]);
    await act(async () => {
      window.history.forward();
      await vi.advanceTimersByTimeAsync(100);
    });
    await tick(100);
    expect(window.history.state).toEqual({ mfScreen: 1 });
    expect(formOf()).toBe('closed');
  });

  it('Escape closes it', async () => {
    const { usage, cites } = draw();
    await openFirst(cites);
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(usage.filter((u) => u[0] === 'source_sheet_close')).toEqual([
      ['source_sheet_close', A, 'key'],
    ]);
  });

  it('full view: no sheet player any more, the same entry, no close record and no second evidence', async () => {
    const { usage, evidence, cites } = draw();
    const push = vi.spyOn(window.history, 'pushState');
    const yt = await openFirst(cites);
    act(() => yt.opts.events.onStateChange!({ data: PLAYING }));
    yt.time = 215.6;
    await tick(2000);
    fireEvent.click(screen.getByTestId('mf-src-full'));
    expect(yt.destroyed).toBe(true);
    expect(screen.getByTestId('mf-page-watch')).toBeTruthy();
    expect(window.history.state).toEqual({ mfScreen: 1, mfPageWatch: true });
    expect(push).toHaveBeenCalledTimes(1);
    expect(evidence).toEqual([A + ' body']);
    expect(usage).toEqual([
      ['source_sheet_open', A, 'body'],
      ['source_sheet_watch', A, '2'],
      ['source_sheet_full', A, undefined],
    ]);
    await tick(600);
    expect(screen.queryByTestId('mf-src-sheet')).toBeNull();
    await pop();
    expect(screen.queryByTestId('mf-page-watch')).toBeNull();
    expect(usage).toHaveLength(3);
    push.mockRestore();
  });

  it('a page that is hidden sends the seconds so far once', async () => {
    const { usage, cites } = draw();
    const yt = await openFirst(cites);
    act(() => yt.opts.events.onStateChange!({ data: PLAYING }));
    await tick(4000);
    act(() => void window.dispatchEvent(new Event('pagehide')));
    act(() => void window.dispatchEvent(new Event('pagehide')));
    expect(usage.filter((u) => u[0] === 'source_sheet_watch')).toEqual([
      ['source_sheet_watch', A, '4'],
    ]);
  });
});

describe('played parts', () => {
  it('a part belongs to the sentence it was played for, also after a switch to another sentence', async () => {
    const sent = vi.spyOn(events, 'recordBriefEvent').mockImplementation(() => undefined);
    const { cites } = draw();
    const yt = await openFirst(cites);
    yt.time = 200;
    act(() => yt.opts.events.onStateChange!({ data: PLAYING }));
    for (let i = 1; i <= 4; i++) {
      yt.time = 200 + i;
      await tick(1000);
    }
    fireEvent.click(cites[1]!);
    expect(sent.mock.calls.filter((c) => c[0] === 'play_range').map((c) => c[1])).toEqual([
      expect.objectContaining({ sentenceId: 'p0.s0', videoId: A, startSec: 200, endSec: 204 }),
    ]);
    sent.mockRestore();
  });
});

describe('dragging the sheet', () => {
  const pointer = (el: Element, type: string, y: number, at: number, x = 100): void => {
    const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
    Object.defineProperties(e, {
      pointerId: { value: 1 },
      pointerType: { value: 'touch' },
      timeStamp: { value: at },
    });
    act(() => void el.dispatchEvent(e));
  };

  it('follows the finger after the slop; far enough down it is the bar, paused, with where it stopped', async () => {
    const sent = vi.spyOn(events, 'recordBriefEvent').mockImplementation(() => undefined);
    const { usage, cites } = draw();
    const yt = await openFirst(cites);
    act(() => yt.opts.events.onStateChange!({ data: PLAYING }));
    yt.time = 211.4;
    const sheet = screen.getByTestId('mf-src-sheet');
    const head = screen.getByTestId('mf-src-head');
    pointer(head, 'pointerdown', 300, 10);
    pointer(head, 'pointermove', 306, 20);
    expect(sheet.style.getPropertyValue('--src-drag')).toBe('');
    pointer(head, 'pointermove', 360, 400);
    expect(sheet.style.getPropertyValue('--src-drag')).toBe('60px');
    // the element under the finger losing its implicit capture does not end the drag
    pointer(head, 'lostpointercapture', 360, 410);
    pointer(sheet, 'pointermove', 400, 800);
    expect(sheet.style.getPropertyValue('--src-drag')).toBe('100px');
    pointer(sheet, 'pointerup', 400, 900);
    expect(formOf()).toBe('mini');
    expect(yt.calls[yt.calls.length - 1]).toBe('pause');
    expect(screen.getByTestId('mf-src-bar-at').textContent).toBe('3:31 · 멈춤');
    expect(usage.some((u) => u[0] === 'source_sheet_close')).toBe(false);
    // the sentence stays marked; the entry stays
    expect(lit()?.textContent).toBe('첫 문장이다.');
    expect(window.history.state).toEqual({ mfScreen: 1, mfSourceSheet: true });
    // a start that was still on its way does not play out of the screen
    act(() => yt.opts.events.onStateChange!({ data: PLAYING }));
    expect(yt.calls[yt.calls.length - 1]).toBe('pause');
    // the bar brings it back where it stopped
    const open = screen.getByTestId('mf-src-bar-open');
    pointer(open, 'pointerdown', 620, 2000);
    pointer(open, 'pointerup', 620, 2050);
    fireEvent.click(open, { detail: 1 });
    expect(formOf()).toBe('base');
    expect(yt.calls[yt.calls.length - 1]).toBe('pause');
    await tick(SLIDE_MS);
    expect(yt.calls[yt.calls.length - 1]).toBe('play');
    expect(FakeYt.all).toHaveLength(1);
    expect(
      sent.mock.calls
        .filter((c) => String(c[0]).startsWith('sheet_'))
        .map((c) => [c[0], c[1]?.sentenceId, c[1]?.value])
    ).toEqual([
      ['sheet_open', 'p0.s0', 'body'],
      ['sheet_form', 'p0.s0', 'mini_drag'],
      ['sheet_form', 'p0.s0', 'base_tap'],
    ]);
    sent.mockRestore();
  });

  const toBar = async (cites: HTMLElement[]): Promise<FakeYt> => {
    const yt = await openFirst(cites);
    const sheet = screen.getByTestId('mf-src-sheet');
    pointer(sheet, 'pointerdown', 600, 10);
    pointer(sheet, 'pointermove', 640, 300);
    pointer(sheet, 'pointerup', 640, 320);
    expect(formOf()).toBe('mini');
    return yt;
  };

  it('the bar: an upward swipe opens it, a downward one or its button closes it', async () => {
    const { usage, cites } = draw();
    await toBar(cites);
    const bar = screen.getByTestId('mf-src-sheet');
    // not played yet: where it starts
    expect(screen.getByTestId('mf-src-bar-at').textContent).toBe('3:20부터');
    pointer(bar, 'pointerdown', 630, 1000);
    pointer(bar, 'pointermove', 590, 1200);
    // the bar itself does not leave its place upwards
    expect(bar.style.getPropertyValue('--src-drag')).toBe('');
    pointer(bar, 'pointerup', 590, 1300);
    expect(formOf()).toBe('base');
    const sheet = bar;
    pointer(sheet, 'pointerdown', 600, 2000);
    pointer(sheet, 'pointermove', 640, 2300);
    pointer(sheet, 'pointerup', 640, 2320);
    pointer(bar, 'pointerdown', 620, 3000);
    pointer(bar, 'pointermove', 655, 3300);
    expect(bar.style.getPropertyValue('--src-drag')).toBe('35px');
    pointer(bar, 'pointerup', 655, 3400);
    expect(formOf()).toBe('closed');
    expect(usage[usage.length - 1]).toEqual(['source_sheet_close', A, 'drag']);
  });

  it('a sentence tapped while it is the bar plays in the base form again', async () => {
    const { cites } = draw();
    const yt = await toBar(cites);
    fireEvent.click(cites[1]!);
    expect(formOf()).toBe('base');
    await tick(SLIDE_MS);
    expect(yt.calls[yt.calls.length - 1]).toBe(`cue ${B} 0`);
    expect(FakeYt.all).toHaveLength(1);
  });

  it('a short slow drag goes back, and the click that ends it presses nothing', async () => {
    const { usage, cites } = draw();
    await openFirst(cites);
    const sheet = screen.getByTestId('mf-src-sheet');
    const full = screen.getByTestId('mf-src-full');
    pointer(full, 'pointerdown', 600, 10);
    pointer(full, 'pointermove', 615, 500);
    pointer(sheet, 'pointerup', 615, 600);
    expect(sheet.style.getPropertyValue('--src-drag')).toBe('');
    fireEvent.click(full, { detail: 1 });
    expect(screen.queryByTestId('mf-page-watch')).toBeNull();
    expect(usage).toHaveLength(1);
    // the next real tap works
    pointer(full, 'pointerdown', 600, 1000);
    pointer(full, 'pointerup', 601, 1050);
    fireEvent.click(full, { detail: 1 });
    expect(screen.getByTestId('mf-page-watch')).toBeTruthy();
  });
});

describe('PlaySeconds', () => {
  it('counts playing time only, gives each second once, and starts anew for the next video', () => {
    let now = 0;
    const s = new PlaySeconds(() => now);
    s.onState(PLAYING);
    now = 2500;
    expect(s.take()).toBe(2);
    now = 3200;
    s.onState(PAUSED);
    now = 60_000;
    expect(s.end()).toBe(1);
    s.onState(PLAYING);
    now = 61_000;
    expect(s.end()).toBe(1);
    expect(s.end()).toBe(0);
  });
});

describe('the sentence above the sheet', () => {
  it('a tap scrolls it above the sheet only when the sheet would cover it; the room is under the last line', async () => {
    const tops: Record<string, [number, number]> = { lit: [500, 560] };
    const orig = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (this: Element) {
      const [top, bottom] = this.classList.contains('mf-page-lit') ? tops.lit! : [0, 664];
      return { top, bottom, height: bottom - top } as DOMRect;
    };
    const h = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(300);
    const { cites } = draw();
    const scroll = screen.getByTestId('mf-page-scroll');
    (scroll as { scrollTo?: unknown }).scrollTo = undefined;
    scroll.scrollTop = 300;
    fireEvent.click(cites[0]!);
    // 560 must be above 664 - 300 - 16
    expect(scroll.scrollTop).toBe(300 + 212);
    expect(screen.getByTestId('mf-page').style.getPropertyValue('--src-room')).toBe('300px');
    // already in view: the article stays where it is
    tops.lit = [100, 160];
    fireEvent.click(cites[1]!);
    expect(scroll.scrollTop).toBe(512);
    // the place read to since then stays on closing
    scroll.scrollTop = 777;
    fireEvent.click(screen.getByTestId('mf-src-close'));
    expect(scroll.scrollTop).toBe(777);
    expect(screen.getByTestId('mf-page').style.getPropertyValue('--src-room')).toBe('0px');
    Element.prototype.getBoundingClientRect = orig;
    h.mockRestore();
  });
});
