import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useDroppable } from '@dnd-kit/core';
import { Pencil, Check } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { type DropData } from '@/shared/lib/dnd';
import type { InsightCard } from '@/entities/card/model/types';
import { extractUrlFromDragData, extractUrlFromHtml } from '@/shared/data/mockData';

interface SidebarHeatMinimapProps {
  cardsByCell: Record<number, InsightCard[]>;
  sectorSubjects: string[];
  /** 2-4 char short labels parallel to sectorSubjects. Falls back to sectorSubjects when missing. */
  sectorLabels?: string[];
  centerGoal: string;
  centerLabel?: string | null;
  selectedCellIndex: number | null;
  onCellClick: (cellIndex: number, subject: string) => void;
  onSectorNamesChange?: (centerGoal: string, subjects: string[]) => void;
  onExternalUrlDrop?: (cellIndex: number, url: string) => void;
}

const GRID_TO_SUBJECT: Record<number, number> = {
  0: 0,
  1: 1,
  2: 2,
  3: 3,
  5: 4,
  6: 5,
  7: 6,
  8: 7,
};

const STORAGE_KEY = 'insighta-minimap-numbers';

function cardCountToOpacity(count: number, maxCount: number): number {
  if (count === 0) return 0;
  const ratio = Math.log(count + 1) / Math.log(maxCount + 1);
  return 0.05 + ratio * 0.35;
}

function getInitialShowNumbers(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function SidebarHeatMinimap({
  cardsByCell,
  sectorSubjects,
  sectorLabels,
  centerGoal,
  centerLabel,
  selectedCellIndex,
  onCellClick,
  onSectorNamesChange,
  onExternalUrlDrop,
}: SidebarHeatMinimapProps) {
  const { t } = useTranslation();
  const [showNumbers, setShowNumbers] = useState(getInitialShowNumbers);
  const [isEditing, setIsEditing] = useState(false);
  const [editSubjects, setEditSubjects] = useState<string[]>([]);
  const [editGoal, setEditGoal] = useState('');

  const handleToggle = () => {
    setShowNumbers((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const enterEditMode = useCallback(() => {
    setEditSubjects([...sectorSubjects]);
    setEditGoal(centerGoal);
    setIsEditing(true);
  }, [sectorSubjects, centerGoal]);

  const saveAndExit = useCallback(() => {
    if (onSectorNamesChange) {
      onSectorNamesChange(editGoal, editSubjects);
    }
    setIsEditing(false);
  }, [editGoal, editSubjects, onSectorNamesChange]);

  const cancelEdit = useCallback(() => {
    setIsEditing(false);
  }, []);

  const handleSubjectChange = useCallback((subjectIndex: number, value: string) => {
    setEditSubjects((prev) => {
      const next = [...prev];
      next[subjectIndex] = value;
      return next;
    });
  }, []);

  const maxCount = useMemo(() => {
    let max = 0;
    for (const [, subIdx] of Object.entries(GRID_TO_SUBJECT)) {
      const count = (cardsByCell[subIdx] ?? []).length;
      if (count > max) max = count;
    }
    return Math.max(max, 1);
  }, [cardsByCell]);

  return (
    <div className="flex-shrink-0">
      {/* Header with edit toggle + # toggle */}
      <div className="flex items-center justify-end px-3 pb-1">
        <div className="flex items-center gap-1">
          {/* Edit toggle */}
          {onSectorNamesChange && (
            <button
              onClick={isEditing ? saveAndExit : enterEditMode}
              className={cn(
                'p-0.5 rounded transition-colors',
                isEditing
                  ? 'text-primary hover:text-primary/80'
                  : 'text-sidebar-foreground/60 hover:text-sidebar-foreground/70'
              )}
              aria-label={t('minimap.editSectors')}
              title={t('minimap.editSectors')}
            >
              {isEditing ? <Check className="w-3 h-3" /> : <Pencil className="w-3 h-3" />}
            </button>
          )}
          {/* # toggle */}
          {!isEditing && (
            <button
              onClick={handleToggle}
              className={cn(
                'relative w-7 h-[15px] rounded-full transition-colors',
                showNumbers ? 'bg-primary' : 'bg-muted'
              )}
              aria-label={t('minimap.showNumbers')}
              title={t('minimap.showNumbers')}
            >
              <span className="absolute text-[8px] font-bold text-sidebar-foreground/50 -left-3 top-0.5">
                #
              </span>
              <div
                className={cn(
                  'absolute top-[2px] w-[11px] h-[11px] rounded-full bg-sidebar-background transition-[left]',
                  showNumbers ? 'left-[14px]' : 'left-[2px]'
                )}
              />
            </button>
          )}
        </div>
      </div>

      {/* 3x3 Heat Grid */}
      <div className="grid grid-cols-3 gap-1 px-3 pb-2">
        {Array.from({ length: 9 }).map((_, gridIndex) => {
          const isCenter = gridIndex === 4;
          const subjectIndex = GRID_TO_SUBJECT[gridIndex] ?? -1;
          // Display label uses the short variant when available; edit mode still
          // operates on the long subjects (source of truth, see onSectorNamesChange).
          const shortLabel = sectorLabels?.[subjectIndex]?.trim();
          const displayLabel =
            shortLabel && shortLabel.length > 0 ? shortLabel : sectorSubjects[subjectIndex] || '';
          const label = isCenter
            ? isEditing
              ? editGoal
              : centerLabel || centerGoal
            : isEditing
              ? (editSubjects[subjectIndex] ?? '')
              : displayLabel;
          const count = isCenter ? 0 : (cardsByCell[subjectIndex] ?? []).length;
          const opacity = isCenter ? 0 : cardCountToOpacity(count, maxCount);
          const isSelected = isCenter
            ? selectedCellIndex === null
            : selectedCellIndex === subjectIndex;

          const placeholder = isCenter
            ? t('minimap.goalPlaceholder')
            : t('minimap.sectorPlaceholder', { n: subjectIndex + 1 });

          if (isEditing) {
            return (
              <EditableCell
                key={gridIndex}
                gridIndex={gridIndex}
                isCenter={isCenter}
                value={label}
                placeholder={placeholder}
                onChange={(val) => {
                  if (isCenter) {
                    setEditGoal(val);
                  } else {
                    handleSubjectChange(subjectIndex, val);
                  }
                }}
                onSave={saveAndExit}
                onCancel={cancelEdit}
              />
            );
          }

          return (
            <HeatCell
              key={gridIndex}
              gridIndex={gridIndex}
              subjectIndex={subjectIndex}
              label={label || placeholder}
              isPlaceholder={!label}
              count={count}
              opacity={opacity}
              isCenter={isCenter}
              isSelected={isSelected}
              showNumbers={showNumbers}
              onClick={() => {
                if (isCenter) {
                  onCellClick(-1, label);
                } else {
                  onCellClick(subjectIndex, label);
                }
              }}
              onExternalUrlDrop={onExternalUrlDrop}
            />
          );
        })}
      </div>
    </div>
  );
}

/* -- Editable cell (edit mode) -- */

interface EditableCellProps {
  gridIndex: number;
  isCenter: boolean;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
}

function EditableCell({
  gridIndex,
  isCenter,
  value,
  placeholder,
  onChange,
  onSave,
  onCancel,
}: EditableCellProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus first sector cell on mount
  useEffect(() => {
    if (gridIndex === 0) {
      inputRef.current?.focus();
    }
  }, [gridIndex]);

  const nextCellGridIndex = gridIndex === 3 ? 5 : gridIndex + 1; // skip center (4)

  return (
    <div
      className={cn(
        'aspect-square rounded-[5px] flex items-center justify-center transition-all duration-150',
        'border border-dashed',
        isCenter
          ? 'border-primary/50 bg-sidebar-accent'
          : 'border-sidebar-foreground/30 bg-muted/50'
      )}
    >
      <input
        ref={inputRef}
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          // Skip during IME composition (Korean, Japanese, etc.)
          if (e.nativeEvent.isComposing) return;
          if (e.key === 'Enter') {
            e.preventDefault();
            // Move to next cell or save if last
            if (gridIndex === 8) {
              onSave();
            } else {
              // Delay focus to let IME composition finalize
              requestAnimationFrame(() => {
                const nextInput = document.querySelector<HTMLInputElement>(
                  `[data-edit-cell="${nextCellGridIndex}"]`
                );
                nextInput?.focus();
              });
            }
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
        data-edit-cell={gridIndex}
        className={cn(
          'w-full h-full bg-transparent text-center outline-none',
          'text-[9px] leading-tight px-0.5',
          'placeholder:text-sidebar-foreground/30',
          isCenter
            ? 'text-sidebar-foreground font-medium text-[10px]'
            : 'text-sidebar-foreground/70'
        )}
      />
    </div>
  );
}

/* -- Drop-target cell (view mode) -- */

interface HeatCellProps {
  gridIndex: number;
  subjectIndex: number;
  label: string;
  isPlaceholder: boolean;
  count: number;
  opacity: number;
  isCenter: boolean;
  isSelected: boolean;
  showNumbers: boolean;
  onClick: () => void;
  onExternalUrlDrop?: (cellIndex: number, url: string) => void;
}

function HeatCell({
  gridIndex,
  subjectIndex,
  label,
  isPlaceholder,
  count,
  opacity,
  isCenter,
  isSelected,
  showNumbers,
  onClick,
  onExternalUrlDrop,
}: HeatCellProps) {
  const [isExternalDragOver, setIsExternalDragOver] = useState(false);

  const handleExternalDragOver = useCallback(
    (e: React.DragEvent) => {
      if (isCenter || !onExternalUrlDrop) return;
      e.preventDefault();
      e.stopPropagation();
      setIsExternalDragOver(true);
    },
    [isCenter, onExternalUrlDrop]
  );

  const handleExternalDragLeave = useCallback(() => {
    setIsExternalDragOver(false);
  }, []);

  const handleExternalDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsExternalDragOver(false);
      if (isCenter || !onExternalUrlDrop) return;
      const rawUrl =
        e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
      let url = rawUrl ? extractUrlFromDragData(rawUrl) : null;
      if (!url) {
        const html = e.dataTransfer.getData('text/html');
        if (html) url = extractUrlFromHtml(html);
      }
      if (url) {
        onExternalUrlDrop(subjectIndex, url);
      }
    },
    [isCenter, subjectIndex, onExternalUrlDrop]
  );

  const dropData: DropData = {
    type: 'mandala-cell',
    gridIndex,
    subjectIndex,
  };
  const { setNodeRef, isOver } = useDroppable({
    id: `sidebar-drop-cell-${gridIndex}`,
    data: dropData,
    disabled: isCenter,
  });

  return (
    <button
      ref={setNodeRef}
      onClick={onClick}
      onDragOver={handleExternalDragOver}
      onDragLeave={handleExternalDragLeave}
      onDrop={handleExternalDrop}
      className={cn(
        'aspect-square rounded-[5px] flex flex-col items-center justify-center gap-0.5 transition-all duration-150',
        'border border-transparent',
        isCenter && 'border-sidebar-border',
        isSelected && 'border-primary',
        !isCenter &&
          !isSelected &&
          !isOver &&
          !isExternalDragOver &&
          'hover:border-sidebar-foreground/20',
        'cursor-pointer',
        // Drop target highlight (internal D&D or external HTML5 drag)
        (isOver || isExternalDragOver) &&
          !isCenter &&
          'border-2 border-dashed border-primary bg-primary/5 scale-105'
      )}
      style={{
        background: isCenter
          ? 'hsl(var(--sidebar-accent))'
          : isOver
            ? 'hsl(var(--primary) / 0.30)'
            : count === 0
              ? 'hsl(var(--muted))'
              : `hsl(var(--primary) / ${opacity})`,
      }}
    >
      {showNumbers && !isCenter && count > 0 && (
        <span className="text-[12px] font-medium text-sidebar-foreground leading-none">
          {count}
        </span>
      )}
      <span
        className={cn(
          'text-[9px] leading-tight text-center line-clamp-2 break-words px-0.5',
          isPlaceholder && 'italic',
          isCenter
            ? 'text-sidebar-foreground font-medium text-[10px]'
            : isPlaceholder
              ? 'text-sidebar-foreground/60'
              : isSelected
                ? 'text-primary font-medium'
                : 'text-sidebar-foreground/70'
        )}
      >
        {label}
      </span>
    </button>
  );
}
