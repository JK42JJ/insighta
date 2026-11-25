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
  it('the text carries no source marks; the paragraph says how many videos are behind it (order 2026-11-25 B5)', () => {
    render(
      <WatchPage
        frame={FRAME}
        page={PAGE}
        domainTitle="기술·개발"
        order={[]}
        others={[]}
        today="2026-11-14"
        back={{ label: '홈', onBack: () => undefined }}
        onPast={() => undefined}
      />
    );
    const core = screen.getByTestId('mf-page-core');
    expect(core.querySelector('.mf-page-core-src')).toBeNull();
    expect(core.querySelector('.mf-page-core-p')?.textContent).toBe(
      '핵심 문장 하나. 근거 영상 1개'
    );
    const para = screen.getByTestId('mf-page-note').querySelector('.mf-page-para');
    expect(para?.textContent).toBe('문단. 근거 영상 1개');
    expect(screen.queryByTestId('mf-page-cite')).toBeNull();
  });

  it("copy is filled; two seconds of one video are one video; today's videos link; a long order is capped", () => {
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
        others={[
          {
            cell: '재테크/투자',
            title: '재테크',
            headline: '다른 헤드라인',
            onPick: () => undefined,
          },
        ]}
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
    expect(screen.getByTestId('mf-page-others').textContent).toBe('다른 분야재테크다른 헤드라인');
    expect(screen.getByTestId('mf-page-past').textContent).toContain('지난 브리프');
    expect(screen.getByTestId('mf-page-home').textContent).toBe('홈');
    expect(screen.getByTestId('mf-page-seen').textContent).toBe('오늘 · 11월 14일');
    expect(
      screen.getByTestId('mf-page-core').querySelector('[data-testid="mf-page-ev"]')?.textContent
    ).toBe('근거 영상 1개');
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

  it('본 순서 and 다른 분야 are hidden when empty, shown when given; the end is in the ordered sequence', () => {
    const { rerender } = render(
      <WatchPage
        frame={FRAME}
        page={PAGE}
        domainTitle="기술·개발"
        order={[]}
        others={[]}
        today="2026-11-14"
        back={{ label: '홈', onBack: () => undefined }}
        onPast={() => undefined}
      />
    );
    expect(screen.queryByTestId('mf-page-order')).toBeNull();
    expect(screen.queryByTestId('mf-page-others')).toBeNull();
    const onPick = vi.fn();
    rerender(
      <WatchPage
        frame={FRAME}
        page={PAGE}
        domainTitle="기술·개발"
        order={[{ key: 'a', title: '영상 제목' }]}
        others={[{ cell: '재테크/투자', title: '재테크', headline: '다른 헤드라인', onPick }]}
        feedback={{ value: null, onPick: () => Promise.resolve() }}
        shareUrl="https://example.com/b"
        todayVideos={{ count: 2, onGo: () => undefined }}
        today="2026-11-14"
        back={{ label: '홈', onBack: () => undefined }}
        onPast={() => undefined}
      />
    );
    expect(screen.getByTestId('mf-page-order')).toBeTruthy();
    const at = ['feedback', 'others', 'today', 'past'].map((k) =>
      screen.getByTestId('mf-page-' + k)
    );
    for (let i = 1; i < at.length; i++) {
      const rel = at[i - 1]!.compareDocumentPosition(at[i]!);
      expect(rel & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(
      [...screen.getByTestId('mf-page-feedback').querySelectorAll('button')].map((b) =>
        b.getAttribute('aria-label')
      )
    ).toEqual(['별로', '좋아', '공유']);
    fireEvent.click(screen.getByTestId('mf-page-other'));
    expect(onPick).toHaveBeenCalledTimes(1);
  });
});

describe('브리프 while its text is still read (2026-11-25)', () => {
  it('the title and date handed over are drawn at once as they stay; lines only in the text place', () => {
    const animate = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate });
    const props = {
      frame: FRAME,
      title: { headline: PAGE.headline, seenDate: '2026-11-14' },
      domainTitle: '기술·개발',
      order: [],
      others: [],
      today: '2026-11-14',
      back: { label: '홈', onBack: () => undefined },
      onPast: () => undefined,
    };
    const { rerender } = render(<WatchPage {...props} page={null} />);
    const h1 = screen.getByTestId('mf-page-headline');
    expect(h1.textContent).toBe(PAGE.headline);
    for (let e: HTMLElement | null = h1; e; e = e.parentElement) {
      expect(e.style.visibility).not.toBe('hidden');
      expect(e.style.opacity).toBe('');
    }
    expect(screen.getByTestId('mf-page-seen').textContent).toBe('오늘 · 11월 14일');
    const lines = screen.getByTestId('mf-page-skeleton');
    expect(h1.compareDocumentPosition(lines) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByTestId('mf-page-core')).toBeNull();
    // the text arrives: the lines go at once, the title is the same element and never faded
    rerender(<WatchPage {...props} page={PAGE} />);
    expect(screen.getByTestId('mf-page-core')).toBeTruthy();
    expect(screen.queryByTestId('mf-page-skeleton')).toBeNull();
    expect(screen.getByTestId('mf-page-headline')).toBe(h1);
    expect(animate).not.toHaveBeenCalled();
    delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
  });

  it('a kept brief is drawn with no lines at all', () => {
    render(
      <WatchPage
        frame={FRAME}
        page={PAGE}
        domainTitle="기술·개발"
        order={[]}
        others={[]}
        today="2026-11-14"
        back={{ label: '홈', onBack: () => undefined }}
        onPast={() => undefined}
      />
    );
    expect(screen.queryByTestId('mf-page-skeleton')).toBeNull();
    expect(screen.getByTestId('mf-page-core')).toBeTruthy();
  });
});

describe('daily home routing', () => {
  it('a chip changes the headline; the button is always 브리프 읽기 and opens the shown brief', () => {
    const onOpen = vi.fn();
    const onOpenPage = vi.fn();
    const onPast = vi.fn();
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
        onOpen={onOpen}
        onOpenPage={onOpenPage}
        onPast={onPast}
      />
    );
    expect(screen.getByTestId('mf-home-headline').textContent).toBe('첫 헤드라인');
    // the head (2026-11-25): the date of the shown brief with its weekday, a button to past briefs
    expect(screen.getByTestId('mf-home-past').textContent).toBe('11월 14일 토요일');
    fireEvent.click(screen.getByTestId('mf-home-past'));
    expect(onPast).toHaveBeenLastCalledWith('기술/개발', '2026-11-14');
    // above the headline: the chosen domain's name alone
    expect(screen.getByTestId('mf-home-meta').textContent).toBe('기술·개발');
    expect(document.body.textContent).not.toContain('오늘 ·');
    expect(document.body.textContent).not.toContain('지난 브리프');
    // Insighta is a button with the head's press feel and stays on the home
    const brand = screen.getByTestId('mf-home-brand');
    expect(brand.tagName).toBe('BUTTON');
    expect(brand.getAttribute('data-press')).toBe('soft');
    expect(screen.getByTestId('mf-home-past').getAttribute('data-press')).toBe('soft');
    fireEvent.click(brand);
    expect(onOpenPage).not.toHaveBeenCalled();
    expect(screen.getByTestId('mf-home-headline').textContent).toBe('첫 헤드라인');
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
    // the domain name and the date change with the chip
    expect(screen.getByTestId('mf-home-domain').textContent).toBe('재테크');
    expect(screen.getByTestId('mf-home-seen').textContent).toBe('11월 12일 목요일');
    fireEvent.click(screen.getByTestId('mf-home-past'));
    expect(onPast).toHaveBeenLastCalledWith('재테크/투자', '2026-11-12');
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
        others={[]}
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
    expect(onOpen).toHaveBeenCalledWith('기술/개발', '2026-11-13', '나');
    fireEvent.click(screen.getAllByTestId('mf-past-chip')[1]!);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId('mf-past-dom').textContent).toBe('건강');
    expect(screen.queryAllByTestId('mf-past-row')).toHaveLength(0);
    // opened from today: no 오늘로
    expect(screen.queryByTestId('mf-past-today')).toBeNull();
  });

  it('오늘로 is the first thing in the list when given, and gives the chosen domain', async () => {
    const onToday = vi.fn();
    render(
      <WatchPast
        frame={FRAME}
        chips={[{ cell: '기술/개발', title: '기술·개발' }]}
        initial="기술/개발"
        load={() => Promise.resolve([{ seen_date: '2026-11-13', headline: '나' }])}
        onOpen={() => undefined}
        onToday={onToday}
        today="2026-11-14"
        back={{ label: '홈', onBack: () => undefined }}
      />
    );
    await screen.findAllByTestId('mf-past-row');
    const go = screen.getByTestId('mf-past-today');
    expect(go.textContent).toBe('오늘로');
    expect(go.getAttribute('data-press')).toBe('soft');
    expect(document.querySelector('.mf-past-list')!.firstElementChild).toBe(go);
    fireEvent.click(go);
    expect(onToday).toHaveBeenCalledWith('기술/개발');
  });
});
