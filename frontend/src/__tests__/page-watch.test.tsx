import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MorningPage } from '@/features/morning-cards/api';
import { PageWithWatch } from '@/features/morning-feed/PageWithWatch';
import { toFeedCard } from '@/features/morning-feed/feed-format';
import type { WatchVideo } from '@/features/morning-feed/watch-list';
import { WatchFeed, type R3Video } from '@/features/morning-feed/watch-r3-feed';

vi.mock('@/features/morning-feed/watch-home-fonts', () => ({
  ensureHomeFonts: () => undefined,
  waitHomeFonts: () => Promise.resolve('late'),
}));
// the real player needs the YouTube API; the layer only needs something to render
vi.mock('@/features/morning-feed/WatchPlayer', () => ({
  WatchPlayer: () => null,
}));

const FRAME = { vh: 642, safeTop: 0, safeBottom: 0, playerH: 219, width: 390 };
const ID = ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc'];

function r3(i: number): R3Video {
  return {
    key: 'k' + i,
    videoId: ID[i]!,
    title: '제목 ' + i,
    channel: '채널',
    initial: '채',
    altIcon: false,
    durationSec: 360,
    ageText: '',
    fresh: false,
    viewsText: '',
    why: '',
    summary: '',
    checks: [],
    chapters: [],
  };
}

describe('watch feed for a page (recordPass false)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('swiping on records nothing and draws no 넘김; 좋아 is recorded; the first video starts at the second', () => {
    const verdicts: unknown[] = [];
    const loads: Array<[string, number]> = [];
    const player = {
      current: {
        load: (id: string, s: number) => loads.push([id, s]),
        soundOn: () => undefined,
        soundOff: () => undefined,
        pause: () => undefined,
      },
    };
    let ready: (() => void) | null = null;
    render(
      <WatchFeed
        goalTitle="기술·개발"
        videos={[r3(0), r3(1), r3(2)]}
        frame={FRAME}
        loading={false}
        recordPass={false}
        startSeconds={961}
        initial={{ idx: 1, maxIdx: 1 }}
        onVerdict={(i, v) => verdicts.push([i, v])}
        onFinish={() => undefined}
        onBack={() => undefined}
        sound={false}
        onSound={() => undefined}
        player={player}
        renderPlayer={(e) => {
          ready = e.onReady;
          return null;
        }}
      />
    );
    act(() => ready?.());
    expect(loads[0]).toEqual([ID[1], 961]);
    expect(screen.getByTestId('mf-watch-counter').textContent).toBe('2 / 3');
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(screen.getByTestId('mf-watch-counter').textContent).toBe('3 / 3');
    expect(verdicts).toEqual([]);
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    act(() => {
      vi.advanceTimersByTime(600);
    });
    // the card swiped past shows no 넘김
    const cur = screen.getAllByTestId('mf-w3-card').find((c) => c.hasAttribute('data-current'))!;
    expect(cur.querySelector('[data-testid="mf-w3-confirm"]')).toBeNull();
    fireEvent.click(cur.querySelector('[data-testid="mf-watch-like"]')!);
    expect(verdicts).toEqual([[1, 'useful']]);
  });
});

const PAGE: MorningPage = {
  domain: '기술/개발',
  seen_date: '2026-11-14',
  headline: '헤드라인',
  core: [{ text: '문장.', sources: [{ video_id: ID[1]!, t: 77 }] }],
  note: [{ heading: '소제목', paragraphs: [{ text: '문단.', sources: [] }] }],
  videos: ID.map((id, i) => ({
    video_id: id,
    title: '제목 ' + i,
    channel: '채널',
    useful_for: '',
  })),
};

const card = (i: number): WatchVideo => ({
  ...toFeedCard(
    {
      video_id: ID[i]!,
      title: '제목 ' + i,
      channel: '채널',
      published_at: '2026-11-01T00:00:00Z',
      duration: 360,
      view_count: 10,
      thumbnail_url: null,
      cell: '기술/개발',
      focus: [],
      why: '',
    } as never,
    ['#000000']
  ),
  durationSec: 360,
});

describe('brief -> its videos -> back', () => {
  it('a source opens the layer at that video and pushes history; back closes it and the page keeps its state', async () => {
    const pushState = vi.spyOn(window.history, 'pushState');
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    const onEvidence = vi.fn();
    const load = vi.fn(() =>
      Promise.resolve({
        items: [card(0), card(1), card(2)],
        judged: { [ID[0]!]: 'useful' as const },
      })
    );
    render(
      <PageWithWatch
        frame={FRAME}
        page={PAGE}
        domainTitle="기술·개발"
        order={[]}
        rest={[]}
        today="2026-11-14"
        back={{ label: '홈', onBack: () => undefined }}
        onPast={() => undefined}
        onEvidence={onEvidence}
        loadCards={load}
        sound={false}
        onSound={() => undefined}
        onJudge={() => undefined}
      />
    );
    // open the note first: its state must survive the round trip
    fireEvent.click(screen.getByTestId('mf-page-note-toggle'));
    expect(screen.getByTestId('mf-page-note').hasAttribute('data-open')).toBe(true);
    fireEvent.click(screen.getAllByTestId('mf-page-cite')[0]!);
    await act(async () => {
      await Promise.resolve();
    });
    expect(pushState).toHaveBeenCalledTimes(1);
    expect(onEvidence).toHaveBeenCalledWith(ID[1]);
    expect(screen.getByTestId('mf-page-watch')).toBeTruthy();
    // during the slide-in the feed (and its player) is not mounted yet: no playback mid-slide
    expect(screen.queryByTestId('mf-watch-counter')).toBeNull();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });
    expect(screen.getByTestId('mf-watch-counter').textContent).toBe('2 / 3');
    // the page is still mounted under the layer
    expect(screen.getByTestId('mf-page')).toBeTruthy();
    fireEvent.click(screen.getByTestId('mf-watch-back'));
    expect(back).toHaveBeenCalledTimes(1);
    // the exact reverse of the slide-in, then the layer is gone
    await act(async () => {
      await new Promise((r) => setTimeout(r, 450));
    });
    expect(screen.queryByTestId('mf-page-watch')).toBeNull();
    expect(screen.getByTestId('mf-page-note').hasAttribute('data-open')).toBe(true);
    pushState.mockRestore();
    back.mockRestore();
  });
});
