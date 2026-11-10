import { cssText as css } from '@/features/morning-feed/css-text';
import type { FeedCard } from '@/features/morning-feed/MorningFeed';

/** True when the card carries anything for the detail panel. */
export function hasCardDetail(c: FeedCard): boolean {
  return !!(c.oneLiner || c.reasonLines?.length || c.checks?.length || c.chapters?.length);
}

const BLOCK_CARD =
  'border-radius: 16px; padding: 14px 16px; background: var(--mf-fit); display: flex; flex-direction: column; gap: 8px';
const BLOCK_LABEL = 'font-size: 12px; font-weight: 700; color: var(--mf-muted)';

/**
 * Detail panel below the video: 한 줄 요약, 이 영상을 고른 이유, 설명란에서 추린 순서.
 * It is a sibling of the swipe card (not inside it) and scrolls on its own, so a vertical scroll
 * here never reaches the card's pointer handlers. Each block shows only when its data exists.
 */
export function CardDetail({ card, onClose }: { card: FeedCard; onClose: () => void }) {
  const hasReason = !!(card.reasonLines?.length || card.checks?.length);
  return (
    <div
      data-testid="mf-detail"
      style={css(
        'position: absolute; left: 0; right: 0; bottom: 0; z-index: 7; top: calc(60px + env(safe-area-inset-top, 0px) + min(100vw, 430px) * 9 / 16); overflow-y: auto; overscroll-behavior: contain; touch-action: pan-y; background: var(--mf-bg); padding: 16px 20px max(26px, env(safe-area-inset-bottom, 0px)); display: flex; flex-direction: column; gap: 14px'
      )}
    >
      <div style={css('display: flex; align-items: center; justify-content: space-between')}>
        <span style={css('font-size: 15px; font-weight: 700')}>{card.title}</span>
        <button
          type="button"
          data-testid="mf-detail-close"
          onClick={onClose}
          style={css(
            'flex: none; margin-left: 12px; height: 32px; padding: 0 14px; border-radius: 999px; border: none; background: var(--mf-surface); color: var(--mf-fg); font-size: 13px; font-weight: 700; cursor: pointer'
          )}
        >
          닫기
        </button>
      </div>
      {card.oneLiner ? (
        <div
          data-testid="mf-oneliner"
          style={css(
            'border-left: 4px solid var(--mf-accent); padding-left: 14px; display: flex; flex-direction: column; gap: 4px'
          )}
        >
          <span style={css('font-size: 12px; font-weight: 700; color: var(--mf-accent-soft)')}>
            한 줄 요약
          </span>
          <span style={css('font-size: 15px; line-height: 1.6')}>{card.oneLiner}</span>
        </div>
      ) : null}
      {hasReason ? (
        <div data-testid="mf-reason" style={css(BLOCK_CARD)}>
          <span style={css(BLOCK_LABEL)}>이 영상을 고른 이유</span>
          {card.reasonLines?.map((line, k) => (
            <div
              key={'r' + k}
              style={css('font-size: 14px; line-height: 1.55; color: var(--mf-why)')}
            >
              {line}
            </div>
          ))}
          {card.checks?.map((chk, k) => (
            <div
              key={'c' + k}
              style={css(
                'font-size: 12.5px; font-weight: 700; color: ' +
                  (chk.text.startsWith('✓') ? 'var(--mf-ok)' : 'var(--mf-muted)')
              )}
            >
              {chk.text}
            </div>
          ))}
        </div>
      ) : null}
      {card.chapters?.length ? (
        <div data-testid="mf-chapters" style={css(BLOCK_CARD)}>
          <span style={css(BLOCK_LABEL)}>영상 설명란에서 추린 순서</span>
          {card.chapters.map((ch, k) => (
            <div key={k} style={css('display: flex; gap: 12px; font-size: 14px; line-height: 1.5')}>
              <span
                style={css(
                  "flex: none; width: 52px; font-family: 'Inter', sans-serif; font-size: 13px; font-weight: 700; color: var(--mf-accent-soft)"
                )}
              >
                {ch.at}
              </span>
              <span style={css('min-width: 0; color: var(--mf-why)')}>{ch.title}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
