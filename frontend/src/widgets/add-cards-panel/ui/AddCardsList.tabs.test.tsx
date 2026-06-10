/**
 * T2 (CP499+, James 확정·드롭 금지) — rounds are TABS, not a scrolled stack.
 * Pins: one tab per round (newest first) / only the ACTIVE round's cards
 * render / newest round auto-activates on arrival / manual switch works.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { AddCardsList } from './AddCardsList';
import type { AddCardsRound } from '../lib/persistence';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, d: string | object) => (typeof d === 'string' ? d : _k),
  }),
}));

const card = (videoId: string) => ({
  videoId,
  title: videoId,
  channel: 'ch',
  thumbnail: null,
  durationSec: 60,
  viewCount: 10,
  publishedAt: '2026-01-01T00:00:00Z',
  score: 0.5,
  cellIndex: 0,
  source: 'realtime' as const,
});

const round = (id: string, at: string, ids: string[]): AddCardsRound => ({
  id,
  at,
  cards: ids.map(card),
});

const baseProps = {
  isLoading: false,
  isError: false,
  errorMessage: null,
  hasSearched: true,
  pickedSet: new Set<string>(),
  isPickPending: false,
  onPick: vi.fn(),
};

describe('AddCardsList — round tabs (T2)', () => {
  const rounds = [
    round('r2', '2026-06-10T12:30:00Z', ['new-a', 'new-b']), // newest first
    round('r1', '2026-06-10T12:00:00Z', ['old-a']),
  ];

  it('renders one tab per round; ONLY the newest (active) round cards show', () => {
    const { getAllByRole, queryByText, getByText } = render(
      <AddCardsList {...baseProps} rounds={rounds} />
    );
    expect(getAllByRole('tab')).toHaveLength(2);
    expect(getByText('new-a')).toBeTruthy(); // active round
    expect(queryByText('old-a')).toBeNull(); // inactive round NOT rendered
  });

  it('clicking an older tab switches the visible round', () => {
    const { getAllByRole, queryByText, getByText } = render(
      <AddCardsList {...baseProps} rounds={rounds} />
    );
    fireEvent.click(getAllByRole('tab')[1]!); // "Round 1"
    expect(getByText('old-a')).toBeTruthy();
    expect(queryByText('new-a')).toBeNull();
  });

  it('a NEW round arriving auto-activates (user just searched)', () => {
    const { rerender, getByText, queryByText } = render(
      <AddCardsList {...baseProps} rounds={rounds} />
    );
    const withNew = [round('r3', '2026-06-10T13:00:00Z', ['fresh-a']), ...rounds];
    rerender(<AddCardsList {...baseProps} rounds={withNew} />);
    expect(getByText('fresh-a')).toBeTruthy();
    expect(queryByText('new-a')).toBeNull();
  });
});
