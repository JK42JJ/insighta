/**
 * Titles for a set of pool video ids.
 *
 * The deck renders a curation item by joining `video_pool`, so this is the
 * title the user will actually read. Anything judged or logged about an item
 * has to come from here rather than from whatever the search leg happened to
 * carry, or we judge one string and show another.
 *
 * A missing entry means the pool row is gone: that item cannot render at all
 * (the empty cards incident), so callers drop it rather than substituting.
 */
import type { PrismaClient } from '@prisma/client';

export async function getPoolTitles(
  prisma: PrismaClient,
  videoIds: readonly string[]
): Promise<Map<string, string>> {
  if (!videoIds.length) return new Map();
  const rows = await prisma.video_pool.findMany({
    where: { video_id: { in: [...videoIds] } },
    select: { video_id: true, title: true },
  });
  const out = new Map<string, string>();
  for (const r of rows) {
    const t = r.title?.trim();
    if (t) out.set(r.video_id, t);
  }
  return out;
}
