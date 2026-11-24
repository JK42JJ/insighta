import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  detectInAppBrowser,
  externalOpenUrl,
  LANDING_EVENTS_MAX,
  markLandingSignIn,
  peekLandingArrival,
  readLandingEvents,
  recordLandingEvent,
  sendLandingArrival,
  takeLandingArrival,
} from '@/features/landing-intro';

/*
 * Landing page (decision 2026-11-24): the signed-out visitor's events stay in the tab and go out
 * after sign-in with login_done; Google sign-in is not started inside app webviews.
 */

/** The server's value shape (src/modules/morning-feed/brief-usage.ts EVENT_VALUE_RE). */
const SERVER_VALUE_RE = /^[A-Za-z0-9_-]{1,16}$/;

beforeEach(() => {
  sessionStorage.clear();
});

describe('landing events (tab storage)', () => {
  it('keeps landing_open and landing_scroll_step3 once, every tap with its button', () => {
    recordLandingEvent('landing_open');
    recordLandingEvent('landing_open');
    recordLandingEvent('landing_scroll_step3');
    recordLandingEvent('landing_scroll_step3');
    recordLandingEvent('start_click', 'sticky');
    recordLandingEvent('start_click', 'final');
    recordLandingEvent('add_click');
    expect(readLandingEvents()).toEqual([
      { kind: 'landing_open' },
      { kind: 'landing_scroll_step3' },
      { kind: 'start_click', value: 'sticky' },
      { kind: 'start_click', value: 'final' },
      { kind: 'add_click' },
    ]);
    for (const e of readLandingEvents()) {
      if (e.value !== undefined) expect(e.value).toMatch(SERVER_VALUE_RE);
    }
  });

  it('keeps at most LANDING_EVENTS_MAX events', () => {
    for (let i = 0; i < LANDING_EVENTS_MAX + 5; i++) recordLandingEvent('start_click', 'sticky');
    expect(readLandingEvents()).toHaveLength(LANDING_EVENTS_MAX);
  });

  it('ignores anything in the key that is not a landing event', () => {
    sessionStorage.setItem(
      'insighta-landing-events',
      JSON.stringify([
        { kind: 'home_open' },
        { kind: 'add_click' },
        'x',
        { kind: 'start_click', value: 3 },
      ])
    );
    expect(readLandingEvents()).toEqual([{ kind: 'add_click' }]);
    sessionStorage.setItem('insighta-landing-events', '{broken');
    expect(readLandingEvents()).toEqual([]);
  });

  it('the arrival is taken once with the kept events, and only after a sign-in from the landing', () => {
    recordLandingEvent('landing_open');
    expect(takeLandingArrival()).toBeNull();
    markLandingSignIn('add');
    expect(peekLandingArrival()).toBe('add');
    expect(takeLandingArrival()).toEqual({ entry: 'add', events: [{ kind: 'landing_open' }] });
    expect(takeLandingArrival()).toBeNull();
    expect(readLandingEvents()).toEqual([]);
  });
});

describe('sending after sign-in', () => {
  it('sends the kept events in order, then login_done', async () => {
    const send = vi.fn(async () => undefined);
    await sendLandingArrival(
      {
        entry: 'google',
        events: [{ kind: 'landing_open' }, { kind: 'start_click', value: 'final' }],
      },
      send
    );
    expect(send.mock.calls.map((c) => c[0])).toEqual([
      { kind: 'landing_open' },
      { kind: 'start_click', value: 'final' },
      { kind: 'login_done' },
    ]);
  });
});

describe('in-app browsers', () => {
  const PAGE = 'https://insighta.one/morning-cards?view=watch';
  const UA = {
    kakaoIos:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 10.4.5',
    kakaoAndroid:
      'Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0 Mobile Safari/537.36 KAKAOTALK/10.4.5',
    instaIos:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 300.0.0.0',
    instaAndroid:
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0 Mobile Safari/537.36 Instagram 300.0.0.0 Android',
    fbIos:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/440.0]',
    lineIos:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/13.20.0',
    naverIos:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 NAVER(inapp; search; 2000; 12.0.0)',
    safari:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    chromeAndroid:
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    samsung:
      'Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0 Mobile Safari/537.36',
  };

  it('tells the five webviews from regular browsers', () => {
    expect(detectInAppBrowser(UA.kakaoIos)).toBe('kakaotalk');
    expect(detectInAppBrowser(UA.kakaoAndroid)).toBe('kakaotalk');
    expect(detectInAppBrowser(UA.instaIos)).toBe('instagram');
    expect(detectInAppBrowser(UA.fbIos)).toBe('facebook');
    expect(detectInAppBrowser(UA.lineIos)).toBe('line');
    expect(detectInAppBrowser(UA.naverIos)).toBe('naver');
    expect(detectInAppBrowser(UA.safari)).toBeNull();
    expect(detectInAppBrowser(UA.chromeAndroid)).toBeNull();
    expect(detectInAppBrowser(UA.samsung)).toBeNull();
  });

  it('KakaoTalk opens the page outside on any phone; Android webviews through Chrome; iOS others: none', () => {
    expect(externalOpenUrl('kakaotalk', UA.kakaoIos, PAGE)).toBe(
      'kakaotalk://web/openExternal?url=' + encodeURIComponent(PAGE)
    );
    expect(externalOpenUrl('instagram', UA.instaAndroid, PAGE)).toBe(
      'intent://insighta.one/morning-cards?view=watch#Intent;scheme=https;package=com.android.chrome;end'
    );
    expect(externalOpenUrl('instagram', UA.instaIos, PAGE)).toBeNull();
    expect(externalOpenUrl('facebook', UA.fbIos, PAGE)).toBeNull();
  });
});
