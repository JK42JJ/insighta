import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { MorningPage } from '@/features/morning-cards/api';
import articleFixture from '@/features/morning-feed/page-fixture-article.json';
import pageFixture from '@/features/morning-feed/page-fixture.json';
import { PageWithWatch } from '@/features/morning-feed/PageWithWatch';
import { toFeedCard } from '@/features/morning-feed/feed-format';
import { WatchPage, type SourceTap } from '@/features/morning-feed/WatchPage';
import { articleParagraphs, isArticleCore } from '@/features/morning-feed/watch-page-model';

// no network in tests: the font links are not added and the wait ends at once ('late')
vi.mock('@/features/morning-feed/watch-home-fonts', () => ({
  ensureHomeFonts: () => undefined,
  waitHomeFonts: () => Promise.resolve('late'),
}));
// the real player needs the YouTube API; the layer only needs something to render
vi.mock('@/features/morning-feed/WatchPlayer', () => ({
  WatchPlayer: () => null,
}));
// the watch layer as PageWithWatch opens it: which video, from which second
const opened = vi.hoisted(() => [] as Array<{ videoId: string; t: number }>);
vi.mock('@/features/morning-feed/PageWatch', async (actual) => {
  const real = await actual<typeof import('@/features/morning-feed/PageWatch')>();
  const { createElement } = await import('react');
  return {
    ...real,
    PageWatch: (p: Parameters<typeof real.PageWatch>[0]) => {
      opened.push(p.start);
      return createElement(real.PageWatch, p);
    },
  };
});

/*
 * Article format (decision 2026-11-22): core items with `para` are drawn as 1 to 2 paragraphs;
 * the text carries no source marks, a sentence opens its sources (order 2026-11-25 B5).
 */

const FRAME = { vh: 844, safeTop: 47, safeBottom: 34, playerH: 219, width: 390 };
const A = 'aaaaaaaaaaa';
const B = 'bbbbbbbbbbb';
const C = 'ccccccccccc';
const PAGE: MorningPage = {
  domain: '재테크/투자',
  seen_date: '2026-11-22',
  headline: '기사식 헤드라인 한 줄이 여기에 들어간다',
  core: [
    { text: '첫 문장이다.', sources: [{ video_id: A, t: 200 }], para: 1 },
    { text: '둘째 문장이다.', sources: [{ video_id: B, t: 160 }], para: 1 },
    { text: '셋째 문장이다.', sources: [{ video_id: A, t: 220 }], para: 1 },
    { text: '넷째 문장이다.', sources: [{ video_id: B, t: 180 }], para: 2 },
    { text: '다섯째 문장이다.', sources: [{ video_id: A, t: 360 }], para: 2 },
  ],
  note: [{ heading: '소제목', paragraphs: [{ text: '문단.', sources: [{ video_id: C, t: 30 }] }] }],
  videos: [
    { video_id: A, title: '영상 A', channel: '채널A', useful_for: '가', role: 'support' },
    { video_id: B, title: '영상 B', channel: '채널B', useful_for: '나', role: 'support' },
    { video_id: C, title: '영상 C', channel: '채널C', useful_for: '다', role: 'other' },
  ],
};

function draw(
  page: MorningPage,
  onOpenVideo?: (id: string, t: number, from: 'body' | 'note' | 'list') => void,
  onOpenSource?: (tap: SourceTap) => void
): ReturnType<typeof render> {
  return render(
    <WatchPage
      frame={FRAME}
      page={page}
      domainTitle="재테크"
      order={[]}
      others={[]}
      today="2026-11-22"
      back={{ label: '홈', onBack: () => undefined }}
      onPast={() => undefined}
      onOpenVideo={onOpenVideo}
      onOpenSource={onOpenSource}
    />
  );
}

describe('article paragraphs (model)', () => {
  it('groups sentences by para in order, each sentence with its own sources', () => {
    expect(isArticleCore(PAGE.core)).toBe(true);
    expect(articleParagraphs(PAGE.core)).toEqual([
      {
        sentences: [
          { text: '첫 문장이다.', sources: [{ video_id: A, t: 200 }] },
          { text: '둘째 문장이다.', sources: [{ video_id: B, t: 160 }] },
          { text: '셋째 문장이다.', sources: [{ video_id: A, t: 220 }] },
        ],
      },
      {
        sentences: [
          { text: '넷째 문장이다.', sources: [{ video_id: B, t: 180 }] },
          { text: '다섯째 문장이다.', sources: [{ video_id: A, t: 360 }] },
        ],
      },
    ]);
    // one paragraph only; para 2 written before para 1 is still drawn second
    expect(articleParagraphs(PAGE.core.map((c) => ({ ...c, para: 1 as const })))).toHaveLength(1);
    const swapped = [PAGE.core[3]!, PAGE.core[0]!];
    expect(articleParagraphs(swapped).map((q) => q.sentences.map((x) => x.text))).toEqual([
      ['첫 문장이다.'],
      ['넷째 문장이다.'],
    ]);
    expect(isArticleCore((pageFixture as MorningPage).core)).toBe(false);
  });
});

describe('article page (screen)', () => {
  it('draws one paragraph per para, text only, with how many videos are behind it', () => {
    draw(PAGE);
    const ps = screen.getByTestId('mf-page-core').querySelectorAll('.mf-page-core-p');
    expect(ps).toHaveLength(2);
    expect(ps[0]!.textContent).toBe('첫 문장이다. 둘째 문장이다. 셋째 문장이다. 근거 영상 2개');
    expect(ps[1]!.textContent).toBe('넷째 문장이다. 다섯째 문장이다. 근거 영상 2개');
    expect(screen.queryByTestId('mf-page-cite')).toBeNull();
    expect(
      [...ps[1]!.querySelectorAll('.mf-page-sent')].map((x) => x.getAttribute('data-sid'))
    ).toEqual(['p1.s0', 'p1.s1']);
    // the paragraph typography applies to the article format only
    expect(screen.getByTestId('mf-page-core').hasAttribute('data-article')).toBe(true);
    // the note and the video list are drawn as before
    expect(screen.getByTestId('mf-page-note').querySelector('.mf-page-para')?.textContent).toBe(
      '문단. 근거 영상 1개'
    );
    expect(screen.getAllByTestId('mf-page-video')).toHaveLength(3);
    // no length stored: the channel alone
    expect(screen.getAllByTestId('mf-page-video-ch')[0]!.textContent).not.toContain('·');
    expect(screen.getByTestId('mf-page').textContent).not.toMatch(/support|condition|other/);
  });

  it('a sentence gives its own sources, its id and where it is', () => {
    const open = vi.fn();
    draw(PAGE, undefined, open);
    const sents = screen.getByTestId('mf-page-core').querySelectorAll<HTMLElement>('.mf-page-sent');
    fireEvent.click(sents[2]!);
    expect(open).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sources: [{ video_id: A, t: 220 }],
        sid: 'p0.s2',
        from: 'body',
        scope: 'sentence',
        el: sents[2],
      })
    );
    fireEvent.keyDown(sents[3]!, { key: 'Enter' });
    expect(open).toHaveBeenLastCalledWith(
      expect.objectContaining({ sources: [{ video_id: B, t: 180 }], sid: 'p1.s0' })
    );
  });

  it('a long press or a selection is no tap; without the handler a sentence is plain text', () => {
    const open = vi.fn();
    const { unmount } = draw(PAGE, undefined, open);
    const s = screen.getAllByTestId('mf-page-sent')[0]!;
    const press = (type: string, at: number): void => {
      const e = new MouseEvent(type, { bubbles: true, detail: 1 });
      Object.defineProperty(e, 'timeStamp', { value: at });
      act(() => void s.dispatchEvent(e));
    };
    press('pointerdown', 100);
    press('click', 900);
    expect(open).not.toHaveBeenCalled();
    const sel = vi
      .spyOn(window, 'getSelection')
      .mockReturnValue({ isCollapsed: false, toString: () => '첫' } as Selection);
    press('pointerdown', 1000);
    press('click', 1080);
    expect(open).not.toHaveBeenCalled();
    sel.mockRestore();
    press('pointerdown', 2000);
    press('click', 2080);
    expect(open).toHaveBeenCalledTimes(1);
    unmount();
    draw(PAGE);
    expect(screen.getAllByTestId('mf-page-sent')[0]!.getAttribute('role')).toBeNull();
  });

  it('tells a body sentence from a list row and a note sentence (usage records)', () => {
    const open = vi.fn();
    const tap = vi.fn();
    draw(PAGE, open, tap);
    fireEvent.click(screen.getAllByTestId('mf-page-video')[0]!);
    expect(open).toHaveBeenLastCalledWith(PAGE.videos[0]!.video_id, 0, 'list');
    fireEvent.click(screen.getByTestId('mf-page-note-toggle'));
    fireEvent.click(screen.getByTestId('mf-page-note').querySelector('.mf-page-sent')!);
    expect(tap).toHaveBeenLastCalledWith(expect.objectContaining({ from: 'note', sid: 'p2.s0' }));
  });

  it('the earlier format is drawn as before: one paragraph per core sentence with its own links', () => {
    const old = pageFixture as MorningPage;
    draw(old);
    const ps = screen.getByTestId('mf-page-core').querySelectorAll('.mf-page-core-p');
    expect(ps).toHaveLength(old.core.length);
    expect(screen.getByTestId('mf-page-core').hasAttribute('data-article')).toBe(false);
    ps.forEach((el, i) => {
      expect(el.textContent?.startsWith(old.core[i]!.text)).toBe(true);
    });
  });

  it('the example data is in the article format and within its limits', () => {
    const ex = articleFixture as MorningPage;
    expect(isArticleCore(ex.core)).toBe(true);
    expect(ex.core.length).toBeGreaterThanOrEqual(5);
    expect(ex.core.length).toBeLessThanOrEqual(8);
    expect(ex.core.every((c) => (c.para === 1 || c.para === 2) && c.sources.length > 0)).toBe(true);
    expect(articleParagraphs(ex.core)).toHaveLength(2);
    expect(ex.videos).toHaveLength(6);
    expect(ex.videos.every((v) => ['support', 'condition', 'other'].includes(v.role ?? ''))).toBe(
      true
    );
  });
});

describe('article page -> the video at that second', () => {
  it("a sentence opens its sheet; the sheet's full view opens the watch layer at that video and second", async () => {
    const pushState = vi.spyOn(window.history, 'pushState');
    const evidence: string[] = [];
    opened.length = 0;
    const card = (id: string, i: number) => ({
      ...toFeedCard(
        {
          video_id: id,
          title: '제목 ' + i,
          channel: '채널',
          published_at: '2026-11-10T00:00:00Z',
          duration: 360,
          view_count: null,
          thumbnail_url: null,
          cell: '재테크/투자',
          focus: [],
          why: '',
        } as never,
        ['#16273f']
      ),
      durationSec: 360,
    });
    render(
      <PageWithWatch
        frame={{ ...FRAME, vh: 642, safeTop: 0, safeBottom: 0 }}
        page={PAGE}
        domainTitle="재테크"
        order={[]}
        others={[]}
        today="2026-11-22"
        back={{ label: '홈', onBack: () => undefined }}
        onPast={() => undefined}
        onEvidence={(id) => evidence.push(id)}
        loadCards={() =>
          Promise.resolve({ items: [card(A, 0), card(B, 1), card(C, 2)], judged: {} })
        }
        sound={false}
        onSound={() => undefined}
        onJudge={() => undefined}
      />
    );
    // the second sentence of the first paragraph: 채널B 2:40
    const sents = screen.getByTestId('mf-page-core').querySelectorAll('.mf-page-sent');
    expect(sents[1]!.textContent).toBe('둘째 문장이다.');
    fireEvent.click(sents[1]!);
    await act(async () => {
      await Promise.resolve();
    });
    expect(pushState).toHaveBeenCalledTimes(1);
    expect(evidence).toEqual([B]);
    // the sheet, over the article; the video screen only from its button
    expect(screen.getByTestId('mf-src-line').textContent).toMatch(/^2:40 · /);
    expect(opened).toEqual([]);
    fireEvent.click(screen.getByTestId('mf-src-full'));
    await act(async () => {
      await Promise.resolve();
    });
    // the same history entry, and one source open is one evidence record
    expect(pushState).toHaveBeenCalledTimes(1);
    expect(evidence).toEqual([B]);
    // 2:40 = 160 s into video B
    expect(opened[0]).toEqual({ videoId: B, t: 160 });
    expect(screen.getByTestId('mf-page-watch')).toBeTruthy();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });
    // the layer is on the linked video (2nd of 3)
    expect(screen.getByTestId('mf-watch-counter').textContent).toBe('2 / 3');
    pushState.mockRestore();
  });
});
