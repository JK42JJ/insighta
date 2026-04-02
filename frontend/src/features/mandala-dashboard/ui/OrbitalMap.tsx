import { useTranslation } from 'react-i18next';

import type { DashboardCell } from '@/shared/types/mandala-ux';

const RADIUS = 155;
const RING_R = 26;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_R;
const SVG_SIZE = 420;
const CENTER = SVG_SIZE / 2;

interface OrbitalMapProps {
  centerLabel: string;
  cells: DashboardCell[];
}

export function OrbitalMap({ centerLabel, cells }: OrbitalMapProps) {
  const { t } = useTranslation();
  const allEmpty = cells.every((c) => c.videoCount === 0);

  return (
    <div className="relative mx-auto mb-12" style={{ width: SVG_SIZE, height: SVG_SIZE }}>
      {/* Decorative orbit rings */}
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          width: 340,
          height: 340,
          border: '1px dashed hsl(var(--primary) / 0.08)',
        }}
      />
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          width: 200,
          height: 200,
          border: '1px dashed hsl(var(--primary) / 0.08)',
        }}
      />

      {/* Center sun */}
      <div
        className="absolute left-1/2 top-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 cursor-pointer flex-col items-center justify-center rounded-full transition-all duration-300 hover:scale-105"
        style={{
          width: 100,
          height: 100,
          background: 'radial-gradient(circle, hsl(var(--primary) / 0.12), transparent 70%)',
        }}
      >
        <span
          className="text-center text-base font-black leading-tight tracking-tight text-primary"
          style={{
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            maxWidth: 88,
            wordBreak: 'keep-all',
          }}
        >
          {centerLabel}
        </span>
      </div>

      {/* Empty state hint */}
      {allEmpty && (
        <div
          className="pointer-events-none absolute left-1/2 z-[6] -translate-x-1/2 text-center"
          style={{ top: CENTER + 58 }}
        >
          <span className="text-xs font-semibold text-muted-foreground/50">
            {t('dashboard.orbital.emptyHint')}
          </span>
        </div>
      )}

      {/* Planets */}
      {cells.map((cell, i) => {
        const angle = (i / 8) * 2 * Math.PI - Math.PI / 2;
        const x = CENTER + RADIUS * Math.cos(angle) - 30;
        const y = CENTER + RADIUS * Math.sin(angle) - 38;
        const pct = cell.totalSlots > 0 ? cell.videoCount / cell.totalSlots : 0;
        const offset = RING_CIRCUMFERENCE * (1 - pct);
        const isEmpty = cell.videoCount === 0;
        const isActive = cell.isActive;
        const delay = 0.3 + i * 0.08;

        return (
          <div
            key={i}
            className="group absolute flex cursor-pointer flex-col items-center gap-1.5 transition-transform duration-300 ease-out hover:scale-110"
            style={{ left: x, top: y, zIndex: 5 }}
          >
            {/* Ring */}
            <div className="relative" style={{ width: 60, height: 60 }}>
              <svg viewBox="0 0 60 60" width={60} height={60}>
                {/* Background ring */}
                <circle
                  cx={30}
                  cy={30}
                  r={RING_R}
                  fill="none"
                  stroke={isEmpty ? 'hsl(var(--primary))' : 'hsl(var(--border))'}
                  strokeWidth={3}
                  className="transition-opacity duration-200 group-hover:opacity-[0.15]"
                  style={{ opacity: isEmpty ? 0.25 : 0.08 }}
                />
                {/* Progress ring */}
                <circle
                  cx={30}
                  cy={30}
                  r={RING_R}
                  fill="none"
                  stroke="hsl(var(--primary))"
                  strokeWidth={3}
                  strokeLinecap="round"
                  transform="rotate(-90 30 30)"
                  style={
                    {
                      '--circ': RING_CIRCUMFERENCE,
                      '--offset': offset,
                      strokeDasharray: RING_CIRCUMFERENCE,
                      strokeDashoffset: RING_CIRCUMFERENCE,
                      animation: isEmpty ? 'none' : `ringDraw 1.2s ease-out ${delay}s forwards`,
                      opacity: isEmpty ? 0 : 1,
                    } as React.CSSProperties
                  }
                />
              </svg>
              {/* Count number */}
              <div
                className="absolute inset-0 grid place-items-center text-sm font-extrabold tracking-tight"
                style={{
                  color: isEmpty ? 'hsl(var(--muted-foreground))' : 'hsl(var(--primary))',
                  opacity: isEmpty ? 0.5 : 1,
                }}
              >
                {cell.videoCount}
              </div>
            </div>
            {/* Planet name */}
            <span
              className={[
                'whitespace-nowrap text-[10.5px] font-semibold transition-colors duration-200',
                isActive ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground',
                '',
              ].join(' ')}
            >
              {cell.label || t('dashboard.orbital.cellLabel', { index: i + 1 })}
            </span>
          </div>
        );
      })}
    </div>
  );
}
