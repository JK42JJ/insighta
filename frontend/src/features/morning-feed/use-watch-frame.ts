import { useEffect, useLayoutEffect, useState, type RefObject } from 'react';

import { playerHeight, type Frame } from '@/features/morning-feed/watch-r3-layout';

/*
 * The watch screen's frame: app width/height (dynamic viewport) and the safe areas, measured,
 * plus the player height for that width. README "화면 높이 기준": with browser bars the safe areas
 * are 0; added to the home screen they are the status bar and the home indicator.
 *
 * env(safe-area-inset-*) is 0 unless the viewport has viewport-fit=cover, so this screen sets it
 * while it is mounted (and puts the previous content back on the way out): the rest of the app
 * keeps its viewport as it is.
 */

const VIEWPORT_FIT = 'viewport-fit=cover';

export interface FrameOverride {
  safeTop: number;
  safeBottom: number;
}

/** Test hook for side-by-side captures (fixture only): '47,34' -> the two safe areas. */
export function parseSafeOverride(value: string | null): FrameOverride | null {
  if (!value) return null;
  const m = /^(\d{1,3}),(\d{1,3})$/.exec(value.trim());
  return m ? { safeTop: Number(m[1]), safeBottom: Number(m[2]) } : null;
}

function readInsets(): { top: number; bottom: number } {
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;top:0;left:0;visibility:hidden;pointer-events:none;' +
    'padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)';
  document.body.appendChild(probe);
  const cs = window.getComputedStyle(probe);
  const out = { top: parseFloat(cs.paddingTop) || 0, bottom: parseFloat(cs.paddingBottom) || 0 };
  probe.remove();
  return out;
}

export function useViewportFitCover(): void {
  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    if (!meta) return undefined;
    const before = meta.content;
    if (!before.includes(VIEWPORT_FIT)) meta.content = before + ', ' + VIEWPORT_FIT;
    return () => {
      meta.content = before;
    };
  }, []);
}

export function useWatchFrame(
  app: RefObject<HTMLElement>,
  override: FrameOverride | null = null
): Frame & { width: number } {
  const [frame, setFrame] = useState<Frame & { width: number }>(() => {
    const width = Math.min(window.innerWidth, 430);
    return {
      width,
      vh: window.innerHeight,
      safeTop: override?.safeTop ?? 0,
      safeBottom: override?.safeBottom ?? 0,
      playerH: playerHeight(width),
    };
  });
  const oTop = override?.safeTop ?? null;
  const oBottom = override?.safeBottom ?? null;
  useLayoutEffect(() => {
    const el = app.current;
    if (!el) return undefined;
    const measure = (): void => {
      const r = el.getBoundingClientRect();
      const fixed = oTop !== null && oBottom !== null;
      const ins = fixed ? null : readInsets();
      const next = {
        width: Math.round(r.width),
        vh: Math.round(r.height),
        safeTop: fixed ? oTop : Math.round(ins?.top ?? 0),
        safeBottom: fixed ? oBottom : Math.round(ins?.bottom ?? 0),
        playerH: playerHeight(Math.round(r.width)),
      };
      setFrame((f) =>
        f.width === next.width &&
        f.vh === next.vh &&
        f.safeTop === next.safeTop &&
        f.safeBottom === next.safeBottom
          ? f
          : next
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('orientationchange', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('orientationchange', measure);
    };
  }, [app, oTop, oBottom]);
  return frame;
}
