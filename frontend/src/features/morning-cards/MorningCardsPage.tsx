import { useCallback, useEffect, useRef, useState } from 'react';

import {
  fetchMorningCards,
  postJudgment,
  type MorningCardDomainKey,
  type MorningCardDto,
  type MorningCardVerdict,
} from '@/features/morning-cards/api';
import { DomainPicker } from '@/features/morning-cards/DomainPicker';
import { MorningCard } from '@/features/morning-cards/MorningCard';
import { SWIPE_DISTANCE_THRESHOLD_PX, useCardSwipe } from '@/features/morning-cards/use-card-swipe';
import { buildYoutubeWatchUrl } from '@/features/morning-cards/youtube-url';

const DEFAULT_DOMAIN: MorningCardDomainKey = 'work_practice';

/**
 * Mobile morning cards: one card at a time, swipe right = useful, left = skip.
 * One judgment is posted per swipe with the position it was shown at (0-based).
 * No buttons and no undo.
 */
export function MorningCardsPage() {
  const [domain, setDomain] = useState<MorningCardDomainKey>(DEFAULT_DOMAIN);
  const [cards, setCards] = useState<MorningCardDto[]>([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const downX = useRef(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    setCards([]);
    setIndex(0);
    fetchMorningCards(domain)
      .then((res) => {
        if (!cancelled) setCards(res.cards);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [domain]);

  const current: MorningCardDto | undefined = cards[index];

  const handleSwipe = useCallback(
    (verdict: MorningCardVerdict) => {
      if (!current) return;
      void postJudgment({
        video_id: current.video_id,
        domain,
        verdict,
        shown_position: index,
      }).catch(() => undefined);
      setIndex((i) => i + 1);
    },
    [current, domain, index]
  );

  const { dragX, handlers } = useCardSwipe({ onSwipe: handleSwipe });

  const handlePlay = useCallback((card: MorningCardDto) => {
    const url = buildYoutubeWatchUrl(card.video_id);
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  }, []);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-3 bg-background p-3 text-foreground">
      <DomainPicker value={domain} onChange={setDomain} />
      {loading ? (
        <p className="text-sm text-muted-foreground">불러오는 중…</p>
      ) : failed ? (
        <p className="text-sm text-muted-foreground">카드를 불러오지 못했습니다.</p>
      ) : current ? (
        <div
          key={current.video_id}
          data-testid="morning-card-swipe-area"
          className="touch-pan-y select-none"
          style={{ transform: `translateX(${dragX}px)` }}
          onPointerDown={(e) => {
            downX.current = e.clientX;
            handlers.onPointerDown(e);
          }}
          onPointerMove={handlers.onPointerMove}
          onPointerUp={handlers.onPointerUp}
          onPointerCancel={handlers.onPointerCancel}
          onClickCapture={(e) => {
            // A swipe must not also count as a tap.
            if (Math.abs(e.clientX - downX.current) >= SWIPE_DISTANCE_THRESHOLD_PX) {
              e.stopPropagation();
            }
          }}
        >
          <MorningCard card={current} onPlay={handlePlay} />
        </div>
      ) : null}
    </main>
  );
}
