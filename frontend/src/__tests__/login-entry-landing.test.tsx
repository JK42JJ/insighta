import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

const auth = { user: null as null | { id: string }, isLoading: false };
vi.mock('@/features/auth/model/AuthContext', () => ({ useAuthContext: () => auth }));
vi.mock('@/pages/login', () => ({ default: () => <div>old login page</div> }));

import { LoginEntry } from '@/app/router';
import { WATCH_RETURN_PATH } from '@/app/router/watch-path';

function at(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<LoginEntry />} />
        <Route path="/morning-cards" element={<div>watch address</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('/login after the intro landing replaced the web login (James 2026-11-24)', () => {
  it('a signed-out visitor goes to the participant address, where the landing is', () => {
    auth.user = null;
    at('/login');
    expect(screen.getByText('watch address')).toBeTruthy();
    expect(WATCH_RETURN_PATH).toBe('/morning-cards?view=watch');
  });

  it('a signed-in visitor still gets the login page, which forwards to returnTo', async () => {
    auth.user = { id: 'u1' };
    at('/login');
    expect(await screen.findByText('old login page')).toBeTruthy();
  });
});

describe('mobile gate notice on the participant address (2026-11-24)', () => {
  it('is never shown on /morning-cards, even with the gate flag set', async () => {
    const { MobileGateNotice } = await import('@/app/router/MobileGateNotice');
    const { MOBILE_GATE_FLAG_KEY } = await import('@/shared/lib/mobile-gate');
    sessionStorage.setItem(MOBILE_GATE_FLAG_KEY, '1');
    const { container } = render(
      <MemoryRouter initialEntries={['/morning-cards?view=watch']}>
        <MobileGateNotice />
      </MemoryRouter>
    );
    expect(container.textContent).toBe('');
    sessionStorage.removeItem(MOBILE_GATE_FLAG_KEY);
  });
});

describe('sign-in return on a phone never leaves a black screen (James 2026-11-24)', () => {
  it('shows the boot screen while the session is read, then goes on to the target after the cap', async () => {
    vi.resetModules();
    const state = { isLoading: true, isLoggedIn: false };
    vi.doMock('@/features/auth/model/useAuth', () => ({ useAuth: () => state }));
    vi.doMock('@/features/morning-feed/WatchBoot', () => ({
      WatchBoot: () => <div>boot screen</div>,
    }));
    const { MobileAuthReturn, AUTH_RETURN_WAIT_MS } = await import('@/app/router/MobileAuthReturn');
    vi.useFakeTimers();
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<MobileAuthReturn target="/morning-cards?view=watch" />} />
          <Route path="/morning-cards" element={<div>watch address</div>} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByText('boot screen')).toBeTruthy();
    const { act } = await import('@testing-library/react');
    act(() => {
      vi.advanceTimersByTime(AUTH_RETURN_WAIT_MS + 10);
    });
    expect(screen.getByText('watch address')).toBeTruthy();
    vi.useRealTimers();
    vi.doUnmock('@/features/auth/model/useAuth');
    vi.doUnmock('@/features/morning-feed/WatchBoot');
  });
});
