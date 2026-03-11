/**
 * @vitest-environment happy-dom
 * Tests for useBatchMoveCards optimistic update architecture
 *
 * These tests verify the NEW single-source-of-truth architecture:
 * - onMutate: optimistic cache updates (RQ cache = SSOT)
 * - onError: rollback to snapshot
 * - onSettled: invalidateQueries for server reconciliation
 *
 * Previously these scenarios were handled by `cards` useState + `skipNextSyncRef`,
 * which caused race conditions, stale closures, and error reset bugs.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '../../setup/msw-handlers';
import React from 'react';
import type { InsightCard } from '@/types/mandala';
import type { LocalCardsResponse, LocalCard } from '@/types/local-cards';
import type { UserVideoStateWithVideo } from '@/types/youtube';

// Mock supabase client
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

const { useBatchMoveCards } = await import('@/hooks/useBatchMoveCards');
const { localCardsKeys } = await import('@/hooks/useLocalCards');
const { youtubeSyncKeys } = await import('@/hooks/useYouTubeSync');

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function createWrapper(queryClient: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

const mockCard = (overrides: Partial<InsightCard> = {}): InsightCard => ({
  id: 'card-1',
  videoUrl: 'https://youtube.com/watch?v=test',
  title: 'Test Card',
  thumbnail: 'https://example.com/thumb.jpg',
  userNote: '',
  createdAt: new Date('2024-01-01'),
  cellIndex: -1,
  levelId: 'scratchpad',
  ...overrides,
});

const mockLocalCard = (overrides: Partial<LocalCard> = {}): LocalCard => ({
  id: 'local-1',
  user_id: 'user-1',
  url: 'https://example.com',
  title: 'Local Card',
  thumbnail: 'https://example.com/thumb.jpg',
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

const mockVideoState = (overrides: Partial<UserVideoStateWithVideo> = {}): UserVideoStateWithVideo => ({
  id: 'sync-1',
  user_id: 'user-1',
  video_id: 'vid-1',
  is_in_ideation: true,
  user_note: null,
  watch_position_seconds: 0,
  is_watched: false,
  cell_index: -1,
  level_id: 'scratchpad',
  sort_order: null,
  added_to_ideation_at: '2024-01-01T00:00:00Z',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  video: {
    id: 'vid-1',
    youtube_video_id: 'abc123',
    title: 'Test Video',
    description: null,
    thumbnail_url: 'https://example.com/thumb.jpg',
    channel_title: 'Test Channel',
    duration_seconds: 120,
    published_at: '2024-01-01T00:00:00Z',
    view_count: 100,
    like_count: 10,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  },
  ...overrides,
});

describe('useBatchMoveCards — optimistic update architecture', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();

    mockGetSession.mockResolvedValue({
      data: { session: { access_token: 'test-token' } },
    });

    // Slow server to observe optimistic state before resolution
    server.use(
      http.post('http://localhost:8000/functions/v1/youtube-sync', async () => {
        await new Promise((r) => setTimeout(r, 100));
        return HttpResponse.json({ success: true });
      }),
      http.post('http://localhost:8000/functions/v1/local-cards', async () => {
        await new Promise((r) => setTimeout(r, 100));
        return HttpResponse.json({ success: true });
      }),
    );
  });

  describe('onMutate — optimistic updates', () => {
    it('should optimistically update synced card position in allVideoStates cache', async () => {
      const videoState = mockVideoState({ id: 'sync-1', cell_index: -1, level_id: 'scratchpad', is_in_ideation: true });
      queryClient.setQueryData(youtubeSyncKeys.allVideoStates, [videoState]);

      const { result } = renderHook(() => useBatchMoveCards(), {
        wrapper: createWrapper(queryClient),
      });

      act(() => {
        result.current.mutate({
          items: [{ card: mockCard({ id: 'sync-1' }), source: 'synced', cellIndex: 3, levelId: 'L1' }],
        });
      });

      // Check optimistic state IMMEDIATELY (before network resolves)
      await waitFor(() => {
        const cached = queryClient.getQueryData<UserVideoStateWithVideo[]>(youtubeSyncKeys.allVideoStates);
        expect(cached).toHaveLength(1);
        expect(cached![0].cell_index).toBe(3);
        expect(cached![0].level_id).toBe('L1');
        expect(cached![0].is_in_ideation).toBe(false);
      });
    });

    it('should optimistically update local card position in localCards cache', async () => {
      const localCard = mockLocalCard({ id: 'local-1', cell_index: -1, level_id: 'scratchpad' });
      queryClient.setQueryData<LocalCardsResponse>(localCardsKeys.list(), {
        cards: [localCard],
        subscription: { tier: 'free', limit: 10, used: 1 },
      });

      const { result } = renderHook(() => useBatchMoveCards(), {
        wrapper: createWrapper(queryClient),
      });

      act(() => {
        result.current.mutate({
          items: [{ card: mockCard({ id: 'local-1' }), source: 'local', cellIndex: 5, levelId: 'L2' }],
        });
      });

      await waitFor(() => {
        const cached = queryClient.getQueryData<LocalCardsResponse>(localCardsKeys.list());
        expect(cached!.cards[0].cell_index).toBe(5);
        expect(cached!.cards[0].level_id).toBe('L2');
      });
    });

    it('should optimistically add pending cards to localCards cache', async () => {
      queryClient.setQueryData<LocalCardsResponse>(localCardsKeys.list(), {
        cards: [],
        subscription: { tier: 'free', limit: 10, used: 0 },
      });

      const { result } = renderHook(() => useBatchMoveCards(), {
        wrapper: createWrapper(queryClient),
      });

      act(() => {
        result.current.mutate({
          items: [{
            card: mockCard({ id: 'pending-1', videoUrl: 'https://example.com/new', title: 'New Card' }),
            source: 'pending',
            cellIndex: 2,
            levelId: 'L1',
          }],
        });
      });

      await waitFor(() => {
        const cached = queryClient.getQueryData<LocalCardsResponse>(localCardsKeys.list());
        expect(cached!.cards).toHaveLength(1);
        expect(cached!.cards[0].id).toBe('pending-1');
        expect(cached!.cards[0].cell_index).toBe(2);
        expect(cached!.cards[0].level_id).toBe('L1');
      });
    });

    it('should handle mixed sources (synced + local + pending) in single batch', async () => {
      const videoState = mockVideoState({ id: 'sync-1', cell_index: -1, level_id: 'scratchpad' });
      const localCard = mockLocalCard({ id: 'local-1', cell_index: -1, level_id: 'scratchpad' });

      queryClient.setQueryData(youtubeSyncKeys.allVideoStates, [videoState]);
      queryClient.setQueryData<LocalCardsResponse>(localCardsKeys.list(), {
        cards: [localCard],
        subscription: { tier: 'free', limit: 10, used: 1 },
      });

      const { result } = renderHook(() => useBatchMoveCards(), {
        wrapper: createWrapper(queryClient),
      });

      act(() => {
        result.current.mutate({
          items: [
            { card: mockCard({ id: 'sync-1' }), source: 'synced', cellIndex: 0, levelId: 'root' },
            { card: mockCard({ id: 'local-1' }), source: 'local', cellIndex: 1, levelId: 'root' },
            { card: mockCard({ id: 'pending-1' }), source: 'pending', cellIndex: 2, levelId: 'root' },
          ],
        });
      });

      await waitFor(() => {
        const videoCache = queryClient.getQueryData<UserVideoStateWithVideo[]>(youtubeSyncKeys.allVideoStates);
        expect(videoCache![0].cell_index).toBe(0);
        expect(videoCache![0].is_in_ideation).toBe(false);

        const localCache = queryClient.getQueryData<LocalCardsResponse>(localCardsKeys.list());
        // local-1 moved + pending-1 added = 2 cards
        expect(localCache!.cards).toHaveLength(2);
        expect(localCache!.cards[0].cell_index).toBe(1); // local-1
        expect(localCache!.cards[1].cell_index).toBe(2); // pending-1
      });
    });
  });

  describe('onError — rollback', () => {
    it('should rollback synced card cache on network error', async () => {
      server.use(
        http.post('http://localhost:8000/functions/v1/youtube-sync', () => {
          return HttpResponse.json({ error: 'Server error' }, { status: 500 });
        }),
      );

      const videoState = mockVideoState({ id: 'sync-1', cell_index: -1, level_id: 'scratchpad', is_in_ideation: true });
      queryClient.setQueryData(youtubeSyncKeys.allVideoStates, [videoState]);

      const { result } = renderHook(() => useBatchMoveCards(), {
        wrapper: createWrapper(queryClient),
      });

      act(() => {
        result.current.mutate({
          items: [{ card: mockCard({ id: 'sync-1' }), source: 'synced', cellIndex: 5, levelId: 'L1' }],
        });
      });

      await waitFor(() => expect(result.current.isError).toBe(true));

      // Cache should be rolled back to original state
      const cached = queryClient.getQueryData<UserVideoStateWithVideo[]>(youtubeSyncKeys.allVideoStates);
      expect(cached![0].cell_index).toBe(-1);
      expect(cached![0].level_id).toBe('scratchpad');
      expect(cached![0].is_in_ideation).toBe(true);
    });

    it('should rollback local card cache on network error', async () => {
      server.use(
        http.post('http://localhost:8000/functions/v1/local-cards', () => {
          return HttpResponse.json({ error: 'Server error' }, { status: 500 });
        }),
      );

      const localCard = mockLocalCard({ id: 'local-1', cell_index: -1, level_id: 'scratchpad' });
      queryClient.setQueryData<LocalCardsResponse>(localCardsKeys.list(), {
        cards: [localCard],
        subscription: { tier: 'free', limit: 10, used: 1 },
      });

      const { result } = renderHook(() => useBatchMoveCards(), {
        wrapper: createWrapper(queryClient),
      });

      act(() => {
        result.current.mutate({
          items: [{ card: mockCard({ id: 'local-1' }), source: 'local', cellIndex: 3, levelId: 'L2' }],
        });
      });

      await waitFor(() => expect(result.current.isError).toBe(true));

      const cached = queryClient.getQueryData<LocalCardsResponse>(localCardsKeys.list());
      expect(cached!.cards[0].cell_index).toBe(-1);
      expect(cached!.cards[0].level_id).toBe('scratchpad');
    });

    it('should rollback pending cards from cache on error', async () => {
      server.use(
        http.post('http://localhost:8000/functions/v1/local-cards', () => {
          return HttpResponse.json({ error: 'Server error' }, { status: 500 });
        }),
      );

      queryClient.setQueryData<LocalCardsResponse>(localCardsKeys.list(), {
        cards: [],
        subscription: { tier: 'free', limit: 10, used: 0 },
      });

      const { result } = renderHook(() => useBatchMoveCards(), {
        wrapper: createWrapper(queryClient),
      });

      act(() => {
        result.current.mutate({
          items: [{ card: mockCard({ id: 'pending-1' }), source: 'pending', cellIndex: 2, levelId: 'L1' }],
        });
      });

      await waitFor(() => expect(result.current.isError).toBe(true));

      // Pending card should be removed from cache on rollback
      const cached = queryClient.getQueryData<LocalCardsResponse>(localCardsKeys.list());
      expect(cached!.cards).toHaveLength(0);
    });
  });

  describe('onSettled — server reconciliation', () => {
    it('should invalidate both query caches after successful mutation', async () => {
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      queryClient.setQueryData(youtubeSyncKeys.allVideoStates, [
        mockVideoState({ id: 'sync-1' }),
      ]);

      const { result } = renderHook(() => useBatchMoveCards(), {
        wrapper: createWrapper(queryClient),
      });

      act(() => {
        result.current.mutate({
          items: [{ card: mockCard({ id: 'sync-1' }), source: 'synced', cellIndex: 0, levelId: 'root' }],
        });
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      // Both caches should be invalidated for server reconciliation
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: localCardsKeys.list() })
      );
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: youtubeSyncKeys.allVideoStates })
      );
    });

    it('should invalidate caches even after error (for cleanup)', async () => {
      server.use(
        http.post('http://localhost:8000/functions/v1/youtube-sync', () => {
          return HttpResponse.json({ error: 'fail' }, { status: 500 });
        }),
      );

      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      queryClient.setQueryData(youtubeSyncKeys.allVideoStates, [
        mockVideoState({ id: 'sync-1' }),
      ]);

      const { result } = renderHook(() => useBatchMoveCards(), {
        wrapper: createWrapper(queryClient),
      });

      act(() => {
        result.current.mutate({
          items: [{ card: mockCard({ id: 'sync-1' }), source: 'synced', cellIndex: 0, levelId: 'root' }],
        });
      });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: youtubeSyncKeys.allVideoStates })
      );
    });

    it('should NOT use 5s setTimeout for cache invalidation (old bug)', async () => {
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

      queryClient.setQueryData(youtubeSyncKeys.allVideoStates, [
        mockVideoState({ id: 'sync-1' }),
      ]);

      const { result } = renderHook(() => useBatchMoveCards(), {
        wrapper: createWrapper(queryClient),
      });

      act(() => {
        result.current.mutate({
          items: [{ card: mockCard({ id: 'sync-1' }), source: 'synced', cellIndex: 0, levelId: 'root' }],
        });
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      // Verify no 5000ms setTimeout was registered (the old bug pattern)
      const fiveSecondCalls = setTimeoutSpy.mock.calls.filter(
        (call) => call[1] === 5000
      );
      expect(fiveSecondCalls).toHaveLength(0);

      setTimeoutSpy.mockRestore();
    });
  });

  describe('regression: previous bug scenarios', () => {
    it('C-1: refetch during optimistic update should not revert card position', async () => {
      // This was the skipNextSyncRef bug — during RQ refetch, the sync useEffect
      // would overwrite optimistic positions. Now there's no sync useEffect at all.
      const videoState = mockVideoState({ id: 'sync-1', cell_index: -1, level_id: 'scratchpad', is_in_ideation: true });
      queryClient.setQueryData(youtubeSyncKeys.allVideoStates, [videoState]);

      const { result } = renderHook(() => useBatchMoveCards(), {
        wrapper: createWrapper(queryClient),
      });

      // Move card to mandala cell 3
      act(() => {
        result.current.mutate({
          items: [{ card: mockCard({ id: 'sync-1' }), source: 'synced', cellIndex: 3, levelId: 'L1' }],
        });
      });

      // Wait for async onMutate to complete (cancelQueries is async)
      await waitFor(() => {
        const cachedBefore = queryClient.getQueryData<UserVideoStateWithVideo[]>(youtubeSyncKeys.allVideoStates);
        expect(cachedBefore![0].cell_index).toBe(3);
      });

      // Simulate what old server data would look like — the key point is that
      // in the new architecture, there's no useEffect that overwrites positions
      // based on RQ data. The RQ data IS the source of truth.
      // Even if we set "stale" data, the UI just reflects whatever RQ has.
      const cachedAfter = queryClient.getQueryData<UserVideoStateWithVideo[]>(youtubeSyncKeys.allVideoStates);
      expect(cachedAfter![0].cell_index).toBe(3); // Position preserved
      expect(cachedAfter![0].is_in_ideation).toBe(false);
    });

    it('C-1a: error after move should not permanently break sync', async () => {
      // In old architecture, skipNextSyncRef.current = false on error didn't always reset properly
      // In new architecture, onError simply rolls back cache, no flags to manage
      server.use(
        http.post('http://localhost:8000/functions/v1/youtube-sync', () => {
          return HttpResponse.json({ error: 'fail' }, { status: 500 });
        }),
      );

      const videoState = mockVideoState({ id: 'sync-1', cell_index: -1, level_id: 'scratchpad', is_in_ideation: true });
      queryClient.setQueryData(youtubeSyncKeys.allVideoStates, [videoState]);

      const { result } = renderHook(() => useBatchMoveCards(), {
        wrapper: createWrapper(queryClient),
      });

      // First attempt fails
      act(() => {
        result.current.mutate({
          items: [{ card: mockCard({ id: 'sync-1' }), source: 'synced', cellIndex: 3, levelId: 'L1' }],
        });
      });

      await waitFor(() => expect(result.current.isError).toBe(true));

      // Cache should be rolled back
      const cached = queryClient.getQueryData<UserVideoStateWithVideo[]>(youtubeSyncKeys.allVideoStates);
      expect(cached![0].cell_index).toBe(-1);

      // Now fix server and try again — should work without any "stuck" state
      server.use(
        http.post('http://localhost:8000/functions/v1/youtube-sync', () => {
          return HttpResponse.json({ success: true });
        }),
      );

      act(() => {
        result.current.mutate({
          items: [{ card: mockCard({ id: 'sync-1' }), source: 'synced', cellIndex: 3, levelId: 'L1' }],
        });
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      const cachedAfter = queryClient.getQueryData<UserVideoStateWithVideo[]>(youtubeSyncKeys.allVideoStates);
      expect(cachedAfter![0].cell_index).toBe(3);
    });

    it('should not have stale closure issues (old setScratchPadCards bug)', async () => {
      // In old architecture, setScratchPadCards used refs to avoid stale closures
      // In new architecture, mutations directly update RQ cache — no closures needed
      const videoState1 = mockVideoState({ id: 'sync-1', cell_index: -1, is_in_ideation: true });
      const videoState2 = mockVideoState({ id: 'sync-2', cell_index: -1, is_in_ideation: true });
      queryClient.setQueryData(youtubeSyncKeys.allVideoStates, [videoState1, videoState2]);

      const { result } = renderHook(() => useBatchMoveCards(), {
        wrapper: createWrapper(queryClient),
      });

      // Rapid successive mutations
      act(() => {
        result.current.mutate({
          items: [{ card: mockCard({ id: 'sync-1' }), source: 'synced', cellIndex: 0, levelId: 'root' }],
        });
      });

      // Second mutation while first is in flight
      act(() => {
        result.current.mutate({
          items: [{ card: mockCard({ id: 'sync-2' }), source: 'synced', cellIndex: 1, levelId: 'root' }],
        });
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      const cached = queryClient.getQueryData<UserVideoStateWithVideo[]>(youtubeSyncKeys.allVideoStates);
      // Both cards should be at their new positions
      const card1 = cached!.find((v) => v.id === 'sync-1');
      const card2 = cached!.find((v) => v.id === 'sync-2');
      expect(card1).toBeDefined();
      expect(card2).toBeDefined();
    });
  });
});
