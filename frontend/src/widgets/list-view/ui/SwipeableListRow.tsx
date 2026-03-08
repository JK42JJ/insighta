import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, useMotionValue, useTransform, PanInfo } from 'framer-motion';
import { Trash2, Check } from 'lucide-react';
import { InsightCard } from '@/types/mandala';
import { ListRowItem } from './ListRowItem';

const SWIPE_THRESHOLD = 80;

interface SwipeableListRowProps {
  card: InsightCard;
  isSelected: boolean;
  onClick: () => void;
  onDelete?: (id: string) => void;
  onToggleComplete?: (id: string) => void;
}

export function SwipeableListRow({
  card,
  isSelected,
  onClick,
  onDelete,
  onToggleComplete,
}: SwipeableListRowProps) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState<'delete' | null>(null);
  const x = useMotionValue(0);
  const constraintsRef = useRef<HTMLDivElement>(null);

  // Background opacity based on drag distance
  const deleteOpacity = useTransform(
    x,
    [-SWIPE_THRESHOLD * 1.5, -SWIPE_THRESHOLD / 2, 0],
    [1, 0.5, 0]
  );
  const completeOpacity = useTransform(
    x,
    [0, SWIPE_THRESHOLD / 2, SWIPE_THRESHOLD * 1.5],
    [0, 0.5, 1]
  );

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    const offset = info.offset.x;
    if (offset < -SWIPE_THRESHOLD && onDelete) {
      setConfirming('delete');
    } else if (offset > SWIPE_THRESHOLD && onToggleComplete) {
      onToggleComplete(card.id);
    }
  };

  if (confirming === 'delete') {
    return (
      <motion.div
        className="flex items-center justify-between px-4 py-2 bg-destructive/10 border-l-2 border-destructive"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      >
        <span className="text-sm text-destructive font-medium">
          {t('listView.deleteConfirm', 'Delete this card?')}
        </span>
        <div className="flex gap-2">
          <button
            onClick={() => setConfirming(null)}
            className="px-3 py-1.5 text-xs rounded-md bg-muted hover:bg-muted/80 transition-colors"
          >
            {t('common.cancel', 'Cancel')}
          </button>
          <button
            onClick={() => {
              onDelete?.(card.id);
              setConfirming(null);
            }}
            className="px-3 py-1.5 text-xs rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
          >
            {t('listView.deleteCard')}
          </button>
        </div>
      </motion.div>
    );
  }

  return (
    <div ref={constraintsRef} className="relative overflow-hidden">
      {/* Delete background (swipe left) */}
      <motion.div
        className="absolute inset-0 flex items-center justify-end px-4 bg-destructive/20"
        style={{ opacity: deleteOpacity }}
      >
        <Trash2 className="h-5 w-5 text-destructive" />
      </motion.div>

      {/* Complete background (swipe right) */}
      <motion.div
        className="absolute inset-0 flex items-center justify-start px-4 bg-green-500/20"
        style={{ opacity: completeOpacity }}
      >
        <Check className="h-5 w-5 text-green-600" />
      </motion.div>

      {/* Draggable row */}
      <motion.div
        style={{ x }}
        drag="x"
        dragConstraints={{ left: -SWIPE_THRESHOLD * 1.5, right: SWIPE_THRESHOLD * 1.5 }}
        dragElastic={0.3}
        dragSnapToOrigin
        onDragEnd={handleDragEnd}
        className="relative bg-background"
      >
        <ListRowItem card={card} isSelected={isSelected} onClick={onClick} />
      </motion.div>
    </div>
  );
}
