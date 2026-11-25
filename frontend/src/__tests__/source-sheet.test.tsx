import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MorningPage } from '@/features/morning-cards/api';
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
 * Order 2026-11-25 B5: a source in the text opens a sheet over the article with one YouTube
 * player; the article keeps its place; the browser's back closes the sheet only.
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
  ],
  note: [{ heading: '소제목', paragraphs: [{ text: '문단.', sources: [{ video_id: B, t: 30 }] }] }],
  videos: [
    { video_id: A, title: '영상 A', channel: '채널A', useful_for: '' },
    { video_id: B, title: '영상 B', channel: '채널B', useful_for: '' },
  ],
};

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
  render(
    <PageWithWatch
      frame={FRAME}
      page={PAGE}
      domainTitle="기술·개발"
      order={[]}
      rest={[]}
      today="2026-11-25"
      back={{ label: '홈', onBack }}
      onPast={() => undefined}
      loadCards={() => new Promise(() => undefined)}
      sound={false}
      onSound={() => undefined}
      onJudge={() => undefined}
      onEvidence={(id, from) => evidence.push(id + ' ' + from)}
      onSheet={(e: SheetUsage) => usage.push([e.kind, e.videoId, e.value])}
    />
  );
  const cites = screen.getAllByTestId('mf-page-cite');
  return { usage, evidence, onBack, cites };
}

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
  it('opens over the article: one player at the second, the texts, the sentence marked, the article locked', async () => {
    const { usage, evidence, cites } = draw();
    cites[0]!.focus();
    fireEvent.click(cites[0]!);
    // no player before the sheet is in place
    expect(FakeYt.all).toHaveLength(0);
    const sheet = screen.getByRole('dialog');
    expect(sheet.getAttribute('aria-label')).toContain('영상 A');
    expect(screen.getByTestId('mf-src-channel').textContent).toBe('채널A');
    expect(screen.getByTestId('mf-src-title').textContent).toBe('영상 A');
    expect(screen.getByTestId('mf-src-at').textContent).toBe('이 부분 3:20');
    expect(screen.getByTestId('mf-src-full').textContent).toContain('영상 전체 보기');
    expect(document.activeElement).toBe(screen.getByTestId('mf-src-close'));
    expect(screen.getByTestId('mf-page-lit').textContent).toBe('첫 문장이다.');
    expect(cites[0]!.hasAttribute('data-shown')).toBe(true);
    expect(screen.getByTestId('mf-page-scroll').hasAttribute('data-locked')).toBe(true);
    expect(screen.queryByTestId('mf-page-watch')).toBeNull();
    await tick(SLIDE_MS);
    expect(FakeYt.all).toHaveLength(1);
    const yt = FakeYt.all[0]!;
    expect(yt.opts.videoId).toBe(A);
    expect(yt.opts.playerVars).toMatchObject({ start: 200, controls: 1, playsinline: 1 });
    act(() => yt.opts.events.onReady!({ target: yt }));
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
    // played by the reader once: the next source starts by itself again
    act(() => yt.opts.events.onStateChange!({ data: PLAYING }));
    fireEvent.click(cites[0]!);
    expect(yt.calls[yt.calls.length - 1]).toBe(`load ${A} 200`);
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
    expect(yt.calls[yt.calls.length - 1]).toBe(`load ${B} 0`);
    expect(screen.getByTestId('mf-src-title').textContent).toBe('영상 B');
    // no time in the video: no "이 부분"
    expect(screen.queryByTestId('mf-src-at')).toBeNull();
    expect(screen.getByTestId('mf-page-lit').textContent).toBe('둘째 문장이다.');
    expect(evidence).toEqual([A + ' body', B + ' body']);
    expect(usage).toEqual([
      ['source_sheet_open', A, 'body'],
      ['source_sheet_watch', A, '7'],
    ]);
    expect(push).toHaveBeenCalledTimes(1);
    push.mockRestore();
  });

  it('close button: stops, records seconds and how, drops its entry, focus and place come back', async () => {
    const { usage, cites, onBack } = draw();
    const scroll = screen.getByTestId('mf-page-scroll');
    scroll.scrollTop = 420;
    const yt = await openFirst(cites);
    act(() => yt.opts.events.onStateChange!({ data: PLAYING }));
    await tick(3000);
    act(() => yt.opts.events.onStateChange!({ data: PAUSED }));
    // moved by the browser while the sheet was open
    scroll.scrollTop = 0;
    fireEvent.click(screen.getByTestId('mf-src-close'));
    expect(yt.calls[yt.calls.length - 1]).toBe('pause');
    expect(scroll.scrollTop).toBe(420);
    expect(document.activeElement).toBe(cites[0]);
    expect(screen.queryByTestId('mf-page-lit')).toBeNull();
    await tick(600);
    expect(screen.queryByTestId('mf-src-sheet')).toBeNull();
    expect(yt.destroyed).toBe(true);
    expect(scroll.hasAttribute('data-locked')).toBe(false);
    expect(usage.slice(1)).toEqual([
      ['source_sheet_watch', A, '3'],
      ['source_sheet_close', A, 'button'],
    ]);
    expect(onBack).not.toHaveBeenCalled();
    expect(window.history.state).toEqual({ mfScreen: 1 });
  });

  it('a tap outside closes it and does nothing else; a source tap right after opens it again', async () => {
    const { usage, cites, onBack } = draw();
    await openFirst(cites);
    fireEvent.click(screen.getByTestId('mf-page-home'));
    expect(onBack).not.toHaveBeenCalled();
    expect(usage[usage.length - 1]).toEqual(['source_sheet_close', A, 'outside']);
    // the entry is still being dropped: the next opening waits for it and then has its own
    fireEvent.click(cites[1]!);
    await tick(600);
    expect(screen.getByTestId('mf-src-title').textContent).toBe('영상 B');
    expect(window.history.state).toEqual({ mfScreen: 1, mfSourceSheet: true });
    expect(usage.filter((u) => u[0] === 'source_sheet_open')).toHaveLength(2);
    expect(usage.filter((u) => u[0] === 'source_sheet_close')).toHaveLength(1);
  });

  it("the browser's back closes the sheet only, at once; forward does not bring a dead entry", async () => {
    const { usage, cites, onBack } = draw();
    await openFirst(cites);
    await pop();
    expect(screen.queryByTestId('mf-src-sheet')).toBeNull();
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
    expect(screen.queryByTestId('mf-src-sheet')).toBeNull();
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

  it('follows the finger after the slop; far enough down closes it', async () => {
    const { usage, cites } = draw();
    await openFirst(cites);
    const sheet = screen.getByTestId('mf-src-sheet');
    const head = screen.getByTestId('mf-src-head');
    pointer(head, 'pointerdown', 300, 10);
    pointer(head, 'pointermove', 306, 20);
    expect(sheet.style.transform).toBe('');
    pointer(head, 'pointermove', 360, 400);
    expect(sheet.style.transform).toBe('translate3d(0,60px,0)');
    // the element under the finger losing its implicit capture does not end the drag
    pointer(head, 'lostpointercapture', 360, 410);
    pointer(sheet, 'pointermove', 400, 800);
    expect(sheet.style.transform).toBe('translate3d(0,100px,0)');
    pointer(sheet, 'pointerup', 400, 900);
    expect(usage[usage.length - 1]).toEqual(['source_sheet_close', A, 'drag']);
  });

  it('a short slow drag goes back, and the click that ends it presses nothing', async () => {
    const { usage, cites } = draw();
    await openFirst(cites);
    const sheet = screen.getByTestId('mf-src-sheet');
    const full = screen.getByTestId('mf-src-full');
    pointer(full, 'pointerdown', 600, 10);
    pointer(full, 'pointermove', 640, 500);
    pointer(sheet, 'pointerup', 640, 600);
    expect(sheet.style.transform).toBe('');
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
  it('moves the box, not the scroll position, only when the sheet would cover the sentence', async () => {
    const rect = (top: number, bottom: number) => ({ top, bottom }) as DOMRect;
    const tops: Record<string, [number, number]> = { lit: [500, 560], cite: [540, 560] };
    const orig = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (this: Element) {
      if (this.classList.contains('mf-page-lit')) return rect(...tops.lit!);
      if (this.hasAttribute('data-shown')) return rect(...tops.cite!);
      return rect(0, 0);
    };
    const h = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(400);
    const { cites } = draw();
    const scroll = screen.getByTestId('mf-page-scroll');
    scroll.scrollTop = 300;
    fireEvent.click(cites[0]!);
    // 560 must be above 664 - 400 - 16
    expect(scroll.style.transform).toBe('translate3d(0,-312px,0)');
    expect(scroll.scrollTop).toBe(300);
    // already in view: the box stays where it is
    tops.lit = [480, 520];
    tops.cite = [500, 520];
    fireEvent.click(cites[1]!);
    expect(scroll.style.transform).toBe('translate3d(0,-312px,0)');
    fireEvent.click(screen.getByTestId('mf-src-close'));
    expect(scroll.style.transform).toBe('');
    expect(scroll.scrollTop).toBe(300);
    Element.prototype.getBoundingClientRect = orig;
    h.mockRestore();
  });
});
