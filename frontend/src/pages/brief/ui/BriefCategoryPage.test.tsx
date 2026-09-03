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
import type { SubscribedBriefIssue } from '@/shared/lib/api-client';

const subscribedMock = vi.fn();
const categoriesMock = vi.fn();
const navigateMock = vi.fn();

vi.mock('@/shared/lib/api-client', () => ({
  apiClient: {
    getSubscribedBriefs: () => subscribedMock(),
    getBriefCategories: () => categoriesMock(),
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
    dek: '이번 주 재료에서 반복된 주제는 모델 점수가 아니라 권한이었다.',
    coverVideoId: '1IbrFrdll4U',
    issueLabel: '제1호',
    dateLabel: '2026년 9월 2일',
    read: false,
    ...over,
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

beforeEach(() => {
  vi.clearAllMocks();
  categoriesMock.mockResolvedValue({
    status: 'ok',
    data: {
      categories: [
        { key: 'ai-tech', label: 'AI 엔지니어링', blurb: '', subscribed: true, issues: 1 },
        { key: 'dev', label: '개발', blurb: '', subscribed: true, issues: 0 },
      ],
    },
  });
});

describe('BriefCategoryPage', () => {
  it('renders an issue as a card', async () => {
    subscribedMock.mockResolvedValue({ status: 'ok', data: { issues: [issue()], unread: 1 } });
    renderGrid();

    expect(await screen.findByText('에이전트가 읽은 것은 전부 명령이 될 수 있다')).toBeTruthy();
    // The standfirst is the card's summary. Without the kind branch the slot
    // is empty, because an issue has no v2 essence and no YouTube summary.
    expect(screen.getByText(/모델 점수가 아니라 권한/)).toBeTruthy();
    // The cover is the lead pick, not a placeholder.
    const img = document.querySelector('img[src*="1IbrFrdll4U"]');
    expect(img).toBeTruthy();
  });

  it('opens the issue when the card is clicked', async () => {
    subscribedMock.mockResolvedValue({ status: 'ok', data: { issues: [issue()], unread: 1 } });
    renderGrid();
    fireEvent.click(await screen.findByText('에이전트가 읽은 것은 전부 명령이 될 수 있다'));
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/brief/2026-09-02-ai-tech'));
  });

  it('shows only this domain, newest first', async () => {
    subscribedMock.mockResolvedValue({
      status: 'ok',
      data: {
        issues: [
          issue({ slug: 'b', headline: '두 번째 호', issueNo: 2 }),
          issue({ slug: 'a', headline: '첫 번째 호', issueNo: 1 }),
          issue({ slug: 'x', headline: '다른 도메인', categoryKey: 'dev' }),
        ],
        unread: 3,
      },
    });
    renderGrid();

    await screen.findByText('두 번째 호');
    expect(screen.queryByText('다른 도메인')).toBeNull();
    const titles = [...document.querySelectorAll('h4')].map((h) => h.textContent);
    expect(titles).toEqual(['두 번째 호', '첫 번째 호']);
  });

  it('marks unread issues and says how many there are', async () => {
    subscribedMock.mockResolvedValue({
      status: 'ok',
      data: { issues: [issue({ read: false }), issue({ slug: 'b', read: true })], unread: 1 },
    });
    renderGrid();

    await screen.findByText('2호');
    expect(screen.getAllByLabelText('안 읽음')).toHaveLength(1);
  });

  it('tells a subscriber with no issues yet that the subscription took', async () => {
    subscribedMock.mockResolvedValue({ status: 'ok', data: { issues: [], unread: 0 } });
    renderGrid('dev');

    expect(await screen.findByText(/첫 호가 발행되면/)).toBeTruthy();
    // The heading still names the brief — a page that cannot say where you are
    // is the case an empty state exists for.
    expect(screen.getByRole('heading', { name: /개발/ })).toBeTruthy();
  });

  it('renders without a cover rather than breaking when an issue has no picks', async () => {
    subscribedMock.mockResolvedValue({
      status: 'ok',
      data: { issues: [issue({ coverVideoId: null })], unread: 1 },
    });
    renderGrid();
    expect(await screen.findByText('에이전트가 읽은 것은 전부 명령이 될 수 있다')).toBeTruthy();
  });
});
