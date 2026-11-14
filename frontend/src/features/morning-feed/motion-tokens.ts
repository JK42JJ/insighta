import type { CSSProperties } from 'react';

/*
 * Touch and motion values for every new screen (home, brief, past briefs, the video screen,
 * onboarding, the account sheet), decision 2026-11-14 "앱처럼 반응". This file is the one place
 * the values live: motion.css reads them as custom properties set on the app root
 * (motionStyleVars), the screen stack and the sheet read the same constants. When the design
 * values arrive, only this file changes.
 *
 * Motion uses position, scale and opacity only (no layout properties), so nothing here moves the
 * video player out of step with its card.
 */
export const MOTION = {
  press: {
    /** Buttons and chips. */
    btnScale: 0.97,
    /** Icon buttons (좋아, 별로, 소리, 뒤로). */
    iconScale: 0.9,
    /** Text links and source marks. */
    linkOpacity: 0.5,
    /** Pressed in at pointerdown. */
    inMs: 80,
    /** Back out after release or when the finger leaves. */
    outMs: 200,
    /** Filled buttons: a dark layer on top (opacity of a black layer). */
    darkLayer: 0.12,
    /** Outlined buttons and whole rows: a faint fill underneath the text. */
    faintFill: 'rgba(20, 26, 36, 0.06)',
    /** Reduced motion: every pressed element only fades to this. */
    reducedOpacity: 0.6,
  },
  /** One level in or out (home → brief → past briefs, brief → video). */
  push: {
    ms: 350,
    ease: 'cubic-bezier(0.32, 0.72, 0, 1)',
    /** The screen underneath moves this share of the width to the left. */
    underShift: 0.3,
    /** ... and gets this dark layer. */
    underDim: 0.12,
  },
  /** Sheets rising from the bottom (account). */
  sheet: {
    ms: 350,
    ease: 'cubic-bezier(0.32, 0.72, 0, 1)',
    scrim: 0.4,
    /** Dragged down this far (px), or flicked faster than closeVelocity (px/ms), it closes. */
    closeDistance: 90,
    closeVelocity: 0.5,
  },
  /** A state that changes at once (좋아/별로, the brief reaction). */
  pop: {
    scale: 1.15,
    ms: 250,
  },
  /** Chip selection moving (existing value). */
  chipMs: 200,
  /** Loading: below this the placeholder lines are skipped; over the busy wait a button spins. */
  wait: {
    skeletonAfterMs: 300,
    busyAfterMs: 400,
  },
  /** Android only (iPhone has no vibration API): a short buzz on 좋아/별로 and the reaction. */
  hapticMs: 10,
} as const;

/** The values as custom properties on the app root, read by motion.css. */
export function motionStyleVars(): CSSProperties {
  const m = MOTION;
  return {
    '--mo-press-btn-scale': String(m.press.btnScale),
    '--mo-press-icon-scale': String(m.press.iconScale),
    '--mo-press-link-opacity': String(m.press.linkOpacity),
    '--mo-press-in': m.press.inMs + 'ms',
    '--mo-press-out': m.press.outMs + 'ms',
    '--mo-press-dark': String(m.press.darkLayer),
    '--mo-press-fill': m.press.faintFill,
    '--mo-press-reduced-opacity': String(m.press.reducedOpacity),
    '--mo-push-ms': m.push.ms + 'ms',
    '--mo-push-ease': m.push.ease,
    '--mo-sheet-ms': m.sheet.ms + 'ms',
    '--mo-sheet-ease': m.sheet.ease,
    '--mo-sheet-scrim': String(m.sheet.scrim),
    '--mo-pop-scale': String(m.pop.scale),
    '--mo-pop-ms': m.pop.ms + 'ms',
    '--mo-chip-ms': m.chipMs + 'ms',
  } as CSSProperties;
}

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  );
}

/** A short buzz where the device supports it (Android); nothing on iPhone or desktop. */
export function haptic(): void {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(MOTION.hapticMs);
    }
  } catch {
    /* not allowed here: no buzz */
  }
}

/** The 1.15× pop of an icon that was just pressed (좋아, 별로, the brief reaction). */
export function popIcon(el: Element | null): void {
  if (!el || typeof (el as HTMLElement).animate !== 'function') return;
  if (prefersReducedMotion()) return;
  (el as HTMLElement).animate(
    [
      { transform: 'scale(1)' },
      { transform: `scale(${MOTION.pop.scale})` },
      { transform: 'scale(1)' },
    ],
    { duration: MOTION.pop.ms, easing: 'ease-out' }
  );
}
