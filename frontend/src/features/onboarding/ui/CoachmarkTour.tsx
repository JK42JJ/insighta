/**
 * CoachmarkTour — spotlight + speech-bubble step sequence (말풍선 온보딩).
 *
 * Screen dims except the anchored element (box-shadow spotlight); a bubble
 * next to it explains the feature with [다음] advancing and 건너뛰기/ESC
 * ending the tour. Missing anchors are skipped so the tour never blocks.
 * Custom-built (~150 lines) instead of an external tour lib: reuses the
 * existing stack only and stays predictable against the app's z-index
 * terrain (palette z-200 / tooltips z-300 → tour z-400).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { CoachStep } from '../steps';

interface Props {
  steps: CoachStep[];
  /** Called once when the user finishes OR skips the tour. */
  onDone: () => void;
}

const BUBBLE_WIDTH = 300;
const SPOT_PADDING = 6;
const VIEWPORT_MARGIN = 12;

interface AnchorRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function measure(selector: string): AnchorRect | null {
  const el = document.querySelector(selector);
  if (!el) return null;
  const r = (el as HTMLElement).getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

export function CoachmarkTour({ steps, onDone }: Props) {
  const { t } = useTranslation();
  const [idx, setIdx] = useState(0);
  const [rect, setRect] = useState<AnchorRect | null>(null);

  // Resolve the current step; skip forward past steps whose anchor is absent.
  const step = steps[idx] ?? null;

  const remeasure = useCallback(() => {
    if (!step) return;
    setRect(measure(step.anchor));
  }, [step]);

  useEffect(() => {
    if (!step) {
      onDone();
      return;
    }
    // Anchor may not have painted yet (screen still fetching) — poll before
    // giving up, else a slow first load silently burns the whole tour
    // (measured 2026-07-02: learning tour consumed itself pre-paint).
    const RETRY_MS = 500;
    const MAX_TRIES = 16; // ≈8s
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cleanupListeners: (() => void) | null = null;

    const attempt = () => {
      const r = measure(step.anchor);
      if (!r) {
        tries += 1;
        if (tries >= MAX_TRIES) {
          // Anchor truly absent (collapsed sidebar, empty grid…) — skip.
          if (idx < steps.length - 1) setIdx((i) => i + 1);
          else onDone();
          return;
        }
        timer = setTimeout(attempt, RETRY_MS);
        return;
      }
      setRect(r);
      (document.querySelector(step.anchor) as HTMLElement | null)?.scrollIntoView({
        block: 'nearest',
      });
      window.addEventListener('resize', remeasure);
      window.addEventListener('scroll', remeasure, true);
      cleanupListeners = () => {
        window.removeEventListener('resize', remeasure);
        window.removeEventListener('scroll', remeasure, true);
      };
    };
    attempt();
    return () => {
      if (timer) clearTimeout(timer);
      cleanupListeners?.();
    };
  }, [step, idx, steps.length, onDone, remeasure]);

  // ESC = skip the whole tour.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDone();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDone]);

  const bubbleStyle = useMemo(() => {
    if (!rect) return null;
    const below = rect.top + rect.height + 16;
    const fitsBelow = below + 170 < window.innerHeight;
    const top = fitsBelow ? below : Math.max(VIEWPORT_MARGIN, rect.top - 16 - 170);
    const left = Math.max(
      VIEWPORT_MARGIN,
      Math.min(rect.left, window.innerWidth - BUBBLE_WIDTH - VIEWPORT_MARGIN)
    );
    return { top, left, width: BUBBLE_WIDTH };
  }, [rect]);

  if (!step || !rect || !bubbleStyle) return null;

  const isLast = idx === steps.length - 1;

  return createPortal(
    <div
      className="fixed inset-0 z-[400]"
      role="dialog"
      aria-label={t(step.titleKey, step.titleDefault)}
    >
      {/* Spotlight — the hole stays interactive-looking but blocks clicks so
          the tour advances only via its own buttons. */}
      <div
        className="absolute rounded-lg pointer-events-none transition-all duration-200"
        style={{
          top: rect.top - SPOT_PADDING,
          left: rect.left - SPOT_PADDING,
          width: rect.width + SPOT_PADDING * 2,
          height: rect.height + SPOT_PADDING * 2,
          boxShadow: '0 0 0 9999px hsl(var(--background) / 0.72)',
        }}
      />

      {/* Speech bubble */}
      <div
        className="absolute rounded-xl border border-border/60 bg-popover shadow-2xl p-4 animate-in fade-in slide-in-from-bottom-1 duration-200"
        style={bubbleStyle}
      >
        <p className="text-[13.5px] font-semibold text-foreground leading-snug">
          {t(step.titleKey, step.titleDefault)}
        </p>
        <p className="mt-1.5 text-[12.5px] text-muted-foreground leading-relaxed">
          {t(step.bodyKey, step.bodyDefault)}
        </p>
        <div className="mt-3.5 flex items-center justify-between">
          <div className="flex items-center gap-1.5" aria-hidden="true">
            {steps.map((s, i) => (
              <span
                key={s.id}
                className={
                  i === idx
                    ? 'w-4 h-1.5 rounded-full bg-primary'
                    : 'w-1.5 h-1.5 rounded-full bg-muted-foreground/30'
                }
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onDone}
              className="h-7 px-2 rounded-md text-[12px] text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06] transition-colors"
            >
              {t('onboarding.skip', '건너뛰기')}
            </button>
            <button
              type="button"
              onClick={() => (isLast ? onDone() : setIdx((i) => i + 1))}
              className="h-7 px-3 rounded-md text-[12px] font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              {isLast ? t('onboarding.finish', '시작하기') : t('onboarding.next', '다음')}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
