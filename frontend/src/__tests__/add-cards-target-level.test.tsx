/**
 * Regression (2026-11-11): the add-cards panel appended the raw level value ('foundation' /
 * 'advanced') to the search keywords, so an English token ended up in the YouTube query. The
 * level now goes as its own `targetLevel` field and the keywords stay as the user typed them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { useAddCards } from '@/widgets/add-cards-panel/model/useAddCards';

const addCards = vi.fn();

vi.mock('@/shared/lib/api-client', () => ({
  apiClient: { addCards: (...args: unknown[]) => addCards(...args) },
}));

const EMPTY_RESPONSE = {
  status: 'ok',
  data: {
    cards: [],
    mandalaMeta: { title: 't', focusTags: [], targetLevel: 'standard', language: 'ko' },
    roundId: 'r',
    roundAt: '2026-11-11T00:00:00Z',
  },
};

function wrapper({ children }: { children: ReactNode }): JSX.Element {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('add-cards request carries the level as its own field', () => {
  beforeEach(() => {
    addCards.mockReset();
    addCards.mockResolvedValue(EMPTY_RESPONSE);
  });

  it('sends targetLevel separately and leaves the keywords untouched', async () => {
    const { result } = renderHook(() => useAddCards(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        mandalaId: '00000000-0000-0000-0000-000000000001',
        extraKeywords: ['자동화'],
        excludeVideoIds: [],
        targetLevel: 'foundation',
      });
    });
    expect(addCards).toHaveBeenCalledTimes(1);
    const body = addCards.mock.calls[0][1] as { extraKeywords: string[]; targetLevel?: string };
    expect(body.extraKeywords).toEqual(['자동화']);
    expect(body.targetLevel).toBe('foundation');
  });

  it('omits targetLevel when none is chosen', async () => {
    const { result } = renderHook(() => useAddCards(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        mandalaId: '00000000-0000-0000-0000-000000000001',
        extraKeywords: [],
        excludeVideoIds: [],
      });
    });
    const body = addCards.mock.calls[0][1] as Record<string, unknown>;
    expect('targetLevel' in body).toBe(false);
  });
});
