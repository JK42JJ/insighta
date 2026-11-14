import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { MorningPage } from '@/features/morning-cards/api';

// no network in tests: the font links are not added and the wait ends at once ('late')
vi.mock('@/features/morning-feed/watch-home-fonts', () => ({
  ensureHomeFonts: () => undefined,
  waitHomeFonts: () => Promise.resolve('late'),
}));
import { WatchHome } from '@/features/morning-feed/WatchHome';
import { WatchPage } from '@/features/morning-feed/WatchPage';
import { WatchPast } from '@/features/morning-feed/WatchPast';

const FRAME = { vh: 844, safeTop: 47, safeBottom: 34, playerH: 219, width: 390 };
const PAGE: MorningPage = {
  domain: '기술/개발',
  seen_date: '2026-11-14',
  headline: '값싼 모델이 비싼 모델보다 비용이 더 많이 들 수 있다',
  core: [{ text: '핵심 문장 하나.', sources: [{ video_id: 'QHBjufYK8TA', t: 961 }] }],
  note: [
    {
      heading: '소제목',
      paragraphs: [{ text: '문단.', sources: [{ video_id: 'QHBjufYK8TA', t: 30 }] }],
    },
  ],
  videos: [
    { video_id: 'QHBjufYK8TA', title: '영상 제목', channel: 'AI Engineer', useful_for: '누구' },
  ],
};

describe('한 장 page (2026-11-14)', () => {
  it('core sources sit on their own line under the sentence; note sources end the paragraph', () => {
    render(
      <WatchPage
        frame={FRAME}
        page={PAGE}
        domainTitle="기술·개발"
        order={[]}
        rest={[]}
        onHome={() => undefined}
        onPast={() => undefined}
      />
    );
    const core = screen.getByTestId('mf-page-core');
    const line = core.querySelector('.mf-page-core-src');
    expect(line?.textContent).toBe('AI Engineer 16:01');
    expect(core.querySelector('.mf-page-core-p')?.textContent).toBe('핵심 문장 하나.');
    const para = screen.getByTestId('mf-page-note').querySelector('.mf-page-para');
    expect(para?.textContent).toBe('문단.AI Engineer 0:30');
    const cite = screen.getAllByTestId('mf-page-cite')[0] as HTMLAnchorElement;
    expect(cite.href).toBe('https://www.youtube.com/watch?v=QHBjufYK8TA&t=961s');
    expect(cite.target).toBe('_blank');
  });

  it('본 순서 and 남은 도메인 are hidden when empty, shown when given', () => {
    const { rerender } = render(
      <WatchPage
        frame={FRAME}
        page={PAGE}
        domainTitle="기술·개발"
        order={[]}
        rest={[]}
        onHome={() => undefined}
        onPast={() => undefined}
      />
    );
    expect(screen.queryByTestId('mf-page-order')).toBeNull();
    expect(screen.queryByTestId('mf-page-rest')).toBeNull();
    const onPick = vi.fn();
    rerender(
      <WatchPage
        frame={FRAME}
        page={PAGE}
        domainTitle="기술·개발"
        order={[{ key: 'a', title: '영상 제목' }]}
        rest={[{ cell: '재테크/투자', title: '재테크', onPick }]}
        onHome={() => undefined}
        onPast={() => undefined}
      />
    );
    expect(screen.getByTestId('mf-page-order')).toBeTruthy();
    fireEvent.click(screen.getByTestId('mf-page-rest-chip'));
    expect(onPick).toHaveBeenCalledTimes(1);
  });
});

describe('daily home routing', () => {
  it('a chip with a page changes the headline; one without opens its videos; the headline opens the page', () => {
    const onOpen = vi.fn();
    const onOpenPage = vi.fn();
    render(
      <WatchHome
        frame={FRAME}
        dateLabel="11월 14일 토요일"
        chips={[
          { cell: '기술/개발', title: '기술·개발' },
          { cell: '재테크/투자', title: '재테크' },
          { cell: '학습/교육', title: '학습' },
        ]}
        pages={{
          '기술/개발': { headline: '첫 헤드라인', seenDate: '2026-11-13' },
          '재테크/투자': { headline: '둘째 헤드라인', seenDate: '2026-11-12' },
        }}
        initial="기술/개발"
        canEnter={(c) => c === '기술/개발'}
        onOpen={onOpen}
        onOpenPage={onOpenPage}
        onPast={() => undefined}
      />
    );
    expect(screen.getByTestId('mf-home-headline').textContent).toBe('첫 헤드라인');
    expect(screen.getByTestId('mf-home-enter')).toBeTruthy();
    const chips = screen.getAllByTestId('mf-home-chip');
    fireEvent.click(chips[2]!);
    expect(onOpen).toHaveBeenCalledWith('학습/교육');
    // jsdom: fonts never arrive, so the switch is immediate (no motion before ready)
    fireEvent.click(chips[1]!);
    expect(screen.getByTestId('mf-home-headline').textContent).toBe('둘째 헤드라인');
    expect(screen.getByTestId('mf-home-seen').textContent).toBe('11월 12일 목요일');
    // no videos left today for that domain: the button is hidden
    expect(screen.queryByTestId('mf-home-enter')).toBeNull();
    fireEvent.click(screen.getByTestId('mf-home-headline'));
    expect(onOpenPage).toHaveBeenCalledWith('재테크/투자');
  });
});

describe('지난 장 목록', () => {
  it('loads the chosen domain newest first; a domain without pages shows its name and no rows', async () => {
    const load = vi.fn((cell: string) =>
      Promise.resolve(
        cell === '기술/개발'
          ? [
              { seen_date: '2026-11-14', headline: '가' },
              { seen_date: '2026-11-13', headline: '나' },
            ]
          : []
      )
    );
    const onOpen = vi.fn();
    render(
      <WatchPast
        frame={FRAME}
        chips={[
          { cell: '기술/개발', title: '기술·개발' },
          { cell: '건강/피트니스', title: '건강' },
        ]}
        initial="기술/개발"
        load={load}
        onOpen={onOpen}
        onHome={() => undefined}
      />
    );
    await act(async () => {
      await Promise.resolve();
    });
    const rows = screen.getAllByTestId('mf-past-row');
    expect(rows.map((r) => r.textContent)).toEqual(['11월 14일 토요일가', '11월 13일 금요일나']);
    fireEvent.click(rows[1]!);
    expect(onOpen).toHaveBeenCalledWith('기술/개발', '2026-11-13');
    fireEvent.click(screen.getAllByTestId('mf-past-chip')[1]!);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId('mf-past-dom').textContent).toBe('건강');
    expect(screen.queryAllByTestId('mf-past-row')).toHaveLength(0);
  });
});
