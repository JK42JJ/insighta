/**
 * The brief menu — ten rows, on and off.
 *
 * Two regressions are pinned here because both shipped and both were reported
 * as "브리프 안 보여":
 *
 *   The list used to come from the issues, so a brief with nothing published
 *   had no row — which is every brief but one.
 *
 *   The other nine sat behind a `+ 브리프 추가` link to a separate page, so
 *   the product looked like it had one brief.
 *
 * What is available is data, not a list in the component: `issues === 0` means
 * nothing has published, which is what the TBD badge says.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { SidebarBriefEntry } from './SidebarBriefEntry';

const subscribedMock = vi.fn();
const categoriesMock = vi.fn();
const subscribeMock = vi.fn();
const navigateMock = vi.fn();

vi.mock('@/shared/lib/api-client', () => ({
  apiClient: {
    getSubscribedBriefs: () => subscribedMock(),
    getBriefCategories: () => categoriesMock(),
    subscribeToBrief: (...a: unknown[]) => subscribeMock(...a),
  },
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

function cat(key: string, label: string, subscribed: boolean, issues: number) {
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

/** What production looks like today: one brief published, nine not. */
const TEN = [
  cat('ai-tech', 'AI 엔지니어링', true, 2),
  cat('dev', '개발', false, 0),
  cat('career', '커리어', false, 0),
  cat('english', '영어', false, 0),
  cat('investing', '투자', false, 0),
  cat('shopping', '소비', false, 0),
  cat('productivity', '생산성', false, 0),
  cat('health', '건강', false, 0),
  cat('startup', '스타트업', false, 0),
  cat('news-trend', '뉴스·트렌드', false, 0),
];

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

beforeEach(() => {
  vi.clearAllMocks();
  categoriesMock.mockResolvedValue({ status: 'ok', data: { categories: TEN } });
  subscribedMock.mockResolvedValue({
    status: 'ok',
    data: { issues: [issue('ai-tech', 'a', false), issue('ai-tech', 'b', true)], unread: 1 },
  });
  subscribeMock.mockResolvedValue({ status: 'ok', data: { subscribed: true } });
});

describe('SidebarBriefEntry', () => {
  it('lists all ten, subscribed or not', async () => {
    renderEntry();
    await screen.findByText('AI 엔지니어링');
    for (const c of TEN) expect(screen.getByText(c.label)).toBeTruthy();
  });

  it('badges the nine with nothing published and makes them unclickable', async () => {
    renderEntry();
    await screen.findByText('AI 엔지니어링');

    expect(screen.getAllByText('TBD')).toHaveLength(9);
    const dev = screen.getByText('개발').closest('button')!;
    expect(dev.hasAttribute('disabled')).toBe(true);

    fireEvent.click(dev);
    expect(navigateMock).not.toHaveBeenCalled();
    expect(subscribeMock).not.toHaveBeenCalled();
  });

  it('opens a subscribed brief', async () => {
    renderEntry();
    fireEvent.click(await screen.findByText('AI 엔지니어링'));
    expect(navigateMock).toHaveBeenCalledWith('/brief/c/ai-tech');
    expect(subscribeMock).not.toHaveBeenCalled();
  });

  it('turns on an unsubscribed brief that has issues, then opens it', async () => {
    categoriesMock.mockResolvedValue({
      status: 'ok',
      data: { categories: [cat('ai-tech', 'AI 엔지니어링', false, 2), ...TEN.slice(1)] },
    });
    renderEntry();

    fireEvent.click(await screen.findByText('AI 엔지니어링'));
    await waitFor(() => expect(subscribeMock).toHaveBeenCalledWith('ai-tech'));
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/brief/c/ai-tech'));
  });

  it('shows the unread count on the row rather than a bare dot', async () => {
    renderEntry();
    await screen.findByText('AI 엔지니어링');
    expect(screen.getByText('1')).toBeTruthy();
    expect(screen.queryByLabelText('구독 중')).toBeNull();
  });

  it('shows the on-dot when a subscribed brief is fully read', async () => {
    subscribedMock.mockResolvedValue({
      status: 'ok',
      data: { issues: [issue('ai-tech', 'a', true)], unread: 0 },
    });
    renderEntry();
    await screen.findByText('AI 엔지니어링');
    expect(screen.getByLabelText('구독 중')).toBeTruthy();
  });

  it('offers no way to create a brief — there are exactly ten', async () => {
    renderEntry();
    await screen.findByText('AI 엔지니어링');
    expect(screen.queryByText('브리프 추가')).toBeNull();
  });

  it('renders nothing on the collapsed rail', () => {
    const { container } = renderEntry(true);
    expect(container.firstChild).toBeNull();
  });
});
