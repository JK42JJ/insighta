/**
 * Database module index exports test
 */

import * as databaseModule from '../../../../src/modules/database';

describe('Database Module Index', () => {
  describe('Client exports', () => {
    it('should export db client', () => {
      expect(databaseModule.db).toBeDefined();
      expect(typeof databaseModule.db.$connect).toBe('function');
      expect(typeof databaseModule.db.$disconnect).toBe('function');
    });

    it('should export getPrismaClient function', () => {
      expect(databaseModule.getPrismaClient).toBeDefined();
      expect(typeof databaseModule.getPrismaClient).toBe('function');
    });

    it('should return same instance from getPrismaClient', () => {
      const instance1 = databaseModule.getPrismaClient();
      const instance2 = databaseModule.getPrismaClient();
      expect(instance1).toBe(instance2);
    });
  });

  describe('Export structure', () => {
    it('should export expected properties', () => {
      const exports = Object.keys(databaseModule);
      expect(exports).toContain('db');
      expect(exports).toContain('getPrismaClient');
    });
  });
});
