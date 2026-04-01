/**
 * Explore API smoke tests — list/filter/sort, like toggle, clone.
 *
 * Mocking strategy:
 *   - getPrismaClient: mocked to avoid real DB connections
 *   - MandalaManager: tested via mocked Prisma client
 */
export {};

const mockFindMany = jest.fn();
const mockCount = jest.fn();
const mockFindFirst = jest.fn();
const mockFindUnique = jest.fn();
const mockCreate = jest.fn();
const mockUpdate = jest.fn();
const mockTransaction = jest.fn();
const mockLikeFindUnique = jest.fn();
const mockLikeCreate = jest.fn();
const mockLikeDelete = jest.fn();
const mockLevelFindMany = jest.fn();
const mockLevelCreate = jest.fn();
const mockLevelUpdate = jest.fn();

const mockPrisma = {
  user_mandalas: {
    findMany: mockFindMany,
    count: mockCount,
    findFirst: mockFindFirst,
    findUnique: mockFindUnique,
    create: mockCreate,
    update: mockUpdate,
  },
  mandala_likes: {
    findUnique: mockLikeFindUnique,
    create: mockLikeCreate,
    delete: mockLikeDelete,
  },
  user_mandala_levels: {
    findMany: mockLevelFindMany,
    create: mockLevelCreate,
    update: mockLevelUpdate,
  },
  $transaction: mockTransaction,
};

jest.mock('../../src/modules/database', () => ({
  getPrismaClient: jest.fn(() => mockPrisma),
}));

jest.mock('../../src/modules/database/client', () => ({
  getPrismaClient: jest.fn(() => mockPrisma),
  db: mockPrisma,
  connectDatabase: jest.fn(),
  disconnectDatabase: jest.fn(),
  resetConnectionPool: jest.fn(),
  withRetry: jest.fn((fn: () => unknown) => fn()),
  executeTransaction: jest.fn(),
  testDatabaseConnection: jest.fn(),
}));

jest.mock('../../src/config', () => ({
  config: {
    database: { url: 'mock://db' },
    supabase: {
      url: 'http://mock',
      anonKey: 'mock',
      jwtSecret: 'mock-jwt-secret-32chars-minimum!!',
    },
    encryption: { secret: 'a'.repeat(64) },
  },
}));

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

import { getMandalaManager } from '../../src/modules/mandala';

const MOCK_USER_ID = '00000000-0000-0000-0000-000000000001';
const MOCK_MANDALA_ID = '00000000-0000-0000-0000-000000000010';

const makeMockMandala = (overrides: Record<string, unknown> = {}) => ({
  id: MOCK_MANDALA_ID,
  user_id: MOCK_USER_ID,
  title: 'Test Mandala',
  is_default: false,
  is_public: true,
  is_template: false,
  domain: 'tech',
  like_count: 5,
  clone_count: 2,
  share_slug: 'abc123',
  position: 0,
  created_at: new Date('2026-03-01'),
  updated_at: new Date('2026-03-15'),
  levels: [
    {
      id: 'level-root',
      level_key: 'root',
      center_goal: 'Become a developer',
      subjects: ['Frontend', 'Backend', 'DB', 'DevOps', 'Testing', 'Deploy', 'Design', 'Network'],
      position: 0,
      depth: 0,
      color: null,
      parent_level_id: null,
    },
  ],
  users: {
    id: MOCK_USER_ID,
    raw_user_meta_data: { full_name: 'Test User' },
  },
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Explore API — listExploreMandalas', () => {
  const manager = getMandalaManager();

  test('returns mandalas with correct shape', async () => {
    const mockData = [makeMockMandala()];
    mockFindMany.mockResolvedValue(mockData);
    mockCount.mockResolvedValue(1);

    const result = await manager.listExploreMandalas({});

    expect(result.mandalas).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.page).toBe(1);
    expect(result.limit).toBe(24);

    const mandala = result.mandalas[0]!;
    expect(mandala.id).toBe(MOCK_MANDALA_ID);
    expect(mandala.title).toBe('Test Mandala');
    expect(mandala.domain).toBe('tech');
    expect(mandala.isTemplate).toBe(false);
    expect(mandala.likeCount).toBe(5);
    expect(mandala.cloneCount).toBe(2);
    expect(mandala.author).toEqual({ displayName: 'Test User', avatarInitial: 'T' });
    expect(mandala.rootLevel).toEqual(
      expect.objectContaining({
        centerGoal: 'Become a developer',
        subjects: expect.arrayContaining(['Frontend', 'Backend']),
      })
    );
  });

  test('template mandalas have null author', async () => {
    const mockData = [makeMockMandala({ is_template: true })];
    mockFindMany.mockResolvedValue(mockData);
    mockCount.mockResolvedValue(1);

    const result = await manager.listExploreMandalas({ source: 'template' });
    expect(result.mandalas[0]!.author).toBeNull();
  });

  test('filters by domain', async () => {
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);

    await manager.listExploreMandalas({ domain: 'health' });

    const whereArg = mockFindMany.mock.calls[0][0].where;
    expect(whereArg.AND).toEqual(
      expect.arrayContaining([expect.objectContaining({ domain: 'health' })])
    );
  });

  test('sorts by popular (default)', async () => {
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);

    await manager.listExploreMandalas({});

    const orderBy = mockFindMany.mock.calls[0][0].orderBy;
    expect(orderBy[0]).toEqual({ like_count: 'desc' });
  });

  test('sorts by recent', async () => {
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);

    await manager.listExploreMandalas({ sort: 'recent' });

    const orderBy = mockFindMany.mock.calls[0][0].orderBy;
    expect(orderBy[0]).toEqual({ created_at: 'desc' });
  });

  test('search filters by title and center_goal', async () => {
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);

    await manager.listExploreMandalas({ q: '개발자' });

    const whereArg = mockFindMany.mock.calls[0][0].where;
    // AND has 3 conditions: visibility OR, search OR — find the search one (has title filter)
    const searchCondition = whereArg.AND.find(
      (c: Record<string, unknown>) =>
        Array.isArray(c['OR']) && (c['OR'] as Record<string, unknown>[]).some((o) => o['title'])
    );
    expect(searchCondition).toBeDefined();
    expect(searchCondition['OR']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: { contains: '개발자', mode: 'insensitive' } }),
      ])
    );
  });

  test('template source does NOT apply language filter', async () => {
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);

    await manager.listExploreMandalas({ source: 'template', language: 'en' });

    const whereArg = mockFindMany.mock.calls[0][0].where;
    // template source should have is_template:true but NO language filter
    const hasLanguage = whereArg.AND.some((c: Record<string, unknown>) => 'language' in c);
    expect(hasLanguage).toBe(false);
  });

  test('community source applies language filter', async () => {
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);

    await manager.listExploreMandalas({ source: 'community', language: 'ko' });

    const whereArg = mockFindMany.mock.calls[0][0].where;
    expect(whereArg.AND).toEqual(
      expect.arrayContaining([expect.objectContaining({ language: 'ko' })])
    );
  });

  test('limits page size to MAX (50)', async () => {
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);

    const result = await manager.listExploreMandalas({ limit: 999 });
    expect(result.limit).toBe(50);
    expect(mockFindMany.mock.calls[0][0].take).toBe(50);
  });
});

describe('Explore API — toggleLike', () => {
  const manager = getMandalaManager();

  test('adds like when not yet liked', async () => {
    mockLikeFindUnique.mockResolvedValue(null);
    mockTransaction.mockResolvedValue([{}, {}]);
    mockFindUnique.mockResolvedValue({ like_count: 6 });

    const result = await manager.toggleLike(MOCK_USER_ID, MOCK_MANDALA_ID);

    expect(result.liked).toBe(true);
    expect(result.likeCount).toBe(6);
    expect(mockTransaction).toHaveBeenCalled();
  });

  test('removes like when already liked', async () => {
    mockLikeFindUnique.mockResolvedValue({
      id: 'like-1',
      user_id: MOCK_USER_ID,
      mandala_id: MOCK_MANDALA_ID,
    });
    mockTransaction.mockResolvedValue([{}, {}]);
    mockFindUnique.mockResolvedValue({ like_count: 4 });

    const result = await manager.toggleLike(MOCK_USER_ID, MOCK_MANDALA_ID);

    expect(result.liked).toBe(false);
    expect(result.likeCount).toBe(4);
  });
});

describe('Explore API — clonePublicMandala', () => {
  const manager = getMandalaManager();

  test('clones a public mandala with levels', async () => {
    mockFindFirst.mockResolvedValue({
      id: MOCK_MANDALA_ID,
      title: 'Source Mandala',
      is_public: true,
      is_template: false,
    });

    const newMandalaId = '00000000-0000-0000-0000-000000000020';
    mockCreate.mockResolvedValue({ id: newMandalaId, title: 'Source Mandala (cloned)' });

    mockLevelFindMany.mockResolvedValue([
      {
        id: 'l1',
        level_key: 'root',
        center_goal: 'Goal',
        subjects: ['A'],
        depth: 0,
        color: null,
        position: 0,
        parent_level_id: null,
      },
    ]);

    mockLevelCreate.mockResolvedValue({ id: 'new-l1' });
    mockUpdate.mockResolvedValue({});

    const result = await manager.clonePublicMandala(MOCK_MANDALA_ID, MOCK_USER_ID);

    expect(result.mandalaId).toBe(newMandalaId);
    expect(result.title).toBe('Source Mandala (cloned)');
    expect(mockCreate).toHaveBeenCalled();
    expect(mockLevelCreate).toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: MOCK_MANDALA_ID },
        data: { clone_count: { increment: 1 } },
      })
    );
  });

  test('throws MANDALA_NOT_FOUND for non-public mandala', async () => {
    mockFindFirst.mockResolvedValue(null);

    await expect(manager.clonePublicMandala(MOCK_MANDALA_ID, MOCK_USER_ID)).rejects.toThrow(
      'MANDALA_NOT_FOUND'
    );
  });
});
