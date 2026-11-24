import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// no network in tests: the font links are not added and the wait ends at once
vi.mock('@/features/morning-feed/watch-home-fonts', () => ({
  ensureHomeFonts: () => undefined,
  waitHomeFonts: () => Promise.resolve('late'),
}));
const toast = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast }));

import { IN_APP_NOTICE, peekLandingArrival, readLandingEvents } from '@/features/landing-intro';
import { IntroPage } from '@/pages/intro';
import { HERO_BODY, ILLU_CHANNELS, WALL_PICK } from '@/pages/intro/model/intro-content';

/*
 * Landing page (design "Insighta Intro", decisions 2026-11-24): the text as designed with the two
 * decided changes, the channel letter wall, and what the Google buttons and ADD do.
 */

const IOS_INSTAGRAM =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 300.0.0.0';

function draw(onSignIn = vi.fn(() => Promise.resolve())) {
  render(
    <MemoryRouter>
      <IntroPage onSignIn={onSignIn} />
    </MemoryRouter>
  );
  return onSignIn;
}

beforeEach(() => {
  sessionStorage.clear();
  toast.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('landing page text', () => {
  it('has the decided hero body and no line under the last Google button', () => {
    draw();
    expect(screen.getByTestId('li-hero-body').textContent).toBe(
      '분야마다 최근 한 달 동안 올라온 영상을 살펴봤어요. 어떤 내용인지 먼저 읽어 보고, 마음에 드는 영상만 보세요.'
    );
    expect(HERO_BODY).not.toMatch(/선택한 분야/);
    const page = screen.getByTestId('li-intro').textContent ?? '';
    expect(page).not.toMatch(/이름과 이메일 정보만 사용해요/);
    // the design's other text, unchanged
    for (const t of [
      '오늘 볼 영상,',
      '미리 골라 뒀어요',
      '그 수고를 인사이타가 대신할게요.',
      '왜곡 없는 정보를 지향합니다',
      '지금은 8개 분야에서 골라 드려요.',
      'Google 계정으로 로그인하면 오늘의 영상을 바로 볼 수 있어요.',
      '개인정보처리방침',
      '이용약관',
    ]) {
      expect(page).toContain(t);
    }
    expect(screen.getAllByText('Google로 계속하기')).toHaveLength(2);
    expect(screen.getByText('개인정보처리방침').getAttribute('href')).toBe('/privacy');
    expect(screen.getByText('이용약관').getAttribute('href')).toBe('/terms');
  });

  it('the wall lights six tiles with the first letter of the example brief channels, the rest blank', () => {
    draw();
    const tiles = screen.getAllByTestId('li-tile');
    expect(tiles).toHaveLength(20);
    const lit = tiles.filter((t) => t.hasAttribute('data-pick'));
    expect(lit.map((t) => tiles.indexOf(t))).toEqual([...WALL_PICK]);
    expect(lit.map((t) => t.textContent)).toEqual(ILLU_CHANNELS.map((c) => c.slice(0, 1)));
    expect(
      tiles.filter((t) => !t.hasAttribute('data-pick')).every((t) => t.textContent === '')
    ).toBe(true);
    // no images at all on the wall (YouTube thumbnails are not used)
    expect(screen.getByTestId('li-intro').querySelectorAll('img')).toHaveLength(0);
  });
});

describe('landing page actions', () => {
  it('records the visit once and a Google button tap with its button, then starts sign-in', () => {
    const onSignIn = draw();
    fireEvent.click(screen.getByTestId('li-google-sticky'));
    expect(onSignIn).toHaveBeenCalledTimes(1);
    expect(peekLandingArrival()).toBe('google');
    fireEvent.click(screen.getByTestId('li-google-final')); // a second tap while leaving: ignored (review 11-24)
    expect(onSignIn).toHaveBeenCalledTimes(1);
    expect(readLandingEvents()).toEqual([
      { kind: 'landing_open' },
      { kind: 'start_click', value: 'sticky' },
    ]);
  });

  it('ADD starts sign-in like the Google buttons and is remembered for the notice after', () => {
    const onSignIn = draw();
    fireEvent.click(screen.getByTestId('li-add'));
    expect(onSignIn).toHaveBeenCalledTimes(1);
    expect(peekLandingArrival()).toBe('add');
    expect(readLandingEvents()).toContainEqual({ kind: 'add_click' });
  });

  it('inside an app webview with no way out: no sign-in, the notice instead', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(IOS_INSTAGRAM);
    const onSignIn = draw();
    fireEvent.click(screen.getByTestId('li-google-final'));
    expect(onSignIn).not.toHaveBeenCalled();
    expect(peekLandingArrival()).toBeNull();
    expect(toast).toHaveBeenCalledWith(IN_APP_NOTICE, expect.anything());
    // the tap itself is still kept
    expect(readLandingEvents()).toContainEqual({ kind: 'start_click', value: 'final' });
  });
});
