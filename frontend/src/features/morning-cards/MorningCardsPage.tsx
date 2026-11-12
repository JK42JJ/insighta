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
const EMPTY_MESSAGE = '올해 올라온 영상이 적습니다. 오래된 영상으로 채우지 않았습니다.';
const DONE_MESSAGE = '오늘 카드를 모두 확인했습니다.';

/**
 * Mobile morning cards: one card at a time, swipe right = useful, left = skip.
 * One judgment is posted per swipe with the position it was shown at (0-based).
 * No buttons and no undo.
 */
export function MorningCardsPage() {
  const [domain, setDomain] = useState<MorningCardDomainKey>(DEFAULT_DOMAIN);
  const [cards, setCards] = useState<MorningCardDto[]>([]);
  const [shortage, setShortage] = useState(false);
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
        if (cancelled) return;
        setCards(res.cards);
        setShortage(res.shortage);
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

  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  // One judgment = one saved row, then the next card. A failed save keeps the
  // same card on screen so nothing is silently lost.
  const handleVerdict = useCallback(
    async (verdict: MorningCardVerdict) => {
      if (!current || savingRef.current) return;
      savingRef.current = true;
      setSaving(true);
      setSaveFailed(false);
      try {
        await postJudgment({
          video_id: current.video_id,
          domain,
          verdict,
          shown_position: index,
        });
        setIndex((i) => i + 1);
      } catch {
        setSaveFailed(true);
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    },
    [current, domain, index]
  );
  const handleSwipe = handleVerdict;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') void handleVerdict('useful');
      else if (e.key === 'ArrowLeft') void handleVerdict('skip');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleVerdict]);

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
      ) : (
        <p data-testid="morning-cards-empty" className="text-sm text-muted-foreground">
          {cards.length === 0 ? EMPTY_MESSAGE : DONE_MESSAGE}
        </p>
      )}
      {!loading && !failed && current ? (
        <div className="flex gap-3">
          <button
            type="button"
            data-testid="verdict-skip"
            disabled={saving}
            onClick={() => void handleVerdict('skip')}
            className="flex-1 rounded-lg border border-border bg-card py-3 text-base font-semibold disabled:opacity-50"
          >
            별로
          </button>
          <button
            type="button"
            data-testid="verdict-useful"
            disabled={saving}
            onClick={() => void handleVerdict('useful')}
            className="flex-1 rounded-lg bg-primary py-3 text-base font-semibold text-primary-foreground disabled:opacity-50"
          >
            볼 만함
          </button>
        </div>
      ) : null}
      {saveFailed ? (
        <p data-testid="verdict-save-failed" className="text-sm text-destructive">
          저장하지 못했습니다. 다시 눌러 주세요.
        </p>
      ) : null}
      {!loading && !failed && current ? (
        <p className="text-xs text-muted-foreground">
          {index + 1} / {cards.length}
        </p>
      ) : null}
      {!loading && !failed && shortage && current ? (
        <p data-testid="morning-cards-shortage" className="text-xs text-muted-foreground">
          {EMPTY_MESSAGE}
        </p>
      ) : null}
    </main>
  );
}
