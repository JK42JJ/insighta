import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock IndexedDB with a simple in-memory store
function createMockIDB() {
  let store: Map<number, unknown> = new Map();
  let autoId = 0;

  const mockObjectStore = (_mode: string) => ({
    add(item: unknown) {
      const id = ++autoId;
      store.set(id, { ...item as Record<string, unknown>, id });
      const req = { result: id, onsuccess: null as (() => void) | null, onerror: null as (() => void) | null };
      setTimeout(() => req.onsuccess?.(), 0);
      return req;
    },
    getAll() {
      const req = {
        result: Array.from(store.values()),
        onsuccess: null as (() => void) | null,
        onerror: null as (() => void) | null,
      };
      setTimeout(() => req.onsuccess?.(), 0);
      return req;
    },
    delete(id: number) {
      store.delete(id);
      const req = { onsuccess: null as (() => void) | null, onerror: null as (() => void) | null };
      setTimeout(() => req.onsuccess?.(), 0);
      return req;
    },
  });

  const mockTransaction = (_storeName: string, mode: string) => {
    const tx = {
      objectStore: () => mockObjectStore(mode),
      oncomplete: null as (() => void) | null,
      onerror: null as (() => void) | null,
      error: null,
    };
    setTimeout(() => tx.oncomplete?.(), 0);
    return tx;
  };

  const mockDB = {
    transaction: mockTransaction,
    objectStoreNames: { contains: () => true },
    createObjectStore: vi.fn(),
  };

  const mockOpen = {
    result: mockDB,
    onsuccess: null as (() => void) | null,
    onerror: null as (() => void) | null,
    onupgradeneeded: null as (() => void) | null,
  };

  // Simulate async open
  const originalOpen = vi.fn(() => {
    setTimeout(() => {
      mockOpen.onupgradeneeded?.();
      mockOpen.onsuccess?.();
    }, 0);
    return mockOpen;
  });

  return {
    open: originalOpen,
    reset() {
      store = new Map();
      autoId = 0;
    },
  };
}

const mockIDB = createMockIDB();

vi.stubGlobal('indexedDB', { open: mockIDB.open });

// Import after mocking
const { enqueue, getAll, remove, flushQueue } = await import(
  '@shared/lib/offline-queue'
);

describe('offline-queue', () => {
  beforeEach(() => {
    mockIDB.reset();
    vi.restoreAllMocks();
  });

  describe('enqueue', () => {
    it('adds a mutation to the queue', async () => {
      await enqueue({ url: '/api/test', method: 'POST', body: '{}' });
      const items = await getAll();
      expect(items.length).toBeGreaterThanOrEqual(1);
    });

    it('adds createdAt timestamp', async () => {
      const before = Date.now();
      await enqueue({ url: '/api/test', method: 'PUT' });
      const items = await getAll();
      const item = items[items.length - 1];
      expect(item.createdAt).toBeGreaterThanOrEqual(before);
    });
  });

  describe('getAll', () => {
    it('returns empty array when queue is empty', async () => {
      const items = await getAll();
      expect(items).toEqual([]);
    });

    it('returns all enqueued items', async () => {
      await enqueue({ url: '/api/a', method: 'POST' });
      await enqueue({ url: '/api/b', method: 'DELETE' });
      const items = await getAll();
      expect(items).toHaveLength(2);
    });
  });

  describe('remove', () => {
    it('removes a specific mutation by id', async () => {
      await enqueue({ url: '/api/test', method: 'POST' });
      const items = await getAll();
      const id = items[0]?.id;
      if (id != null) {
        await remove(id);
        const remaining = await getAll();
        expect(remaining.find((m) => m.id === id)).toBeUndefined();
      }
    });
  });

  describe('flushQueue', () => {
    it('returns { succeeded: 0, failed: 0 } for empty queue', async () => {
      const result = await flushQueue();
      expect(result).toEqual({ succeeded: 0, failed: 0 });
    });

    it('flushes successful mutations', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
      await enqueue({ url: '/api/test', method: 'POST', body: '{"x":1}' });
      const result = await flushQueue();
      expect(result.succeeded).toBe(1);
      expect(result.failed).toBe(0);
    });

    it('counts failed mutations', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockRejectedValue(new Error('Network error'))
      );
      await enqueue({ url: '/api/test', method: 'POST' });
      const result = await flushQueue();
      expect(result.succeeded).toBe(0);
      expect(result.failed).toBe(1);
    });

    it('calls fetch with correct params', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal('fetch', mockFetch);
      await enqueue({
        url: '/api/cards',
        method: 'POST',
        body: '{"title":"test"}',
        headers: { 'Content-Type': 'application/json' },
      });
      await flushQueue();
      expect(mockFetch).toHaveBeenCalledWith('/api/cards', {
        method: 'POST',
        body: '{"title":"test"}',
        headers: { 'Content-Type': 'application/json' },
      });
    });
  });
});
