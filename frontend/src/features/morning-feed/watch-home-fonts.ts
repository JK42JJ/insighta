/*
 * Daily home fonts (README "글꼴 불러오는 방법"): Noto Serif KR 500 for the headline and
 * Pretendard Variable for the rest, both split by unicode-range so only the pieces with the
 * drawn characters are fetched. The entrance motion waits for them for at most 1.5 s; after
 * that the screen is shown at once in the fallback font and the fonts swap in when they arrive.
 */

const LINKS: ReadonlyArray<{ rel: string; href: string; crossOrigin?: string }> = [
  { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
  { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' },
  {
    rel: 'stylesheet',
    href: 'https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@500&display=swap',
  },
  {
    rel: 'stylesheet',
    href: 'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css',
  },
];
const MARK = 'data-mf-home-font';

/** README: the wait for the fonts before the entrance motion. */
export const FONT_WAIT_MS = 1500;
/** How often to look whether the stylesheets have declared their faces. */
const SHEET_POLL_MS = 50;

/** Adds the font links once per page. */
export function ensureHomeFonts(): void {
  if (typeof document === 'undefined') return;
  for (const l of LINKS) {
    if (document.head.querySelector(`link[${MARK}][href="${l.href}"][rel="${l.rel}"]`)) continue;
    const el = document.createElement('link');
    el.rel = l.rel;
    el.href = l.href;
    if (l.crossOrigin) el.crossOrigin = l.crossOrigin;
    el.setAttribute(MARK, '');
    document.head.appendChild(el);
  }
}

function facesDeclared(): boolean {
  const fams = [...document.fonts].map((f) => f.family).join('|');
  return /Noto Serif KR/.test(fams) && /Pretendard/.test(fams);
}

/**
 * 'ready' when the pieces for `headlines` and `ui` arrived within FONT_WAIT_MS, else 'late'.
 * fonts.load is called only after the stylesheets declared their faces (before that it returns
 * at once without fetching anything).
 */
export function waitHomeFonts(headlines: string, ui: string): Promise<'ready' | 'late'> {
  if (typeof document === 'undefined' || !document.fonts) return Promise.resolve('late');
  const started = Date.now();
  const loaded = new Promise<'ready'>((resolve, reject) => {
    const tryLoad = (): void => {
      if (!facesDeclared()) {
        if (Date.now() - started > FONT_WAIT_MS) {
          reject(new Error('font stylesheets not applied'));
          return;
        }
        window.setTimeout(tryLoad, SHEET_POLL_MS);
        return;
      }
      Promise.all([
        document.fonts.load("500 38px 'Noto Serif KR'", headlines),
        document.fonts.load("700 17px 'Pretendard Variable'", ui),
        document.fonts.load("500 13px 'Pretendard Variable'", ui),
      ]).then(
        () => resolve('ready'),
        (e: unknown) => reject(e)
      );
    };
    tryLoad();
  });
  const limit = new Promise<'late'>((resolve) =>
    window.setTimeout(() => resolve('late'), FONT_WAIT_MS)
  );
  return Promise.race([loaded.catch((): 'late' => 'late'), limit]);
}
