/**
 * The brief's panel: category, subscription state, issues newest first with
 * the one being read marked, and that issue's contents nested under it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { SidebarBriefPanel } from './SidebarBriefPanel';
import type { BriefCategoryIssues, SubscribedBriefIssue } from '@/shared/lib/api-client';
import type { IssueDocument } from '@/features/newsletter-note/lib/issue-types';

const categoryMock = vi.fn();
const subscribeMock = vi.fn();
const unsubscribeMock = vi.fn();
const navigateMock = vi.fn();

vi.mock('@/shared/lib/api-client', () => ({
  apiClient: {
    getBriefCategoryIssues: (key: string) => categoryMock(key),
    subscribeToBrief: (...a: unknown[]) => subscribeMock(...a),
    unsubscribeFromBrief: (...a: unknown[]) => unsubscribeMock(...a),
  },
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

function issue(over: Partial<SubscribedBriefIssue> = {}): SubscribedBriefIssue {
  return {
    slug: '2026-09-02-ai-tech',
    categoryKey: 'ai-tech',
    categoryLabel: 'AI 엔지니어링',
    issueNo: 1,
    publishedAt: '2026-09-02T00:00:00Z',
    headline: '에이전트가 읽은 것은 전부 명령이 될 수 있다',
    dek: 'd',
    coverVideoId: null,
    coverUrl: '/brief-covers/ai-tech.svg',
    issueLabel: '제1호',
    dateLabel: '2026년 9월 2일',
    read: true,
    ...over,
  };
}

function payload(issues: SubscribedBriefIssue[], subscribed = true) {
  const data: BriefCategoryIssues = {
    category: { key: 'ai-tech', label: 'AI 엔지니어링', subscribed },
    issues,
    unread: issues.filter((i) => !i.read).length,
  };
  return { status: 'ok', data };
}

function doc(): IssueDocument {
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
    runline: '읽는 데 7분 · 유튜브 274편에서 인용',
    preview: 'p',
    headline: ['h'],
    dek: 'dek',
    stories: [
      { kicker: '신뢰 경계', title: '설정 파일 이야기', blocks: [{ type: 'p', html: 'a' }] },
    ],
    insight: { blocks: [{ type: 'p', html: 'c' }], actions: [] },
    picks: [],
    vocabulary: [],
    interest: { intro: 'i', ledger: [], ledgerCaption: 'c' },
    next: { intro: 'i', checkpoints: [] },
    refs: [],
    gradeNote: 'g',
    editNote: 'e',
    sign: 'Insighta',
  } as IssueDocument;
}

function renderPanel(props: Partial<Parameters<typeof SidebarBriefPanel>[0]> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={['/brief/c/ai-tech']}>
      <QueryClientProvider client={qc}>
        <SidebarBriefPanel
          categoryKey="ai-tech"
          currentSlug={undefined}
          issue={null}
          issueLoading={false}
          collapsed={false}
          activeEntry={null}
          onSelectEntry={() => undefined}
          {...props}
        />
      </QueryClientProvider>
    </MemoryRouter>
  );
}

beforeEach(() => vi.clearAllMocks());

describe('SidebarBriefPanel', () => {
  it('names the category and says the reader subscribes', async () => {
    categoryMock.mockResolvedValue(payload([issue()]));
    renderPanel();
    expect(await screen.findByText('AI 엔지니어링')).toBeTruthy();
    expect(screen.getByText('구독 중')).toBeTruthy();
    expect(screen.getByText(/1호 발행/)).toBeTruthy();
  });

  it('offers to subscribe when the reader does not yet', async () => {
    categoryMock.mockResolvedValue(payload([issue()], false));
    subscribeMock.mockResolvedValue({ status: 'ok' });
    renderPanel();
    const btn = await screen.findByRole('button', { name: '구독' });
    fireEvent.click(btn);
    await waitFor(() => expect(subscribeMock).toHaveBeenCalledWith('ai-tech', undefined));
  });

  it('lists the issues in the order given and marks the one being read', async () => {
    categoryMock.mockResolvedValue(
      payload([
        issue({ slug: 'b', issueNo: 2, issueLabel: '제2호', headline: '둘째' }),
        issue({ slug: 'a', issueNo: 1, issueLabel: '제1호', headline: '첫째' }),
      ])
    );
    renderPanel({ currentSlug: 'a' });
    await screen.findByText('둘째');
    const rows = [...document.querySelectorAll('li > button')];
    expect(rows.map((b) => b.textContent)).toEqual([
      '제2호2026년 9월 2일둘째',
      '제1호2026년 9월 2일첫째',
    ]);
    expect(rows[1].getAttribute('aria-current')).toBe('page');
    expect(rows[0].getAttribute('aria-current')).toBeNull();
  });

  it('puts the date beside the label and gives the headline two lines', async () => {
    // A headline is a 40-character sentence; beside the label it was cut to an
    // ellipsis after a few words. Line 1 = label + date, line 2-3 = headline.
    categoryMock.mockResolvedValue(payload([issue({ headline: '긴 헤드라인 문장' })]));
    renderPanel();
    const head = await screen.findByText('긴 헤드라인 문장');
    expect(head.className).toContain('line-clamp-2');
    expect(screen.getByText('2026년 9월 2일')).toBeTruthy();
  });

  it('opens an issue when its row is clicked', async () => {
    categoryMock.mockResolvedValue(payload([issue({ slug: 'x', headline: '열기' })]));
    const onNavigated = vi.fn();
    renderPanel({ onNavigated });
    fireEvent.click(await screen.findByText('열기'));
    expect(navigateMock).toHaveBeenCalledWith('/brief/x');
    expect(onNavigated).toHaveBeenCalled();
  });

  it('marks unread issues with the dot the rest of the product uses', async () => {
    categoryMock.mockResolvedValue(
      payload([issue({ read: false }), issue({ slug: 'r', read: true })])
    );
    renderPanel();
    await screen.findByText(/안 읽음 1/);
    expect(screen.getAllByLabelText('안 읽음')).toHaveLength(1);
  });

  it('nests the contents of the issue being read under its row', async () => {
    categoryMock.mockResolvedValue(payload([issue()]));
    renderPanel({ currentSlug: '2026-09-02-ai-tech', issue: doc() });
    await screen.findByText('에이전트가 읽은 것은 전부 명령이 될 수 있다');
    // A story from the contents, and no second title block naming the issue.
    expect(screen.getByText('설정 파일 이야기')).toBeTruthy();
    expect(screen.queryByText('AI 엔지니어링 제1호')).toBeNull();
  });

  it('renders nothing on the collapsed rail', () => {
    categoryMock.mockResolvedValue(payload([issue()]));
    const { container } = renderPanel({ collapsed: true });
    expect(container.firstChild).toBeNull();
  });

  it('waits rather than naming the wrong brief before the issue is known', () => {
    renderPanel({ categoryKey: undefined });
    expect(screen.getByText('불러오는 중…')).toBeTruthy();
    expect(categoryMock).not.toHaveBeenCalled();
  });
});
