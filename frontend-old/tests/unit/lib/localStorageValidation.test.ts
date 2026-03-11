/**
 * localStorage Validation Tests
 *
 * Tests for Zod-based localStorage validation including:
 * - mandalaLevelSchema (8-subject constraint)
 * - subLevelSchema validation
 * - parseValidatedMandalaLevel function
 * - parseValidatedSubLevel function
 * - safeParseJSON utility
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  mandalaLevelSchema,
  subLevelSchema,
  parseValidatedMandalaLevel,
  parseValidatedSubLevel,
  safeParseJSON,
} from '@/lib/localStorageValidation';

// ============================================
// Test Data Factories
// ============================================

function createValidMandalaLevel(overrides = {}) {
  return {
    id: 'level-1',
    centerGoal: 'Master TypeScript',
    subjects: ['Basics', 'Types', 'Functions', 'Classes', 'Generics', 'Decorators', 'Modules', 'Testing'],
    parentId: null,
    parentCellIndex: null,
    cards: [],
    ...overrides,
  };
}

function createValidSubLevel(overrides = {}) {
  return {
    id: 'sub-1',
    centerGoal: 'Learn Basics',
    subjects: ['Variables', 'Operators', 'Control Flow', 'Loops', 'Arrays', 'Objects', 'Functions', 'Errors'],
    parentId: 'level-1',
    parentCellIndex: 0,
    cards: [],
    ...overrides,
  };
}

// ============================================
// Schema Tests
// ============================================

describe('mandalaLevelSchema', () => {
  describe('valid data', () => {
    it('should validate a complete mandala level', () => {
      const data = createValidMandalaLevel();
      const result = mandalaLevelSchema.safeParse(data);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toBe('level-1');
        expect(result.data.subjects).toHaveLength(8);
      }
    });

    it('should validate with parent references', () => {
      const data = createValidMandalaLevel({
        parentId: 'parent-level',
        parentCellIndex: 3,
      });
      const result = mandalaLevelSchema.safeParse(data);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.parentId).toBe('parent-level');
        expect(result.data.parentCellIndex).toBe(3);
      }
    });

    it('should default cards to empty array if not provided', () => {
      const data = {
        id: 'level-1',
        centerGoal: 'Goal',
        subjects: ['1', '2', '3', '4', '5', '6', '7', '8'],
        parentId: null,
        parentCellIndex: null,
      };
      const result = mandalaLevelSchema.safeParse(data);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.cards).toEqual([]);
      }
    });

    it('should accept cards with any content', () => {
      const data = createValidMandalaLevel({
        cards: [
          { id: 'card-1', title: 'Card 1' },
          { id: 'card-2', content: 'Some content' },
        ],
      });
      const result = mandalaLevelSchema.safeParse(data);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.cards).toHaveLength(2);
      }
    });
  });

  describe('8-subject constraint', () => {
    it('should reject fewer than 8 subjects', () => {
      const data = createValidMandalaLevel({
        subjects: ['1', '2', '3', '4', '5', '6', '7'], // 7 subjects
      });
      const result = mandalaLevelSchema.safeParse(data);

      expect(result.success).toBe(false);
    });

    it('should reject more than 8 subjects', () => {
      const data = createValidMandalaLevel({
        subjects: ['1', '2', '3', '4', '5', '6', '7', '8', '9'], // 9 subjects
      });
      const result = mandalaLevelSchema.safeParse(data);

      expect(result.success).toBe(false);
    });

    it('should accept exactly 8 subjects', () => {
      const data = createValidMandalaLevel({
        subjects: ['1', '2', '3', '4', '5', '6', '7', '8'],
      });
      const result = mandalaLevelSchema.safeParse(data);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.subjects).toHaveLength(8);
      }
    });

    it('should reject empty subjects array', () => {
      const data = createValidMandalaLevel({
        subjects: [],
      });
      const result = mandalaLevelSchema.safeParse(data);

      expect(result.success).toBe(false);
    });
  });

  describe('invalid data', () => {
    it('should reject missing id', () => {
      const { id, ...data } = createValidMandalaLevel();
      const result = mandalaLevelSchema.safeParse(data);

      expect(result.success).toBe(false);
    });

    it('should reject missing centerGoal', () => {
      const { centerGoal, ...data } = createValidMandalaLevel();
      const result = mandalaLevelSchema.safeParse(data);

      expect(result.success).toBe(false);
    });

    it('should reject non-string subjects', () => {
      const data = createValidMandalaLevel({
        subjects: [1, 2, 3, 4, 5, 6, 7, 8],
      });
      const result = mandalaLevelSchema.safeParse(data);

      expect(result.success).toBe(false);
    });

    it('should reject null subjects', () => {
      const data = createValidMandalaLevel({
        subjects: null,
      });
      const result = mandalaLevelSchema.safeParse(data);

      expect(result.success).toBe(false);
    });
  });
});

describe('subLevelSchema', () => {
  describe('valid data', () => {
    it('should validate a complete sub-level', () => {
      const data = createValidSubLevel();
      const result = subLevelSchema.safeParse(data);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.subjects).toHaveLength(8);
      }
    });

    it('should validate with minimal required fields (only subjects)', () => {
      const data = {
        subjects: ['1', '2', '3', '4', '5', '6', '7', '8'],
      };
      const result = subLevelSchema.safeParse(data);

      expect(result.success).toBe(true);
    });

    it('should allow optional fields to be undefined', () => {
      const data = {
        subjects: ['1', '2', '3', '4', '5', '6', '7', '8'],
        id: undefined,
        centerGoal: undefined,
        parentId: undefined,
        parentCellIndex: undefined,
        cards: undefined,
      };
      const result = subLevelSchema.safeParse(data);

      expect(result.success).toBe(true);
    });
  });

  describe('8-subject constraint', () => {
    it('should reject fewer than 8 subjects', () => {
      const data = createValidSubLevel({
        subjects: ['1', '2', '3'],
      });
      const result = subLevelSchema.safeParse(data);

      expect(result.success).toBe(false);
    });

    it('should reject more than 8 subjects', () => {
      const data = createValidSubLevel({
        subjects: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'],
      });
      const result = subLevelSchema.safeParse(data);

      expect(result.success).toBe(false);
    });
  });

  describe('invalid data', () => {
    it('should reject missing subjects', () => {
      const { subjects, ...data } = createValidSubLevel();
      const result = subLevelSchema.safeParse(data);

      expect(result.success).toBe(false);
    });
  });
});

// ============================================
// Function Tests
// ============================================

describe('parseValidatedMandalaLevel', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  describe('successful parsing', () => {
    it('should parse and validate a valid mandala level', () => {
      const data = createValidMandalaLevel();
      localStorage.setItem('test-key', JSON.stringify(data));

      const result = parseValidatedMandalaLevel('test-key');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('level-1');
      expect(result?.centerGoal).toBe('Master TypeScript');
      expect(result?.subjects).toHaveLength(8);
    });

    it('should return data with all properties', () => {
      const data = createValidMandalaLevel({
        parentId: 'parent-1',
        parentCellIndex: 5,
        cards: [{ id: 'card-1' }],
      });
      localStorage.setItem('test-key', JSON.stringify(data));

      const result = parseValidatedMandalaLevel('test-key');

      expect(result?.parentId).toBe('parent-1');
      expect(result?.parentCellIndex).toBe(5);
      expect(result?.cards).toHaveLength(1);
    });
  });

  describe('null return cases', () => {
    it('should return null when key does not exist', () => {
      const result = parseValidatedMandalaLevel('nonexistent-key');

      expect(result).toBeNull();
    });

    it('should return null for invalid JSON', () => {
      localStorage.setItem('test-key', 'not-valid-json{');

      const result = parseValidatedMandalaLevel('test-key');

      expect(result).toBeNull();
      expect(console.warn).toHaveBeenCalled();
    });

    it('should return null for empty string', () => {
      localStorage.setItem('test-key', '');

      const result = parseValidatedMandalaLevel('test-key');

      expect(result).toBeNull();
    });

    it('should return null when validation fails (wrong subject count)', () => {
      const data = createValidMandalaLevel({
        subjects: ['1', '2', '3'], // Only 3 subjects
      });
      localStorage.setItem('test-key', JSON.stringify(data));

      const result = parseValidatedMandalaLevel('test-key');

      expect(result).toBeNull();
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('Invalid data in localStorage key'),
        expect.anything()
      );
    });

    it('should return null when validation fails (missing required field)', () => {
      const data = { subjects: ['1', '2', '3', '4', '5', '6', '7', '8'] }; // Missing id, centerGoal
      localStorage.setItem('test-key', JSON.stringify(data));

      const result = parseValidatedMandalaLevel('test-key');

      expect(result).toBeNull();
    });

    it('should return null for null JSON value', () => {
      localStorage.setItem('test-key', 'null');

      const result = parseValidatedMandalaLevel('test-key');

      expect(result).toBeNull();
    });
  });
});

describe('parseValidatedSubLevel', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  describe('successful parsing', () => {
    it('should parse and return subjects array', () => {
      const data = createValidSubLevel();
      localStorage.setItem('test-key', JSON.stringify(data));

      const result = parseValidatedSubLevel('test-key');

      expect(result).not.toBeNull();
      expect(result).toHaveLength(8);
      expect(result?.[0]).toBe('Variables');
    });

    it('should return only subjects, not other properties', () => {
      const data = createValidSubLevel();
      localStorage.setItem('test-key', JSON.stringify(data));

      const result = parseValidatedSubLevel('test-key');

      // Result should be an array, not an object
      expect(Array.isArray(result)).toBe(true);
      expect(result).toEqual(data.subjects);
    });

    it('should work with minimal data (only subjects)', () => {
      const data = {
        subjects: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'],
      };
      localStorage.setItem('test-key', JSON.stringify(data));

      const result = parseValidatedSubLevel('test-key');

      expect(result).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
    });
  });

  describe('null return cases', () => {
    it('should return null when key does not exist', () => {
      const result = parseValidatedSubLevel('nonexistent-key');

      expect(result).toBeNull();
    });

    it('should return null for invalid JSON', () => {
      localStorage.setItem('test-key', '{invalid');

      const result = parseValidatedSubLevel('test-key');

      expect(result).toBeNull();
      expect(console.warn).toHaveBeenCalled();
    });

    it('should return null when validation fails (wrong subject count)', () => {
      const data = { subjects: ['1', '2'] };
      localStorage.setItem('test-key', JSON.stringify(data));

      const result = parseValidatedSubLevel('test-key');

      expect(result).toBeNull();
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('Invalid sub-level data'),
        expect.anything()
      );
    });

    it('should return null when subjects is missing', () => {
      const data = { id: 'sub-1', centerGoal: 'Goal' };
      localStorage.setItem('test-key', JSON.stringify(data));

      const result = parseValidatedSubLevel('test-key');

      expect(result).toBeNull();
    });
  });
});

describe('safeParseJSON', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  describe('successful parsing', () => {
    it('should parse valid JSON object', () => {
      const data = { name: 'test', value: 42 };
      localStorage.setItem('test-key', JSON.stringify(data));

      const result = safeParseJSON<{ name: string; value: number }>('test-key');

      expect(result).toEqual(data);
    });

    it('should parse valid JSON array', () => {
      const data = [1, 2, 3, 4, 5];
      localStorage.setItem('test-key', JSON.stringify(data));

      const result = safeParseJSON<number[]>('test-key');

      expect(result).toEqual(data);
    });

    it('should parse valid JSON string', () => {
      localStorage.setItem('test-key', JSON.stringify('hello world'));

      const result = safeParseJSON<string>('test-key');

      expect(result).toBe('hello world');
    });

    it('should parse valid JSON number', () => {
      localStorage.setItem('test-key', JSON.stringify(12345));

      const result = safeParseJSON<number>('test-key');

      expect(result).toBe(12345);
    });

    it('should parse valid JSON boolean', () => {
      localStorage.setItem('test-key', JSON.stringify(true));

      const result = safeParseJSON<boolean>('test-key');

      expect(result).toBe(true);
    });

    it('should parse null JSON value', () => {
      localStorage.setItem('test-key', 'null');

      const result = safeParseJSON<null>('test-key');

      expect(result).toBeNull();
    });

    it('should parse nested objects', () => {
      const data = {
        user: {
          name: 'John',
          settings: {
            theme: 'dark',
            notifications: true,
          },
        },
        items: [{ id: 1 }, { id: 2 }],
      };
      localStorage.setItem('test-key', JSON.stringify(data));

      const result = safeParseJSON<typeof data>('test-key');

      expect(result).toEqual(data);
    });
  });

  describe('null return cases', () => {
    it('should return null when key does not exist', () => {
      const result = safeParseJSON<unknown>('nonexistent-key');

      expect(result).toBeNull();
    });

    it('should return null for invalid JSON', () => {
      localStorage.setItem('test-key', 'not valid json');

      const result = safeParseJSON<unknown>('test-key');

      expect(result).toBeNull();
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to parse localStorage key'),
        expect.anything()
      );
    });

    it('should return null for truncated JSON', () => {
      localStorage.setItem('test-key', '{"incomplete":');

      const result = safeParseJSON<unknown>('test-key');

      expect(result).toBeNull();
    });

    it('should return null for JavaScript syntax (not JSON)', () => {
      localStorage.setItem('test-key', "{ key: 'value' }"); // JS object, not JSON

      const result = safeParseJSON<unknown>('test-key');

      expect(result).toBeNull();
    });
  });

  describe('edge cases', () => {
    it('should handle empty object', () => {
      localStorage.setItem('test-key', '{}');

      const result = safeParseJSON<Record<string, unknown>>('test-key');

      expect(result).toEqual({});
    });

    it('should handle empty array', () => {
      localStorage.setItem('test-key', '[]');

      const result = safeParseJSON<unknown[]>('test-key');

      expect(result).toEqual([]);
    });

    it('should handle zero', () => {
      localStorage.setItem('test-key', '0');

      const result = safeParseJSON<number>('test-key');

      expect(result).toBe(0);
    });

    it('should handle false', () => {
      localStorage.setItem('test-key', 'false');

      const result = safeParseJSON<boolean>('test-key');

      expect(result).toBe(false);
    });

    it('should handle empty string JSON', () => {
      localStorage.setItem('test-key', '""');

      const result = safeParseJSON<string>('test-key');

      expect(result).toBe('');
    });

    it('should handle unicode strings', () => {
      const data = '한글 테스트 🎉';
      localStorage.setItem('test-key', JSON.stringify(data));

      const result = safeParseJSON<string>('test-key');

      expect(result).toBe(data);
    });

    it('should handle special characters in strings', () => {
      const data = 'line1\nline2\ttab\\backslash"quote';
      localStorage.setItem('test-key', JSON.stringify(data));

      const result = safeParseJSON<string>('test-key');

      expect(result).toBe(data);
    });
  });
});
