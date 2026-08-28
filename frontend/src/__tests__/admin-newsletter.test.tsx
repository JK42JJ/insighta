/**
 * Admin → Newsletter — mounts, lists, and refuses to submit what it cannot parse.
 *
 * A type check proves the file compiles, not that the screen renders; this is
 * the difference. The submit-guard cases matter most: the register button is
 * the only way an issue reaches readers, and enabling it on unparseable text
 * turns a paste error into a server round trip that reports something vaguer
 * than "this is not JSON".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AdminNewsletter } from '@/pages/admin/ui/AdminNewsletter';

const listMock = vi.fn();
const createMock = vi.fn();

vi.mock('@/shared/lib/api-client', () => ({
  apiClient: {
    listNewsletterIssues: (...a: unknown[]) => listMock(...a),
    createNewsletterIssue: (...a: unknown[]) => createMock(...a),
    updateNewsletterIssue: vi.fn(),
    getNewsletterIssue: vi.fn(),
    deleteNewsletterIssue: vi.fn(),
  },
}));

vi.mock('@/shared/lib/use-toast', () => ({ toast: vi.fn() }));

function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <AdminNewsletter />
      </QueryClientProvider>
    </MemoryRouter>
  );
}

const ISSUE = {
  id: '23d06c76-f2eb-47cb-b195-430084b1a5c4',
  slug: '2026-08-25-ai-tech',
  category_key: 'ai-tech',
  issue_no: 1,
  template_version: 'web-v1',
  published_at: '2026-08-25T00:00:00.000Z',
  updated_at: '2026-08-26T00:00:00.000Z',
};

const DRAFT = { ...ISSUE, id: 'b'.repeat(8), slug: 'draft-one', issue_no: 2, published_at: null };

describe('AdminNewsletter', () => {
  beforeEach(() => {
    listMock.mockReset();
    createMock.mockReset();
    listMock.mockResolvedValue({ status: 'ok', data: { issues: [ISSUE, DRAFT] } });
  });

  it('lists issues with their category, template and publication state', async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByText('2026-08-25-ai-tech')).toBeTruthy());
    // Both fixtures are ai-tech, so the label appears once per row.
    expect(screen.getAllByText('AI · 기술')).toHaveLength(2);
    expect(screen.getAllByText('web-v1').length).toBe(2);
    // Published shows its date; a draft says so rather than showing nothing.
    expect(screen.getByText('2026-08-25')).toBeTruthy();
    expect(screen.getByText('초안')).toBeTruthy();
  });

  it('offers a public link only for issues that are published', async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByText('2026-08-25-ai-tech')).toBeTruthy());
    const links = screen.getAllByText('보기') as HTMLAnchorElement[];
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe('/api/v1/brief/2026-08-25-ai-tech');
  });

  it('keeps both buttons disabled until there is something to submit', async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByText('발행')).toBeTruthy());
    expect(screen.getByText('발행').closest('button')?.disabled).toBe(true);
    expect(screen.getByText('초안으로 저장').closest('button')?.disabled).toBe(true);
  });

  it('refuses unparseable text and says why', async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByPlaceholderText(/IssueDocument/)).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText(/IssueDocument/), {
      target: { value: '{ not json' },
    });
    await waitFor(() => expect(screen.getByText('JSON 이 아닙니다')).toBeTruthy());
    expect(screen.getByText('발행').closest('button')?.disabled).toBe(true);
    expect(createMock).not.toHaveBeenCalled();
  });

  it('submits the parsed document, and publishes only when publish is pressed', async () => {
    createMock.mockResolvedValue({ status: 'ok', data: { issue: { id: 'x', slug: 'new-one' } } });
    renderScreen();
    await waitFor(() => expect(screen.getByPlaceholderText(/IssueDocument/)).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText(/IssueDocument/), {
      target: { value: '{"slug":"new-one"}' },
    });

    fireEvent.click(screen.getByText('초안으로 저장'));
    await waitFor(() => expect(createMock).toHaveBeenCalledWith({ slug: 'new-one' }, false));

    createMock.mockClear();
    fireEvent.change(screen.getByPlaceholderText(/IssueDocument/), {
      target: { value: '{"slug":"new-one"}' },
    });
    fireEvent.click(screen.getByText('발행'));
    await waitFor(() => expect(createMock).toHaveBeenCalledWith({ slug: 'new-one' }, true));
  });

  it('shows the slug of whatever is currently in the box', async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByPlaceholderText(/IssueDocument/)).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText(/IssueDocument/), {
      target: { value: '{"slug":"2026-09-01-career"}' },
    });
    await waitFor(() => expect(screen.getByText('2026-09-01-career')).toBeTruthy());
  });
});
