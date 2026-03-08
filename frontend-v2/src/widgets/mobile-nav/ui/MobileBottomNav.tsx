import { useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  motion,
  useMotionValue,
  useTransform,
  useSpring,
  type MotionValue,
} from 'framer-motion';
import { Home, LayoutGrid, List, Columns2 } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import type { ViewMode } from '@/entities/user/model/types';

interface MobileBottomNavProps {
  currentView: ViewMode;
  onViewChange: (mode: ViewMode) => void;
  onNavigateHome?: () => void;
}

const NAV_ITEMS: { mode: ViewMode; icon: typeof LayoutGrid; labelKey: string }[] = [
  { mode: 'grid', icon: LayoutGrid, labelKey: 'view.grid' },
  { mode: 'list', icon: List, labelKey: 'view.list' },
  { mode: 'list-detail', icon: Columns2, labelKey: 'view.listDetail' },
];

const SPRING_CONFIG = { stiffness: 300, damping: 25, mass: 0.5 };
const ITEM_WIDTH = 56;
const DOCK_INFLUENCE_RADIUS = ITEM_WIDTH * 2;

function useReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function useDockItemScale(
  mouseX: MotionValue<number>,
  itemRef: React.RefObject<HTMLButtonElement | null>,
  reducedMotion: boolean,
) {
  const distance = useTransform(mouseX, (x: number) => {
    if (x < 0 || !itemRef.current) return DOCK_INFLUENCE_RADIUS;
    const rect = itemRef.current.getBoundingClientRect();
    const center = rect.left + rect.width / 2;
    return Math.abs(x - center);
  });

  const rawScale = useTransform(distance, (d: number) => {
    if (reducedMotion) return 1;
    if (d >= DOCK_INFLUENCE_RADIUS) return 1;
    const ratio = 1 - d / DOCK_INFLUENCE_RADIUS;
    // Peak: 1.4x for the hovered item, ~1.2x for adjacent
    return 1 + 0.4 * ratio * ratio;
  });

  const scale = useSpring(rawScale, SPRING_CONFIG);

  return scale;
}

interface DockItemProps {
  icon: typeof LayoutGrid;
  label: string;
  isActive: boolean;
  onClick: () => void;
  mouseX: MotionValue<number>;
  reducedMotion: boolean;
  ariaLabel: string;
}

function DockItem({
  icon: Icon,
  label,
  isActive,
  onClick,
  mouseX,
  reducedMotion,
  ariaLabel,
}: DockItemProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const scale = useDockItemScale(mouseX, ref, reducedMotion);

  return (
    <motion.button
      ref={ref}
      type="button"
      onClick={onClick}
      style={{ scale: reducedMotion ? 1 : scale }}
      className={cn(
        'flex flex-col items-center justify-center gap-0.5 px-3 py-1.5 rounded-lg transition-colors min-w-[3rem]',
        'focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background',
        isActive
          ? 'text-[hsl(var(--primary))]'
          : 'text-muted-foreground hover:text-foreground',
      )}
      aria-label={ariaLabel}
      aria-current={isActive ? 'page' : undefined}
    >
      <Icon className="h-5 w-5" aria-hidden="true" />
      <span className="text-[10px] font-medium select-none">{label}</span>
    </motion.button>
  );
}

export function MobileBottomNav({
  currentView,
  onViewChange,
  onNavigateHome,
}: MobileBottomNavProps) {
  const { t } = useTranslation();
  const reducedMotion = useReducedMotion();
  const mouseX = useMotionValue(-1);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      const clientX =
        'touches' in e ? e.touches[0]?.clientX ?? -1 : e.clientX;
      mouseX.set(clientX);
    },
    [mouseX],
  );

  const handleMouseLeave = useCallback(() => {
    mouseX.set(-1);
  }, [mouseX]);

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 border-t border-border/50 bg-background/80 backdrop-blur-md md:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      aria-label={t('view.switchView')}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onTouchMove={handleMouseMove}
      onTouchEnd={handleMouseLeave}
    >
      <div className="flex items-center justify-around px-2 py-1">
        {/* Home button */}
        <DockItem
          icon={Home}
          label={t('header.home')}
          isActive={false}
          onClick={() => onNavigateHome?.()}
          mouseX={mouseX}
          reducedMotion={reducedMotion}
          ariaLabel={t('header.goHome')}
        />

        {/* View mode items */}
        {NAV_ITEMS.map(({ mode, icon, labelKey }) => (
          <DockItem
            key={mode}
            icon={icon}
            label={t(labelKey)}
            isActive={currentView === mode}
            onClick={() => onViewChange(mode)}
            mouseX={mouseX}
            reducedMotion={reducedMotion}
            ariaLabel={t(labelKey)}
          />
        ))}
      </div>
    </nav>
  );
}
