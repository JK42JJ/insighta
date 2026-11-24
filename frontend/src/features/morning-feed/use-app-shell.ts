import { useEffect } from 'react';

/*
 * The brief screens as an app (decision 2026-11-14 "웹 티 없애기", 11-07 명세 모바일 웹 완성도):
 * - added to the home screen it opens full screen at the brief home (its own manifest:
 *   standalone, scope /morning-cards, start /morning-cards?view=watch, paper status bar);
 * - the page itself never rubber-bands or pulls to refresh; only the content scrolls.
 * Everything is put back when the screen unmounts.
 */

export const BRIEF_MANIFEST = '/insighta-brief.webmanifest';
/** The paper background (watch.css --w-paper), for the status bar and the splash. */
export const BRIEF_THEME = '#f7f5f0';

export function useAppShell(): void {
  useEffect(() => {
    const undo: Array<() => void> = [];
    const html = document.documentElement;
    const body = document.body;
    const prev = [html.style.overscrollBehavior, body.style.overscrollBehavior];
    html.style.overscrollBehavior = 'none';
    body.style.overscrollBehavior = 'none';
    undo.push(() => {
      html.style.overscrollBehavior = prev[0] ?? '';
      body.style.overscrollBehavior = prev[1] ?? '';
    });
    // one theme colour: change the page's own tag rather than adding a second one
    const theme = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (theme) {
      const was = theme.content;
      theme.content = BRIEF_THEME;
      undo.push(() => {
        theme.content = was;
      });
    }
    const add = (tag: string, attrs: Record<string, string>): void => {
      const el = document.createElement(tag);
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
      document.head.appendChild(el);
      undo.push(() => el.remove());
    };
    // another manifest on the page (none on the watch route today) gives way while this is shown
    document.querySelectorAll<HTMLLinkElement>('link[rel="manifest"]').forEach((l) => {
      const href = l.href;
      l.removeAttribute('href');
      undo.push(() => l.setAttribute('href', href));
    });
    add('link', { rel: 'manifest', href: BRIEF_MANIFEST });
    if (!theme) add('meta', { name: 'theme-color', content: BRIEF_THEME });
    add('meta', { name: 'apple-mobile-web-app-capable', content: 'yes' });
    add('meta', { name: 'mobile-web-app-capable', content: 'yes' });
    add('meta', { name: 'apple-mobile-web-app-title', content: 'Insighta' });
    // light screens: dark status bar text on the paper
    add('meta', { name: 'apple-mobile-web-app-status-bar-style', content: 'default' });
    return () => undo.reverse().forEach((fn) => fn());
  }, []);
}
