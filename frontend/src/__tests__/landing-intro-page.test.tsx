import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// no network in tests: the font links are not added and the wait ends at once
vi.mock('@/features/morning-feed/watch-home-fonts', () => ({
  ensureHomeFonts: () => undefined,
  waitHomeFonts: () => Promise.resolve('late'),
  FONT_WAIT_MS: 1500,
}));
const toast = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast }));
// the landing wall (public endpoint): fails by default, so the letter tiles show
const fetchLandingWall = vi.hoisted(() => vi.fn());
vi.mock('@/features/morning-cards/api', () => ({ fetchLandingWall }));
// the sheets render the real pages; their i18n text is not under test here
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  Trans: ({ i18nKey }: { i18nKey: string }) => i18nKey,
}));

import { IN_APP_NOTICE, peekLandingArrival, readLandingEvents } from '@/features/landing-intro';
import { IntroPage } from '@/pages/intro';
import {
  HERO_BODY,
  ILLU_CHANNELS,
  WALL_CREDIT,
  WALL_PICK,
  WALL_ROWS,
  WALL_TILES,
} from '@/pages/intro/model/intro-content';

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
  fetchLandingWall.mockReset();
  fetchLandingWall.mockRejectedValue(new Error('offline'));
});

const ids = (prefix: string, n: number): string[] =>
  Array.from({ length: n }, (_x, i) => `${prefix}${String(i).padStart(10, '0')}`);
function wallData() {
  const highlight = ids('h', 6);
  const others = ids('o', 14);
  const items = Object.fromEntries(
    [...highlight, ...others].map((id) => [id, { title: `T ${id}`, channel: `C ${id}` }])
  );
  return { date: '2026-11-24', highlight, others, items };
}
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
  });

  it('the wall lights six tiles with the first letter of the example brief channels, the rest blank', () => {
    draw();
    const tiles = screen.getAllByTestId('li-tile');
    expect(WALL_ROWS).toBe(3);
    expect(tiles).toHaveLength(WALL_TILES);
    expect(WALL_TILES).toBe(12);
    const lit = tiles.filter((t) => t.hasAttribute('data-pick'));
    expect(lit.map((t) => tiles.indexOf(t))).toEqual([...WALL_PICK]);
    expect(lit.map((t) => t.textContent)).toEqual(ILLU_CHANNELS.map((c) => c.slice(0, 1)));
    expect(
      tiles.filter((t) => !t.hasAttribute('data-pick')).every((t) => t.textContent === '')
    ).toBe(true);
    // fallback (request failed): no images, no links, no YouTube credit
    expect(screen.getByTestId('li-intro').querySelectorAll('img')).toHaveLength(0);
    expect(screen.queryByTestId('li-wall-credit')).toBeNull();
    expect(screen.getByTestId('li-wall').getAttribute('aria-hidden')).toBe('true');
  });

  it('with the wall data: original thumbnails as links to the video, the six on the lit tiles', async () => {
    const data = wallData();
    fetchLandingWall.mockResolvedValue(data);
    draw();
    await waitFor(() => expect(screen.getByTestId('li-wall-credit')).toBeTruthy());
    expect(screen.getByTestId('li-wall-credit').textContent).toBe(WALL_CREDIT);
    const tiles = screen.getAllByTestId('li-tile');
    expect(tiles).toHaveLength(WALL_TILES);
    const lit = tiles.filter((t) => t.hasAttribute('data-pick'));
    expect(lit.map((t) => tiles.indexOf(t))).toEqual([...WALL_PICK]);
    lit.forEach((t, k) => {
      const id = data.highlight[k]!;
      expect(t.getAttribute('href')).toBe(`https://www.youtube.com/watch?v=${id}`);
      expect(t.getAttribute('aria-label')).toBe(`T ${id} — C ${id}`);
    });
    for (const t of lit) {
      expect(t.tagName).toBe('A');
      expect(t.getAttribute('target')).toBe('_blank');
      expect(t.getAttribute('rel')).toBe('noopener');
      const img = t.querySelector('img')!;
      expect(img.getAttribute('src')).toMatch(
        /^https:\/\/i\.ytimg\.com\/vi\/[\w-]{11}\/mqdefault\.jpg$/
      );
      // nothing on the image itself alters it
      expect(img.getAttribute('style')).toBeNull();
    }
    // only the six lit tiles carry a picture (as in the design); the rest stay empty tiles
    for (const t of tiles.filter((x) => !x.hasAttribute('data-pick'))) {
      expect(t.tagName).toBe('DIV');
      expect(t.querySelector('img')).toBeNull();
    }
    expect(screen.getByTestId('li-intro').querySelectorAll('img')).toHaveLength(WALL_PICK.length);
  });

  it('fewer than six highlighted videos keeps the letter tiles', async () => {
    const data = wallData();
    fetchLandingWall.mockResolvedValue({ ...data, highlight: data.highlight.slice(0, 3) });
    draw();
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId('li-intro').querySelectorAll('img')).toHaveLength(0);
    expect(screen.queryByTestId('li-wall-credit')).toBeNull();
  });
});

describe('privacy policy and terms', () => {
  it.each([
    ['li-privacy', 'privacy', '개인정보처리방침', 'privacy.title'],
    ['li-terms', 'terms', '이용약관', 'terms.title'],
  ])('%s opens the page content in a sheet, X and Esc close it', async (link, doc, name, title) => {
    draw();
    const trigger = screen.getByTestId(link);
    expect(trigger.tagName).toBe('BUTTON');
    fireEvent.click(trigger);
    const sheet = await screen.findByRole('dialog', { name });
    expect(sheet.getAttribute('data-testid')).toBe(`li-sheet-${doc}`);
    expect(await screen.findByText(title)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '닫기' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    const again = await screen.findByRole('dialog', { name });
    fireEvent.keyDown(again, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
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
