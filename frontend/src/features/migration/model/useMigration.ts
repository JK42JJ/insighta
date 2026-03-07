import { useState, useCallback, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getAuthHeaders } from '@/lib/supabase-auth';
import { queryKeys } from '@/lib/queryKeys';
import { useAuth } from '@/hooks/useAuth';
import { parseValidatedMandalaLevel, parseValidatedSubLevel } from '@/lib/localStorageValidation';
import type { MandalaLevel } from '@/types/mandala';

type MigrationStatus = 'idle' | 'migrating' | 'success' | 'error';

interface LocalDataSummary {
  rootGoal: string;
  levelCount: number;
}

interface UseMigrationReturn {
  shouldPrompt: boolean;
  localDataSummary: LocalDataSummary | null;
  status: MigrationStatus;
  error: string | null;
  migrate: () => Promise<void>;
  dismiss: () => void;
}

const DISMISS_KEY = 'migration-dismissed';

function loadFromLocalStorage(): Record<string, MandalaLevel> | null {
  const root = parseValidatedMandalaLevel('mandala-root');
  if (!root) return null;

  const result: Record<string, MandalaLevel> = { root };

  for (const key of Object.keys(localStorage)) {
    if (!key.startsWith('mandala-l2-')) continue;
    const levelKey = key.replace('mandala-l2-', '');
    const subjects = parseValidatedSubLevel(key);
    if (!subjects) continue;

    const stored = localStorage.getItem(key);
    if (!stored) continue;

    try {
      const parsed = JSON.parse(stored) as MandalaLevel;
      result[levelKey] = {
        id: levelKey,
        centerGoal: parsed.centerGoal || levelKey,
        subjects,
        parentId: parsed.parentId || 'root',
        parentCellIndex: parsed.parentCellIndex ?? null,
        cards: [],
      };
    } catch {
      // skip corrupted
    }
  }

  return result;
}

function recordToApiLevels(levels: Record<string, MandalaLevel>) {
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

  return { title: root?.centerGoal ?? 'My Mandala', levels: apiLevels };
}

function clearMandalaLocalStorage(): void {
  localStorage.removeItem('mandala-root');
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith('mandala-l2-')) {
      localStorage.removeItem(key);
    }
  }
}

function getLocalDataSummary(): LocalDataSummary | null {
  const root = parseValidatedMandalaLevel('mandala-root');
  if (!root) return null;

  let levelCount = 1;
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith('mandala-l2-')) levelCount++;
  }

  return { rootGoal: root.centerGoal, levelCount };
}

export function useMigration(): UseMigrationReturn {
  const { isLoggedIn } = useAuth();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<MigrationStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISS_KEY) === 'true');

  const localDataSummary = useMemo(() => {
    if (!isLoggedIn || dismissed || status === 'success') return null;
    return getLocalDataSummary();
  }, [isLoggedIn, dismissed, status]);

  const shouldPrompt =
    isLoggedIn && !dismissed && status !== 'success' && localDataSummary !== null;

  const migrate = useCallback(async () => {
    setStatus('migrating');
    setError(null);

    try {
      const localData = loadFromLocalStorage();
      if (!localData) throw new Error('No local data found');

      const payload = recordToApiLevels(localData);
      const headers = await getAuthHeaders();
      const response = await fetch('/api/v1/mandalas', {
        method: 'PUT',
        headers,
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `Migration failed (${response.status})`);
      }

      const data = await response.json();

      // Verify: compare level count
      const dbLevelCount = data.mandala?.levels?.length ?? 0;
      const localLevelCount = Object.keys(localData).length;
      if (dbLevelCount < localLevelCount) {
        throw new Error(
          `Verification failed: expected ${localLevelCount} levels, got ${dbLevelCount}`
        );
      }

      clearMandalaLocalStorage();

      // Invalidate all related caches
      queryClient.invalidateQueries({ queryKey: queryKeys.mandala });
      queryClient.invalidateQueries({ queryKey: queryKeys.mandalas.all });
      if (data.linked) {
        queryClient.invalidateQueries({ queryKey: queryKeys.localCards.all });
        queryClient.invalidateQueries({ queryKey: ['youtube', 'all-video-states'] });
      }

      setStatus('success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Migration failed');
      setStatus('error');
    }
  }, [queryClient]);

  const dismiss = useCallback(() => {
    localStorage.setItem(DISMISS_KEY, 'true');
    setDismissed(true);
  }, []);

  return { shouldPrompt, localDataSummary, status, error, migrate, dismiss };
}
