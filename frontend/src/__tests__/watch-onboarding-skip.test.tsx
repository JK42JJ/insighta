import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Found 2026-11-25 as a first-time participant: while the YouTube window was open the onboarding's
 * 건너뛰기 could not be pressed either (up to 5 minutes).
 */

vi.mock('@/features/morning-feed/watch-home-fonts', () => ({
  ensureHomeFonts: () => undefined,
  waitHomeFonts: () => Promise.resolve('late'),
  FONT_WAIT_MS: 1500,
}));
vi.mock('@/features/auth/model/useAuth', () => ({
  useAuth: () => ({
    userName: 'p',
    userEmail: 'p@example.com',
    userAvatar: null,
    signOut: () => Promise.resolve(),
  }),
}));
vi.mock('@/features/morning-cards/api', async (orig) => ({
  ...(await orig<typeof import('@/features/morning-cards/api')>()),
  fetchTestClock: () => Promise.resolve(null),
  postUsageEvent: () => Promise.resolve(),
}));

import { MorningWatch } from '@/features/morning-feed/MorningWatch';
import { readOnboardingSeen } from '@/features/morning-feed/watch-design';

beforeEach(() => localStorage.clear());

describe('onboarding, YouTube window open', () => {
  it('건너뛰기 ends it at once, and the window ending later changes nothing', async () => {
    let end: () => void = () => undefined;
    const connect = vi.fn(() => new Promise<void>((r) => (end = r)));
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <MorningWatch
            cells={[]}
            today={{}}
            history={[]}
            pages={null}
            loadBatch={() => Promise.resolve({ items: [], judged: {} })}
            onJudge={() => undefined}
            whenSaved={() => Promise.resolve()}
            connectYouTube={connect}
            experiment
          />
        </MemoryRouter>
      </QueryClientProvider>
    );
    const next = (): HTMLElement => screen.getAllByTestId('mf-w-onb-next').at(-1)!;
    const stepTo = (s: number): Promise<void> =>
      waitFor(() =>
        expect(screen.getAllByTestId('mf-w-onb').at(-1)!.getAttribute('data-step')).toBe(String(s))
      );
    fireEvent.click(next());
    await stepTo(1);
    fireEvent.click(next());
    await stepTo(2);
    fireEvent.click(next());
    expect(connect).toHaveBeenCalledTimes(1);
    await waitFor(() => expect((next() as HTMLButtonElement).disabled).toBe(true));
    const skip = screen.getByTestId('mf-w-onb-skip') as HTMLButtonElement;
    expect(skip.disabled).toBe(false);
    fireEvent.click(skip);
    expect(readOnboardingSeen()).toBe(true);
    localStorage.clear();
    await act(async () => end());
    expect(readOnboardingSeen()).toBe(false); // not finished a second time
  });
});
