import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * 제안하기 (work order B4, 2026-11-25): in the account sheet for every account without the test
 * controls. One line and 보내기; what is sent carries the screen, the brief and, when a recording
 * is running, its address.
 */

const post = vi.hoisted(() => vi.fn());
const replay = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => vi.fn());
const clock = vi.hoisted(() => ({ answer: (): Promise<unknown> => Promise.resolve(null) }));
vi.mock('@/features/morning-feed/watch-home-fonts', () => ({
  ensureHomeFonts: () => undefined,
  waitHomeFonts: () => Promise.resolve('late'),
}));
vi.mock('@/features/morning-cards/api', async (orig) => ({
  ...(await orig<typeof import('@/features/morning-cards/api')>()),
  postAppFeedback: post,
  fetchTestClock: () => clock.answer(),
}));
vi.mock('@/shared/lib/posthog', () => ({ getReplayUrl: replay }));
vi.mock('@/shared/ui/sonner', () => ({ toast }));

import type { MorningPage } from '@/features/morning-cards/api';
import { feedbackPath } from '@/features/morning-feed/feedback-path';
import { useTestClock } from '@/features/morning-feed/use-test-clock';
import { keyboardInset } from '@/features/morning-feed/use-keyboard-inset';
import { WatchHome, WatchHomeEmpty } from '@/features/morning-feed/WatchHome';
import { WatchPage } from '@/features/morning-feed/WatchPage';
import { WatchPast } from '@/features/morning-feed/WatchPast';

const FRAME = { vh: 844, safeTop: 47, safeBottom: 34, playerH: 219, width: 390 };
const ACCOUNT = {
  name: '참여자',
  email: 'p@example.com',
  onLogout: () => undefined,
  suggest: true,
};
const PAGE: MorningPage = {
  domain: '기술/개발',
  seen_date: '2026-11-22',
  headline: '헤드라인',
  core: [],
  note: [],
  videos: [],
};

function home(account: Record<string, unknown> = ACCOUNT): void {
  render(
    <WatchHome
      frame={FRAME}
      account={account as typeof ACCOUNT}
      chips={[
        { cell: '기술/개발', title: '기술·개발' },
        { cell: '재테크/투자', title: '재테크' },
      ]}
      pages={{
        '기술/개발': { headline: 'H1', seenDate: '2026-11-25' },
        '재테크/투자': { headline: 'H2', seenDate: '2026-11-24' },
      }}
      initial="기술/개발"
      today="2026-11-25"
      onOpen={() => undefined}
      onOpenPage={() => undefined}
    />
  );
}
const openForm = (): void => {
  fireEvent.click(screen.getByTestId('mf-w3-acct-open'));
  fireEvent.click(screen.getByTestId('mf-suggest-open'));
};
const type = (text: string): void => {
  fireEvent.change(screen.getByTestId('mf-suggest-input'), { target: { value: text } });
};
const send = async (): Promise<void> => {
  await act(async () => {
    fireEvent.click(screen.getByTestId('mf-suggest-send'));
  });
};

beforeEach(() => {
  post.mockReset().mockResolvedValue(undefined);
  replay.mockReset().mockReturnValue(null);
  toast.mockReset();
  window.history.replaceState(null, '', '/morning-cards?view=watch&code=secret');
});

describe('account sheet', () => {
  it('제안하기 opens the form in the sheet, with the work order’s copy', () => {
    home();
    openForm();
    expect(screen.getByTestId('mf-suggest').textContent).toBe(
      '불편하거나 바라는 점을 한 줄로 남겨 주세요.보내기'
    );
    expect(screen.queryByTestId('mf-w3-logout')).toBeNull();
    expect(screen.getByTestId('mf-w3-acct').getAttribute('aria-label')).toBe('제안하기');
    expect((screen.getByTestId('mf-suggest-input') as HTMLInputElement).type).toBe('text');
  });

  it('an account with the test controls has no 제안하기', () => {
    home({ ...ACCOUNT, suggest: false, extra: <div data-testid="controls" /> });
    fireEvent.click(screen.getByTestId('mf-w3-acct-open'));
    expect(screen.getByTestId('controls')).toBeTruthy();
    expect(screen.queryByTestId('mf-suggest-open')).toBeNull();
  });

  it('closes with the X; opening again starts at the account sheet', async () => {
    home();
    openForm();
    fireEvent.click(screen.getByLabelText('닫기'));
    await waitFor(() => expect(screen.queryByTestId('mf-suggest')).toBeNull());
    fireEvent.click(screen.getByTestId('mf-w3-acct-open'));
    expect(screen.getByTestId('mf-w3-logout')).toBeTruthy();
    expect(screen.queryByTestId('mf-suggest')).toBeNull();
  });
});

describe('sending', () => {
  it('보내기 is off while the line is empty or blank', async () => {
    home();
    openForm();
    const button = screen.getByTestId('mf-suggest-send') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    type('   ');
    expect(button.disabled).toBe(true);
    fireEvent.submit(screen.getByTestId('mf-suggest'));
    expect(post).not.toHaveBeenCalled();
    type('글자가 작아요');
    expect(button.disabled).toBe(false);
  });

  it('home: the selected domain and its brief; the path without other query values; toast; closed', async () => {
    replay.mockReturnValue('https://us.posthog.com/project/p/replay/s?t=3');
    home();
    fireEvent.click(screen.getAllByTestId('mf-home-chip')[1]!);
    openForm();
    type('  글자가 작아요 ');
    await send();
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith({
      kind: 'menu',
      body: '글자가 작아요',
      path: '/morning-cards?view=watch',
      replayUrl: 'https://us.posthog.com/project/p/replay/s?t=3',
      screen: 'home',
      cell: '재테크/투자',
      date: '2026-11-24',
    });
    expect(toast).toHaveBeenCalledWith('고마워요. 잘 반영할게요.');
    await waitFor(() => expect(screen.queryByTestId('mf-suggest')).toBeNull());
  });

  it('no recording: the comment alone', async () => {
    home();
    openForm();
    type('x');
    await send();
    expect(post.mock.calls[0]![0].replayUrl).toBeNull();
  });

  it('not saved: the line stays, it says so, no thanks, and it can be sent again', async () => {
    post.mockRejectedValueOnce(new Error('500'));
    home();
    openForm();
    type('남는 글');
    await send();
    expect(screen.getByTestId('mf-suggest-error').textContent).toBe('저장하지 못했습니다');
    expect((screen.getByTestId('mf-suggest-input') as HTMLInputElement).value).toBe('남는 글');
    expect(toast).not.toHaveBeenCalled();
    await send();
    expect(post).toHaveBeenCalledTimes(2);
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it('a second press while it is being sent sends nothing more', async () => {
    let done: () => void = () => undefined;
    post.mockReturnValue(new Promise<void>((r) => (done = r)));
    home();
    openForm();
    type('x');
    await send();
    fireEvent.submit(screen.getByTestId('mf-suggest'));
    expect(post).toHaveBeenCalledTimes(1);
    await act(async () => done());
  });

  it('brief, past briefs and the empty home say where they are', async () => {
    const brief = render(
      <WatchPage
        frame={FRAME}
        account={ACCOUNT}
        page={PAGE}
        domainTitle="기술·개발"
        order={[]}
        others={[]}
        today="2026-11-25"
        back={{ label: '홈', onBack: () => undefined }}
        onPast={() => undefined}
      />
    );
    openForm();
    type('a');
    await send();
    brief.unmount();
    const past = render(
      <WatchPast
        frame={FRAME}
        account={ACCOUNT}
        chips={[]}
        initial="재테크/투자"
        load={() => Promise.resolve([])}
        onOpen={() => undefined}
        back={{ label: '홈', onBack: () => undefined }}
        today="2026-11-25"
      />
    );
    openForm();
    type('b');
    await send();
    past.unmount();
    render(<WatchHomeEmpty frame={FRAME} account={ACCOUNT} today="2026-11-25" message="없음" />);
    openForm();
    type('c');
    await send();
    const where = post.mock.calls.map((c) => {
      const { screen: s, cell, date } = c[0] as Record<string, unknown>;
      return { screen: s, cell, date };
    });
    expect(where).toEqual([
      { screen: 'page', cell: '기술/개발', date: '2026-11-22' },
      { screen: 'past', cell: '재테크/투자', date: undefined },
      { screen: 'empty', cell: undefined, date: undefined },
    ]);
  });
});

describe('who sees it', () => {
  function Probe(): JSX.Element {
    const c = useTestClock();
    return <i data-testid="clock">{c === undefined ? 'asking' : c === null ? 'none' : 'has'}</i>;
  }
  it('nothing until the server answers; refused (404 or 403) = no controls', async () => {
    clock.answer = () => Promise.reject(new Error('403'));
    render(<Probe />);
    expect(screen.getByTestId('clock').textContent).toBe('asking');
    await waitFor(() => expect(screen.getByTestId('clock').textContent).toBe('none'));
  });
  it('an allowed account keeps its controls', async () => {
    clock.answer = () => Promise.resolve({ enabled: true, day: null, real: '2026-11-25' });
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId('clock').textContent).toBe('has'));
  });
});

describe('helpers', () => {
  it('feedbackPath keeps the path and the view only', () => {
    expect(feedbackPath({ pathname: '/morning-cards', search: '?view=watch&code=x' })).toBe(
      '/morning-cards?view=watch'
    );
    expect(feedbackPath({ pathname: '/a', search: '?view=<b>' })).toBe('/a');
    expect(feedbackPath({ pathname: '/a', search: '' })).toBe('/a');
  });

  it('keyboardInset: what the keyboard covers; browser bars and zoom are not a keyboard', () => {
    const vv = (height: number, offsetTop = 0, scale = 1) => ({ height, offsetTop, scale });
    expect(keyboardInset(844, vv(844))).toBe(0);
    expect(keyboardInset(844, vv(508))).toBe(336);
    // the browser already moved the visible part down by 200
    expect(keyboardInset(844, vv(508, 200))).toBe(136);
    expect(keyboardInset(844, vv(790))).toBe(0);
    expect(keyboardInset(844, vv(422, 0, 2))).toBe(0);
  });
});
