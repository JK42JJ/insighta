/**
 * The brief card grid — mounted, not type-checked.
 *
 * `tsc` proves the file compiles. It does not prove that a card built out of
 * an issue survives `InsightCardItemV2`, which reads a dozen fields an issue
 * does not have and calls four hooks that assume a video. That is the failure
 * this file is here for: the one that passes every static check and throws on
 * the first render.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { BriefCategoryPage } from './BriefCategoryPage';
import type { BriefCategoryIssues, SubscribedBriefIssue } from '@/shared/lib/api-client';

const categoryMock = vi.fn();
const navigateMock = vi.fn();

vi.mock('@/shared/lib/api-client', () => ({
  apiClient: {
    getBriefCategoryIssues: (key: string) => categoryMock(key),
    unsubscribeFromBrief: vi.fn(),
  },
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

// The card's enrich hook pulls in the Supabase client, which subscribes to
// auth events at import time. Stubbed rather than skipped: the card is the
// thing under test and it must be the real one.
vi.mock('@/shared/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
    },
  },
}));

function issue(over: Partial<SubscribedBriefIssue> = {}): SubscribedBriefIssue {
  return {
    slug: '2026-09-02-ai-tech',
    categoryKey: 'ai-tech',
    categoryLabel: 'AI 엔지니어링',
    issueNo: 1,
    publishedAt: '2026-09-02T00:00:00Z',
    headline: '에이전트가 읽은 것은 전부 명령이 될 수 있다',
    // Prose already: the server strips the markup where the excerpt is made.
    dek: '이번 주 재료에서 반복된 주제는 모델 점수가 아니라 권한이었다.',
    coverVideoId: '1IbrFrdll4U',
    coverUrl: 'https://i.ytimg.com/vi/1IbrFrdll4U/hqdefault.jpg',
    issueLabel: '제1호',
    dateLabel: '2026년 9월 2일',
    read: false,
    ...over,
  };
}

function payload(
  issues: SubscribedBriefIssue[],
  over: Partial<BriefCategoryIssues['category']> = {}
): { status: 'ok'; data: BriefCategoryIssues } {
  return {
    status: 'ok',
    data: {
      category: { key: 'ai-tech', label: 'AI 엔지니어링', subscribed: true, ...over },
      issues,
      unread: issues.filter((i) => !i.read).length,
    },
  };
}

function renderGrid(categoryKey = 'ai-tech') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[`/brief/c/${categoryKey}`]}>
      <QueryClientProvider client={qc}>
        <Routes>
          <Route path="/brief/c/:categoryKey" element={<BriefCategoryPage />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

beforeEach(() => vi.clearAllMocks());

describe('BriefCategoryPage', () => {
  it('renders an issue as a card', async () => {
    categoryMock.mockResolvedValue(payload([issue()]));
    renderGrid();

    expect(await screen.findByText('에이전트가 읽은 것은 전부 명령이 될 수 있다')).toBeTruthy();
    // The standfirst is the card's summary. Without the kind branch the slot
    // is empty, because an issue has no v2 essence and no YouTube summary.
    expect(screen.getByText(/모델 점수가 아니라 권한/)).toBeTruthy();
    // The cover is the lead pick, not a placeholder.
    const img = document.querySelector('img[src*="1IbrFrdll4U"]');
    expect(img).toBeTruthy();
  });

  it('asks the category route, not the subscription list', async () => {
    categoryMock.mockResolvedValue(payload([issue()]));
    renderGrid('ai-tech');
    await screen.findByText('에이전트가 읽은 것은 전부 명령이 될 수 있다');
    expect(categoryMock).toHaveBeenCalledWith('ai-tech');
  });

  it('opens the issue when the card is clicked', async () => {
    categoryMock.mockResolvedValue(payload([issue()]));
    renderGrid();
    fireEvent.click(await screen.findByText('에이전트가 읽은 것은 전부 명령이 될 수 있다'));
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/brief/2026-09-02-ai-tech'));
  });

  it('keeps the order the API gives, newest first', async () => {
    categoryMock.mockResolvedValue(
      payload([
        issue({ slug: 'b', headline: '두 번째 호', issueNo: 2, issueLabel: '제2호' }),
        issue({ slug: 'a', headline: '첫 번째 호', issueNo: 1 }),
      ])
    );
    renderGrid();

    await screen.findByText('두 번째 호');
    const titles = [...document.querySelectorAll('h4')].map((h) => h.textContent);
    expect(titles).toEqual(['두 번째 호', '첫 번째 호']);
  });

  it('marks unread issues and says how many there are', async () => {
    categoryMock.mockResolvedValue(
      payload([issue({ read: false }), issue({ slug: 'b', read: true })])
    );
    renderGrid();

    await screen.findByText('2호');
    expect(screen.getAllByLabelText('안 읽음')).toHaveLength(1);
  });

  it('tells a subscriber with no issues yet that the subscription took', async () => {
    categoryMock.mockResolvedValue(payload([], { key: 'dev', label: '개발' }));
    renderGrid('dev');

    expect(await screen.findByText(/첫 호가 발행되면/)).toBeTruthy();
    // The heading still names the brief — a page that cannot say where you are
    // is the case an empty state exists for.
    expect(screen.getByRole('heading', { name: /개발/ })).toBeTruthy();
  });

  it('shows the shelf to a reader who does not subscribe yet', async () => {
    categoryMock.mockResolvedValue(payload([issue()], { subscribed: false }));
    renderGrid();
    expect(await screen.findByText('에이전트가 읽은 것은 전부 명령이 될 수 있다')).toBeTruthy();
    expect(screen.queryByText('구독 중')).toBeNull();
  });

  it('renders the category cover when an issue has no picks', async () => {
    categoryMock.mockResolvedValue(
      payload([issue({ coverVideoId: null, coverUrl: '/brief-covers/ai-tech.svg' })])
    );
    renderGrid();
    expect(await screen.findByText('에이전트가 읽은 것은 전부 명령이 될 수 있다')).toBeTruthy();
    expect(document.querySelector('img[src="/brief-covers/ai-tech.svg"]')).toBeTruthy();
  });

  // The scroll box shipped without a scrollbar class, so it drew the operating
  // system's default bar: 15px wide on the live page, against 6px on every
  // other reading surface in the product. `scrollbar-pro` is the house class
  // the learning page's centre column uses, and jsdom applies no styles, so
  // the class itself is the only thing a unit test can hold.
  it('scrolls with the house scrollbar, not the browser default', async () => {
    categoryMock.mockResolvedValue(payload([issue()]));
    renderGrid();
    await screen.findByText('에이전트가 읽은 것은 전부 명령이 될 수 있다');

    const box = document.querySelector('.overflow-y-auto');
    expect(box).not.toBeNull();
    expect(box?.className).toContain('scrollbar-pro');
  });
});
