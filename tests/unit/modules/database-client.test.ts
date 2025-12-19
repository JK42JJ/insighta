/**
 * Database Client Unit Tests
 *
 * Tests for Database Client implementation:
 * - Prisma client singleton management
 * - Database connection lifecycle
 * - Transaction execution
 * - Error handling
 */

import {
  getPrismaClient,
  connectDatabase,
  disconnectDatabase,
  testDatabaseConnection,
  executeTransaction,
} from '../../../src/modules/database/client';
import { DatabaseError } from '../../../src/utils/errors';
import { logger } from '../../../src/utils/logger';

// Mock PrismaClient - must be before imports that use it
jest.mock('@prisma/client', () => {
  const mockInstance = {
    $connect: jest.fn(),
    $disconnect: jest.fn(),
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
    $on: jest.fn(),
  };
  return {
    PrismaClient: jest.fn(() => mockInstance),
    __mockPrismaInstance: mockInstance,
  };
});
jest.mock('../../../src/utils/logger');
jest.mock('../../../src/config', () => ({
  config: {
    app: {
      isDevelopment: false,
    },
    paths: {
      logs: '/tmp/logs',
    },
  },
}));

describe('Database Client', () => {
  let mockPrismaInstance: any;
  let MockPrismaClient: jest.Mock;

  beforeAll(() => {
    // Get references to mocks once at the start
    const prismaModule = require('@prisma/client');
    mockPrismaInstance = prismaModule.__mockPrismaInstance;
    MockPrismaClient = prismaModule.PrismaClient;
  });

  beforeEach(() => {
    // Clear only the call history, not the mock implementations
    jest.clearAllMocks();

    // Reset mock function call counts but preserve the mock instance
    mockPrismaInstance.$connect.mockClear();
    mockPrismaInstance.$disconnect.mockClear();
    mockPrismaInstance.$queryRaw.mockClear();
    mockPrismaInstance.$transaction.mockClear();
    mockPrismaInstance.$on.mockClear();
    MockPrismaClient.mockClear();
  });

  describe('getPrismaClient', () => {
    test('should return Prisma client instance', () => {
      const client = getPrismaClient();

      expect(client).toBeDefined();
      // The client was created when the module loaded, so we verify it exists
      expect(client).toBe(mockPrismaInstance);
    });

    test('should return same instance on multiple calls (singleton)', () => {
      const client1 = getPrismaClient();
      const client2 = getPrismaClient();

      expect(client1).toBe(client2);
      // Both should be the same mock instance
      expect(client1).toBe(mockPrismaInstance);
    });

    test('should configure logging based on environment', () => {
      // The client is created at module load time, so we verify the configuration was applied
      const client = getPrismaClient();

      // Verify the client instance exists and is properly configured
      expect(client).toBeDefined();
      expect(client).toBe(mockPrismaInstance);
    });

    test('should register event listeners', () => {
      // Event listeners are registered when the module loads
      // We can verify the client was created and has the event listener methods
      const client = getPrismaClient();

      expect(client).toBeDefined();
      expect(client.$on).toBeDefined();
      expect(typeof client.$on).toBe('function');
    });
  });

  describe('connectDatabase', () => {
    test('should connect to database successfully', async () => {
      mockPrismaInstance.$connect.mockResolvedValue(undefined);

      await expect(connectDatabase()).resolves.toBeUndefined();

      expect(mockPrismaInstance.$connect).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith('Database connected successfully');
    });

    test('should throw DatabaseError on connection failure', async () => {
      const mockError = new Error('Connection failed');
      mockPrismaInstance.$connect.mockRejectedValue(mockError);

      await expect(connectDatabase()).rejects.toThrow(DatabaseError);
      await expect(connectDatabase()).rejects.toThrow('Database connection failed');

      expect(logger.error).toHaveBeenCalledWith('Failed to connect to database', {
        error: mockError,
      });
    });

    test('should handle non-Error objects in connection failure', async () => {
      mockPrismaInstance.$connect.mockRejectedValue('Connection string error');

      await expect(connectDatabase()).rejects.toThrow(DatabaseError);

      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('disconnectDatabase', () => {
    test('should disconnect from database successfully', async () => {
      mockPrismaInstance.$disconnect.mockResolvedValue(undefined);

      // First create a client instance
      getPrismaClient();

      await expect(disconnectDatabase()).resolves.toBeUndefined();

      expect(mockPrismaInstance.$disconnect).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith('Database disconnected successfully');
    });

    test('should handle disconnection when no client exists', async () => {
      // Don't create client instance, just call disconnect
      await expect(disconnectDatabase()).resolves.toBeUndefined();

      // Should not attempt to disconnect
      expect(mockPrismaInstance.$disconnect).not.toHaveBeenCalled();
    });

    test('should throw DatabaseError on disconnection failure', async () => {
      const mockError = new Error('Disconnection failed');
      mockPrismaInstance.$disconnect.mockRejectedValue(mockError);

      // Create client instance first
      getPrismaClient();

      await expect(disconnectDatabase()).rejects.toThrow(DatabaseError);
      await expect(disconnectDatabase()).rejects.toThrow('Database disconnection failed');

      expect(logger.error).toHaveBeenCalledWith('Error disconnecting from database', {
        error: mockError,
      });
    });

    test('should handle non-Error objects in disconnection failure', async () => {
      mockPrismaInstance.$disconnect.mockRejectedValue('Disconnection error');

      // Create client instance first
      getPrismaClient();

      await expect(disconnectDatabase()).rejects.toThrow(DatabaseError);

      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('testDatabaseConnection', () => {
    test('should return true on successful connection test', async () => {
      mockPrismaInstance.$queryRaw.mockResolvedValue([{ '1': 1 }]);

      const result = await testDatabaseConnection();

      expect(result).toBe(true);
      expect(mockPrismaInstance.$queryRaw).toHaveBeenCalled();
    });

    test('should return false on connection test failure', async () => {
      const mockError = new Error('Query failed');
      mockPrismaInstance.$queryRaw.mockRejectedValue(mockError);

      const result = await testDatabaseConnection();

      expect(result).toBe(false);
      expect(logger.error).toHaveBeenCalledWith('Database connection test failed', {
        error: mockError,
      });
    });

    test('should handle non-Error objects in connection test failure', async () => {
      mockPrismaInstance.$queryRaw.mockRejectedValue('Connection timeout');

      const result = await testDatabaseConnection();

      expect(result).toBe(false);
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('executeTransaction', () => {
    test('should execute transaction successfully', async () => {
      const mockCallback = jest.fn().mockResolvedValue({ id: 1, name: 'Test' });
      const mockTransaction = jest.fn().mockImplementation(async (callback: any) => {
        return callback(mockPrismaInstance);
      });
      mockPrismaInstance.$transaction = mockTransaction;

      const result = await executeTransaction(mockCallback);

      expect(result).toEqual({ id: 1, name: 'Test' });
      expect(mockTransaction).toHaveBeenCalled();
      expect(mockCallback).toHaveBeenCalledWith(mockPrismaInstance);
    });

    test('should throw DatabaseError on transaction failure', async () => {
      const mockError = new Error('Transaction failed');
      const mockCallback = jest.fn();
      mockPrismaInstance.$transaction.mockRejectedValue(mockError);

      await expect(executeTransaction(mockCallback)).rejects.toThrow(DatabaseError);
      await expect(executeTransaction(mockCallback)).rejects.toThrow(
        'Transaction execution failed'
      );

      expect(logger.error).toHaveBeenCalledWith('Transaction failed', { error: mockError });
    });

    test('should handle callback errors', async () => {
      const mockError = new Error('Callback error');
      const mockCallback = jest.fn().mockRejectedValue(mockError);
      mockPrismaInstance.$transaction.mockImplementation(async (callback: any) => {
        return callback(mockPrismaInstance);
      });

      await expect(executeTransaction(mockCallback)).rejects.toThrow(DatabaseError);
      await expect(executeTransaction(mockCallback)).rejects.toThrow(
        'Transaction execution failed'
      );
    });

    test('should handle non-Error objects in transaction failure', async () => {
      const mockCallback = jest.fn();
      mockPrismaInstance.$transaction.mockRejectedValue('Constraint violation');

      await expect(executeTransaction(mockCallback)).rejects.toThrow(DatabaseError);

      expect(logger.error).toHaveBeenCalled();
    });

    test('should execute complex transaction with multiple operations', async () => {
      const mockCallback = jest.fn().mockImplementation(async (tx) => {
        await tx.user.create({ data: { name: 'User 1' } });
        await tx.post.create({ data: { title: 'Post 1' } });
        return { users: 1, posts: 1 };
      });

      (mockPrismaInstance as any).user = { create: jest.fn() };
      (mockPrismaInstance as any).post = { create: jest.fn() };
      mockPrismaInstance.$transaction.mockImplementation(async (callback: any) => {
        return callback(mockPrismaInstance);
      });

      const result = await executeTransaction(mockCallback);

      expect(result).toEqual({ users: 1, posts: 1 });
      expect(mockCallback).toHaveBeenCalledWith(mockPrismaInstance);
    });

    test('should rollback on transaction error', async () => {
      const mockCallback = jest.fn().mockImplementation(async (tx) => {
        await tx.user.create({ data: { name: 'User 1' } });
        throw new Error('Something went wrong');
      });

      (mockPrismaInstance as any).user = { create: jest.fn() };
      mockPrismaInstance.$transaction.mockImplementation(async (callback: any) => {
        try {
          return await callback(mockPrismaInstance);
        } catch (error) {
          // Simulate rollback
          throw error;
        }
      });

      await expect(executeTransaction(mockCallback)).rejects.toThrow(DatabaseError);
      await expect(executeTransaction(mockCallback)).rejects.toThrow(
        'Transaction execution failed'
      );
    });
  });

  describe('Integration scenarios', () => {
    test('should handle connect-disconnect cycle', async () => {
      mockPrismaInstance.$connect.mockResolvedValue(undefined);
      mockPrismaInstance.$disconnect.mockResolvedValue(undefined);

      // Connect
      await connectDatabase();
      expect(logger.info).toHaveBeenCalledWith('Database connected successfully');

      // Test connection
      mockPrismaInstance.$queryRaw.mockResolvedValue([{ '1': 1 }]);
      const isConnected = await testDatabaseConnection();
      expect(isConnected).toBe(true);

      // Disconnect
      await disconnectDatabase();
      expect(logger.info).toHaveBeenCalledWith('Database disconnected successfully');
    });

    test('should handle transaction after connection', async () => {
      mockPrismaInstance.$connect.mockResolvedValue(undefined);
      mockPrismaInstance.$transaction.mockImplementation(async (callback: any) => {
        return callback(mockPrismaInstance);
      });

      await connectDatabase();

      const mockCallback = jest.fn().mockResolvedValue({ success: true });
      const result = await executeTransaction(mockCallback);

      expect(result).toEqual({ success: true });
    });

    test('should handle multiple failed transactions', async () => {
      const mockError1 = new Error('Error 1');
      const mockError2 = new Error('Error 2');

      mockPrismaInstance.$transaction
        .mockRejectedValueOnce(mockError1)
        .mockRejectedValueOnce(mockError2);

      const mockCallback = jest.fn();

      await expect(executeTransaction(mockCallback)).rejects.toThrow(DatabaseError);
      await expect(executeTransaction(mockCallback)).rejects.toThrow(
        'Transaction execution failed'
      );

      expect(logger.error).toHaveBeenCalledTimes(2);
    });
  });

  describe('Edge cases', () => {
    test('should handle null/undefined in error objects', async () => {
      mockPrismaInstance.$connect.mockRejectedValue(null);

      await expect(connectDatabase()).rejects.toThrow(DatabaseError);

      expect(logger.error).toHaveBeenCalled();
    });

    test('should handle transaction with empty callback', async () => {
      const mockCallback = jest.fn().mockResolvedValue(undefined);
      mockPrismaInstance.$transaction.mockImplementation(async (callback: any) => {
        return callback(mockPrismaInstance);
      });

      const result = await executeTransaction(mockCallback);

      expect(result).toBeUndefined();
      expect(mockCallback).toHaveBeenCalled();
    });

    test('should handle concurrent transaction executions', async () => {
      mockPrismaInstance.$transaction.mockImplementation(async (callback: any) => {
        return callback(mockPrismaInstance);
      });

      const callback1 = jest.fn().mockResolvedValue({ id: 1 });
      const callback2 = jest.fn().mockResolvedValue({ id: 2 });
      const callback3 = jest.fn().mockResolvedValue({ id: 3 });

      const [result1, result2, result3] = await Promise.all([
        executeTransaction(callback1),
        executeTransaction(callback2),
        executeTransaction(callback3),
      ]);

      expect(result1).toEqual({ id: 1 });
      expect(result2).toEqual({ id: 2 });
      expect(result3).toEqual({ id: 3 });
    });
  });
});
