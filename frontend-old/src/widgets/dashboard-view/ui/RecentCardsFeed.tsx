import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { InsightCard } from '@/types/mandala';
import { motion, AnimatePresence } from 'framer-motion';
import { feedContainer, feedItemVariants, transition } from '@/lib/motion';

interface RecentCardsFeedProps {
  cards: InsightCard[];
  onCardClick?: (card: InsightCard) => void;
}

function timeAgo(date: Date): string {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${Math.max(1, mins)}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

export function RecentCardsFeed({ cards, onCardClick }: RecentCardsFeedProps) {
  const { t } = useTranslation();

  const recent = [...cards]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 8);

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-3">
        <h3 className="text-sm font-semibold">{t('dashboard.recentCards', 'Recent Cards')}</h3>
      </div>
      {recent.length === 0 ? (
        <p className="text-xs text-muted-foreground py-4 text-center">{t('listView.noCards')}</p>
      ) : (
        <motion.div
          className="space-y-1"
          variants={feedContainer}
          initial="initial"
          animate="animate"
        >
          <AnimatePresence>
            {recent.map((card) => (
              <motion.button
                key={card.id}
                type="button"
                variants={feedItemVariants}
                transition={transition.normal}
                onClick={() => onCardClick?.(card)}
                className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-muted/50 transition-colors"
              >
                {card.thumbnail ? (
                  <img
                    src={card.thumbnail}
                    alt=""
                    className="h-7 w-10 shrink-0 rounded object-cover"
                  />
                ) : (
                  <div className="h-7 w-10 shrink-0 rounded bg-muted" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">{card.title}</p>
                </div>
                {card.linkType && (
                  <Badge variant="secondary" className="text-[9px] px-1 py-0 shrink-0">
                    {card.linkType}
                  </Badge>
                )}
                <span className="text-[10px] text-muted-foreground shrink-0">
                  {timeAgo(card.createdAt)}
                </span>
              </motion.button>
            ))}
          </AnimatePresence>
        </motion.div>
      )}
    </div>
  );
}
