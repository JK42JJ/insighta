/**
 * CoachmarkTour — spotlight + speech-bubble step sequence (말풍선 온보딩).
 *
 * v2 design (James 2026-07-02: "포커스가 약해 집중이 안 된다"):
 * heavier dim (0.85), primary glow ring around the spotlight hole, brighter
 * elevated bubble with a caret pointing at the target. Missing anchors are
 * polled (~8s) then skipped so a slow first paint never burns the tour.
 * Custom-built — no external tour lib (z-terrain: palette 200 / tooltip 300
 * → tour 400).
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

const BUBBLE_WIDTH = 320;
const BUBBLE_EST_HEIGHT = 170;
const SPOT_PADDING = 6;
const VIEWPORT_MARGIN = 12;
const CARET_SIZE = 10;

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

  const layout = useMemo(() => {
    if (!rect) return null;
    const below = rect.top + rect.height + SPOT_PADDING + CARET_SIZE + 8;
    const placeBelow = below + BUBBLE_EST_HEIGHT < window.innerHeight;
    const top = placeBelow
      ? below
      : Math.max(VIEWPORT_MARGIN, rect.top - SPOT_PADDING - CARET_SIZE - 8 - BUBBLE_EST_HEIGHT);
    const anchorCenterX = rect.left + rect.width / 2;
    const left = Math.max(
      VIEWPORT_MARGIN,
      Math.min(anchorCenterX - BUBBLE_WIDTH / 3, window.innerWidth - BUBBLE_WIDTH - VIEWPORT_MARGIN)
    );
    // Caret x within the bubble, clamped away from rounded corners.
    const caretLeft = Math.max(
      16,
      Math.min(BUBBLE_WIDTH - 26, anchorCenterX - left - CARET_SIZE / 2)
    );
    return { top, left, placeBelow, caretLeft };
  }, [rect]);

  if (!step || !rect || !layout) return null;

  const isLast = idx === steps.length - 1;

  return createPortal(
    <div
      className="fixed inset-0 z-[400]"
      role="dialog"
      aria-label={t(step.titleKey, step.titleDefault)}
    >
      {/* Spotlight — heavy dim + primary glow ring so the focus is unmistakable. */}
      <div
        className="absolute rounded-lg pointer-events-none transition-all duration-200"
        style={{
          top: rect.top - SPOT_PADDING,
          left: rect.left - SPOT_PADDING,
          width: rect.width + SPOT_PADDING * 2,
          height: rect.height + SPOT_PADDING * 2,
          boxShadow: [
            '0 0 0 2px hsl(var(--primary) / 0.75)',
            '0 0 0 6px hsl(var(--primary) / 0.25)',
            '0 0 32px 8px hsl(var(--primary) / 0.30)',
            '0 0 0 9999px hsl(var(--background) / 0.85)',
          ].join(', '),
        }}
      />

      {/* Speech bubble + caret */}
      <div
        className="absolute rounded-xl border border-primary/30 bg-popover shadow-[0_16px_48px_rgba(0,0,0,0.6)] p-4 animate-in fade-in slide-in-from-bottom-1 duration-200"
        style={{ top: layout.top, left: layout.left, width: BUBBLE_WIDTH }}
      >
        <span
          aria-hidden="true"
          className="absolute h-2.5 w-2.5 rotate-45 bg-popover border-primary/30"
          style={
            layout.placeBelow
              ? { top: -6, left: layout.caretLeft, borderLeftWidth: 1, borderTopWidth: 1 }
              : { bottom: -6, left: layout.caretLeft, borderRightWidth: 1, borderBottomWidth: 1 }
          }
        />
        <p className="text-[14px] font-semibold text-foreground leading-snug">
          {t(step.titleKey, step.titleDefault)}
        </p>
        <p className="mt-1.5 text-[12.5px] text-muted-foreground leading-relaxed">
          {t(step.bodyKey, step.bodyDefault)}
        </p>
        <div className="mt-4 flex items-center justify-between">
          <div className="flex items-center gap-1.5" aria-hidden="true">
            {steps.length > 1 &&
              steps.map((s, i) => (
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
              {isLast ? t('onboarding.finish', '확인') : t('onboarding.next', '다음')}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
