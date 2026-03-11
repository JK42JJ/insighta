/**
 * @vitest-environment happy-dom
 * Tests for useUpdateLocalCard optimistic position updates
 *
 * Verifies: isPositionChange guard was removed — position changes
 * (cell_index, level_id) are now optimistically applied via onMutate.
 * Also verifies onSettled invalidates queries.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '../../setup/msw-handlers';
import React from 'react';
import type { LocalCardsResponse, LocalCard } from '@/types/local-cards';

const mockGetSession = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: () => mockGetSession(),
      refreshSession: () => Promise.resolve({ data: { session: null }, error: null }),
    },
  },
}));

vi.stubEnv('VITE_SUPABASE_URL', 'http://localhost:8000');
vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'test-anon-key');

const { useUpdateLocalCard, localCardsKeys } = await import('@/hooks/useLocalCards');

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function createWrapper(qc: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

const mockLocalCard = (overrides: Partial<LocalCard> = {}): LocalCard => ({
  id: 'local-1',
  user_id: 'user-1',
  url: 'https://example.com',
  title: 'Card',
  thumbnail: null,
  link_type: 'other',
  user_note: null,
  metadata_title: null,
  metadata_description: null,
  metadata_image: null,
  cell_index: -1,
  level_id: 'scratchpad',
  sort_order: null,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  ...overrides,
});

describe('useUpdateLocalCard — position optimistic updates', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: 'test-token' } },
    });

    server.use(
      http.post('http://localhost:8000/functions/v1/local-cards', async ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get('action') === 'update') {
          await new Promise((r) => setTimeout(r, 50));
          const body = await request.json() as Record<string, unknown>;
          return HttpResponse.json({
            card: { ...mockLocalCard(), ...body },
          });
        }
        return HttpResponse.json({ error: 'Unknown' }, { status: 400 });
      }),
    );
  });

  it('should optimistically update position (cell_index + level_id) in cache', async () => {
    const card = mockLocalCard({ id: 'local-1', cell_index: -1, level_id: 'scratchpad' });
    queryClient.setQueryData<LocalCardsResponse>(localCardsKeys.list(), {
      cards: [card],
      subscription: { tier: 'free', limit: 10, used: 1 },
    });

    const { result } = renderHook(() => useUpdateLocalCard(), {
      wrapper: createWrapper(queryClient),
    });

    act(() => {
      result.current.mutate({ id: 'local-1', cell_index: 3, level_id: 'L1' });
    });

    // Check IMMEDIATELY — before network response
    await waitFor(() => {
      const cached = queryClient.getQueryData<LocalCardsResponse>(localCardsKeys.list());
      expect(cached!.cards[0].cell_index).toBe(3);
      expect(cached!.cards[0].level_id).toBe('L1');
    });
  });

  it('should optimistically update user_note in cache', async () => {
    const card = mockLocalCard({ id: 'local-1', user_note: null });
    queryClient.setQueryData<LocalCardsResponse>(localCardsKeys.list(), {
      cards: [card],
      subscription: { tier: 'free', limit: 10, used: 1 },
    });

    const { result } = renderHook(() => useUpdateLocalCard(), {
      wrapper: createWrapper(queryClient),
    });

    act(() => {
      result.current.mutate({ id: 'local-1', user_note: 'My note' });
    });

    await waitFor(() => {
      const cached = queryClient.getQueryData<LocalCardsResponse>(localCardsKeys.list());
      expect(cached!.cards[0].user_note).toBe('My note');
    });
  });

  it('should rollback on error', async () => {
    server.use(
      http.post('http://localhost:8000/functions/v1/local-cards', () => {
        return HttpResponse.json({ error: 'fail' }, { status: 500 });
      }),
    );

    const card = mockLocalCard({ id: 'local-1', cell_index: -1, level_id: 'scratchpad' });
    queryClient.setQueryData<LocalCardsResponse>(localCardsKeys.list(), {
      cards: [card],
      subscription: { tier: 'free', limit: 10, used: 1 },
    });

    const { result } = renderHook(() => useUpdateLocalCard(), {
      wrapper: createWrapper(queryClient),
    });

    act(() => {
      result.current.mutate({ id: 'local-1', cell_index: 5, level_id: 'L2' });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    const cached = queryClient.getQueryData<LocalCardsResponse>(localCardsKeys.list());
    expect(cached!.cards[0].cell_index).toBe(-1);
    expect(cached!.cards[0].level_id).toBe('scratchpad');
  });

  it('should invalidate queries on settled (onSettled)', async () => {
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const card = mockLocalCard({ id: 'local-1' });
    queryClient.setQueryData<LocalCardsResponse>(localCardsKeys.list(), {
      cards: [card],
      subscription: { tier: 'free', limit: 10, used: 1 },
    });

    const { result } = renderHook(() => useUpdateLocalCard(), {
      wrapper: createWrapper(queryClient),
    });

    act(() => {
      result.current.mutate({ id: 'local-1', user_note: 'test' });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: localCardsKeys.list() })
    );
  });

  it('regression: position changes should NOT be skipped (old isPositionChange guard)', async () => {
    // In the old code, position changes were skipped in onMutate:
    //   const isPositionChange = 'cell_index' in payload || 'level_id' in payload;
    //   if (previous && !isPositionChange) { ... }
    // This meant position changes had no optimistic update!
    const card = mockLocalCard({ id: 'local-1', cell_index: 0, level_id: 'root' });
    queryClient.setQueryData<LocalCardsResponse>(localCardsKeys.list(), {
      cards: [card],
      subscription: { tier: 'free', limit: 10, used: 1 },
    });

    const { result } = renderHook(() => useUpdateLocalCard(), {
      wrapper: createWrapper(queryClient),
    });

    // Move to a different cell
    act(() => {
      result.current.mutate({ id: 'local-1', cell_index: 7, level_id: 'L3' });
    });

    // In old code this would still be at cell 0 / root
    // In new code it should be at 7 / L3 immediately
    await waitFor(() => {
      const cached = queryClient.getQueryData<LocalCardsResponse>(localCardsKeys.list());
      expect(cached!.cards[0].cell_index).toBe(7);
      expect(cached!.cards[0].level_id).toBe('L3');
    });
  });
});
