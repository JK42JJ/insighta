/**
 * Book re-fill trigger (post-enrich) — debounce contract. When v2 segments (the
 * book's atom source) are written, the enrich handler enqueues a mandala book
 * re-fill so videos enriched AFTER the book was first built are reflected (fixes
 * the stale-book race = empty "토픽 0" notes on new mandalas). The enqueue is
 * debounced so a burst of per-video enrichments collapses into ONE re-fill per
 * mandala (topic-synthesis Haiku is not over-triggered).
 */
import { bookRefillEnqueueOptions } from '../../src/modules/queue/handlers/book-refill-debounce';

describe('bookRefillEnqueueOptions (post-enrich book re-fill debounce)', () => {
  it('dedups per mandala via singletonKey', () => {
    const a = bookRefillEnqueueOptions('mandala-A');
    const b = bookRefillEnqueueOptions('mandala-B');
    expect(a.singletonKey).toBe('book-fill-mandala-A');
    expect(b.singletonKey).toBe('book-fill-mandala-B');
    expect(bookRefillEnqueueOptions('mandala-A').singletonKey).toBe(a.singletonKey);
  });

  it('delays 120s to collect an enrich burst before re-filling', () => {
    expect(bookRefillEnqueueOptions('m').startAfter).toBe(120);
  });
});
