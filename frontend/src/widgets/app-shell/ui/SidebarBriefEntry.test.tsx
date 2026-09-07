/**
 * The brief menu — one row, and a popover.
 *
 * Two regressions are pinned here, both reported from screenshots:
 *
 *   The ten domains were listed inline, pushing the mandala list down by ten
 *   rows and cutting it off. Nine of those rows were `TBD` and unclickable, so
 *   what could not be used was hiding what could.
 *
 *   The row was 4px wider on each side than the mandala header below it. The
 *   two button class strings were byte-identical; the difference was the
 *   wrapper — the mandala section sits inside a `px-1` nav as well as its own
 *   `px-1`. Comparing class strings alone would let that back in.
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

/** Production today: one brief published, nine not. */
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

describe('the sidebar row', () => {
  it('shows one row, not ten', async () => {
    renderEntry();
    await screen.findByText('브리프');
    // Nothing else is rendered until the popover opens; that is the whole
    // point of the change.
    expect(screen.queryByText('AI 엔지니어링')).toBeNull();
    expect(screen.queryByText('개발')).toBeNull();
    expect(screen.queryAllByText('TBD')).toHaveLength(0);
  });

  it('carries the unread total on the row', async () => {
    renderEntry();
    // The count arrives with the query, not with the first paint.
    expect(await screen.findByText('1')).toBeTruthy();
    expect(screen.getByText('브리프').closest('button')).toBeTruthy();
  });

  it('offsets itself to match the mandala header below it', async () => {
    renderEntry();
    const btn = (await screen.findByText('브리프')).closest('button')!;
    // The mandala section gets `px-1` twice (its nav, then its own div). This
    // one is outside that nav, so it needs the extra inset itself. Without it
    // the hover box is 4px wider on each side -- visible, and reported.
    expect(btn.className).toContain('mx-1');
    expect(btn.className).toContain('w-[calc(100%-0.5rem)]');
    // The rest of the metrics are the mandala header's, unchanged.
    for (const c of ['px-1.5', 'py-2', 'rounded-lg', 'text-[13px]', 'font-bold']) {
      expect(btn.className).toContain(c);
    }
  });

  it('renders nothing on the collapsed rail', () => {
    const { container } = renderEntry(true);
    expect(container.firstChild).toBeNull();
  });
});

describe('the popover', () => {
  it('lists all ten once opened', async () => {
    renderEntry();
    fireEvent.click(await screen.findByText('브리프'));
    await screen.findByText('AI 엔지니어링');
    for (const c of TEN) expect(screen.getByText(c.label)).toBeTruthy();
  });

  it('badges the nine with nothing published and makes them unclickable', async () => {
    renderEntry();
    fireEvent.click(await screen.findByText('브리프'));
    await screen.findByText('AI 엔지니어링');

    expect(screen.getAllByText('TBD')).toHaveLength(9);
    const dev = screen.getByText('개발').closest('button')!;
    expect(dev.hasAttribute('disabled')).toBe(true);
    fireEvent.click(dev);
    expect(navigateMock).not.toHaveBeenCalled();
    expect(subscribeMock).not.toHaveBeenCalled();
  });

  it('opens a subscribed brief at its card grid', async () => {
    renderEntry();
    fireEvent.click(await screen.findByText('브리프'));
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
    fireEvent.click(await screen.findByText('브리프'));
    fireEvent.click(await screen.findByText('AI 엔지니어링'));
    await waitFor(() => expect(subscribeMock).toHaveBeenCalledWith('ai-tech'));
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/brief/c/ai-tech'));
  });

  it('marks a fully-read subscription with the on-dot rather than a count', async () => {
    subscribedMock.mockResolvedValue({
      status: 'ok',
      data: { issues: [issue('ai-tech', 'a', true)], unread: 0 },
    });
    renderEntry();
    fireEvent.click(await screen.findByText('브리프'));
    await screen.findByText('AI 엔지니어링');
    expect(screen.getByLabelText('구독 중')).toBeTruthy();
  });
});
