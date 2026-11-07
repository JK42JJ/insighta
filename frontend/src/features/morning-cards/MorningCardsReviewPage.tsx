import { useCallback, useEffect, useState } from 'react';

import {
  fetchMorningCardsReview,
  MORNING_CARD_REASON_TAGS,
  patchReasonTags,
  type MorningCardDomainKey,
  type MorningCardReasonTag,
  type MorningCardReviewItem,
} from '@/features/morning-cards/api';
import { DomainPicker } from '@/features/morning-cards/DomainPicker';
import { formatUploadDate } from '@/features/morning-cards/MorningCard';

const DEFAULT_DOMAIN: MorningCardDomainKey = 'work_practice';
const EMPTY_MESSAGE = '올해 올라온 영상이 적습니다. 오래된 영상으로 채우지 않았습니다.';
const VERDICT_LABELS = { useful: '유용함', skip: '건너뜀' } as const;
const NO_VERDICT_LABEL = '미판정';

/**
 * PC review list: today's cards for a domain in one list with the saved
 * verdict and selectable reason tags. YouTube text is rendered as escaped text.
 */
export function MorningCardsReviewPage() {
  const [domain, setDomain] = useState<MorningCardDomainKey>(DEFAULT_DOMAIN);
  const [items, setItems] = useState<MorningCardReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    setItems([]);
    fetchMorningCardsReview(domain)
      .then((res) => {
        if (!cancelled) setItems(res.items);
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

  const toggleTag = useCallback(
    (item: MorningCardReviewItem, tag: MorningCardReasonTag) => {
      const next = item.reason_tags.includes(tag)
        ? item.reason_tags.filter((t) => t !== tag)
        : [...item.reason_tags, tag];
      void patchReasonTags({ video_id: item.video_id, domain, reason_tags: next })
        .then(() => {
          setItems((prev) =>
            prev.map((p) => (p.video_id === item.video_id ? { ...p, reason_tags: next } : p))
          );
        })
        .catch(() => undefined);
    },
    [domain]
  );

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 bg-background p-4 text-foreground">
      <DomainPicker value={domain} onChange={setDomain} />
      {loading ? (
        <p className="text-sm text-muted-foreground">불러오는 중…</p>
      ) : failed ? (
        <p className="text-sm text-muted-foreground">목록을 불러오지 못했습니다.</p>
      ) : items.length === 0 ? (
        <p data-testid="morning-review-empty" className="text-sm text-muted-foreground">
          {EMPTY_MESSAGE}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <li
              key={item.video_id}
              data-testid="morning-review-row"
              className="flex flex-col gap-1 rounded-lg border border-border bg-card p-3 text-card-foreground"
            >
              <h2 className="break-words text-base font-semibold">{item.title}</h2>
              <p className="break-words text-sm text-muted-foreground">
                {item.channel_name ?? ''}
              </p>
              <p data-testid="morning-review-date" className="text-sm text-muted-foreground">
                {formatUploadDate(item.published_at)}
              </p>
              <p className="break-words text-sm">{item.reason}</p>
              <p data-testid="morning-review-verdict" className="text-sm font-medium">
                {item.verdict ? VERDICT_LABELS[item.verdict] : NO_VERDICT_LABEL}
              </p>
              <div className="flex flex-wrap gap-2">
                {MORNING_CARD_REASON_TAGS.map((tag) => {
                  const selected = item.reason_tags.includes(tag);
                  return (
                    <button
                      key={tag}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => toggleTag(item, tag)}
                      className={
                        selected
                          ? 'rounded-md border border-primary bg-primary px-2 py-1 text-xs text-primary-foreground'
                          : 'rounded-md border border-border bg-card px-2 py-1 text-xs text-card-foreground'
                      }
                    >
                      {tag}
                    </button>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
