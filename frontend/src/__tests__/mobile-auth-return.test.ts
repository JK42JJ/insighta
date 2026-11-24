import { describe, expect, it } from 'vitest';

import { mobileReturnTarget } from '@/app/router/mobile-auth-return';

describe('mobile sign-in return (Google OAuth comes back to /)', () => {
  it('goes to a stored target that is open on phones', () => {
    expect(mobileReturnTarget('/', '/morning-cards?view=watch')).toBe('/morning-cards?view=watch');
    expect(mobileReturnTarget('/', '/morning-cards/player-lab')).toBe('/morning-cards/player-lab');
  });

  it('keeps the gate (null) for anything else', () => {
    expect(mobileReturnTarget('/', null)).toBeNull();
    expect(mobileReturnTarget('/', '/mandalas')).toBeNull(); // desktop-only page
    expect(mobileReturnTarget('/', '/login')).toBeNull();
    expect(mobileReturnTarget('/', '/')).toBeNull();
    expect(mobileReturnTarget('/', '//evil.example.com/x')).toBeNull();
    expect(mobileReturnTarget('/', 'https://evil.example.com')).toBeNull();
    expect(mobileReturnTarget('/mandalas', '/morning-cards')).toBeNull(); // only on the OAuth return path
  });
});
