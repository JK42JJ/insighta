/**
 * MandalaFullPreview — 읽기 전용 9×9 만다라트 그리드
 * D&D 없음. MandalaGrid와 완전히 분리된 컴포넌트.
 *
 * 기능:
 * - 기본: 중앙 3×3 블록이 하일라이트 (나머지 fade-out)
 * - sub-goal (도메인 컬러 텍스트) 클릭 → 해당 3×3 블록으로 하일라이트 이동
 * - 중앙 셀 클릭 → 다시 중앙 블록으로 복귀
 *
 * CSS 클래스: index.css의 explore-* 클래스 사용.
 * 이 파일의 className을 수정하지 마세요.
 */

import { useState } from 'react';
import type { MandalaDomain } from '@/shared/config/domain-colors';
import { DOMAIN_STYLES } from '@/shared/config/domain-colors';

interface MandalaLevel {
  centerGoal: string;
  subjects: string[];
}

interface Props {
  /** depth=0 root level */
  rootLevel: MandalaLevel;
  /** depth=1 sub-levels (position 0~7) */
  subLevels?: (MandalaLevel | null)[];
  domain?: MandalaDomain | null;
  /** 짧은 디스플레이 라벨 (center cell) */
  centerLabel?: string;
  /** 짧은 디스플레이 라벨 (8개 sub-goals) */
  subLabels?: string[];
  className?: string;
}

// Block layout in the 3×3 meta-grid:
// [0] [1] [2]
// [3] [-1=CENTER] [4]
// [5] [6] [7]
const BLOCK_ORDER = [0, 1, 2, 3, -1, 4, 5, 6, 7];

// Which meta-grid position (brow, bcol) each blockIdx maps to
const BLOCK_POSITIONS: Record<number, [number, number]> = {
  0: [0, 0],
  1: [0, 1],
  2: [0, 2],
  3: [1, 0],
  4: [1, 2],
  5: [2, 0],
  6: [2, 1],
  7: [2, 2],
};

interface CellData {
  text: string;
  ring: number;
  isCenter: boolean;
  isSubCenter: boolean;
  blockIdx: number; // -1 for center block, 0-7 for outer blocks
  absRow: number;
  absCol: number;
}

function buildCells(
  rootLevel: MandalaLevel,
  subLevels: (MandalaLevel | null)[],
  centerLabel?: string,
  subLabels?: string[]
): CellData[] {
  const cells: CellData[] = [];

  for (let brow = 0; brow < 3; brow++) {
    for (let crow = 0; crow < 3; crow++) {
      for (let bcol = 0; bcol < 3; bcol++) {
        const bi = brow * 3 + bcol;
        const blockIdx = BLOCK_ORDER[bi];

        if (blockIdx === -1) {
          // Use short labels if available, fallback to full text
          const displaySubjects = subLabels?.length === 8 ? subLabels : rootLevel.subjects;
          const displayCenter = centerLabel ?? rootLevel.centerGoal;
          const centerCells = [
            ...displaySubjects.slice(0, 4),
            displayCenter,
            ...displaySubjects.slice(4),
          ];
          for (let ccol = 0; ccol < 3; ccol++) {
            const idx = crow * 3 + ccol;
            cells.push({
              text: centerCells[idx] || '',
              ring: 0,
              isCenter: idx === 4,
              isSubCenter: idx !== 4,
              blockIdx: -1,
              absRow: brow * 3 + crow,
              absCol: bcol * 3 + ccol,
            });
          }
        } else {
          const sub = subLevels[blockIdx];
          const subGoalName = rootLevel.subjects[blockIdx] || '';
          // Short label for sub-center cell
          const subLabelName = subLabels?.[blockIdx] ?? subGoalName;
          let blockCells: string[];

          if (sub) {
            blockCells = [...sub.subjects.slice(0, 4), subLabelName, ...sub.subjects.slice(4)];
          } else {
            blockCells = ['', '', '', '', subLabelName, '', '', '', ''];
          }

          for (let ccol = 0; ccol < 3; ccol++) {
            const idx = crow * 3 + ccol;
            const isSubCenter = idx === 4;

            const ar = brow * 3 + crow;
            const ac = bcol * 3 + ccol;
            const dist = Math.sqrt((ar - 4) ** 2 + (ac - 4) ** 2);

            let ring: number;
            if (dist < 1.5) ring = 0;
            else if (dist < 3.0) ring = 1;
            else if (dist < 4.5) ring = 2;
            else ring = 3;

            let text = blockCells[idx] || '';
            text = text.replace(/\[HIGH\]\s*/g, '');

            cells.push({
              text,
              ring,
              isCenter: false,
              isSubCenter,
              blockIdx,
              absRow: ar,
              absCol: ac,
            });
          }
        }
      }
    }
  }

  return cells;
}

/**
 * activeBlock에 따라 셀의 시각적 상태를 결정.
 * activeBlock = -1 (기본, 중앙 하일라이트)
 * activeBlock = 0~7 (해당 외곽 블록 하일라이트)
 */
/**
 * Font size is ALWAYS based on absolute ring (cell position).
 * Active/inactive only changes color/background via getCellStyle.
 * This prevents text reflow when activeBlock changes.
 */
function getCellClass(cell: CellData): string {
  const base = 'explore-cell';

  // Center cell of center block — always largest
  if (cell.isCenter && cell.blockIdx === -1) {
    return `${base} explore-cell-ring0 explore-cell-center`;
  }

  // Sub-center cells (center of outer blocks) — clickable
  if (cell.isSubCenter && cell.blockIdx !== -1) {
    return `${base} explore-cell-ring1 explore-cell-sub`;
  }

  // Static ring-based font sizing
  if (cell.ring === 0) return `${base} explore-cell-ring0`;
  if (cell.ring === 1) return `${base} explore-cell-ring1`;
  if (cell.ring === 2) return `${base} explore-cell-ring2`;
  return `${base} explore-cell-ring3`;
}

function getCellStyle(
  cell: CellData,
  activeBlock: number,
  domain?: MandalaDomain | null
): React.CSSProperties {
  if (!domain || !DOMAIN_STYLES[domain]) return {};
  const s = DOMAIN_STYLES[domain];
  const isInActiveBlock = cell.blockIdx === activeBlock;

  // L1→L2 전환: 외곽 블록 선택 시 비활성 블록을 dim 처리
  const hasActiveOuter = activeBlock !== -1;

  // 활성 블록의 중앙 셀 (center 또는 sub-center) — 도메인 컬러 배경
  if (isInActiveBlock && (cell.isCenter || (activeBlock !== -1 && cell.isSubCenter))) {
    return {
      background: s.dim,
      color: s.color,
      opacity: 1,
      transform: hasActiveOuter ? 'scale(1.02)' : undefined,
    };
  }

  // 활성 블록의 일반 셀 — 선명하게 (font-size 변경 없이 색상만)
  if (isInActiveBlock) {
    return {
      color: 'hsl(var(--foreground))',
      background: 'hsl(var(--card))',
      borderColor: 'hsl(var(--border) / 0.3)',
      borderRadius: '4px',
      zIndex: 2,
      position: 'relative' as const,
      opacity: 1,
    };
  }

  // 비활성 블록의 sub-center → 도메인 컬러 텍스트 + 클릭 가능
  if (cell.isSubCenter && cell.blockIdx !== -1) {
    return {
      color: s.color,
      cursor: 'pointer',
      opacity: hasActiveOuter ? 0.35 : undefined,
    };
  }

  // 비활성인 원래 center 셀 (외곽 블록 선택 시) → 클릭 가능
  if (cell.isCenter && cell.blockIdx === -1 && activeBlock !== -1) {
    return {
      color: s.color,
      cursor: 'pointer',
      opacity: 0.35,
    };
  }

  // 비활성 블록의 일반 셀 — dim 처리
  if (hasActiveOuter && !isInActiveBlock) {
    return { opacity: 0.2 };
  }

  return {};
}

/**
 * activeBlock에 따라 radial-gradient 중심점을 이동.
 * 기본(-1): center (50%, 50%)
 * 외곽 블록: 해당 블록의 중심 좌표
 */
function getMaskOrigin(activeBlock: number): React.CSSProperties {
  if (activeBlock === -1) return {};

  const pos = BLOCK_POSITIONS[activeBlock];
  if (!pos) return {};

  // 각 블록의 중심: (brow * 3 + 1) / 9 * 100%
  const centerRow = ((pos[0] * 3 + 1) / 9) * 100;
  const centerCol = ((pos[1] * 3 + 1) / 9) * 100;

  // ::after를 직접 제어할 수 없으므로 CSS 변수로 전달
  return {
    '--mask-x': `${centerCol}%`,
    '--mask-y': `${centerRow}%`,
  } as React.CSSProperties;
}

export function MandalaFullPreview({
  rootLevel,
  subLevels = [],
  domain,
  centerLabel,
  subLabels,
  className,
}: Props) {
  const [activeBlock, setActiveBlock] = useState<number>(-1); // -1 = center

  const subs = Array.from({ length: 8 }, (_, i) => subLevels[i] ?? null);
  const cells = buildCells(rootLevel, subs, centerLabel, subLabels);

  function handleCellClick(cell: CellData) {
    // sub-goal 클릭 → 해당 블록 활성화
    if (cell.isSubCenter && cell.blockIdx !== -1 && cell.blockIdx !== activeBlock) {
      setActiveBlock(cell.blockIdx);
      return;
    }
    // center 셀 또는 이미 활성인 블록의 sub-center 클릭 → 중앙으로 복귀
    if (cell.isCenter || (cell.isSubCenter && cell.blockIdx === activeBlock)) {
      setActiveBlock(-1);
      return;
    }
  }

  return (
    <div className={`mb-7 relative ${className || ''}`}>
      <div
        className="explore-9x9-mask grid grid-cols-9 gap-0.5 rounded-xl overflow-hidden relative"
        style={getMaskOrigin(activeBlock)}
      >
        {cells.map((cell, i) => (
          <div
            key={i}
            className={getCellClass(cell)}
            style={getCellStyle(cell, activeBlock, domain)}
            title={cell.text}
            onClick={() => handleCellClick(cell)}
          >
            {cell.text}
          </div>
        ))}
      </div>
    </div>
  );
}
