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

// 중앙 3×3 블록 내 각 서브골의 절대 좌표 (blockIdx → [row, col])
// subjects 배열: [0,1,2,3, center, 4,5,6,7]
const CENTER_SUB_POSITIONS: Record<number, [number, number]> = {
  0: [3, 3],
  1: [3, 4],
  2: [3, 5],
  3: [4, 3],
  4: [4, 5],
  5: [5, 3],
  6: [5, 4],
  7: [5, 5],
};

// center sub-goal의 3×3 grid index → 연결된 외곽 blockIdx
const CENTER_SUB_TO_BLOCK: Record<number, number> = {
  0: 0,
  1: 1,
  2: 2,
  3: 3,
  5: 4,
  6: 5,
  7: 6,
  8: 7,
};

interface CellData {
  text: string;
  ring: number;
  isCenter: boolean;
  isSubCenter: boolean;
  blockIdx: number; // -1 for center block, 0-7 for outer blocks
  linkedBlock: number; // center sub-goal이 연결된 외곽 blockIdx (-1 if N/A)
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
              linkedBlock: CENTER_SUB_TO_BLOCK[idx] ?? -1,
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
              linkedBlock: -1,
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

  // === 중앙 블록 (blockIdx === -1) ===
  if (cell.blockIdx === -1) {
    // 메인 센터 셀 — 항상 도메인 컬러 배경
    if (cell.isCenter) {
      return {
        background: s.dim,
        color: s.color,
        opacity: hasActiveOuter ? 0.35 : 1,
        cursor: hasActiveOuter ? 'pointer' : undefined,
      };
    }
    // 서브골 셀 — 톤다운 도메인 컬러
    // 연결된 외곽 블록이 활성이면 하일라이트 유지, 아니면 dim
    if (cell.isSubCenter) {
      const isLinkedActive = hasActiveOuter && cell.linkedBlock === activeBlock;
      return {
        color: `color-mix(in srgb, ${s.color} 40%, hsl(var(--muted-foreground)))`,
        background: 'hsl(var(--card))',
        borderRadius: '4px',
        zIndex: 2,
        position: 'relative' as const,
        opacity: isLinkedActive ? 1 : hasActiveOuter ? 0.35 : 1,
      };
    }
    // 일반 셀
    return {
      color: 'hsl(var(--foreground))',
      background: 'hsl(var(--card))',
      borderRadius: '4px',
      zIndex: 2,
      position: 'relative' as const,
      opacity: 1,
    };
  }

  // === 외곽 블록 ===

  // 활성 외곽 블록의 중앙 셀 — 중앙 3×3 sub-goal과 동일한 스타일
  if (isInActiveBlock && cell.isSubCenter) {
    return {
      color: `color-mix(in srgb, ${s.color} 40%, hsl(var(--muted-foreground)))`,
      background: 'hsl(var(--card))',
      borderRadius: '4px',
      zIndex: 2,
      position: 'relative' as const,
      opacity: 1,
      transform: 'scale(1.02)',
    };
  }

  // 활성 외곽 블록의 일반 셀
  if (isInActiveBlock) {
    return {
      color: 'hsl(var(--foreground))',
      background: 'hsl(var(--card))',
      borderRadius: '4px',
      zIndex: 2,
      position: 'relative' as const,
      opacity: 1,
    };
  }

  // 비활성 외곽 블록의 sub-center — 무채색 톤다운
  if (cell.isSubCenter) {
    return {
      color: 'hsl(var(--muted-foreground) / 0.6)',
      cursor: 'pointer',
      opacity: hasActiveOuter ? 0.35 : undefined,
    };
  }

  // 비활성 블록의 일반 셀 — dim 처리
  if (hasActiveOuter && !isInActiveBlock) {
    return { opacity: 0.2 };
  }

  // 기본 상태: CSS mask-image가 픽셀 단위 radial fade 처리
  // JS per-cell opacity 불필요

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
  // 방금 활성화된 블록 (fly-out 애니메이션 대상)
  const [flyingBlock, setFlyingBlock] = useState<number | null>(null);
  // 외곽 셀 hover → 중앙 sub-goal 연동 하일라이트
  const [hoveredBlock, setHoveredBlock] = useState<number | null>(null);

  const subs = Array.from({ length: 8 }, (_, i) => subLevels[i] ?? null);
  const cells = buildCells(rootLevel, subs, centerLabel, subLabels);

  function handleCellClick(cell: CellData) {
    // sub-goal 클릭 → 해당 블록 활성화 + fly-out 애니메이션
    if (cell.isSubCenter && cell.blockIdx !== -1 && cell.blockIdx !== activeBlock) {
      setFlyingBlock(cell.blockIdx);
      // 약간의 딜레이 후 블록 활성화 (fly-out 보이도록)
      requestAnimationFrame(() => {
        setActiveBlock(cell.blockIdx);
        setTimeout(() => setFlyingBlock(null), 600);
      });
      return;
    }
    // center 셀 또는 이미 활성인 블록의 sub-center 클릭 → 중앙으로 복귀
    if (cell.isCenter || (cell.isSubCenter && cell.blockIdx === activeBlock)) {
      setActiveBlock(-1);
      setFlyingBlock(null);
      return;
    }
  }

  return (
    <div className={`mb-7 relative ${className || ''}`}>
      <div
        className="explore-9x9-mask grid grid-cols-9 gap-0.5 rounded-xl overflow-hidden relative"
        style={getMaskOrigin(activeBlock)}
      >
        {cells.map((cell, i) => {
          const baseStyle = getCellStyle(cell, activeBlock, domain);
          const isFlying = cell.isSubCenter && cell.blockIdx === flyingBlock;

          // fly 시작점: 중앙 3×3 내 해당 서브골 셀 → 현재 셀 위치
          let flyStyle: React.CSSProperties = {};
          if (isFlying && cell.blockIdx !== -1) {
            const origin = CENTER_SUB_POSITIONS[cell.blockIdx];
            if (origin) {
              const offsetCol = origin[1] - cell.absCol;
              const offsetRow = origin[0] - cell.absRow;
              const domainColor =
                domain && DOMAIN_STYLES[domain] ? DOMAIN_STYLES[domain].color : undefined;
              flyStyle = {
                zIndex: 10,
                '--fly-x': `calc(${offsetCol} * (100% + 2px))`,
                '--fly-y': `calc(${offsetRow} * (100% + 2px))`,
                '--d-color': domainColor,
                animation: 'explore-fly-out 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards',
              } as React.CSSProperties;
            }
          }

          // 중앙 3×3 격자: 중심에서 외곽으로 border 희미해짐
          let borderStyle: React.CSSProperties = {};
          if (cell.blockIdx === -1) {
            const dx = cell.absCol - 4;
            const dy = cell.absRow - 4;
            const dist = Math.sqrt(dx * dx + dy * dy);
            // dist 0 = 0.8, dist 1.41(코너) = 0.3
            const alpha = Math.max(0.15, 0.5 - dist * 0.25);
            borderStyle = { borderColor: `rgba(148, 163, 184, ${alpha.toFixed(2)})` };
          }

          // 외곽 셀 hover → 중앙 sub-goal 연동 하일라이트
          const isHoverLinked =
            hoveredBlock !== null &&
            cell.blockIdx === -1 &&
            cell.isSubCenter &&
            cell.linkedBlock === hoveredBlock;

          const hoverLinkStyle: React.CSSProperties = isHoverLinked
            ? { background: 'hsl(var(--muted) / 0.4)', opacity: 1, zIndex: 5, position: 'relative' }
            : {};

          return (
            <div
              key={i}
              className={getCellClass(cell)}
              style={{
                ...baseStyle,
                ...borderStyle,
                transition: 'opacity 0.3s ease',
                ...flyStyle,
                ...hoverLinkStyle,
              }}
              title={cell.text}
              onClick={() => handleCellClick(cell)}
              onMouseEnter={() =>
                cell.blockIdx !== -1 ? setHoveredBlock(cell.blockIdx) : undefined
              }
              onMouseLeave={() => setHoveredBlock(null)}
            >
              {cell.text}
            </div>
          );
        })}
      </div>
    </div>
  );
}
