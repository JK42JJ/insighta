/**
 * The issue's contents, in the sidebar.
 *
 * The entries have to stay in step with `issueToNoteDoc`, which assembles the
 * page: a section that does not render must not appear in the contents, and
 * the order has to match or the list reads as a different document. These pin
 * both, so a change to the converter that forgets this file fails here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { SidebarBriefSection } from './SidebarBriefSection';
import type { IssueDocument } from '@/features/newsletter-note/lib/issue-types';

function doc(over: Partial<IssueDocument> = {}): IssueDocument {
  return {
    schemaVersion: 1,
    templateVersion: 'web-v1',
    locale: 'ko',
    slug: '2026-09-02-ai-tech',
    category: 'AI 엔지니어링',
    categoryKey: 'ai-tech',
    issueLabel: '제1호',
    dateLabel: '2026년 9월 2일',
    publishedAt: '2026-09-02',
    runline: '읽는 데 7분 · 유튜브 274편에서 인용 · 1차 출처 3건 대조',
    preview: 'p',
    headline: ['h1', 'h2'],
    dek: 'dek',
    stories: [
      { kicker: '신뢰 경계', title: '설정 파일 이야기', blocks: [{ type: 'p', html: 'a' }] },
      { kicker: '권한의 시점', title: '결제 승인 이야기', blocks: [{ type: 'p', html: 'b' }] },
    ],
    insight: { blocks: [{ type: 'p', html: 'c' }], actions: [] },
    picks: [{ title: 't', meta: 'm', body: 'b', latin: true, videoId: 'abcdefghijk' }],
    vocabulary: [{ word: '용어', body: 'b', use: 'u' }],
    interest: { intro: 'i', ledger: [], ledgerCaption: 'c' },
    next: { intro: 'i', checkpoints: [] },
    refs: [{ label: 'r', sources: [{ label: 's', url: 'https://x.test' }] }],
    gradeNote: 'g',
    editNote: 'e',
    sign: 'Insighta 에디토리얼',
    ...over,
  } as IssueDocument;
}

function renderSection(
  over: Partial<IssueDocument> = {},
  loading = false,
  active: string | null = null
) {
  const onSelect = vi.fn();
  const r = render(
    <SidebarBriefSection
      issue={loading ? null : doc(over)}
      loading={loading}
      collapsed={false}
      active={active}
      onSelect={onSelect}
    />
  );
  return { ...r, onSelect };
}

beforeEach(() => vi.clearAllMocks());

describe('SidebarBriefSection', () => {
  it('names the issue and carries the runline as a subtitle', () => {
    renderSection();
    expect(screen.getByText('AI 엔지니어링 제1호')).toBeTruthy();
    // The reading time leads the runline; what belongs under a title is the rest.
    expect(screen.getByText(/274편에서 인용/)).toBeTruthy();
    expect(screen.queryByText(/읽는 데 7분/)).toBeNull();
  });

  it('groups stories under their kicker, which is already the chapter name', () => {
    renderSection();
    expect(screen.getByText('신뢰 경계')).toBeTruthy();
    expect(screen.getByText('권한의 시점')).toBeTruthy();
    expect(screen.getByText('설정 파일 이야기')).toBeTruthy();
  });

  it('lists the sections in the order the page assembles them', () => {
    renderSection();
    // Entries are `li` now, matching the note's TOC markup.
    const labels = [...document.querySelectorAll('li')].map((b) => b.textContent);
    expect(labels).toEqual([
      '설정 파일 이야기',
      '결제 승인 이야기',
      '이번 주 한 문장',
      '이번 주 추천',
      '용어',
      '이 브리프를 만든 방법',
      '출처',
    ]);
  });

  it('omits a section the page does not render', () => {
    renderSection({ picks: [], vocabulary: [], refs: [] });
    expect(screen.queryByText('이번 주 추천')).toBeNull();
    expect(screen.queryByText('용어')).toBeNull();
    expect(screen.queryByText('출처')).toBeNull();
    // The unconditional ones stay.
    expect(screen.getByText('이 브리프를 만든 방법')).toBeTruthy();
  });

  it('scrolls the container, which is what the reading surface actually moves', () => {
    // The layout the page uses: a scrolling parent wrapping `.note-prose-root`.
    // `scrollIntoView` on the heading does nothing here -- measured in the
    // browser with the target 6,417px down and scrollTop still 0 -- so the
    // container is moved directly and this pins that.
    const scroller = document.createElement('div');
    const root = document.createElement('div');
    root.className = 'note-prose-root';
    const h = document.createElement('h2');
    h.textContent = '이번 주 추천';
    root.appendChild(h);
    scroller.appendChild(root);
    document.body.appendChild(scroller);
    const scrollTo = vi.fn();
    scroller.scrollTo = scrollTo;

    renderSection();
    // Both the stub heading and the sidebar entry carry this text, which is
    // the point -- the entry finds the heading by matching it.
    const entry = [...document.querySelectorAll('li')].find(
      (li) => li.textContent?.trim() === '이번 주 추천'
    )!;
    fireEvent.click(entry);
    // Instant: `smooth` on this container is a no-op in the browser -- asked
    // for 3,000px and `scrollTop` stayed 0, with reduced-motion off.
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'auto' }));
    document.body.removeChild(scroller);
  });

  it('renders nothing on the collapsed rail', () => {
    const { container } = render(
      <SidebarBriefSection
        issue={doc()}
        loading={false}
        collapsed
        active={null}
        onSelect={() => undefined}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('says it is loading rather than showing an empty shell', () => {
    renderSection({}, true);
    expect(screen.getByText('불러오는 중…')).toBeTruthy();
  });

  it('keeps every entry on one line', () => {
    // Long titles wrapped to two and three lines, turning the contents into a
    // wall of text. The note truncates; so does this.
    renderSection();
    for (const li of document.querySelectorAll('li')) {
      expect(li.className).toContain('truncate');
    }
  });

  it('shortens a title at its lead clause, the way the note does', () => {
    renderSection({
      stories: [
        {
          kicker: '신뢰 경계',
          title: '설정 파일 이야기: 저장소를 열기만 해도 실행됩니다',
          blocks: [{ type: 'p', html: 'a' }],
        },
      ],
    } as Partial<IssueDocument>);
    expect(screen.getByText('설정 파일 이야기')).toBeTruthy();
    expect(screen.queryByText(/저장소를 열기만 해도/)).toBeNull();
  });

  it('marks the selected entry with the gold bar the note uses', () => {
    renderSection({}, false, '용어');
    const sel = [...document.querySelectorAll('li')].find(
      (li) => li.textContent?.trim() === '용어'
    )!;
    // `sidebar-primary` is gold inside `.note-mode`. Both the 2px bar and the
    // text colour come from it, and the size class must not merge it away.
    expect(sel.className).toContain('border-l-2');
    expect(sel.className).toContain('border-sidebar-primary');
    expect(sel.className).toContain('text-sidebar-primary');

    const other = [...document.querySelectorAll('li')].find(
      (li) => li.textContent?.trim() === '출처'
    )!;
    expect(other.className).not.toContain('text-sidebar-primary');
  });

  it('reports the click upward rather than holding the selection itself', () => {
    // The issue object changes identity whenever `useBriefNote` refetches, so a
    // `useState` here loses the selection on that re-render -- the gold marker
    // appeared and vanished within a frame. The sidebar owns it.
    const { onSelect } = renderSection();
    const entry = [...document.querySelectorAll('li')].find(
      (li) => li.textContent?.trim() === '용어'
    )!;
    fireEvent.click(entry);
    expect(onSelect).toHaveBeenCalledWith('용어');
  });
});
