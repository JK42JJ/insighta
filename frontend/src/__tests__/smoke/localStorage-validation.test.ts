import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  mandalaLevelSchema,
  subLevelSchema,
  parseValidatedMandalaLevel,
  parseValidatedSubLevel,
  safeParseJSON,
} from '@shared/lib/localStorageValidation';

const VALID_MANDALA_LEVEL = {
  id: 'level-1',
  centerGoal: 'Learn AI',
  subjects: ['ML', 'DL', 'NLP', 'CV', 'RL', 'Ethics', 'Math', 'Data'],
  parentId: null,
  parentCellIndex: null,
  cards: [],
};

const VALID_SUB_LEVEL = {
  id: 'sub-1',
  centerGoal: 'Master ML',
  subjects: ['Linear', 'Trees', 'SVM', 'KNN', 'Ensemble', 'Neural', 'Reg', 'Cluster'],
  parentId: 'level-1',
  parentCellIndex: 3,
};

describe('mandalaLevelSchema', () => {
  it('accepts valid mandala level', () => {
    const result = mandalaLevelSchema.safeParse(VALID_MANDALA_LEVEL);
    expect(result.success).toBe(true);
  });

  it('rejects subjects with wrong length', () => {
    const invalid = { ...VALID_MANDALA_LEVEL, subjects: ['only', 'three', 'items'] };
    const result = mandalaLevelSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('rejects missing id', () => {
    const { id: _, ...noId } = VALID_MANDALA_LEVEL;
    const result = mandalaLevelSchema.safeParse(noId);
    expect(result.success).toBe(false);
  });

  it('rejects missing centerGoal', () => {
    const { centerGoal: _, ...noCG } = VALID_MANDALA_LEVEL;
    const result = mandalaLevelSchema.safeParse(noCG);
    expect(result.success).toBe(false);
  });

  it('defaults cards to empty array', () => {
    const { cards: _, ...noCards } = VALID_MANDALA_LEVEL;
    const result = mandalaLevelSchema.safeParse(noCards);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cards).toEqual([]);
    }
  });
});

describe('subLevelSchema', () => {
  it('accepts valid sub-level', () => {
    const result = subLevelSchema.safeParse(VALID_SUB_LEVEL);
    expect(result.success).toBe(true);
  });

  it('accepts minimal sub-level (subjects only)', () => {
    const minimal = {
      subjects: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
    };
    const result = subLevelSchema.safeParse(minimal);
    expect(result.success).toBe(true);
  });

  it('rejects subjects with wrong length', () => {
    const result = subLevelSchema.safeParse({ subjects: ['one'] });
    expect(result.success).toBe(false);
  });
});

describe('parseValidatedMandalaLevel', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns parsed data for valid localStorage entry', () => {
    localStorage.setItem('test-key', JSON.stringify(VALID_MANDALA_LEVEL));
    const result = parseValidatedMandalaLevel('test-key');
    expect(result).not.toBeNull();
    expect(result?.id).toBe('level-1');
    expect(result?.centerGoal).toBe('Learn AI');
    expect(result?.subjects).toHaveLength(8);
  });

  it('returns null for missing key', () => {
    expect(parseValidatedMandalaLevel('nonexistent')).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    localStorage.setItem('bad-json', '{not valid json');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(parseValidatedMandalaLevel('bad-json')).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('returns null for valid JSON but invalid schema', () => {
    localStorage.setItem('bad-schema', JSON.stringify({ foo: 'bar' }));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(parseValidatedMandalaLevel('bad-schema')).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe('parseValidatedSubLevel', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns subjects array for valid sub-level', () => {
    localStorage.setItem('sub-key', JSON.stringify(VALID_SUB_LEVEL));
    const result = parseValidatedSubLevel('sub-key');
    expect(result).toEqual(VALID_SUB_LEVEL.subjects);
  });

  it('returns null for missing key', () => {
    expect(parseValidatedSubLevel('nonexistent')).toBeNull();
  });

  it('returns null for invalid schema', () => {
    localStorage.setItem('bad', JSON.stringify({ subjects: ['too', 'few'] }));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(parseValidatedSubLevel('bad')).toBeNull();
    warnSpy.mockRestore();
  });
});

describe('safeParseJSON', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('parses valid JSON', () => {
    localStorage.setItem('json-key', JSON.stringify({ a: 1, b: 'two' }));
    const result = safeParseJSON<{ a: number; b: string }>('json-key');
    expect(result).toEqual({ a: 1, b: 'two' });
  });

  it('returns null for missing key', () => {
    expect(safeParseJSON('missing')).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    localStorage.setItem('broken', 'not json');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(safeParseJSON('broken')).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('parses arrays', () => {
    localStorage.setItem('arr', JSON.stringify([1, 2, 3]));
    expect(safeParseJSON<number[]>('arr')).toEqual([1, 2, 3]);
  });

  it('parses primitive values', () => {
    localStorage.setItem('str', JSON.stringify('hello'));
    expect(safeParseJSON<string>('str')).toBe('hello');
  });
});
