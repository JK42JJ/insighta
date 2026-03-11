import type { MandalaLevel } from '@/entities/card/model/types';
import type { MandalaResponse } from '@/shared/lib/api-client';

export function apiLevelsToRecord(apiMandala: MandalaResponse): Record<string, MandalaLevel> {
  const result: Record<string, MandalaLevel> = {};

  for (const level of apiMandala.levels) {
    const parentLevel = level.parentLevelId
      ? apiMandala.levels.find((l) => l.id === level.parentLevelId)
      : null;

    result[level.levelKey] = {
      id: level.levelKey,
      centerGoal: level.centerGoal,
      subjects: level.subjects,
      parentId: parentLevel?.levelKey ?? null,
      parentCellIndex: level.depth > 0 ? level.position : null,
      cards: [],
    };
  }

  return result;
}

export function recordToApiLevels(levels: Record<string, MandalaLevel>): {
  title: string;
  levels: Array<{
    levelKey: string;
    centerGoal: string;
    subjects: string[];
    position: number;
    depth: number;
    parentLevelKey: string | null;
  }>;
} {
  const root = levels['root'];
  const apiLevels = [];

  if (root) {
    apiLevels.push({
      levelKey: 'root',
      centerGoal: root.centerGoal,
      subjects: root.subjects,
      position: 0,
      depth: 0,
      parentLevelKey: null,
    });
  }

  for (const [key, level] of Object.entries(levels)) {
    if (key === 'root') continue;
    apiLevels.push({
      levelKey: key,
      centerGoal: level.centerGoal,
      subjects: level.subjects,
      position: level.parentCellIndex ?? 0,
      depth: 1,
      parentLevelKey: level.parentId ?? 'root',
    });
  }

  return {
    title: root?.centerGoal ?? 'My Mandala',
    levels: apiLevels,
  };
}

export function clearMandalaLocalStorage(): void {
  localStorage.removeItem('mandala-root');
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith('mandala-l2-')) localStorage.removeItem(key);
  }
}
