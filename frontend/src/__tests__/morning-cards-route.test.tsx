import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ fetchMorningCardsStatus: vi.fn() }));

vi.mock('@/features/morning-cards/api', async (orig) => {
  const actual = await orig<typeof import('@/features/morning-cards/api')>();
  return { ...actual, fetchMorningCardsStatus: mocks.fetchMorningCardsStatus };
});
vi.mock('@/features/morning-cards/MorningCardsPage', () => ({
  MorningCardsPage: () => <div data-testid="morning-page" />,
}));

import { MorningCardsRoute } from '@/features/morning-cards/MorningCardsRoute';
import { isPathAllowedOnMobile } from '@/shared/lib/mobile-gate';

describe('MorningCardsRoute', () => {
  beforeEach(() => {
    mocks.fetchMorningCardsStatus.mockReset();
  });

  it('does not render the page when the flag is off', async () => {
    mocks.fetchMorningCardsStatus.mockResolvedValue({ enabled: false });
    render(<MorningCardsRoute />);
    await waitFor(() => expect(mocks.fetchMorningCardsStatus).toHaveBeenCalled());
    expect(screen.queryByTestId('morning-page')).toBeNull();
  });

  it('does not render the page when the status call fails', async () => {
    mocks.fetchMorningCardsStatus.mockImplementation(() => Promise.reject(new Error('x')));
    render(<MorningCardsRoute />);
    await waitFor(() => expect(mocks.fetchMorningCardsStatus).toHaveBeenCalled());
    expect(screen.queryByTestId('morning-page')).toBeNull();
  });

  it('renders the page when the flag is on', async () => {
    mocks.fetchMorningCardsStatus.mockResolvedValue({ enabled: true });
    render(<MorningCardsRoute />);
    expect(await screen.findByTestId('morning-page')).toBeTruthy();
  });

  it('lets the morning cards path through the mobile gate', () => {
    expect(isPathAllowedOnMobile('/morning-cards')).toBe(true);
  });
});
