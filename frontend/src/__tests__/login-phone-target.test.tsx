import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const device = vi.hoisted(() => ({ phone: true }));
vi.mock('@/shared/lib/mobile-gate', async (orig) => ({
  ...(await orig<typeof import('@/shared/lib/mobile-gate')>()),
  isMobileDevice: () => device.phone,
}));
vi.mock('@/features/auth/model/useAuth', () => ({
  useAuth: () => ({ isLoggedIn: true, isLoading: false }),
}));
vi.mock('@/shared/lib/api-client', () => ({
  apiClient: { getBetaConfig: () => Promise.resolve({ signupMode: 'open' }) },
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

import LoginPage from '@/pages/login/ui/LoginPage';

/*
 * Where a phone goes after password sign-in (stg 2026-11-25: it went to the old /mobile app): its
 * explicit target when that is open on phones, else the watch screen like the router's redirects.
 */
describe('a signed-in phone on the login page', () => {
  const assign = vi.fn();
  const real = window.location;
  beforeEach(() => {
    device.phone = true;
    assign.mockReset();
    Object.defineProperty(window, 'location', { value: { assign }, configurable: true });
  });
  afterEach(() => {
    Object.defineProperty(window, 'location', { value: real, configurable: true });
  });

  it.each([
    ['/login/classic', '/morning-cards?view=watch'],
    ['/login/classic?returnTo=%2F', '/morning-cards?view=watch'],
    ['/login/classic?returnTo=%2Fmobile%2F', '/morning-cards?view=watch'],
    ['/login/classic?returnTo=%2Fmandalas', '/morning-cards?view=watch'],
    ['/login/classic?returnTo=%2F%2Fevil.example', '/morning-cards?view=watch'],
    ['/login/classic?returnTo=%2Fmorning-cards%2Fclassic', '/morning-cards/classic'],
  ])('%s -> %s', (at, to) => {
    render(
      <MemoryRouter initialEntries={[at]}>
        <LoginPage />
      </MemoryRouter>
    );
    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith(to);
  });

  it('a desktop is not sent through this redirect', () => {
    device.phone = false;
    render(
      <MemoryRouter initialEntries={['/login/classic']}>
        <LoginPage />
      </MemoryRouter>
    );
    expect(assign).not.toHaveBeenCalled();
  });
});
