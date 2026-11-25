import { describe, expect, it, vi } from 'vitest';

import type { MorningPage } from '@/features/morning-cards/api';
import { createBriefCache } from '@/features/morning-feed/brief-cache';

/* James 2026-11-25: a brief read once is kept for the visit and not read again. */

const page = (over: Partial<MorningPage> = {}): MorningPage => ({
  domain: '기술/개발',
  seen_date: '2026-11-25',
  headline: '헤드라인',
  core: [],
  note: [],
  videos: [],
  ...over,
});

describe('briefs kept for the visit', () => {
  it('reads once: while it is under way and after it came', async () => {
    const read = vi.fn(() => Promise.resolve(page({ feedback: null })));
    const c = createBriefCache(read);
    const [a, b] = await Promise.all([
      c.load('기술/개발', '2026-11-25'),
      c.load('기술/개발', '2026-11-25'),
    ]);
    expect(a).toBe(b);
    expect(await c.load('기술/개발', '2026-11-25')).toBe(a);
    expect(c.peek('기술/개발', '2026-11-25')).toBe(a);
    expect(read).toHaveBeenCalledTimes(1);
    await c.load('기술/개발', '2026-11-24');
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('not found and failed reads are not kept', async () => {
    const read = vi
      .fn<(cell: string, date: string) => Promise<MorningPage | null>>()
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(page());
    const c = createBriefCache(read);
    expect(await c.load('기술/개발', '2026-11-25')).toBeNull();
    await expect(c.load('기술/개발', '2026-11-25')).rejects.toThrow('network');
    expect(await c.load('기술/개발', '2026-11-25')).not.toBeNull();
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('the brief that came with the home is shown at once and read once for its reaction', async () => {
    const read = vi.fn(() => Promise.resolve(page({ feedback: 'useful' })));
    const c = createBriefCache(read);
    c.seed(page());
    expect(c.peek('기술/개발', '2026-11-25')?.headline).toBe('헤드라인');
    await c.load('기술/개발', '2026-11-25');
    expect(c.peek('기술/개발', '2026-11-25')?.feedback).toBe('useful');
    // seeding again never replaces the full read
    c.seed(page());
    expect(c.peek('기술/개발', '2026-11-25')?.feedback).toBe('useful');
  });

  it('a reaction is kept, and one given before the read came back wins', async () => {
    let come: (p: MorningPage) => void = () => undefined;
    const c = createBriefCache(
      () =>
        new Promise((r) => {
          come = r;
        })
    );
    c.seed(page());
    const p = c.load('기술/개발', '2026-11-25');
    c.setFeedback('기술/개발', '2026-11-25', 'not_useful');
    come(page({ feedback: null }));
    expect((await p)?.feedback).toBe('not_useful');
    c.setFeedback('기술/개발', '2026-11-25', 'useful');
    expect(c.peek('기술/개발', '2026-11-25')?.feedback).toBe('useful');
  });
});
