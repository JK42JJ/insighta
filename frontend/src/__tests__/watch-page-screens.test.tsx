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

describe('브리프 page (2026-11-14 user test copy)', () => {
  it('sources follow the text after one space, core sentences and note paragraphs alike (revised handoff)', () => {
    render(
      <WatchPage
        frame={FRAME}
        page={PAGE}
        domainTitle="기술·개발"
        order={[]}
        rest={[]}
        today="2026-11-14"
        back={{ label: '홈', onBack: () => undefined }}
        onPast={() => undefined}
      />
    );
    const core = screen.getByTestId('mf-page-core');
    expect(core.querySelector('.mf-page-core-src')).toBeNull();
    expect(core.querySelector('.mf-page-core-p')?.textContent).toBe(
      '핵심 문장 하나. AI Engineer 16:01'
    );
    const para = screen.getByTestId('mf-page-note').querySelector('.mf-page-para');
    expect(para?.textContent).toBe('문단. AI Engineer 0:30');
    const cite = screen.getAllByTestId('mf-page-cite')[0] as HTMLAnchorElement;
    expect(cite.href).toBe('https://www.youtube.com/watch?v=QHBjufYK8TA&t=961s');
    expect(cite.target).toBe('_blank');
  });

  it("copy is filled; one video's source links are one unit; today's videos link; a long order is capped", () => {
    const two: MorningPage = {
      ...PAGE,
      core: [
        {
          text: '두 시점 문장.',
          sources: [
            { video_id: 'QHBjufYK8TA', t: 231 },
            { video_id: 'QHBjufYK8TA', t: 379 },
          ],
        },
      ],
    };
    const onGo = vi.fn();
    render(
      <WatchPage
        frame={FRAME}
        page={two}
        domainTitle="기술·개발"
        order={Array.from({ length: 25 }, (_x, i) => ({ key: 'k' + i, title: '영상 ' + i }))}
        rest={[{ cell: '재테크/투자', title: '재테크', onPick: () => undefined }]}
        today="2026-11-14"
        back={{ label: '홈', onBack: () => undefined }}
        onPast={() => undefined}
        todayVideos={{ count: 3, onGo }}
      />
    );
    expect(document.body.textContent).not.toContain('[문구]');
    for (const old of ['지난 장', '이 장', '노트 읽기', '노트 접기'])
      expect(document.body.textContent).not.toContain(old);
    expect(screen.getByTestId('mf-page-note-toggle').textContent).toContain('이어서 읽기');
    fireEvent.click(screen.getByTestId('mf-page-note-toggle'));
    expect(screen.getByTestId('mf-page-note-toggle').textContent).toContain('접기');
    expect(screen.getByTestId('mf-page-videos').textContent).toContain('근거가 된 영상');
    expect(screen.getByTestId('mf-page-rest').textContent).toContain('다른 도메인');
    expect(screen.getByTestId('mf-page-past').textContent).toContain('지난 브리프');
    expect(screen.getByTestId('mf-page-home').textContent).toBe('홈');
    expect(screen.getByTestId('mf-page-seen').textContent).toBe('오늘 · 11월 14일');
    const groups = Array.from(
      screen.getByTestId('mf-page-core').querySelectorAll('[data-testid="mf-page-cite-group"]')
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]!.textContent).toBe('AI Engineer 3:51· 6:19');
    expect(screen.getByTestId('mf-page-today').textContent).toContain(
      '오늘의 영상 모두 보기 (3편)'
    );
    fireEvent.click(screen.getByTestId('mf-page-today'));
    expect(onGo).toHaveBeenCalledTimes(1);
    // 오늘 본 순서 starts folded; opened with more than 20 rows it is capped
    expect(screen.queryByTestId('mf-page-order-list')).toBeNull();
    fireEvent.click(screen.getByTestId('mf-page-order').querySelector('button')!);
    expect(screen.getByTestId('mf-page-order-list').hasAttribute('data-capped')).toBe(true);
  });

  it('본 순서 and 남은 도메인 are hidden when empty, shown when given', () => {
    const { rerender } = render(
      <WatchPage
        frame={FRAME}
        page={PAGE}
        domainTitle="기술·개발"
        order={[]}
        rest={[]}
        today="2026-11-14"
        back={{ label: '홈', onBack: () => undefined }}
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
        today="2026-11-14"
        back={{ label: '홈', onBack: () => undefined }}
        onPast={() => undefined}
      />
    );
    expect(screen.getByTestId('mf-page-order')).toBeTruthy();
    fireEvent.click(screen.getByTestId('mf-page-rest-chip'));
    expect(onPick).toHaveBeenCalledTimes(1);
  });
});

describe('daily home routing', () => {
  it('a chip changes the headline; the button is always 브리프 읽기 and opens the shown brief', () => {
    const onOpen = vi.fn();
    const onOpenPage = vi.fn();
    render(
      <WatchHome
        frame={FRAME}
        chips={[
          { cell: '기술/개발', title: '기술·개발' },
          { cell: '재테크/투자', title: '재테크' },
          { cell: '학습/교육', title: '학습' },
        ]}
        pages={{
          '기술/개발': { headline: '첫 헤드라인', seenDate: '2026-11-14' },
          '재테크/투자': { headline: '둘째 헤드라인', seenDate: '2026-11-12' },
        }}
        initial="기술/개발"
        today="2026-11-14"
        onOpen={onOpen}
        onOpenPage={onOpenPage}
        onPast={() => undefined}
      />
    );
    expect(screen.getByTestId('mf-home-headline').textContent).toBe('첫 헤드라인');
    // the date only; a brief of today reads 오늘 ·
    expect(screen.getByTestId('mf-home-meta').textContent).toContain('오늘 · 11월 14일');
    expect(screen.getByTestId('mf-home-past').textContent).toBe('지난 브리프');
    // no goal in the top row: the brand only
    expect(screen.queryByTestId('mf-home-goal')).toBeNull();
    expect(screen.getByTestId('mf-home-enter').textContent).toContain('브리프 읽기');
    fireEvent.click(screen.getByTestId('mf-home-enter'));
    expect(onOpenPage).toHaveBeenLastCalledWith('기술/개발');
    const chips = screen.getAllByTestId('mf-home-chip');
    fireEvent.click(chips[2]!);
    expect(onOpen).toHaveBeenCalledWith('학습/교육');
    // jsdom: fonts never arrive, so the switch is immediate (no motion before ready)
    fireEvent.click(chips[1]!);
    expect(screen.getByTestId('mf-home-headline').textContent).toBe('둘째 헤드라인');
    expect(screen.getByTestId('mf-home-seen').textContent).toBe('11월 12일');
    expect(screen.getByTestId('mf-home-enter').textContent).toContain('브리프 읽기');
    fireEvent.click(screen.getByTestId('mf-home-enter'));
    expect(onOpenPage).toHaveBeenLastCalledWith('재테크/투자');
    fireEvent.click(screen.getByTestId('mf-home-headline'));
    expect(onOpenPage).toHaveBeenCalledTimes(3);
    // every pressable on the home has a pressed look
    for (const b of Array.from(document.querySelectorAll('button'))) {
      expect(b.hasAttribute('data-press')).toBe(true);
    }
  });
});

describe('brief reaction (이 브리프가 쓸모 있었나요)', () => {
  it('shows at once, saves behind, goes back and says so when the save fails', async () => {
    let fail = true;
    const onPick = vi.fn(() => (fail ? Promise.reject(new Error('x')) : Promise.resolve()));
    render(
      <WatchPage
        frame={FRAME}
        page={PAGE}
        domainTitle="기술·개발"
        order={[]}
        rest={[]}
        today="2026-11-14"
        back={{ label: '홈', onBack: () => undefined }}
        onPast={() => undefined}
        feedback={{ value: null, onPick }}
      />
    );
    const yes = screen.getByTestId('mf-page-feedback-yes');
    fireEvent.click(yes);
    expect(yes.hasAttribute('data-on')).toBe(true);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId('mf-page-feedback-yes').hasAttribute('data-on')).toBe(false);
    expect(screen.getByTestId('mf-page-feedback-error')).toBeTruthy();
    fail = false;
    fireEvent.click(screen.getByTestId('mf-page-feedback-no'));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId('mf-page-feedback-no').hasAttribute('data-on')).toBe(true);
    expect(onPick).toHaveBeenLastCalledWith('not_useful');
  });
});

describe('지난 브리프 목록', () => {
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
        today="2026-11-14"
        back={{ label: '홈', onBack: () => undefined }}
      />
    );
    await act(async () => {
      await Promise.resolve();
    });
    const rows = screen.getAllByTestId('mf-past-row');
    expect(rows.map((r) => r.textContent)).toEqual(['오늘 · 11월 14일가', '11월 13일나']);
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
