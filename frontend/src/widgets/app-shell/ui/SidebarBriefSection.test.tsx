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

function renderSection(over: Partial<IssueDocument> = {}, loading = false) {
  return render(
    <SidebarBriefSection issue={loading ? null : doc(over)} loading={loading} collapsed={false} />
  );
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
    const labels = [...document.querySelectorAll('button')].map((b) => b.textContent);
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
    fireEvent.click(screen.getByRole('button', { name: '이번 주 추천' }));
    // Instant: `smooth` on this container is a no-op in the browser -- asked
    // for 3,000px and `scrollTop` stayed 0, with reduced-motion off.
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'auto' }));
    document.body.removeChild(scroller);
  });

  it('renders nothing on the collapsed rail', () => {
    const { container } = render(<SidebarBriefSection issue={doc()} loading={false} collapsed />);
    expect(container.firstChild).toBeNull();
  });

  it('says it is loading rather than showing an empty shell', () => {
    renderSection({}, true);
    expect(screen.getByText('불러오는 중…')).toBeTruthy();
  });
});
