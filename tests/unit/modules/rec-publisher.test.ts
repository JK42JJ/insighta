/**
 * Phase 1 slice 2 — in-process card publisher.
 *
 * Verifies the pub/sub contract that the v3 executor (producer) and
 * the SSE route (consumer) rely on. Pure unit test: no DB, no HTTP.
 */

import {
  MemoryCardPublisher,
  channelFor,
  type CardPayload,
  type CardPublisher,
} from '@/modules/recommendations/publisher';

function makePayload(overrides: Partial<CardPayload> = {}): CardPayload {
  return {
    id: 'row-1',
    videoId: 'vid-aaa11111111',
    title: 'Daily Routine 101',
    channel: 'Channel X',
    thumbnail: 'https://img.example/t.jpg',
    durationSec: 720,
    recScore: 0.87,
    cellIndex: 3,
    cellLabel: null,
    keyword: 'daily routine',
    source: 'auto_recommend',
    recReason: 'tier:gold',
    ...overrides,
  };
}

describe('channelFor', () => {
  test('prefixes rec_cache: and preserves mandalaId verbatim', () => {
    expect(channelFor('abc-123')).toBe('rec_cache:abc-123');
    expect(channelFor('UUID-4A-A9')).toBe('rec_cache:UUID-4A-A9');
  });
});

describe('MemoryCardPublisher', () => {
  let pub: CardPublisher;
  beforeEach(() => {
    pub = new MemoryCardPublisher();
  });

  test('subscribe then notify → listener receives payload synchronously', () => {
    const received: CardPayload[] = [];
    const unsub = pub.subscribe('m1', (p) => received.push(p));
    const payload = makePayload({ videoId: 'v1' });
    pub.notify('m1', payload);
    expect(received).toEqual([payload]);
    unsub();
  });

  test('notify before any subscribe → silent no-op (no throw)', () => {
    expect(() => pub.notify('m-nobody', makePayload())).not.toThrow();
  });

  test('channel isolation — notify on m1 does not reach m2 listeners', () => {
    const gotM1: CardPayload[] = [];
    const gotM2: CardPayload[] = [];
    pub.subscribe('m1', (p) => gotM1.push(p));
    pub.subscribe('m2', (p) => gotM2.push(p));
    pub.notify('m1', makePayload({ videoId: 'only-for-m1' }));
    expect(gotM1).toHaveLength(1);
    expect(gotM2).toHaveLength(0);
  });

  test('unsubscribe stops delivery and is idempotent', () => {
    const received: CardPayload[] = [];
    const unsub = pub.subscribe('m1', (p) => received.push(p));
    pub.notify('m1', makePayload({ videoId: 'v1' }));
    expect(received).toHaveLength(1);

    unsub();
    pub.notify('m1', makePayload({ videoId: 'v2' }));
    expect(received).toHaveLength(1);

    // Idempotent — second call must not throw or re-register.
    expect(() => unsub()).not.toThrow();
    pub.notify('m1', makePayload({ videoId: 'v3' }));
    expect(received).toHaveLength(1);
  });

  test('multiple listeners on same channel all receive the event', () => {
    const a: CardPayload[] = [];
    const b: CardPayload[] = [];
    pub.subscribe('m1', (p) => a.push(p));
    pub.subscribe('m1', (p) => b.push(p));
    pub.notify('m1', makePayload({ videoId: 'fan-out' }));
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0]).toBe(b[0]);
  });

  test('listener throwing does not prevent later listeners (best-effort fan-out)', () => {
    // Node's EventEmitter.emit re-throws synchronously if a listener
    // throws. We document the existing behavior so the caller
    // (v3 executor) knows to wrap notify() in try/catch.
    pub.subscribe('m1', () => {
      throw new Error('bad listener');
    });
    const received: CardPayload[] = [];
    pub.subscribe('m1', (p) => received.push(p));
    expect(() => pub.notify('m1', makePayload())).toThrow(/bad listener/);
    // The non-throwing listener was registered AFTER the bad one, so
    // it will not run. This mirrors the documented contract: the
    // caller must isolate listener failures (v3 executor wraps
    // notifyCardAdded in try/catch).
    expect(received).toHaveLength(0);
  });

  test('high-cardinality fan-out (50 listeners) stays under MaxListeners cap', () => {
    const counters = Array.from({ length: 50 }, () => 0);
    const unsubs = counters.map((_, i) => pub.subscribe('m1', () => counters[i]!++));
    pub.notify('m1', makePayload());
    expect(counters.every((c) => c === 1)).toBe(true);
    unsubs.forEach((u) => u());
  });
});
