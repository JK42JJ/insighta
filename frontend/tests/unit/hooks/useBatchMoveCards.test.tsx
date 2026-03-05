/**
 * @vitest-environment happy-dom
 * Tests for useBatchMoveCards hook
 *
 * Covers:
 * - Batching logic (synced vs local vs pending cards)
 * - Auth header retrieval
 * - Cache update on success
 * - Error handling
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '../../setup/msw-handlers';
import React from 'react';
import type { InsightCard } from '@/types/mandala';

// Track request bodies for assertions
let capturedRequests: { url: string; body: unknown }[] = [];

// Mock supabase client
const mockGetSession = vi.fn();
const mockRefreshSession = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: () => mockGetSession(),
      refreshSession: () => mockRefreshSession(),
    },
  },
}));

// Set SUPABASE_URL to match MSW base URL
vi.stubEnv('VITE_SUPABASE_URL', 'http://localhost:8000');
vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'test-anon-key');

// Import after mocks
const { useBatchMoveCards } = await import('@/hooks/useBatchMoveCards');
const { detectCardSource } = await import('@/lib/cardUtils');

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

const mockCard = (overrides: Partial<InsightCard> = {}): InsightCard => ({
  id: 'card-1',
  videoUrl: 'https://youtube.com/watch?v=test',
  title: 'Test Card',
  thumbnail: 'https://example.com/thumb.jpg',
  userNote: 'note',
  createdAt: new Date('2024-01-01'),
  cellIndex: 0,
  levelId: 'level-1',
  ...overrides,
});

describe('useBatchMoveCards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedRequests = [];

    mockRefreshSession.mockResolvedValue({ data: { session: null }, error: null });
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: 'test-token' } },
    });

    // Add MSW handlers for batch endpoints
    server.use(
      http.post('http://localhost:8000/functions/v1/youtube-sync', async ({ request }) => {
        const url = new URL(request.url);
        const action = url.searchParams.get('action');
        if (action === 'batch-update-video-state') {
          const body = await request.json();
          capturedRequests.push({ url: request.url, body });
          return HttpResponse.json({ success: true });
        }
        return HttpResponse.json({ error: 'Unknown action' }, { status: 400 });
      }),
      http.post('http://localhost:8000/functions/v1/local-cards', async ({ request }) => {
        const url = new URL(request.url);
        const action = url.searchParams.get('action');
        if (action === 'batch-move') {
          const body = await request.json();
          capturedRequests.push({ url: request.url, body });
          return HttpResponse.json({ success: true });
        }
        return HttpResponse.json({ error: 'Unknown action' }, { status: 400 });
      }),
    );
  });

  it('should send only synced batch when all cards are synced', async () => {
    const { result } = renderHook(() => useBatchMoveCards(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({
      items: [
        { card: mockCard({ id: 'sync-1' }), source: 'synced', cellIndex: 3, levelId: 'L1' },
        { card: mockCard({ id: 'sync-2' }), source: 'synced', cellIndex: 5, levelId: 'L1' },
      ],
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(capturedRequests).toHaveLength(1);
    expect(capturedRequests[0].url).toContain('youtube-sync');
    expect(capturedRequests[0].url).toContain('batch-update-video-state');
    const body = capturedRequests[0].body as { updates: { videoStateId: string }[] };
    expect(body.updates).toHaveLength(2);
    expect(body.updates[0].videoStateId).toBe('sync-1');
  });

  it('should send only local batch when all cards are local/pending', async () => {
    const { result } = renderHook(() => useBatchMoveCards(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({
      items: [
        { card: mockCard({ id: 'local-1' }), source: 'local', cellIndex: 2, levelId: 'L2' },
        { card: mockCard({ id: 'pending-1', videoUrl: 'https://test.com' }), source: 'pending', cellIndex: 4, levelId: 'L2' },
      ],
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(capturedRequests).toHaveLength(1);
    expect(capturedRequests[0].url).toContain('local-cards');
    expect(capturedRequests[0].url).toContain('batch-move');
    const body = capturedRequests[0].body as { updates: unknown[]; inserts: unknown[] };
    expect(body.updates).toHaveLength(1);
    expect(body.inserts).toHaveLength(1);
  });

  it('should send two batches for mixed card sources', async () => {
    const { result } = renderHook(() => useBatchMoveCards(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({
      items: [
        { card: mockCard({ id: 'sync-1' }), source: 'synced', cellIndex: 1, levelId: 'L1' },
        { card: mockCard({ id: 'local-1' }), source: 'local', cellIndex: 2, levelId: 'L1' },
        { card: mockCard({ id: 'pending-1' }), source: 'pending', cellIndex: 3, levelId: 'L1' },
      ],
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(capturedRequests).toHaveLength(2);
    const urls = capturedRequests.map((r) => r.url);
    expect(urls.some((u) => u.includes('youtube-sync'))).toBe(true);
    expect(urls.some((u) => u.includes('local-cards'))).toBe(true);
  });

  it('should throw when not authenticated', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });

    const { result } = renderHook(() => useBatchMoveCards(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({
      items: [{ card: mockCard(), source: 'synced', cellIndex: 0, levelId: 'L1' }],
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('Not authenticated');
  });

  it('should throw on failed fetch response', async () => {
    server.use(
      http.post('http://localhost:8000/functions/v1/youtube-sync', () => {
        return HttpResponse.json({ error: 'Server error' }, { status: 500 });
      }),
    );

    const { result } = renderHook(() => useBatchMoveCards(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({
      items: [{ card: mockCard(), source: 'synced', cellIndex: 0, levelId: 'L1' }],
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('should set is_in_ideation=true for scratchpad level', async () => {
    const { result } = renderHook(() => useBatchMoveCards(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({
      items: [{ card: mockCard(), source: 'synced', cellIndex: -1, levelId: 'scratchpad' }],
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const body = capturedRequests[0].body as { updates: { updates: { is_in_ideation: boolean; level_id: string } }[] };
    expect(body.updates[0].updates.is_in_ideation).toBe(true);
    expect(body.updates[0].updates.level_id).toBe('scratchpad');
  });

  it('should not send any fetch when items array is empty', async () => {
    const { result } = renderHook(() => useBatchMoveCards(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({ items: [] });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(capturedRequests).toHaveLength(0);
  });
});

describe('detectCardSource', () => {
  const synced = [mockCard({ id: 'sync-1' }), mockCard({ id: 'sync-2' })];
  const local = [mockCard({ id: 'local-1' })];

  it('should detect synced card', () => {
    expect(detectCardSource('sync-1', synced, local)).toBe('synced');
  });

  it('should detect local card', () => {
    expect(detectCardSource('local-1', synced, local)).toBe('local');
  });

  it('should detect pending card (not in either)', () => {
    expect(detectCardSource('unknown-id', synced, local)).toBe('pending');
  });

  it('should prioritize synced over local if card exists in both', () => {
    const dualCard = mockCard({ id: 'dual' });
    expect(detectCardSource('dual', [dualCard], [dualCard])).toBe('synced');
  });
});
