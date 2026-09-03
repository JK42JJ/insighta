/**
 * The sidebar's brief section — the thing a reader actually finds.
 *
 * The regression this pins down: the list used to be derived from issues, so a
 * brief subscribed to but not yet published had no row. The reader who had
 * just subscribed went looking for it in the sidebar and it was not there.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { SidebarBriefEntry } from './SidebarBriefEntry';

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

function cat(key: string, label: string, subscribed: boolean, issues = 0) {
  return { key, label, blurb: '', subscribed, issues };
}

function issue(categoryKey: string, slug: string, read: boolean) {
  return {
    slug,
    categoryKey,
    categoryLabel: categoryKey,
    issueNo: 1,
    publishedAt: '2026-09-02T00:00:00Z',
    headline: 'h',
    dek: 'd',
    coverVideoId: null,
    issueLabel: '제1호',
    dateLabel: '9월 2일',
    read,
  };
}

function renderEntry(collapsed = false) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <SidebarBriefEntry collapsed={collapsed} />
      </QueryClientProvider>
    </MemoryRouter>
  );
}

beforeEach(() => vi.clearAllMocks());

describe('SidebarBriefEntry', () => {
  it('lists the briefs the reader takes, not the issues they have', async () => {
    categoriesMock.mockResolvedValue({
      status: 'ok',
      data: {
        categories: [
          cat('ai-tech', 'AI 엔지니어링', true, 1),
          cat('dev', '개발', true, 0),
          cat('design', '디자인', false, 0),
        ],
      },
    });
    subscribedMock.mockResolvedValue({
      status: 'ok',
      data: { issues: [issue('ai-tech', 'a', false)], unread: 1 },
    });

    renderEntry();
    expect(await screen.findByText('AI 엔지니어링')).toBeTruthy();
    // Subscribed with nothing published yet — still a row. This is the bug.
    expect(screen.getByText('개발')).toBeTruthy();
    // Not subscribed — not a row. The list is what you take, not a catalogue.
    expect(screen.queryByText('디자인')).toBeNull();
  });

  it('opens the domain grid, not the latest issue', async () => {
    categoriesMock.mockResolvedValue({
      status: 'ok',
      data: { categories: [cat('ai-tech', 'AI 엔지니어링', true, 1)] },
    });
    subscribedMock.mockResolvedValue({
      status: 'ok',
      data: { issues: [issue('ai-tech', '2026-09-02-ai-tech', false)], unread: 1 },
    });

    renderEntry();
    fireEvent.click(await screen.findByText('AI 엔지니어링'));
    expect(navigateMock).toHaveBeenCalledWith('/brief/c/ai-tech');
  });

  it('badges unread per domain and leaves a read domain unbadged', async () => {
    categoriesMock.mockResolvedValue({
      status: 'ok',
      data: {
        categories: [cat('ai-tech', 'AI 엔지니어링', true, 2), cat('dev', '개발', true, 1)],
      },
    });
    subscribedMock.mockResolvedValue({
      status: 'ok',
      data: {
        issues: [
          issue('ai-tech', 'a', false),
          issue('ai-tech', 'b', false),
          issue('dev', 'c', true),
        ],
        unread: 2,
      },
    });

    renderEntry();
    expect(await screen.findByText('2')).toBeTruthy();
    // One badge on the whole list: 개발 is fully read.
    expect(screen.queryByText('0')).toBeNull();
  });

  it('says so when nothing is subscribed', async () => {
    categoriesMock.mockResolvedValue({
      status: 'ok',
      data: { categories: [cat('ai-tech', 'AI 엔지니어링', false, 1)] },
    });
    subscribedMock.mockResolvedValue({ status: 'ok', data: { issues: [], unread: 0 } });

    renderEntry();
    expect(await screen.findByText('구독한 브리프가 없습니다.')).toBeTruthy();
    expect(screen.getByText('브리프 추가')).toBeTruthy();
  });

  it('renders nothing on the collapsed rail', () => {
    categoriesMock.mockResolvedValue({ status: 'ok', data: { categories: [] } });
    subscribedMock.mockResolvedValue({ status: 'ok', data: { issues: [], unread: 0 } });
    const { container } = renderEntry(true);
    expect(container.firstChild).toBeNull();
  });
});
