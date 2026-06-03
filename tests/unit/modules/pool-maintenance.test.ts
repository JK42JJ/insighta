/**
 * CP494 — pool-maintenance core logic (video_pool ToS hygiene).
 * Verifies the two 0-quota UPDATEs run when enabled, no-op when disabled,
 * counts flow through, and the SQL carries the compliance guards
 * (idempotency `title <> ''`, 30-day TTL, is_active serving gate).
 */

import {
  runPoolMaintenance,
  EXPIRE_SQL,
  SCRUB_SQL,
  METADATA_TTL_DAYS,
} from '@/modules/queue/handlers/pool-maintenance';

function mockPrisma(expired: number, scrubbed: number) {
  const calls: string[] = [];
  const $executeRawUnsafe = jest.fn((sql: string) => {
    calls.push(sql);
    // First call = EXPIRE, second = SCRUB (handler runs in that order).
    return Promise.resolve(calls.length === 1 ? expired : scrubbed);
  });
  return { prisma: { $executeRawUnsafe }, calls, $executeRawUnsafe };
}

describe('runPoolMaintenance (CP494)', () => {
  test('enabled → runs both UPDATEs (expire then scrub), returns counts', async () => {
    const { prisma, calls, $executeRawUnsafe } = mockPrisma(12, 4644);
    const res = await runPoolMaintenance(prisma, { enabled: true });

    expect(res).toEqual({ skipped: false, expired: 12, scrubbed: 4644 });
    expect($executeRawUnsafe).toHaveBeenCalledTimes(2);
    // Call order: EXPIRE first, SCRUB second.
    expect(calls[0]).toContain('is_active = false');
    expect(calls[0]).toContain('expires_at < now()');
    expect(calls[1]).toContain("title = ''");
    expect(calls[1]).toContain('refreshed_at < now()');
  });

  test('disabled → no DB calls, skipped=true', async () => {
    const { prisma, $executeRawUnsafe } = mockPrisma(99, 99);
    const res = await runPoolMaintenance(prisma, { enabled: false });

    expect(res).toEqual({ skipped: true, expired: 0, scrubbed: 0 });
    expect($executeRawUnsafe).not.toHaveBeenCalled();
  });

  test('SCRUB_SQL is idempotent (guards on empty title) and uses the 30-day TTL', () => {
    expect(SCRUB_SQL).toContain("title <> ''");
    expect(SCRUB_SQL).toContain(`${METADATA_TTL_DAYS} days`);
    // Preserves the FK-cascade assets — must NOT touch video_id / embeddings.
    expect(SCRUB_SQL).not.toContain('video_id');
    // Regulated YouTube metadata fields are all cleared.
    for (const f of [
      'title',
      'description',
      'channel_name',
      'channel_id',
      'view_count',
      'like_count',
      'duration_seconds',
      'published_at',
      'thumbnail_url',
    ]) {
      expect(SCRUB_SQL).toContain(f);
    }
  });

  test('EXPIRE_SQL only deactivates currently-active rows past expires_at', () => {
    expect(EXPIRE_SQL).toContain('is_active = false');
    expect(EXPIRE_SQL).toContain('is_active = true');
    expect(EXPIRE_SQL).toContain('expires_at < now()');
  });
});
