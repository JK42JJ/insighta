/**
 * The morning feed screen uses Noto Sans KR and Inter (design reference). They are
 * requested only when this screen's code loads, not for the rest of the app.
 */
const FONT_HREF =
  'https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700;900&family=Inter:wght@500;600;700&display=swap';

export function loadMorningFeedFonts(): void {
  if (typeof document === 'undefined') return;
  if (document.querySelector('link[data-mf-fonts]')) return;
  const pre = document.createElement('link');
  pre.rel = 'preconnect';
  pre.href = 'https://fonts.googleapis.com';
  pre.setAttribute('data-mf-fonts', 'preconnect');
  const sheet = document.createElement('link');
  sheet.rel = 'stylesheet';
  sheet.href = FONT_HREF;
  sheet.setAttribute('data-mf-fonts', 'sheet');
  document.head.appendChild(pre);
  document.head.appendChild(sheet);
}

loadMorningFeedFonts();
