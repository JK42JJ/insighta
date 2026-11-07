import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ fetchMorningCardsReview: vi.fn(), patchReasonTags: vi.fn() }));

vi.mock('@/features/morning-cards/api', async (orig) => {
  const actual = await orig<typeof import('@/features/morning-cards/api')>();
  return {
    ...actual,
    fetchMorningCardsReview: mocks.fetchMorningCardsReview,
    patchReasonTags: mocks.patchReasonTags,
  };
});

import { MorningCardsReviewPage } from '@/features/morning-cards/MorningCardsReviewPage';

const ITEM = {
  video_id: 'abcdefghijk',
  title: '<script>alert(1)</script> title',
  channel_name: 'Chan',
  published_at: '2026-03-04T00:00:00Z',
  thumbnail_url: null,
  reason: 'why',
  position: 0,
  verdict: 'useful' as const,
  reason_tags: [] as never[],
};

describe('MorningCardsReviewPage', () => {
  beforeEach(() => {
    mocks.fetchMorningCardsReview.mockReset();
    mocks.patchReasonTags.mockReset();
    mocks.patchReasonTags.mockResolvedValue(undefined);
  });

  it('shows title, channel, date and verdict, escaping the title', async () => {
    mocks.fetchMorningCardsReview.mockResolvedValue({
      domain: 'work_practice',
      items: [ITEM],
      shortage: false,
    });
    const { container } = render(<MorningCardsReviewPage />);
    expect(await screen.findByText(ITEM.title)).toBeTruthy();
    expect(screen.getByText('Chan')).toBeTruthy();
    expect(screen.getByTestId('morning-review-date').textContent).toBe('2026-03-04');
    expect(screen.getByTestId('morning-review-verdict').textContent).toBe('유용함');
    expect(container.querySelector('script')).toBeNull();
  });

  it('selecting a tag calls the PATCH client', async () => {
    mocks.fetchMorningCardsReview.mockResolvedValue({
      domain: 'work_practice',
      items: [ITEM],
      shortage: false,
    });
    render(<MorningCardsReviewPage />);
    await screen.findByTestId('morning-review-row');
    fireEvent.click(screen.getByRole('button', { name: 'outdated' }));
    await waitFor(() =>
      expect(mocks.patchReasonTags).toHaveBeenCalledWith({
        video_id: 'abcdefghijk',
        domain: 'work_practice',
        reason_tags: ['outdated'],
      })
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'outdated' }).getAttribute('aria-pressed')).toBe(
        'true'
      )
    );
  });

  it('shows the honest message and no rows when empty', async () => {
    mocks.fetchMorningCardsReview.mockResolvedValue({
      domain: 'work_practice',
      items: [],
      shortage: true,
    });
    render(<MorningCardsReviewPage />);
    expect(await screen.findByTestId('morning-review-empty')).toBeTruthy();
    expect(screen.queryAllByTestId('morning-review-row')).toHaveLength(0);
  });
});
