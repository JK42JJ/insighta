/**
 * MandalaManager Unit Tests
 *
 * Tests for MandalaManager implementation including:
 * - Default mandala retrieval (getMandala)
 * - Mandala by ID retrieval (getMandalaById)
 * - List mandalas with pagination (listMandalas)
 * - Create with quota enforcement (createMandala)
 * - Update metadata with isDefault demote (updateMandala)
 * - Replace levels with two-pass pattern (updateMandalaLevels)
 * - Delete with orphan card migration (deleteMandala)
 * - Quota info (getUserQuota)
 * - Link unlinked cards (linkCardsToMandala)
 * - Upsert default mandala (upsertMandala)
 * - Toggle public visibility (togglePublic)
 * - Public mandala access (getPublicMandala, listPublicMandalas)
 * - Update single level (updateLevel)
 * - Subscriptions (subscribe, unsubscribe, listSubscriptions)
 * - Activity log (logActivity, getActivityLog)
 */

import { MandalaManager } from '../../../src/modules/mandala/manager';

// Mock dependencies
const mockPrisma: any = {
  user_mandalas: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    delete: jest.fn(),
    aggregate: jest.fn(),
  },
  user_mandala_levels: {
    create: jest.fn(),
    deleteMany: jest.fn(),
    updateMany: jest.fn(),
  },
  user_subscriptions: {
    findUnique: jest.fn(),
  },
  mandala_subscriptions: {
    create: jest.fn(),
    deleteMany: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  },
  mandala_activity_log: {
    create: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  },
  userVideoState: {
    updateMany: jest.fn(),
  },
  user_local_cards: {
    updateMany: jest.fn(),
  },
  $transaction: jest.fn(),
  // Tagged template literal mock — called as prisma.$queryRaw`SELECT ...`
  // Returns non-admin by default; override per-test with mockResolvedValueOnce
  $queryRaw: jest.fn().mockResolvedValue([{ is_super_admin: false }]),
};

jest.mock('../../../src/modules/database/client', () => ({
  getPrismaClient: () => mockPrisma,
}));

jest.mock('../../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('nanoid', () => ({
  nanoid: jest.fn(() => 'mock-slug-12'),
}));

// ─── Test Fixtures ───

const mockUserId = 'user-1';
const mockMandalaId = 'mandala-1';

const mockRawMandala = {
  id: mockMandalaId,
  user_id: mockUserId,
  title: 'My Mandala',
  is_default: true,
  is_public: false,
  share_slug: null,
  position: 0,
  created_at: new Date('2024-01-01'),
  updated_at: new Date('2024-01-01'),
  levels: [
    {
      id: 'level-root',
      level_key: 'root',
      center_goal: 'Root Goal',
      subjects: ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8'],
      position: 0,
      depth: 0,
      color: null,
      parent_level_id: null,
    },
    {
      id: 'level-child-1',
      level_key: 'child-1',
      center_goal: 'Child Goal 1',
      subjects: ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8'],
      position: 1,
      depth: 1,
      color: '#ff0000',
      parent_level_id: 'level-root',
    },
  ],
};

const mockLevelsInput = [
  {
    levelKey: 'root',
    centerGoal: 'Root Goal',
    subjects: ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8'],
    position: 0,
    depth: 0,
    color: null,
    parentLevelKey: null,
  },
  {
    levelKey: 'child-1',
    centerGoal: 'Child Goal 1',
    subjects: ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8'],
    position: 1,
    depth: 1,
    color: '#ff0000',
    parentLevelKey: 'root',
  },
];

// ─── Helper: Create a mock transaction proxy ───

function createMockTx() {
  const tx: any = {
    user_mandalas: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
      aggregate: jest.fn(),
    },
    user_mandala_levels: {
      create: jest.fn(),
      deleteMany: jest.fn(),
    },
    user_subscriptions: {
      findUnique: jest.fn(),
    },
    mandala_subscriptions: {
      deleteMany: jest.fn(),
    },
  };
  return tx;
}

describe('MandalaManager', () => {
  let manager: MandalaManager;

  beforeEach(() => {
    jest.clearAllMocks();
    manager = new MandalaManager();
  });

  // ─── getMandala ───

  describe('getMandala', () => {
    test('should return null when no default mandala exists', async () => {
      mockPrisma.user_mandalas.findFirst.mockResolvedValue(null);

      const result = await manager.getMandala(mockUserId);

      expect(result).toBeNull();
      expect(mockPrisma.user_mandalas.findFirst).toHaveBeenCalledWith({
        where: { user_id: mockUserId, is_default: true },
        include: {
          levels: { orderBy: [{ depth: 'asc' }, { position: 'asc' }] },
        },
      });
    });

    test('should return mapped mandala with levels', async () => {
      mockPrisma.user_mandalas.findFirst.mockResolvedValue(mockRawMandala);

      const result = await manager.getMandala(mockUserId);

      expect(result).not.toBeNull();
      expect(result!.id).toBe(mockMandalaId);
      expect(result!.userId).toBe(mockUserId);
      expect(result!.title).toBe('My Mandala');
      expect(result!.isDefault).toBe(true);
      expect(result!.levels).toHaveLength(2);
      expect(result!.levels[0]!.levelKey).toBe('root');
      expect(result!.levels[0]!.centerGoal).toBe('Root Goal');
      expect(result!.levels[1]!.parentLevelId).toBe('level-root');
    });

    test('should map snake_case DB fields to camelCase correctly', async () => {
      mockPrisma.user_mandalas.findFirst.mockResolvedValue(mockRawMandala);

      const result = await manager.getMandala(mockUserId);

      expect(result!.isPublic).toBe(false);
      expect(result!.shareSlug).toBeNull();
      expect(result!.createdAt).toEqual(new Date('2024-01-01'));
      expect(result!.levels[1]!.color).toBe('#ff0000');
    });
  });

  // ─── getMandalaById ───

  describe('getMandalaById', () => {
    test('should return null when mandala not found', async () => {
      mockPrisma.user_mandalas.findFirst.mockResolvedValue(null);

      const result = await manager.getMandalaById(mockUserId, 'non-existent');

      expect(result).toBeNull();
    });

    test('should return mandala by ID with ownership filter', async () => {
      mockPrisma.user_mandalas.findFirst.mockResolvedValue(mockRawMandala);

      const result = await manager.getMandalaById(mockUserId, mockMandalaId);

      expect(result).not.toBeNull();
      expect(result!.id).toBe(mockMandalaId);
      expect(mockPrisma.user_mandalas.findFirst).toHaveBeenCalledWith({
        where: { id: mockMandalaId, user_id: mockUserId },
        include: expect.objectContaining({ levels: expect.any(Object) }),
      });
    });

    test("should return null for another user's mandala", async () => {
      mockPrisma.user_mandalas.findFirst.mockResolvedValue(null);

      const result = await manager.getMandalaById('other-user', mockMandalaId);

      expect(result).toBeNull();
    });
  });

  // ─── listMandalas ───

  describe('listMandalas', () => {
    test('should return empty list when user has no mandalas', async () => {
      mockPrisma.user_mandalas.findMany.mockResolvedValue([]);
      mockPrisma.user_mandalas.count.mockResolvedValue(0);

      const result = await manager.listMandalas(mockUserId);

      expect(result.mandalas).toEqual([]);
      expect(result.total).toBe(0);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
    });

    test('should apply pagination parameters', async () => {
      mockPrisma.user_mandalas.findMany.mockResolvedValue([mockRawMandala]);
      mockPrisma.user_mandalas.count.mockResolvedValue(5);

      const result = await manager.listMandalas(mockUserId, { page: 2, limit: 1 });

      expect(result.page).toBe(2);
      expect(result.limit).toBe(1);
      expect(result.total).toBe(5);
      expect(mockPrisma.user_mandalas.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 1, take: 1 })
      );
    });

    test('should order by is_default DESC, position ASC, created_at DESC', async () => {
      mockPrisma.user_mandalas.findMany.mockResolvedValue([]);
      mockPrisma.user_mandalas.count.mockResolvedValue(0);

      await manager.listMandalas(mockUserId);

      expect(mockPrisma.user_mandalas.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ is_default: 'desc' }, { position: 'asc' }, { created_at: 'desc' }],
        })
      );
    });

    test('should map each mandala through mapMandala', async () => {
      mockPrisma.user_mandalas.findMany.mockResolvedValue([mockRawMandala]);
      mockPrisma.user_mandalas.count.mockResolvedValue(1);

      const result = await manager.listMandalas(mockUserId);

      expect(result.mandalas[0]!.userId).toBe(mockUserId);
      expect(result.mandalas[0]!.isDefault).toBe(true);
    });
  });

  // ─── createMandala ───

  describe('createMandala', () => {
    test('should create mandala with correct transaction flow', async () => {
      const mockTx = createMockTx();
      mockTx.user_subscriptions.findUnique.mockResolvedValue({ tier: 'free' });
      mockTx.user_mandalas.count.mockResolvedValue(0);
      mockTx.user_mandalas.aggregate.mockResolvedValue({ _max: { position: null } });
      mockTx.user_mandalas.create.mockResolvedValue({ id: 'new-mandala', user_id: mockUserId });
      mockTx.user_mandala_levels.create
        .mockResolvedValueOnce({ id: 'lvl-root' })
        .mockResolvedValueOnce({ id: 'lvl-child-1' });
      mockTx.user_mandalas.findUnique.mockResolvedValue({
        ...mockRawMandala,
        id: 'new-mandala',
      });

      mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(mockTx));

      const result = await manager.createMandala(mockUserId, 'My Mandala', mockLevelsInput);

      expect(result.id).toBe('new-mandala');
      // First mandala should be default
      expect(mockTx.user_mandalas.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          user_id: mockUserId,
          title: 'My Mandala',
          is_default: true,
          position: 0,
        }),
      });
    });

    test('should throw quota exceeded for free tier at limit', async () => {
      const mockTx = createMockTx();
      mockTx.user_subscriptions.findUnique.mockResolvedValue({ tier: 'free' });
      mockTx.user_mandalas.count.mockResolvedValue(3); // free limit = 3

      mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(mockTx));

      await expect(manager.createMandala(mockUserId, 'Over Quota', [])).rejects.toThrow(
        'Mandala quota exceeded'
      );
    });

    test('should set isDefault=false when user already has mandalas', async () => {
      const mockTx = createMockTx();
      mockTx.user_subscriptions.findUnique.mockResolvedValue({ tier: 'free' });
      mockTx.user_mandalas.count.mockResolvedValue(1);
      mockTx.user_mandalas.aggregate.mockResolvedValue({ _max: { position: 2 } });
      mockTx.user_mandalas.create.mockResolvedValue({ id: 'new-2', user_id: mockUserId });
      mockTx.user_mandalas.findUnique.mockResolvedValue({
        ...mockRawMandala,
        id: 'new-2',
        is_default: false,
      });

      mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(mockTx));

      await manager.createMandala(mockUserId, 'Second', []);

      expect(mockTx.user_mandalas.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          is_default: false,
          position: 3,
        }),
      });
    });

    test('should use pro quota for pro tier', async () => {
      const mockTx = createMockTx();
      mockTx.user_subscriptions.findUnique.mockResolvedValue({ tier: 'pro' });
      mockTx.user_mandalas.count.mockResolvedValue(10); // within pro limit (20)
      mockTx.user_mandalas.aggregate.mockResolvedValue({ _max: { position: 9 } });
      mockTx.user_mandalas.create.mockResolvedValue({ id: 'prem-1', user_id: mockUserId });
      mockTx.user_mandalas.findUnique.mockResolvedValue({
        ...mockRawMandala,
        id: 'prem-1',
        is_default: false,
      });

      mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(mockTx));

      const result = await manager.createMandala(mockUserId, 'Premium', []);

      expect(result.id).toBe('prem-1');
    });

    test('should create levels using two-pass pattern (root first, children second)', async () => {
      const mockTx = createMockTx();
      mockTx.user_subscriptions.findUnique.mockResolvedValue(null); // defaults to free
      mockTx.user_mandalas.count.mockResolvedValue(0);
      mockTx.user_mandalas.aggregate.mockResolvedValue({ _max: { position: null } });
      mockTx.user_mandalas.create.mockResolvedValue({ id: 'new-m', user_id: mockUserId });
      mockTx.user_mandala_levels.create
        .mockResolvedValueOnce({ id: 'root-id' }) // root pass
        .mockResolvedValueOnce({ id: 'child-id' }); // child pass
      mockTx.user_mandalas.findUnique.mockResolvedValue({
        ...mockRawMandala,
        id: 'new-m',
      });

      mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(mockTx));

      await manager.createMandala(mockUserId, 'Test', mockLevelsInput);

      // Root level created first (depth=0)
      expect(mockTx.user_mandala_levels.create).toHaveBeenNthCalledWith(1, {
        data: expect.objectContaining({
          level_key: 'root',
          depth: 0,
        }),
      });
      // Child level created second with parent_level_id resolved
      expect(mockTx.user_mandala_levels.create).toHaveBeenNthCalledWith(2, {
        data: expect.objectContaining({
          level_key: 'child-1',
          depth: 1,
          parent_level_id: 'root-id',
        }),
      });
    });
  });

  // ─── updateMandala ───

  describe('updateMandala', () => {
    test('should update title', async () => {
      const mockTx = createMockTx();
      mockTx.user_mandalas.findFirst.mockResolvedValue(mockRawMandala); // verifyOwnership
      mockTx.user_mandalas.update.mockResolvedValue({});
      mockTx.user_mandalas.findUnique.mockResolvedValue({
        ...mockRawMandala,
        title: 'Updated',
      });

      mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(mockTx));

      const result = await manager.updateMandala(mockUserId, mockMandalaId, {
        title: 'Updated',
      });

      expect(result.title).toBe('Updated');
      expect(mockTx.user_mandalas.update).toHaveBeenCalledWith({
        where: { id: mockMandalaId },
        data: expect.objectContaining({ title: 'Updated' }),
      });
    });

    test('should demote other mandalas when setting isDefault=true', async () => {
      const mockTx = createMockTx();
      mockTx.user_mandalas.findFirst.mockResolvedValue(mockRawMandala);
      mockTx.user_mandalas.update.mockResolvedValue({});
      mockTx.user_mandalas.findUnique.mockResolvedValue(mockRawMandala);

      mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(mockTx));

      await manager.updateMandala(mockUserId, mockMandalaId, { isDefault: true });

      expect(mockTx.user_mandalas.updateMany).toHaveBeenCalledWith({
        where: { user_id: mockUserId, id: { not: mockMandalaId } },
        data: { is_default: false },
      });
    });

    test('should throw when mandala not found (ownership check)', async () => {
      const mockTx = createMockTx();
      mockTx.user_mandalas.findFirst.mockResolvedValue(null);

      mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(mockTx));

      await expect(
        manager.updateMandala(mockUserId, 'non-existent', { title: 'X' })
      ).rejects.toThrow('Mandala not found');
    });

    test('should not demote when isDefault is not set to true', async () => {
      const mockTx = createMockTx();
      mockTx.user_mandalas.findFirst.mockResolvedValue(mockRawMandala);
      mockTx.user_mandalas.update.mockResolvedValue({});
      mockTx.user_mandalas.findUnique.mockResolvedValue(mockRawMandala);

      mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(mockTx));

      await manager.updateMandala(mockUserId, mockMandalaId, { title: 'New Title' });

      expect(mockTx.user_mandalas.updateMany).not.toHaveBeenCalled();
    });
  });

  // ─── updateMandalaLevels ───

  describe('updateMandalaLevels', () => {
    test('should delete existing levels then recreate', async () => {
      const mockTx = createMockTx();
      mockTx.user_mandalas.findFirst.mockResolvedValue(mockRawMandala);
      mockTx.user_mandala_levels.deleteMany.mockResolvedValue({ count: 2 });
      mockTx.user_mandala_levels.create
        .mockResolvedValueOnce({ id: 'new-root' })
        .mockResolvedValueOnce({ id: 'new-child' });
      mockTx.user_mandalas.update.mockResolvedValue({});
      mockTx.user_mandalas.findUnique.mockResolvedValue(mockRawMandala);

      mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(mockTx));

      await manager.updateMandalaLevels(mockUserId, mockMandalaId, mockLevelsInput);

      expect(mockTx.user_mandala_levels.deleteMany).toHaveBeenCalledWith({
        where: { mandala_id: mockMandalaId },
      });
      expect(mockTx.user_mandala_levels.create).toHaveBeenCalledTimes(2);
    });

    test('should verify ownership before updating levels', async () => {
      const mockTx = createMockTx();
      mockTx.user_mandalas.findFirst.mockResolvedValue(null);

      mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(mockTx));

      await expect(
        manager.updateMandalaLevels(mockUserId, 'other-mandala', mockLevelsInput)
      ).rejects.toThrow('Mandala not found');
    });

    test('should touch updated_at on parent mandala', async () => {
      const mockTx = createMockTx();
      mockTx.user_mandalas.findFirst.mockResolvedValue(mockRawMandala);
      mockTx.user_mandala_levels.deleteMany.mockResolvedValue({ count: 0 });
      mockTx.user_mandala_levels.create.mockResolvedValue({ id: 'lvl' });
      mockTx.user_mandalas.update.mockResolvedValue({});
      mockTx.user_mandalas.findUnique.mockResolvedValue(mockRawMandala);

      mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(mockTx));

      await manager.updateMandalaLevels(mockUserId, mockMandalaId, [mockLevelsInput[0]!]);

      expect(mockTx.user_mandalas.update).toHaveBeenCalledWith({
        where: { id: mockMandalaId },
        data: { updated_at: expect.any(Date) },
      });
    });
  });

  // ─── deleteMandala ───

  describe('deleteMandala', () => {
    test('should delete mandala and cascade', async () => {
      // Outside tx: verifyOwnership
      mockPrisma.user_mandalas.findFirst
        .mockResolvedValueOnce({ ...mockRawMandala, is_default: false }) // verifyOwnership
        .mockResolvedValueOnce({ id: 'default-m', is_default: true }); // find default for orphan cards
      mockPrisma.userVideoState.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.user_local_cards.updateMany.mockResolvedValue({ count: 0 });

      const mockTx = createMockTx();
      mockTx.user_mandalas.findFirst.mockResolvedValueOnce({
        ...mockRawMandala,
        is_default: false,
      }); // re-verify
      mockTx.user_mandalas.delete.mockResolvedValue({});

      mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(mockTx));

      await manager.deleteMandala(mockUserId, mockMandalaId);

      expect(mockTx.user_mandalas.delete).toHaveBeenCalledWith({
        where: { id: mockMandalaId },
      });
    });

    test('should promote next mandala when deleting default', async () => {
      const defaultMandala = { ...mockRawMandala, is_default: true };
      const nextMandala = { id: 'mandala-2', user_id: mockUserId, is_default: false, position: 1 };

      // Outside tx
      mockPrisma.user_mandalas.findFirst
        .mockResolvedValueOnce(defaultMandala) // verifyOwnership
        .mockResolvedValueOnce(nextMandala); // find next for orphan cards
      mockPrisma.userVideoState.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.user_local_cards.updateMany.mockResolvedValue({ count: 0 });

      const mockTx = createMockTx();
      mockTx.user_mandalas.findFirst
        .mockResolvedValueOnce(defaultMandala) // re-verify (is_default)
        .mockResolvedValueOnce(nextMandala); // find next to promote
      mockTx.user_mandalas.update.mockResolvedValue({});
      mockTx.user_mandalas.delete.mockResolvedValue({});

      mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(mockTx));

      await manager.deleteMandala(mockUserId, mockMandalaId);

      expect(mockTx.user_mandalas.update).toHaveBeenCalledWith({
        where: { id: 'mandala-2' },
        data: { is_default: true },
      });
    });

    test('should move orphaned cards to target mandala', async () => {
      const nonDefaultMandala = { ...mockRawMandala, is_default: false };
      const defaultMandala = { id: 'default-m', is_default: true };

      mockPrisma.user_mandalas.findFirst
        .mockResolvedValueOnce(nonDefaultMandala) // verifyOwnership
        .mockResolvedValueOnce(defaultMandala); // find default
      mockPrisma.userVideoState.updateMany.mockResolvedValue({ count: 2 });
      mockPrisma.user_local_cards.updateMany.mockResolvedValue({ count: 1 });

      const mockTx = createMockTx();
      mockTx.user_mandalas.findFirst.mockResolvedValueOnce(nonDefaultMandala);
      mockTx.user_mandalas.delete.mockResolvedValue({});

      mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(mockTx));

      await manager.deleteMandala(mockUserId, mockMandalaId);

      expect(mockPrisma.userVideoState.updateMany).toHaveBeenCalledWith({
        where: { user_id: mockUserId, mandala_id: mockMandalaId },
        data: { mandala_id: 'default-m', cell_index: -1, level_id: 'scratchpad' },
      });
      expect(mockPrisma.user_local_cards.updateMany).toHaveBeenCalledWith({
        where: { user_id: mockUserId, mandala_id: mockMandalaId },
        data: { mandala_id: 'default-m', cell_index: -1, level_id: 'scratchpad' },
      });
    });

    test('should throw when mandala not found', async () => {
      mockPrisma.user_mandalas.findFirst.mockResolvedValue(null);

      await expect(manager.deleteMandala(mockUserId, 'non-existent')).rejects.toThrow(
        'Mandala not found'
      );
    });

    test('should handle deleting last mandala (no next to promote)', async () => {
      const lastMandala = { ...mockRawMandala, is_default: true };

      mockPrisma.user_mandalas.findFirst
        .mockResolvedValueOnce(lastMandala) // verifyOwnership
        .mockResolvedValueOnce(null); // no next mandala
      mockPrisma.userVideoState.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.user_local_cards.updateMany.mockResolvedValue({ count: 0 });

      const mockTx = createMockTx();
      mockTx.user_mandalas.findFirst
        .mockResolvedValueOnce(lastMandala) // re-verify
        .mockResolvedValueOnce(null); // no next to promote
      mockTx.user_mandalas.delete.mockResolvedValue({});

      mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(mockTx));

      await manager.deleteMandala(mockUserId, mockMandalaId);

      // Should not try to promote
      expect(mockTx.user_mandalas.update).not.toHaveBeenCalled();
      expect(mockTx.user_mandalas.delete).toHaveBeenCalled();
    });
  });

  // ─── getUserQuota ───

  describe('getUserQuota', () => {
    test('should return free tier quota info', async () => {
      mockPrisma.user_subscriptions.findUnique.mockResolvedValue({ tier: 'free' });
      mockPrisma.user_mandalas.count.mockResolvedValue(1);

      const result = await manager.getUserQuota(mockUserId);

      expect(result).toEqual({
        tier: 'free',
        limit: 3,
        used: 1,
        remaining: 2,
      });
    });

    test('should return pro tier quota info', async () => {
      mockPrisma.user_subscriptions.findUnique.mockResolvedValue({ tier: 'pro' });
      mockPrisma.user_mandalas.count.mockResolvedValue(10);

      const result = await manager.getUserQuota(mockUserId);

      expect(result).toEqual({
        tier: 'pro',
        limit: 20,
        used: 10,
        remaining: 10,
      });
    });

    test('should default to free tier when no subscription exists', async () => {
      mockPrisma.user_subscriptions.findUnique.mockResolvedValue(null);
      mockPrisma.user_mandalas.count.mockResolvedValue(0);

      const result = await manager.getUserQuota(mockUserId);

      expect(result.tier).toBe('free');
      expect(result.limit).toBe(3);
      expect(result.remaining).toBe(3);
    });
  });

  // ─── linkCardsToMandala ───

  describe('linkCardsToMandala', () => {
    test('should link unlinked video states and local cards', async () => {
      mockPrisma.userVideoState.updateMany.mockResolvedValue({ count: 5 });
      mockPrisma.user_local_cards.updateMany.mockResolvedValue({ count: 3 });

      const result = await manager.linkCardsToMandala(mockUserId, mockMandalaId);

      expect(result).toEqual({ videoStates: 5, localCards: 3 });
      expect(mockPrisma.userVideoState.updateMany).toHaveBeenCalledWith({
        where: { user_id: mockUserId, mandala_id: null },
        data: { mandala_id: mockMandalaId },
      });
      expect(mockPrisma.user_local_cards.updateMany).toHaveBeenCalledWith({
        where: { user_id: mockUserId, mandala_id: null },
        data: { mandala_id: mockMandalaId },
      });
    });

    test('should return zero counts when nothing to link', async () => {
      mockPrisma.userVideoState.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.user_local_cards.updateMany.mockResolvedValue({ count: 0 });

      const result = await manager.linkCardsToMandala(mockUserId, mockMandalaId);

      expect(result).toEqual({ videoStates: 0, localCards: 0 });
    });
  });

  // ─── upsertMandala ───

  describe('upsertMandala', () => {
    test('should create new default mandala when none exists', async () => {
      const mockTx = createMockTx();
      mockTx.user_mandalas.findFirst
        .mockResolvedValueOnce(null) // no existing default
        .mockResolvedValueOnce({ ...mockRawMandala }); // fetch complete result
      mockTx.user_mandalas.create.mockResolvedValue({
        id: 'new-upsert',
        user_id: mockUserId,
      });
      mockTx.user_mandala_levels.deleteMany.mockResolvedValue({ count: 0 });
      mockTx.user_mandala_levels.create.mockResolvedValue({ id: 'lvl' });

      mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(mockTx));

      await manager.upsertMandala(mockUserId, 'New Title', [mockLevelsInput[0]!]);

      expect(mockTx.user_mandalas.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          user_id: mockUserId,
          title: 'New Title',
          is_default: true,
          position: 0,
        }),
      });
    });

    test('should update existing default mandala', async () => {
      const existing = { id: 'existing-m', user_id: mockUserId };
      const mockTx = createMockTx();
      mockTx.user_mandalas.findFirst
        .mockResolvedValueOnce(existing) // found existing default
        .mockResolvedValueOnce({ ...mockRawMandala, id: 'existing-m' }); // fetch complete
      mockTx.user_mandalas.update.mockResolvedValue({ ...existing, title: 'Updated' });
      mockTx.user_mandala_levels.deleteMany.mockResolvedValue({ count: 1 });
      mockTx.user_mandala_levels.create.mockResolvedValue({ id: 'lvl' });

      mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(mockTx));

      await manager.upsertMandala(mockUserId, 'Updated', [mockLevelsInput[0]!]);

      expect(mockTx.user_mandalas.update).toHaveBeenCalledWith({
        where: { id: 'existing-m' },
        data: expect.objectContaining({ title: 'Updated' }),
      });
      expect(mockTx.user_mandalas.create).not.toHaveBeenCalled();
    });

    test('should replace levels using two-pass pattern', async () => {
      const mockTx = createMockTx();
      mockTx.user_mandalas.findFirst
        .mockResolvedValueOnce({ id: 'm1', user_id: mockUserId })
        .mockResolvedValueOnce(mockRawMandala);
      mockTx.user_mandalas.update.mockResolvedValue({ id: 'm1' });
      mockTx.user_mandala_levels.deleteMany.mockResolvedValue({ count: 2 });
      mockTx.user_mandala_levels.create
        .mockResolvedValueOnce({ id: 'new-root' })
        .mockResolvedValueOnce({ id: 'new-child' });

      mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(mockTx));

      await manager.upsertMandala(mockUserId, 'Test', mockLevelsInput);

      expect(mockTx.user_mandala_levels.deleteMany).toHaveBeenCalled();
      // Root first, then child with parent_level_id
      expect(mockTx.user_mandala_levels.create).toHaveBeenNthCalledWith(1, {
        data: expect.objectContaining({ level_key: 'root', depth: 0 }),
      });
      expect(mockTx.user_mandala_levels.create).toHaveBeenNthCalledWith(2, {
        data: expect.objectContaining({
          level_key: 'child-1',
          parent_level_id: 'new-root',
        }),
      });
    });
  });

  // ─── updateLevel ───

  describe('updateLevel', () => {
    test('should update centerGoal on default mandala level', async () => {
      mockPrisma.user_mandalas.findFirst.mockResolvedValue({ id: 'm1' });
      mockPrisma.user_mandala_levels.updateMany.mockResolvedValue({ count: 1 });

      await manager.updateLevel(mockUserId, 'root', { centerGoal: 'New Goal' });

      expect(mockPrisma.user_mandala_levels.updateMany).toHaveBeenCalledWith({
        where: { mandala_id: 'm1', level_key: 'root' },
        data: expect.objectContaining({ center_goal: 'New Goal' }),
      });
    });

    test('should update subjects and color independently', async () => {
      mockPrisma.user_mandalas.findFirst.mockResolvedValue({ id: 'm1' });
      mockPrisma.user_mandala_levels.updateMany.mockResolvedValue({ count: 1 });

      await manager.updateLevel(mockUserId, 'child-1', {
        subjects: ['A', 'B'],
        color: '#00ff00',
      });

      expect(mockPrisma.user_mandala_levels.updateMany).toHaveBeenCalledWith({
        where: { mandala_id: 'm1', level_key: 'child-1' },
        data: expect.objectContaining({
          subjects: ['A', 'B'],
          color: '#00ff00',
        }),
      });
    });

    test('should throw when no default mandala exists', async () => {
      mockPrisma.user_mandalas.findFirst.mockResolvedValue(null);

      await expect(manager.updateLevel(mockUserId, 'root', { centerGoal: 'X' })).rejects.toThrow(
        'Mandala not found'
      );
    });
  });

  // ─── togglePublic ───

  describe('togglePublic', () => {
    test('should set mandala public with generated slug', async () => {
      const mockTx = createMockTx();
      mockTx.user_mandalas.findFirst.mockResolvedValue(mockRawMandala);
      mockTx.user_mandalas.update.mockResolvedValue({});
      mockTx.user_mandalas.findUnique.mockResolvedValue({
        ...mockRawMandala,
        is_public: true,
        share_slug: 'mock-slug-12',
      });

      mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(mockTx));

      const result = await manager.togglePublic(mockUserId, mockMandalaId, true);

      expect(mockTx.user_mandalas.update).toHaveBeenCalledWith({
        where: { id: mockMandalaId },
        data: expect.objectContaining({
          is_public: true,
          share_slug: 'mock-slug-12',
        }),
      });
      expect(result.isPublic).toBe(true);
      expect(result.shareSlug).toBe('mock-slug-12');
    });

    test('should set mandala private and delete subscriptions', async () => {
      const mockTx = createMockTx();
      mockTx.user_mandalas.findFirst.mockResolvedValue(mockRawMandala);
      mockTx.user_mandalas.update.mockResolvedValue({});
      mockTx.mandala_subscriptions.deleteMany.mockResolvedValue({ count: 5 });
      mockTx.user_mandalas.findUnique.mockResolvedValue({
        ...mockRawMandala,
        is_public: false,
        share_slug: null,
      });

      mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(mockTx));

      const result = await manager.togglePublic(mockUserId, mockMandalaId, false);

      expect(mockTx.user_mandalas.update).toHaveBeenCalledWith({
        where: { id: mockMandalaId },
        data: expect.objectContaining({
          is_public: false,
          share_slug: null,
        }),
      });
      expect(mockTx.mandala_subscriptions.deleteMany).toHaveBeenCalledWith({
        where: { mandala_id: mockMandalaId },
      });
      expect(result.isPublic).toBe(false);
    });

    test('should not delete subscriptions when making public', async () => {
      const mockTx = createMockTx();
      mockTx.user_mandalas.findFirst.mockResolvedValue(mockRawMandala);
      mockTx.user_mandalas.update.mockResolvedValue({});
      mockTx.user_mandalas.findUnique.mockResolvedValue({
        ...mockRawMandala,
        is_public: true,
      });

      mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(mockTx));

      await manager.togglePublic(mockUserId, mockMandalaId, true);

      expect(mockTx.mandala_subscriptions.deleteMany).not.toHaveBeenCalled();
    });

    test('should verify ownership', async () => {
      const mockTx = createMockTx();
      mockTx.user_mandalas.findFirst.mockResolvedValue(null);

      mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(mockTx));

      await expect(manager.togglePublic(mockUserId, 'not-mine', true)).rejects.toThrow(
        'Mandala not found'
      );
    });
  });

  // ─── getPublicMandala ───

  describe('getPublicMandala', () => {
    test('should return public mandala by slug', async () => {
      mockPrisma.user_mandalas.findFirst.mockResolvedValue({
        ...mockRawMandala,
        is_public: true,
        share_slug: 'test-slug',
      });

      const result = await manager.getPublicMandala('test-slug');

      expect(result).not.toBeNull();
      expect(result!.isPublic).toBe(true);
      expect(mockPrisma.user_mandalas.findFirst).toHaveBeenCalledWith({
        where: { share_slug: 'test-slug', is_public: true },
        include: expect.objectContaining({ levels: expect.any(Object) }),
      });
    });

    test('should return null for non-existent or private mandala', async () => {
      mockPrisma.user_mandalas.findFirst.mockResolvedValue(null);

      const result = await manager.getPublicMandala('no-such-slug');

      expect(result).toBeNull();
    });
  });

  // ─── listPublicMandalas ───

  describe('listPublicMandalas', () => {
    test('should return empty list when no public mandalas', async () => {
      mockPrisma.user_mandalas.findMany.mockResolvedValue([]);
      mockPrisma.user_mandalas.count.mockResolvedValue(0);

      const result = await manager.listPublicMandalas();

      expect(result.mandalas).toEqual([]);
      expect(result.total).toBe(0);
    });

    test('should apply pagination and filter by is_public', async () => {
      mockPrisma.user_mandalas.findMany.mockResolvedValue([{ ...mockRawMandala, is_public: true }]);
      mockPrisma.user_mandalas.count.mockResolvedValue(10);

      const result = await manager.listPublicMandalas({ page: 2, limit: 5 });

      expect(result.page).toBe(2);
      expect(result.limit).toBe(5);
      expect(result.total).toBe(10);
      expect(mockPrisma.user_mandalas.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { is_public: true },
          skip: 5,
          take: 5,
        })
      );
    });
  });

  // ─── subscribe ───

  describe('subscribe', () => {
    test('should subscribe to a public mandala', async () => {
      mockPrisma.user_mandalas.findUnique.mockResolvedValue({
        id: mockMandalaId,
        user_id: 'owner-user',
        is_public: true,
      });
      mockPrisma.mandala_subscriptions.create.mockResolvedValue({ id: 'sub-1' });

      await manager.subscribe('subscriber-1', mockMandalaId);

      expect(mockPrisma.mandala_subscriptions.create).toHaveBeenCalledWith({
        data: {
          subscriber_id: 'subscriber-1',
          mandala_id: mockMandalaId,
        },
      });
    });

    test('should throw when mandala not found or not public', async () => {
      mockPrisma.user_mandalas.findUnique.mockResolvedValue(null);

      await expect(manager.subscribe('subscriber-1', 'non-existent')).rejects.toThrow(
        'Mandala not found or not public'
      );
    });

    test('should throw when subscribing to own mandala', async () => {
      mockPrisma.user_mandalas.findUnique.mockResolvedValue({
        id: mockMandalaId,
        user_id: 'subscriber-1',
        is_public: true,
      });

      await expect(manager.subscribe('subscriber-1', mockMandalaId)).rejects.toThrow(
        'Cannot subscribe to own mandala'
      );
    });

    test('should throw on private mandala', async () => {
      mockPrisma.user_mandalas.findUnique.mockResolvedValue({
        id: mockMandalaId,
        user_id: 'owner',
        is_public: false,
      });

      await expect(manager.subscribe('subscriber-1', mockMandalaId)).rejects.toThrow(
        'Mandala not found or not public'
      );
    });
  });

  // ─── unsubscribe ───

  describe('unsubscribe', () => {
    test('should remove subscription', async () => {
      mockPrisma.mandala_subscriptions.deleteMany.mockResolvedValue({ count: 1 });

      await manager.unsubscribe('subscriber-1', mockMandalaId);

      expect(mockPrisma.mandala_subscriptions.deleteMany).toHaveBeenCalledWith({
        where: {
          subscriber_id: 'subscriber-1',
          mandala_id: mockMandalaId,
        },
      });
    });

    test('should throw when subscription not found', async () => {
      mockPrisma.mandala_subscriptions.deleteMany.mockResolvedValue({ count: 0 });

      await expect(manager.unsubscribe('subscriber-1', 'non-existent')).rejects.toThrow(
        'Subscription not found'
      );
    });
  });

  // ─── listSubscriptions ───

  describe('listSubscriptions', () => {
    test('should return subscriptions with pagination', async () => {
      mockPrisma.mandala_subscriptions.findMany.mockResolvedValue([
        {
          id: 'sub-1',
          mandala_id: mockMandalaId,
          subscribed_at: new Date('2024-06-01'),
          mandala: {
            id: mockMandalaId,
            title: 'Public Mandala',
            is_public: true,
            share_slug: 'slug-1',
          },
        },
      ]);
      mockPrisma.mandala_subscriptions.count.mockResolvedValue(1);

      const result = await manager.listSubscriptions('subscriber-1');

      expect(result.subscriptions).toHaveLength(1);
      expect(result.subscriptions[0]!.mandalaId).toBe(mockMandalaId);
      expect(result.subscriptions[0]!.title).toBe('Public Mandala');
      expect(result.total).toBe(1);
    });

    test('should filter out non-public subscriptions', async () => {
      mockPrisma.mandala_subscriptions.findMany.mockResolvedValue([
        {
          id: 'sub-1',
          mandala_id: 'm1',
          subscribed_at: new Date(),
          mandala: { id: 'm1', title: 'Now Private', is_public: false, share_slug: null },
        },
      ]);
      mockPrisma.mandala_subscriptions.count.mockResolvedValue(1);

      const result = await manager.listSubscriptions('subscriber-1');

      expect(result.subscriptions).toHaveLength(0);
    });
  });

  // ─── logActivity ───

  describe('logActivity', () => {
    test('should create activity log entry', async () => {
      mockPrisma.mandala_activity_log.create.mockResolvedValue({ id: 'log-1' });

      await manager.logActivity(mockMandalaId, mockUserId, 'share_enabled', 'mandala');

      expect(mockPrisma.mandala_activity_log.create).toHaveBeenCalledWith({
        data: {
          mandala_id: mockMandalaId,
          user_id: mockUserId,
          action: 'share_enabled',
          entity_type: 'mandala',
          entity_id: undefined,
          metadata: undefined,
        },
      });
    });

    test('should include optional entityId and metadata', async () => {
      mockPrisma.mandala_activity_log.create.mockResolvedValue({ id: 'log-2' });

      await manager.logActivity(mockMandalaId, mockUserId, 'card_added', 'card', 'card-123', {
        position: 3,
      });

      expect(mockPrisma.mandala_activity_log.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          entity_id: 'card-123',
          metadata: { position: 3 },
        }),
      });
    });
  });

  // ─── getActivityLog ───

  describe('getActivityLog', () => {
    test('should return activity log for public mandala', async () => {
      mockPrisma.user_mandalas.findUnique.mockResolvedValue({ is_public: true });
      mockPrisma.mandala_activity_log.findMany.mockResolvedValue([
        {
          id: 'log-1',
          action: 'share_enabled',
          entity_type: 'mandala',
          entity_id: null,
          metadata: null,
          created_at: new Date('2024-06-01'),
        },
      ]);
      mockPrisma.mandala_activity_log.count.mockResolvedValue(1);

      const result = await manager.getActivityLog(mockMandalaId);

      expect(result.activities).toHaveLength(1);
      expect(result.activities[0]!.action).toBe('share_enabled');
      expect(result.activities[0]!.entityType).toBe('mandala');
      expect(result.total).toBe(1);
    });

    test('should throw for non-public mandala', async () => {
      mockPrisma.user_mandalas.findUnique.mockResolvedValue({ is_public: false });

      await expect(manager.getActivityLog(mockMandalaId)).rejects.toThrow(
        'Mandala not found or not public'
      );
    });

    test('should throw for non-existent mandala', async () => {
      mockPrisma.user_mandalas.findUnique.mockResolvedValue(null);

      await expect(manager.getActivityLog('non-existent')).rejects.toThrow(
        'Mandala not found or not public'
      );
    });

    test('should apply pagination', async () => {
      mockPrisma.user_mandalas.findUnique.mockResolvedValue({ is_public: true });
      mockPrisma.mandala_activity_log.findMany.mockResolvedValue([]);
      mockPrisma.mandala_activity_log.count.mockResolvedValue(100);

      const result = await manager.getActivityLog(mockMandalaId, { page: 2, limit: 10 });

      expect(result.page).toBe(2);
      expect(result.limit).toBe(10);
      expect(mockPrisma.mandala_activity_log.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 10 })
      );
    });
  });
});
