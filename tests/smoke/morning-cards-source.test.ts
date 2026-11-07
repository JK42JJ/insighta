import { fetchMorningCards, poolDomainLabels } from '../../src/modules/morning-cards/source';

function row(id: string, score: number) {
  return {
    relevance_score: score,
    source: 'batch_trend',
    video_pool: {
      video_id: id,
      title: `title ${id}`,
      channel_name: 'chan',
      published_at: new Date('2026-03-01T00:00:00Z'),
      thumbnail_url: `https://i.ytimg.com/vi/${id}/hq.jpg`,
    },
  };
}

describe('morning-cards source', () => {
  it('returns cards with the required fields and dedupes videos', async () => {
    const findMany = jest.fn().mockResolvedValue([row('a', 0.9), row('a', 0.8), row('b', 0.7)]);
    const cards = await fetchMorningCards({ video_pool_domain_tags: { findMany } }, 'ai_tools', 5);
    expect(cards.map((c) => c.video_id)).toEqual(['a', 'b']);
    for (const c of cards) {
      expect(c.title).toBeTruthy();
      expect(c.channel_name).toBe('chan');
      expect(c.published_at).toBeInstanceOf(Date);
      expect(c.thumbnail_url).toContain('ytimg');
      expect(c.reason.length).toBeGreaterThan(0);
    }
  });

  it('queries the pool tags by mapped labels only and respects the limit', async () => {
    const findMany = jest.fn().mockResolvedValue([row('a', 1), row('b', 1), row('c', 1)]);
    const cards = await fetchMorningCards(
      { video_pool_domain_tags: { findMany } },
      'work_practice',
      2
    );
    expect(cards).toHaveLength(2);
    const args = findMany.mock.calls[0][0];
    expect(args.where.domain.in).toEqual(poolDomainLabels('work_practice'));
  });

  it('returns no cards for an empty domain', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const cards = await fetchMorningCards({ video_pool_domain_tags: { findMany } }, 'ai_tools');
    expect(cards).toEqual([]);
  });
});
