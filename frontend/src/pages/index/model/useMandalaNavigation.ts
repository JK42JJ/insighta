import { useState, useEffect, useCallback, useRef } from 'react';
import type { MandalaLevel, MandalaPath } from '@/entities/card/model/types';
import { mockMandalaLevels } from '@/shared/data/mockData';

interface UseMandalaNavigationReturn {
  currentLevelId: string;
  path: MandalaPath[];
  selectedCellIndex: number | null;
  setSelectedCellIndex: (index: number | null) => void;
  mandalaLevels: Record<string, MandalaLevel>;
  setMandalaLevels: React.Dispatch<React.SetStateAction<Record<string, MandalaLevel>>>;
  currentLevel: MandalaLevel;
  entryGridIndex: number | null;
  setEntryGridIndex: (index: number | null) => void;
  // Handlers
  handleCellClick: (cellIndex: number, subject: string) => void;
  handleNavigate: (levelId: string) => void;
  handleNavigateBack: () => void;
  handleNavigateToSubLevel: (subject: string, gridIndex: number) => void;
  handleSubjectsReorder: (
    newSubjects: string[],
    swappedIndices?: { from: number; to: number }
  ) => void;
  hasSubLevel: (subject: string) => boolean;
}

/**
 * Manages mandala navigation state: current level, path/breadcrumb,
 * selected cell, and mandala level data from localStorage.
 *
 * The onSubjectsReorder and onNavigateToSubLevel accept external callbacks
 * to handle card movement side-effects (injected via init params).
 */
export function useMandalaNavigation(deps?: {
  initialLevels?: Record<string, MandalaLevel>;
  mandalaId?: string | null;
  onMoveCardsForSubLevel?: (
    currentLevelId: string,
    nextLevelId: string,
    parentCellIndex: number
  ) => void;
  onSwapCardsForReorder?: (
    swappedIndices: { from: number; to: number },
    currentLevelId: string
  ) => void;
  toast?: (opts: { title: string; description: string }) => void;
  t?: (key: string, opts?: Record<string, unknown>) => string;
}): UseMandalaNavigationReturn {
  const { initialLevels, mandalaId, onMoveCardsForSubLevel, onSwapCardsForReorder, toast, t } =
    deps ?? {};

  // Mandala levels state - initialized from query data
  const [mandalaLevels, setMandalaLevels] = useState<Record<string, MandalaLevel>>(
    () => initialLevels ?? mockMandalaLevels
  );

  const [currentLevelId, setCurrentLevelId] = useState('root');
  const [path, setPath] = useState<MandalaPath[]>([]);
  const [selectedCellIndex, setSelectedCellIndex] = useState<number | null>(null);
  const [entryGridIndex, setEntryGridIndex] = useState<number | null>(null);

  const currentLevel: MandalaLevel = mandalaLevels[currentLevelId] || mandalaLevels['root'];

  // Track previous mandalaId for REPLACE vs MERGE decision
  const prevMandalaIdRef = useRef(mandalaId);

  // Sync when initialLevels change (e.g., after query refetch or settings save)
  useEffect(() => {
    const mandalaChanged = mandalaId !== prevMandalaIdRef.current;
    prevMandalaIdRef.current = mandalaId;

    if (initialLevels) {
      if (mandalaChanged) {
        // Mandala switched: full REPLACE + navigation reset
        setMandalaLevels(initialLevels);
        setCurrentLevelId('root');
        setPath([]);
        setSelectedCellIndex(null);
        setEntryGridIndex(null);
      } else {
        // Same mandala refetch (e.g., after save): MERGE to preserve local sub-levels
        setMandalaLevels((prev) => {
          const merged = { ...prev };
          for (const [key, level] of Object.entries(initialLevels)) {
            merged[key] = level;
          }
          return merged;
        });
      }
    }
  }, [initialLevels, mandalaId]);

  const handleCellClick = useCallback((_cellIndex: number, _subject: string) => {
    if (_cellIndex === -1) {
      setSelectedCellIndex(null);
      return;
    }
    setSelectedCellIndex(_cellIndex);
  }, []);

  const hasSubLevel = useCallback((_subject: string): boolean => {
    return true; // All subjects can have sub-levels
  }, []);

  const handleNavigate = useCallback(
    (levelId: string) => {
      if (levelId === 'root') {
        setPath([]);
        setCurrentLevelId('root');
      } else {
        const index = path.findIndex((p) => p.id === levelId);
        if (index >= 0) {
          setPath(path.slice(0, index));
          setCurrentLevelId(levelId);
        }
      }
      setSelectedCellIndex(null);
    },
    [path]
  );

  const handleNavigateBack = useCallback(() => {
    if (path.length > 0) {
      const parentPath = path[path.length - 1];
      setPath(path.slice(0, -1));
      setCurrentLevelId(parentPath.id);
      setSelectedCellIndex(null);
      setEntryGridIndex(null);
      toast?.({
        title: t?.('index.navigatedToParent') ?? 'Navigated to parent',
        description:
          t?.('index.navigatedToParentDesc', { label: parentPath.label }) ?? parentPath.label,
      });
    }
  }, [path, toast, t]);

  const handleNavigateToSubLevel = useCallback(
    (subject: string, gridIndex: number) => {
      const nextLevelId = subject.toLowerCase().replace(/\s/g, '');
      const parentCellIndex = currentLevel.subjects.indexOf(subject);

      // Create sub-level if it doesn't exist
      if (!mandalaLevels[nextLevelId]) {
        // Check initialLevels (from DB) first, then fall back to defaults
        const dbLevel = initialLevels?.[nextLevelId];
        const subjects =
          dbLevel?.subjects ?? Array.from({ length: 8 }, (_, i) => `${subject} ${i + 1}`);

        setMandalaLevels((prev) => ({
          ...prev,
          [nextLevelId]: {
            id: nextLevelId,
            centerGoal: subject,
            subjects,
            parentId: currentLevelId,
            parentCellIndex,
            cards: [],
          },
        }));
      }

      // Delegate card migration to external callback
      onMoveCardsForSubLevel?.(currentLevelId, nextLevelId, parentCellIndex);

      setPath([...path, { id: currentLevelId, label: currentLevel.centerGoal }]);
      setCurrentLevelId(nextLevelId);
      setSelectedCellIndex(null);
      setEntryGridIndex(gridIndex);

      toast?.({
        title: t?.('index.navigatedToLevel', { subject }) ?? `Navigated to ${subject}`,
        description: t?.('index.navigatedToLevelDesc') ?? '',
      });
    },
    [
      mandalaLevels,
      initialLevels,
      path,
      currentLevelId,
      currentLevel,
      toast,
      t,
      onMoveCardsForSubLevel,
    ]
  );

  const handleSubjectsReorder = useCallback(
    (newSubjects: string[], swappedIndices?: { from: number; to: number }) => {
      setMandalaLevels((prev) => ({
        ...prev,
        [currentLevelId]: {
          ...prev[currentLevelId],
          subjects: newSubjects,
        },
      }));

      if (swappedIndices) {
        onSwapCardsForReorder?.(swappedIndices, currentLevelId);

        // If the selected cell was swapped, follow it
        if (selectedCellIndex !== null) {
          if (selectedCellIndex === swappedIndices.from) {
            setSelectedCellIndex(swappedIndices.to);
          } else if (selectedCellIndex === swappedIndices.to) {
            setSelectedCellIndex(swappedIndices.from);
          }
        }
      }

      toast?.({
        title: t?.('index.priorityChanged') ?? 'Priority changed',
        description: t?.('index.priorityChangedDesc') ?? '',
      });
    },
    [currentLevelId, selectedCellIndex, toast, t, onSwapCardsForReorder]
  );

  return {
    currentLevelId,
    path,
    selectedCellIndex,
    setSelectedCellIndex,
    mandalaLevels,
    setMandalaLevels,
    currentLevel,
    entryGridIndex,
    setEntryGridIndex,
    handleCellClick,
    handleNavigate,
    handleNavigateBack,
    handleNavigateToSubLevel,
    handleSubjectsReorder,
    hasSubLevel,
  };
}
