/**
 * getMandalaSubgraph — the user's WHOLE knowledge graph (scope decision
 * 2026-07-28): every mandala's structure + every placed card, with
 * public-schema projections because the ontology edge graph is sparse on
 * real accounts (prod-measured: mandala roots and v1 card nodes are
 * edge-orphans).
 *
 * $queryRaw mock sequence:
 *   roots(all mandalas) → sectors(+mandala_id,position) → cards →
 *   [card-node match, only when cards exist] → edges(user-wide) →
 *   nodes(by id set)
 */
jest.mock('../../src/modules/database/client', () => ({ getPrismaClient: jest.fn() }));

import { getPrismaClient } from '../../src/modules/database/client';
import { getMandalaSubgraph } from '../../src/modules/ontology/graph';

const getPrisma = getPrismaClient as unknown as jest.Mock;

const USER = '00000000-0000-0000-0000-000000000001';
const MANDALA = '00000000-0000-0000-0000-0000000000aa';
const MANDALA_B = '00000000-0000-0000-0000-0000000000ab';
const ROOT = '00000000-0000-0000-0000-0000000000bb';
const ROOT_B = '00000000-0000-0000-0000-0000000000bc';
const SECTOR = '00000000-0000-0000-0000-0000000000cc';
const STATE_NODE = '00000000-0000-0000-0000-0000000000dd';

function mockPrisma(queryResults: unknown[][]) {
  let call = 0;
  getPrisma.mockReturnValue({
    $queryRaw: jest.fn().mockImplementation(() => Promise.resolve(queryResults[call++] ?? [])),
  });
}

describe('getMandalaSubgraph (user-wide)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns empty when the user has no structures, cards, or edges', async () => {
    mockPrisma([[], [], [], [], []]); // roots, sectors, cards, edges, nodes
    const result = await getMandalaSubgraph(null, USER);
    expect(result).toEqual({ nodes: [], edges: [], truncated: false });
  });

  it('returns every mandala structure with derived root→sector CONTAINS', async () => {
    mockPrisma([
      [
        { id: ROOT, mandala_id: MANDALA },
        { id: ROOT_B, mandala_id: MANDALA_B },
      ],
      [{ id: SECTOR, mandala_id: MANDALA, position: 0 }],
      [], // cards
      [], // edges
      [{ id: ROOT }, { id: ROOT_B }, { id: SECTOR }],
    ]);

    const result = await getMandalaSubgraph(null, USER, 4);
    expect(result.nodes).toHaveLength(3);
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]).toMatchObject({
      source_id: ROOT,
      target_id: SECTOR,
      relation: 'CONTAINS',
    });
  });

  it('projects cards: v1 state-node match, synthetic fallback, cell placement', async () => {
    const cards = [
      { ytid: 'ytA', state_id: 'stA', title: 'Video A', mandala_id: MANDALA, cell_pos: 0 },
      { ytid: 'ytB', state_id: null, title: 'Video B', mandala_id: MANDALA, cell_pos: 0 },
      { ytid: 'ytC', state_id: null, title: 'Video C', mandala_id: MANDALA, cell_pos: null },
    ];
    const match = [{ id: STATE_NODE, ref_table: 'user_video_states', ref_id: 'stA' }];
    mockPrisma([
      [{ id: ROOT, mandala_id: MANDALA }],
      [{ id: SECTOR, mandala_id: MANDALA, position: 0 }],
      cards,
      match,
      [], // edges
      [{ id: ROOT }, { id: SECTOR }, { id: STATE_NODE, type: 'resource' }],
    ]);

    const result = await getMandalaSubgraph(MANDALA, USER, 4);

    const ids = result.nodes.map((n) => n.id);
    expect(ids).toContain(STATE_NODE); // real v1 node reused
    expect(ids).toContain('derived-video-ytB'); // synthetic
    expect(ids).toContain('derived-video-ytC');

    expect(result.edges.find((e) => e.target_id === STATE_NODE)).toMatchObject({
      source_id: SECTOR,
      relation: 'PLACED_IN',
    });
    expect(result.edges.find((e) => e.target_id === 'derived-video-ytB')).toMatchObject({
      source_id: SECTOR,
    });
    // Unmapped cell anchors to the mandala root.
    expect(result.edges.find((e) => e.target_id === 'derived-video-ytC')).toMatchObject({
      source_id: ROOT,
    });
  });

  it('keeps real stored edges and never duplicates them with derived ones', async () => {
    mockPrisma([
      [{ id: ROOT, mandala_id: MANDALA }],
      [{ id: SECTOR, mandala_id: MANDALA, position: 0 }],
      [], // cards
      [
        {
          id: 'e-real',
          user_id: USER,
          source_id: ROOT,
          target_id: SECTOR,
          relation: 'CONTAINS',
          weight: 1,
          properties: {},
          created_at: new Date(),
        },
      ],
      [{ id: ROOT }, { id: SECTOR }],
    ]);

    const result = await getMandalaSubgraph(null, USER, 4);
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]?.id).toBe('e-real');
  });

  it('caps synthetic card nodes at the total node cap and flags truncation', async () => {
    // 4,100 placed cards with no ontology nodes at all — synthetic creation
    // must stop at the 4,000 cap instead of ballooning the payload (prod
    // beta-day incident: ~9k nodes froze the layout thread).
    const manyCards = Array.from({ length: 4100 }, (_, i) => ({
      ytid: `yt${i}`,
      state_id: null,
      title: `V${i}`,
      mandala_id: MANDALA,
      cell_pos: null,
    }));
    mockPrisma([
      [], // roots
      [], // sectors
      manyCards,
      [], // card-node match
      [], // edges
      [], // nodes
    ]);

    const result = await getMandalaSubgraph(null, USER, 4);
    expect(result.nodes).toHaveLength(4000);
    expect(result.truncated).toBe(true);
  });

  it('drops edges whose endpoints fall outside the kept node set', async () => {
    mockPrisma([
      [{ id: ROOT, mandala_id: MANDALA }],
      [],
      [],
      [
        {
          id: 'e-dangling',
          user_id: USER,
          source_id: ROOT,
          target_id: '00000000-0000-0000-0000-00000000ffff',
          relation: 'CONTAINS',
          weight: 1,
          properties: {},
          created_at: new Date(),
        },
      ],
      [{ id: ROOT }],
    ]);

    // The dangling target IS pulled into the node set via the edge, so this
    // edge survives; nothing else appears.
    const result = await getMandalaSubgraph(null, USER, 4);
    expect(result.edges).toHaveLength(1);
    expect(result.nodes).toHaveLength(1); // nodes query returned only ROOT
  });
});
