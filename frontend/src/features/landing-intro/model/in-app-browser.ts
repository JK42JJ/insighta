/*
 * In-app browsers (decision 2026-11-24): Google refuses OAuth inside app webviews
 * (`disallowed_useragent`), so a Google button there does not start sign-in. The page is opened
 * in the device's browser where an app offers a way (KakaoTalk's scheme, Chrome on Android);
 * otherwise the visitor is told what to do.
 */

export type InAppBrowser = 'kakaotalk' | 'instagram' | 'facebook' | 'line' | 'naver';

const IN_APP: ReadonlyArray<readonly [InAppBrowser, RegExp]> = [
  ['kakaotalk', /KAKAOTALK/i],
  ['instagram', /Instagram/i],
  ['facebook', /FBAN|FBAV|FB_IAB|FBIOS/],
  ['line', /\bLine\//i],
  ['naver', /NAVER\(inapp/i],
];

/** The in-app webview this user agent belongs to, or null for a regular browser. */
export function detectInAppBrowser(ua: string): InAppBrowser | null {
  for (const [name, re] of IN_APP) if (re.test(ua)) return name;
  return null;
}

/**
 * Where to send the page so it opens outside the webview, or null when there is no way
 * (iOS webviews other than KakaoTalk).
 */
export function externalOpenUrl(app: InAppBrowser, ua: string, pageUrl: string): string | null {
  if (app === 'kakaotalk') return 'kakaotalk://web/openExternal?url=' + encodeURIComponent(pageUrl);
  if (/Android/i.test(ua)) {
    const u = new URL(pageUrl);
    const scheme = u.protocol.replace(':', '');
    return `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=${scheme};package=com.android.chrome;end`;
  }
  return null;
}

/**
 * Shown when the page cannot leave the webview by itself (and when an attempt did not leave).
 * NOT in the design: James 확인 필요 before shipping.
 */
export const IN_APP_NOTICE =
  '이 앱 안에서는 Google 로그인을 할 수 없어요. 사파리나 크롬 같은 브라우저에서 이 주소를 열어 주세요.';
/** How long the notice stays (it is read, then acted on in another app). */
export const IN_APP_NOTICE_MS = 8000;
/** If the page is still in front this long after the attempt to leave, the notice is shown. */
export const EXTERNAL_OPEN_CHECK_MS = 1500;
