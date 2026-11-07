import { useEffect, useState } from 'react';

const FONT_TIMEOUT_MS = 3000;
const KR_WEIGHTS = [400, 500, 700, 900];
const INTER_WEIGHTS = [500, 600, 700];

/**
 * True once the screen's web fonts (Noto Sans KR, Inter) are loaded for the given
 * text, or after a timeout (offline / blocked fonts must not leave a blank screen).
 * The screen waits so text is laid out once, with the final metrics.
 */
export function useFontsReady(text: string): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    const finish = () => {
      if (alive) setReady(true);
    };
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
    if (!fonts || typeof fonts.load !== 'function') {
      finish();
      return undefined;
    }
    const timer = window.setTimeout(finish, FONT_TIMEOUT_MS);
    const loads = [
      ...KR_WEIGHTS.map((w) => fonts.load(`${w} 16px "Noto Sans KR"`, text)),
      ...INTER_WEIGHTS.map((w) => fonts.load(`${w} 16px "Inter"`, '0123456789:')),
    ];
    Promise.all(loads)
      .then(() => fonts.ready)
      .then(finish, finish);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [text]);
  return ready;
}
