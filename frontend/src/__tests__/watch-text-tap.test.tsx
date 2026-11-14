import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { cutInside, leftOut } from '@/features/morning-feed/watch-r3-clip';
import { WatchFeed, type R3Video } from '@/features/morning-feed/watch-r3-feed';

const FRAME = { vh: 642, safeTop: 0, safeBottom: 0, playerH: 219 };

function video(chapters: number): R3Video {
  return {
    key: 'k',
    videoId: 'v0000000000',
    title: '제목',
    channel: '채널',
    initial: '채',
    altIcon: false,
    durationSec: 360,
    ageText: '3일 전',
    fresh: true,
    viewsText: '',
    why: '',
    summary: '',
    checks: [],
    chapters: Array.from({ length: chapters }, (_x, i) => ({ at: i + ':00', title: '목차 ' + i })),
  };
}

function mount(v: R3Video) {
  render(
    <WatchFeed
      goalTitle="기술·개발"
      videos={[v]}
      frame={FRAME}
      loading={false}
      initial={{ phase: 'player' }}
      onVerdict={() => undefined}
      onFinish={() => undefined}
      onBack={() => undefined}
      sound={false}
      onSound={() => undefined}
      player={{ current: null }}
      renderPlayer={() => <div />}
    />
  );
  fireEvent.click(screen.getByTestId('mf-w3-info'));
}

const SHOWN = {
  why: 'a',
  summary: 'b',
  chapters: 2,
  showWhy: true,
  showSummary: true,
  chapterRows: 2,
};

describe('card text tap opens the panel only when something is cut (2026-11-14)', () => {
  it('leftOut: a block not drawn, or fewer chapter rows than chapters', () => {
    expect(leftOut(SHOWN)).toBe(false);
    expect(leftOut({ ...SHOWN, showWhy: false })).toBe(true);
    expect(leftOut({ ...SHOWN, showSummary: false })).toBe(true);
    expect(leftOut({ ...SHOWN, chapterRows: 1 })).toBe(true);
    expect(leftOut({ ...SHOWN, why: '', showWhy: false })).toBe(false);
  });

  it('cutInside: a clamped block taller than its box', () => {
    const card = document.createElement('div');
    card.innerHTML = '<div class="mf-w3-why-t"></div><div class="mf-w3-title"></div>';
    const why = card.querySelector('.mf-w3-why-t')!;
    let content = 44;
    Object.defineProperty(why, 'clientHeight', { value: 44 });
    Object.defineProperty(why, 'scrollHeight', { get: () => content });
    expect(cutInside(card)).toBe(false);
    content = 66;
    expect(cutInside(card)).toBe(true);
  });

  it('a card with more chapters than it shows: tapping the text opens the panel', () => {
    mount(video(30));
    expect(screen.getByTestId('mf-w3-sheet')).toBeTruthy();
  });

  it('a card showing everything: tapping the text does nothing; there is no 더 보기 button', () => {
    mount(video(0));
    expect(screen.queryByTestId('mf-w3-sheet')).toBeNull();
    expect(screen.queryByTestId('mf-w3-more')).toBeNull();
  });
});
