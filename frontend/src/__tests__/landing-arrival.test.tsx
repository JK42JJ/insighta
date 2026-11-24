import { render, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ postUsageEvent: vi.fn(async () => undefined), toast: vi.fn() }));
vi.mock('@/features/morning-cards/api', async (orig) => {
  const actual = await orig<typeof import('@/features/morning-cards/api')>();
  return { ...actual, postUsageEvent: mocks.postUsageEvent };
});
vi.mock('sonner', () => ({ toast: mocks.toast }));

import {
  ADD_SOON_MS,
  ADD_SOON_TEXT,
  markLandingSignIn,
  recordLandingEvent,
  useLandingArrival,
} from '@/features/landing-intro';
import { readOnboardingSeen } from '@/features/morning-feed/watch-design';

/*
 * Arrival on the brief screen after Google sign-in from the landing (decisions 2026-11-24): the
 * onboarding is already marked seen when the screen reads it, the kept events go out with
 * login_done, ADD shows its notice; anyone else is unchanged.
 */

/** Reads the onboarding flag in its first render, as MorningWatch's first screen does. */
function Screen({ onRead }: { onRead: (seen: boolean) => void }): null {
  useState(() => {
    onRead(readOnboardingSeen());
    return null;
  });
  return null;
}

function Live({ shown, onRead }: { shown: boolean; onRead: (seen: boolean) => void }) {
  useLandingArrival(shown);
  return shown ? <Screen onRead={onRead} /> : null;
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  mocks.postUsageEvent.mockClear();
  mocks.toast.mockReset();
});

describe('arrival from the landing', () => {
  it('skips the onboarding, sends the kept events and login_done once, shows the ADD notice', async () => {
    recordLandingEvent('landing_open');
    recordLandingEvent('add_click');
    markLandingSignIn('add');
    const reads: boolean[] = [];
    const { rerender, unmount } = render(<Live shown={false} onRead={(s) => reads.push(s)} />);
    expect(mocks.postUsageEvent).not.toHaveBeenCalled();
    rerender(<Live shown onRead={(s) => reads.push(s)} />);
    expect(reads).toEqual([true]);
    await waitFor(() => expect(mocks.postUsageEvent).toHaveBeenCalledTimes(3));
    expect(mocks.postUsageEvent.mock.calls.map((c) => (c as unknown[])[0])).toEqual([
      { kind: 'landing_open' },
      { kind: 'add_click' },
      { kind: 'login_done' },
    ]);
    expect(mocks.toast).toHaveBeenCalledWith(ADD_SOON_TEXT, { duration: ADD_SOON_MS });
    expect(ADD_SOON_TEXT).toBe('곧 출시 예정이에요.');
    unmount();
    // a second visit to the screen in the same tab: nothing again
    render(<Live shown onRead={() => undefined} />);
    await Promise.resolve();
    expect(mocks.postUsageEvent).toHaveBeenCalledTimes(3);
    expect(mocks.toast).toHaveBeenCalledTimes(1);
  });

  it('a Google button arrival: no notice', async () => {
    markLandingSignIn('google');
    render(<Live shown onRead={() => undefined} />);
    await waitFor(() => expect(mocks.postUsageEvent).toHaveBeenCalledWith({ kind: 'login_done' }));
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it('anyone else: the onboarding flag is untouched and nothing is sent', async () => {
    recordLandingEvent('landing_open'); // visited the landing but signed in some other way
    const reads: boolean[] = [];
    render(<Live shown onRead={(s) => reads.push(s)} />);
    await Promise.resolve();
    expect(reads).toEqual([false]);
    expect(mocks.postUsageEvent).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
  });
});
