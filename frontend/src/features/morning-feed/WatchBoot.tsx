import { useEffect, useState, type CSSProperties } from 'react';

import { useViewportFitCover } from '@/features/morning-feed/use-watch-frame';

import {
  bootStage,
  type BootStage,
  BOOT_LINE_MS,
  BOOT_SKELETON_MS,
} from '@/features/morning-feed/watch-boot-stage';
import './watch-boot.css';

/*
 * First open of the watch screen (design 수정 4 §8): logo → logo with a running line → the input
 * screen's skeleton, on Paper. Shown wherever the page would otherwise be blank while it starts
 * (sign-in check, code chunks, the flag check, today's state). The stage follows the time since
 * the page loaded, so the sequence continues across those places instead of starting over;
 * when the content is quick, the later stages never show.
 */

const SKELETON_CHIPS = 8;
const pageStart = typeof performance !== 'undefined' ? performance.now() : 0;

export function WatchBoot({
  fixed,
  safe,
}: {
  /** Fixture only: hold this stage. */
  fixed?: BootStage;
  /** Fixture only: safe areas a desktop browser does not have. */
  safe?: { top: number; bottom: number };
}): JSX.Element {
  // env(safe-area-inset-*) is 0 until the viewport covers the screen (same as the watch screen)
  useViewportFitCover();
  const [timed, setStage] = useState<BootStage>(() => bootStage(performance.now() - pageStart));
  const stage = fixed ?? timed;
  useEffect(() => {
    if (fixed || stage === 'skeleton') return undefined;
    const elapsed = performance.now() - pageStart;
    const next = stage === 'logo' ? BOOT_LINE_MS : BOOT_SKELETON_MS;
    const t = window.setTimeout(
      () => setStage(bootStage(performance.now() - pageStart)),
      Math.max(0, next - elapsed)
    );
    return () => window.clearTimeout(t);
  }, [stage, fixed]);

  return (
    <div
      className="mf-boot"
      data-testid="mf-w-boot"
      data-stage={stage}
      aria-busy="true"
      style={
        safe
          ? ({
              '--boot-safe-top': safe.top + 'px',
              '--boot-safe-bottom': safe.bottom + 'px',
            } as CSSProperties)
          : undefined
      }
    >
      {stage !== 'skeleton' ? (
        <div className="mf-boot-logo">
          <div className="mf-boot-char" aria-hidden="true">
            <div className="mf-boot-eye" />
            <div className="mf-boot-eye" />
          </div>
          <div className="mf-boot-name">Insighta</div>
          <div className="mf-boot-line" data-on={stage === 'line' ? '' : undefined}>
            {stage === 'line' ? <div className="mf-boot-run" /> : null}
          </div>
        </div>
      ) : (
        <div className="mf-boot-skel">
          <div className="mf-boot-head">
            <div className="mf-boot-brand">Insighta</div>
            <div className="mf-boot-av" />
          </div>
          <div className="mf-boot-wide-line">
            <div className="mf-boot-run" />
          </div>
          <div className="mf-boot-card" />
          <div className="mf-boot-grow" />
          <div className="mf-boot-ask" />
          {/* the typed-goal row is hidden on the input screen, so its placeholder is too */}
          <div className="mf-boot-chips">
            {Array.from({ length: SKELETON_CHIPS }, (_x, i) => (
              <div key={i} className="mf-boot-chip" />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
