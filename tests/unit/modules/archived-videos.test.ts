import { getArchivedVideoIds } from '@/modules/exclude/archived-videos';

describe('getArchivedVideoIds (CP504 display archive gate SSOT)', () => {
  it('returns the mandala-scoped set of archived video_ids', async () => {
    const findMany = jest.fn().mockResolvedValue([{ video_id: 'aaa' }, { video_id: 'bbb' }]);
    const prisma = { card_interactions: { findMany } } as never;

    const set = await getArchivedVideoIds(prisma, 'user-1', 'mandala-1');

    expect(set).toEqual(new Set(['aaa', 'bbb']));
    // scoped by user + signal='archive' + mandala (NOT global)
    expect(findMany).toHaveBeenCalledWith({
      where: { user_id: 'user-1', signal: 'archive', mandala_id: 'mandala-1' },
      select: { video_id: true },
    });
  });

  it('returns an empty set when nothing is archived', async () => {
    const prisma = {
      card_interactions: { findMany: jest.fn().mockResolvedValue([]) },
    } as never;
    const set = await getArchivedVideoIds(prisma, 'user-1', 'mandala-1');
    expect(set.size).toBe(0);
  });
});
