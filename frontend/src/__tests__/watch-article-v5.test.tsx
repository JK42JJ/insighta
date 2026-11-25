import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { briefReturnTarget } from '@/app/router/mobile-auth-return';
import type { MorningPage } from '@/features/morning-cards/api';
import { briefPath, parseBriefAddress, returnPathOf } from '@/features/morning-feed/brief-address';
import * as events from '@/features/morning-feed/brief-events';
import {
  agoLabel,
  formatDuration,
  formatViews,
  toFeedCard,
} from '@/features/morning-feed/feed-format';
import { PageWithWatch } from '@/features/morning-feed/PageWithWatch';
import { PlayRanges, type PlayRange } from '@/features/morning-feed/play-range';
import { shareBrief } from '@/features/morning-feed/share-brief';
import { BriefFeedback } from '@/features/morning-feed/WatchPage';
import { WatchFeed, type R3Video } from '@/features/morning-feed/watch-r3-feed';
import { feedBlocks, immersiveBlocks } from '@/features/morning-feed/watch-r3-layout';

vi.mock('@/features/morning-feed/watch-home-fonts', () => ({ ensureHomeFonts: () => undefined }));
vi.mock('@/features/morning-feed/WatchPlayer', () => ({ WatchPlayer: () => null }));
vi.mock('@/features/morning-feed/SourcePlayer', () => ({
  SourcePlayer: (p: { target: { videoId: string; t: number } }) => (
    <div data-testid="player">{p.target.videoId + '@' + p.target.t}</div>
  ),
}));

/* Order 2026-11-25 (afternoon): B5 sentences, B8 share, B9 used parts, B12 other fields. */

const FRAME = { vh: 664, safeTop: 0, safeBottom: 0, playerH: 219, width: 390 };
const A = 'aaaaaaaaaaa';
const B = 'bbbbbbbbbbb';
const PAGE: MorningPage = {
  domain: '기술/개발',
  seen_date: '2026-11-25',
  headline: '헤드라인',
  core: [
    {
      text: '둘이 받친다.',
      sources: [
        { video_id: A, t: 160 },
        { video_id: B, t: 30 },
      ],
      para: 1,
    },
    { text: '출처 없는 문장.', sources: [], para: 1 },
  ],
  note: [
    {
      heading: '소제목',
      paragraphs: [
        {
          text: '가다. 나다.',
          sources: [
            { video_id: A, t: 200 },
            { video_id: B, t: 90 },
          ],
        },
      ],
    },
  ],
  videos: [
    { video_id: A, title: '영상 A', channel: '채널A', useful_for: '' },
    { video_id: B, title: '영상 B', channel: '채널B', useful_for: '' },
  ],
};

const drawPage = (): void => {
  render(
    <PageWithWatch
      frame={FRAME}
      page={PAGE}
      domainTitle="기술·개발"
      order={[]}
      others={[]}
      today="2026-11-25"
      back={{ label: '홈', onBack: () => undefined }}
      onPast={() => undefined}
      loadCards={() => new Promise(() => undefined)}
      sound={false}
      onSound={() => undefined}
      onJudge={() => undefined}
    />
  );
};

let sent: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  sent = vi.spyOn(events, 'recordBriefEvent').mockImplementation(() => undefined);
  (Element.prototype as { animate?: unknown }).animate = undefined;
  window.history.replaceState({ mfScreen: 1 }, '');
});
afterEach(() => {
  vi.restoreAllMocks();
});
const wait = (ms: number): Promise<void> =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });

describe('B5 sentence with several sources', () => {
  it('turns over in the same sheet (buttons), one player, the sentence stays marked; a sentence without sources is no button', async () => {
    drawPage();
    const s = screen.getAllByTestId('mf-page-sent');
    expect(s[1]!.getAttribute('role')).toBeNull();
    fireEvent.click(s[0]!);
    await wait(400);
    expect(screen.getByTestId('mf-src-turn-n').textContent).toBe('1/2');
    expect(screen.getByTestId('player').textContent).toBe(A + '@160');
    expect((screen.getByTestId('mf-src-prev') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('mf-src-next'));
    expect(screen.getByTestId('mf-src-turn-n').textContent).toBe('2/2');
    expect(screen.getAllByTestId('player').map((x) => x.textContent)).toEqual([B + '@30']);
    expect(screen.getByTestId('mf-src-title').textContent).toBe('영상 B');
    expect(s[0]!.hasAttribute('data-lit')).toBe(true);
    expect(sent.mock.calls.filter((c) => c[0] === 'sentence_tap')).toEqual([
      [
        'sentence_tap',
        {
          cell: '기술/개발',
          seenDate: '2026-11-25',
          sentenceId: 'p0.s0',
          videoId: A,
          value: 'body',
        },
      ],
    ]);
  });

  it('a sideways swipe turns over; a downward one still closes', async () => {
    drawPage();
    fireEvent.click(screen.getAllByTestId('mf-page-sent')[0]!);
    await wait(400);
    const info = screen.getByTestId('mf-src-title');
    const sheet = screen.getByTestId('mf-src-sheet');
    const ptr = (el: Element, type: string, x: number, y: number, at: number): void => {
      const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
      Object.defineProperties(e, {
        pointerId: { value: 1 },
        pointerType: { value: 'touch' },
        timeStamp: { value: at },
      });
      act(() => void el.dispatchEvent(e));
    };
    ptr(info, 'pointerdown', 250, 600, 0);
    ptr(info, 'pointermove', 220, 602, 30);
    ptr(info, 'pointermove', 180, 603, 60);
    ptr(sheet, 'pointerup', 180, 603, 80);
    expect(screen.getByTestId('mf-src-turn-n').textContent).toBe('2/2');
    expect(sheet.style.transform).toBe('');
    ptr(info, 'pointerdown', 150, 600, 200);
    ptr(info, 'pointermove', 210, 602, 230);
    ptr(sheet, 'pointerup', 210, 602, 260);
    expect(screen.getByTestId('mf-src-turn-n').textContent).toBe('1/2');
  });

  it('a note sentence says its sources are the paragraph’s', async () => {
    drawPage();
    fireEvent.click(screen.getByTestId('mf-page-note-toggle'));
    fireEvent.click(screen.getByTestId('mf-page-note').querySelectorAll('.mf-page-sent')[1]!);
    expect(screen.getByTestId('mf-src-at').textContent).toBe('이 문단의 근거 3:20');
    expect(screen.getByTestId('mf-src-turn-n').textContent).toBe('1/2');
    expect(document.querySelectorAll('[data-lit]')).toHaveLength(1);
  });

  it('the hint: on the first brief, until a sentence is tapped; not on the next one', async () => {
    vi.resetModules();
    localStorage.removeItem('mf_sentence_hint_seen');
    const { WatchPage: Fresh } = await import('@/features/morning-feed/WatchPage');
    const props = {
      frame: FRAME,
      page: PAGE,
      domainTitle: '기술·개발',
      order: [],
      others: [],
      today: '2026-11-25',
      back: { label: '홈', onBack: () => undefined },
      onPast: () => undefined,
      onOpenSource: () => undefined,
    };
    const first = render(<Fresh {...props} />);
    expect(screen.getByTestId('mf-page-hint').textContent).toBe('문장을 누르면 근거 영상이 나와요');
    first.rerender(<Fresh {...props} source={{ sid: 'p0.s0', sheetH: 0 }} />);
    expect(screen.queryByTestId('mf-page-hint')).toBeNull();
    first.unmount();
    render(<Fresh {...props} />);
    expect(screen.queryByTestId('mf-page-hint')).toBeNull();
  });
});

describe('B8 share', () => {
  const nav = navigator as unknown as Record<string, unknown>;
  const set = (k: string, value: unknown): void => {
    Object.defineProperty(nav, k, { configurable: true, value });
  };
  afterEach(() => {
    set('share', undefined);
    set('clipboard', undefined);
  });
  it('headline and address through the system; cancelled does nothing else', async () => {
    const share = vi.fn(() => Promise.resolve());
    set('share', share);
    expect(await shareBrief('제목', 'https://x/b')).toBe('shared');
    expect(share).toHaveBeenCalledWith({ title: '제목', text: '제목', url: 'https://x/b' });
    const write = vi.fn(() => Promise.resolve());
    set('clipboard', { writeText: write });
    set('share', () => Promise.reject(Object.assign(new Error('no'), { name: 'AbortError' })));
    expect(await shareBrief('제목', 'https://x/b')).toBe('cancelled');
    expect(write).not.toHaveBeenCalled();
  });
  it('without it the link is copied', async () => {
    const write = vi.fn(() => Promise.resolve());
    set('clipboard', { writeText: write });
    expect(await shareBrief('제목', 'https://x/b')).toBe('copied');
    expect(write).toHaveBeenCalledWith('제목\nhttps://x/b');
    set('clipboard', { writeText: () => Promise.reject(new Error('no')) });
    expect(await shareBrief('제목', 'https://x/b')).toBe('failed');
  });
  it('the button is the video card’s, next to the reactions', () => {
    const onShare = vi.fn();
    render(<BriefFeedback value={null} onPick={() => Promise.resolve()} onShare={onShare} />);
    fireEvent.click(screen.getByTestId('mf-page-share'));
    expect(onShare).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('mf-page-share').className).toBe('mf-w3-react');
  });
  it('the address comes back from its own path, also after signing in', () => {
    const b = { cell: '재테크/투자', date: '2026-11-25' };
    const path = briefPath(b);
    expect(path.startsWith('/morning-cards?view=watch&')).toBe(true);
    expect(parseBriefAddress(path.split('?')[1]!)).toEqual(b);
    expect(returnPathOf('?' + path.split('?')[1])).toBe(path);
    expect(returnPathOf('?view=watch')).toBe('/morning-cards?view=watch');
    expect(parseBriefAddress('?cell=x&date=11-25')).toBeNull();
    expect(briefReturnTarget('/', path)).toBe(path);
    // a computer keeps its present way for every other target
    expect(briefReturnTarget('/', '/morning-cards?view=watch')).toBeNull();
    expect(briefReturnTarget('/', 'https://evil.example' + path)).toBeNull();
  });
});

describe('B9 no date, no age', () => {
  it('missing or broken values are left out, never NaN', () => {
    expect(agoLabel('').text).toBe('');
    expect(agoLabel('x').text).toBe('');
    expect(formatDuration(Number.NaN)).toBe('');
    expect(formatViews(Number.NaN)).toBe('');
    const card = toFeedCard(
      {
        video_id: A,
        title: 't',
        channel: 'c',
        published_at: '',
        duration: 0,
        view_count: null,
        thumbnail_url: null,
        cell: 'x',
        focus: [],
        why: '',
      },
      ['#000000']
    );
    expect(JSON.stringify(card)).not.toMatch(/NaN|undefined|Invalid|null/);
  });
});

const video = (id: string, parts: R3Video['parts']): R3Video => ({
  key: id,
  videoId: id,
  title: '제목 ' + id,
  channel: '채널 ' + id,
  durationSec: 0,
  ageText: '',
  fresh: false,
  viewsText: '',
  thumbUrl: 'https://i.ytimg.com/vi/' + id + '/mqdefault.jpg',
  why: '',
  summary: '',
  checks: [],
  chapters: [],
  parts,
});

describe('B9 이 브리프에 쓰인 부분', () => {
  it('rows on the card; a tap plays from there; the next row names its seconds; no letter icon', () => {
    const load = vi.fn();
    const ctl = {
      current: {
        load,
        soundOn: () => undefined,
        soundOff: () => undefined,
        pause: () => undefined,
      },
    };
    let ev: { onTick: (t: never) => void; onReady: () => void } | null = null;
    render(
      <WatchFeed
        goalTitle="기술·개발"
        videos={[
          video(A, [
            { sentenceId: 'p0.s0', text: '둘이 받친다.', t: 160 },
            { sentenceId: 'p2.s0', text: '소제목', t: 200 },
          ]),
          video(B, [{ sentenceId: 'p0.s0', text: '둘이 받친다.', t: 30 }]),
        ]}
        frame={FRAME}
        loading={false}
        initial={{ mode: 'imm', phase: 'player' }}
        onVerdict={() => undefined}
        onFinish={() => undefined}
        onBack={() => undefined}
        sound
        onSound={() => undefined}
        player={ctl}
        renderPlayer={(e) => {
          ev = e as never;
          return <div />;
        }}
      />
    );
    const cur = screen.getAllByTestId('mf-w3-card')[0]!;
    expect(cur.querySelector('.mf-w3-av')).toBeNull();
    const rows = cur.querySelectorAll('[data-testid="mf-w3-part"]');
    expect([...rows].map((r) => r.textContent)).toEqual(['2:40둘이 받친다.', '3:20소제목']);
    fireEvent.click(rows[1]!);
    expect(load).toHaveBeenLastCalledWith(A, 200, true);
    expect(cur.querySelector('[data-testid="mf-w3-next-at"]')?.textContent).toBe('쓰인 부분 0:30');
    // the length comes from the player when the server has none
    expect(cur.querySelector('[data-testid="mf-w3-meta"]')?.textContent).toBe('');
    act(() => ev!.onTick({ videoId: A, seconds: 1, duration: 600, playing: true } as never));
    expect(cur.querySelector('[data-testid="mf-w3-meta"]')?.textContent).toBe('10분');
  });
  it('fits into the card heights; nothing changes without parts', () => {
    const has = { why: false, summary: false, checks: false, points: 0 };
    expect(feedBlocks(FRAME, has).partRows).toBe(0);
    const f = feedBlocks(FRAME, { ...has, parts: 5 });
    expect(f.partRows).toBe(3);
    expect(f.height).toBe(feedBlocks(FRAME, has).height + 30 + 3 * 44);
    const imm = { why: false, summary: false, next: true, afterNext: true, chapters: 0 };
    expect(immersiveBlocks(FRAME, { ...imm, parts: 5 })).toMatchObject({
      partRows: 2,
      nextBig: true,
    });
  });
});

describe('play ranges', () => {
  it('a part goes on while the position moves with time; a seek, a stop and a switch end it', () => {
    const out: PlayRange[] = [];
    const r = new PlayRanges((x) => out.push(x));
    r.sample(A, 10, true, 0);
    r.sample(A, 11, true, 1000);
    r.sample(A, 13, true, 2000); // double speed
    r.sample(A, 100, true, 2500); // seek
    r.sample(A, 101.5, true, 4000);
    r.sample(A, 102, false, 4500); // paused
    r.sample(B, 5, true, 5000);
    r.sample(B, 5.4, true, 5400);
    r.end(); // too short
    expect(out).toEqual([
      { videoId: A, startSec: 10, endSec: 13 },
      { videoId: A, startSec: 100, endSec: 102 },
    ]);
  });
});
