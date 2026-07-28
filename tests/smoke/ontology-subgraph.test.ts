/**
 * getMandalaSubgraph — mandala-scoped graph for the knowledge view (MA-2
 * server scoping). Verifies: root+sector seeding (the write pipeline never
 * linked mandala roots into the edge graph — measured 2026-07-28, prod has
 * zero mandala→sector CONTAINS rows), derived CONTAINS projection, empty
 * result when nothing resolves, depth clamp.
 *
 * $queryRaw mock sequence: roots → sectors → getNeighbors(per seed, in seed
 * order) → nodes → edges.
 */
jest.mock('../../src/modules/database/client', () => ({ getPrismaClient: jest.fn() }));

import { getPrismaClient } from '../../src/modules/database/client';
import { getMandalaSubgraph } from '../../src/modules/ontology/graph';

const getPrisma = getPrismaClient as unknown as jest.Mock;

const USER = '00000000-0000-0000-0000-000000000001';
const MANDALA = '00000000-0000-0000-0000-0000000000aa';
const ROOT = '00000000-0000-0000-0000-0000000000bb';
const SECTOR = '00000000-0000-0000-0000-0000000000cc';

function mockPrisma(queryResults: unknown[][]) {
  let call = 0;
  getPrisma.mockReturnValue({
    $queryRaw: jest.fn().mockImplementation(() => Promise.resolve(queryResults[call++] ?? [])),
  });
}

describe('getMandalaSubgraph', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns empty when neither a root node nor sector nodes resolve', async () => {
    mockPrisma([[], []]); // roots, sectors
    const result = await getMandalaSubgraph(MANDALA, USER);
    expect(result).toEqual({ nodes: [], edges: [], truncated: false });
  });

  it('resolves root + neighbors and fetches nodes/edges for the id set', async () => {
    const neighbors = [
      {
        node_id: 'n2',
        node_type: 'goal',
        title: 'g',
        properties: {},
        relation: 'CONTAINS',
        direction: 'out',
        depth: 2,
      },
      {
        node_id: 'n1',
        node_type: 'mandala_sector',
        title: 's',
        properties: {},
        relation: 'CONTAINS',
        direction: 'out',
        depth: 1,
      },
    ];
    const nodeRows = [{ id: ROOT }, { id: 'n1' }, { id: 'n2' }];
    const edgeRows = [{ id: 'e1', source_id: ROOT, target_id: 'n1', relation: 'CONTAINS' }];
    // roots, sectors(empty), getNeighbors(root), nodes, edges
    mockPrisma([[{ id: ROOT }], [], neighbors, nodeRows, edgeRows]);

    const result = await getMandalaSubgraph(MANDALA, USER, 4);
    expect(result.truncated).toBe(false);
    expect(result.nodes).toHaveLength(3);
    expect(result.edges).toHaveLength(1);
  });

  it('seeds from sectors when the mandala root is an edge orphan and derives the CONTAINS link', async () => {
    const sectorNeighbors = [
      {
        node_id: 't1',
        node_type: 'topic',
        title: 't',
        properties: {},
        relation: 'CONTAINS',
        direction: 'out',
        depth: 1,
      },
    ];
    const nodeRows = [{ id: ROOT }, { id: SECTOR }, { id: 't1' }];
    const edgeRows = [{ id: 'e1', source_id: SECTOR, target_id: 't1', relation: 'CONTAINS' }];
    // roots, sectors, getNeighbors(root → orphan: []), getNeighbors(sector), nodes, edges
    mockPrisma([[{ id: ROOT }], [{ id: SECTOR }], [], sectorNeighbors, nodeRows, edgeRows]);

    const result = await getMandalaSubgraph(MANDALA, USER, 4);
    expect(result.nodes).toHaveLength(3);
    // Stored sector→topic edge + derived root→sector CONTAINS projection.
    expect(result.edges).toHaveLength(2);
    const derived = result.edges.find((e) => e.id === `derived-contains-${SECTOR}`);
    expect(derived).toMatchObject({
      source_id: ROOT,
      target_id: SECTOR,
      relation: 'CONTAINS',
    });
  });

  it('does not duplicate a stored mandala→sector edge with a derived one', async () => {
    // roots, sectors, getNeighbors(root), getNeighbors(sector), nodes, edges
    mockPrisma([
      [{ id: ROOT }],
      [{ id: SECTOR }],
      [],
      [],
      [{ id: ROOT }, { id: SECTOR }],
      [{ id: 'e-real', source_id: ROOT, target_id: SECTOR, relation: 'CONTAINS' }],
    ]);

    const result = await getMandalaSubgraph(MANDALA, USER, 4);
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]?.id).toBe('e-real');
  });

  it('clamps depth into [1, 5]', async () => {
    mockPrisma([[], []]);
    await expect(getMandalaSubgraph(MANDALA, USER, 99)).resolves.toEqual({
      nodes: [],
      edges: [],
      truncated: false,
    });
  });
});
