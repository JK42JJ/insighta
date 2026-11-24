import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  value: {
    user: null as null | { id: string },
    isLoading: false,
    signInWithGoogle: vi.fn(async () => undefined),
  },
}));
vi.mock('@/features/auth/model/AuthContext', () => ({
  useAuthContext: () => auth.value,
}));
vi.mock('@/pages/intro', () => ({
  default: ({ onSignIn }: { onSignIn: () => Promise<void> }) => (
    <button data-testid="intro" onClick={() => void onSignIn()} />
  ),
}));
vi.mock('@/features/morning-feed/MorningFeedRoute', () => ({
  MorningFeedRoute: () => <div data-testid="feed" />,
}));
vi.mock('@/features/morning-feed/WatchBoot', () => ({
  WatchBoot: () => <div data-testid="boot" />,
}));

import { MorningCardsEntry } from '@/app/router/MorningCardsEntry';

/*
 * The participant address /morning-cards?view=watch (decision 2026-11-24): signed out -> the
 * landing page; signed in -> the watch screen as before. Plain /morning-cards is the same (stg
 * 2026-11-25); the swipe deck only at ?view=deck.
 */

function at(url: string): void {
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/morning-cards" element={<MorningCardsEntry />} />
        <Route path="/login" element={<div data-testid="login" />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  sessionStorage.clear();
  auth.value = { user: null, isLoading: false, signInWithGoogle: vi.fn(async () => undefined) };
});

describe('participant address', () => {
  it("signed out: the landing page, whose sign-in returns to today's brief screen", async () => {
    at('/morning-cards?view=watch');
    fireEvent.click(await screen.findByTestId('intro'));
    expect(sessionStorage.getItem('auth-return-to')).toBe('/morning-cards?view=watch');
    expect(auth.value.signInWithGoogle).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('login')).toBeNull();
  });

  it('signed in: the watch screen as before', async () => {
    auth.value = { ...auth.value, user: { id: 'u' } };
    at('/morning-cards?view=watch');
    expect(await screen.findByTestId('feed')).toBeTruthy();
    expect(screen.queryByTestId('intro')).toBeNull();
  });

  it('while the sign-in check runs: the first-open screen', () => {
    auth.value = { ...auth.value, isLoading: true };
    at('/morning-cards?view=watch');
    expect(screen.getByTestId('boot')).toBeTruthy();
  });

  it.each(['/morning-cards', '/morning-cards?view=other'])(
    '%s is the participant address too: landing signed out, watch signed in',
    async (url) => {
      at(url);
      fireEvent.click(await screen.findByTestId('intro'));
      expect(sessionStorage.getItem('auth-return-to')).toBe('/morning-cards?view=watch');
      expect(screen.queryByTestId('login')).toBeNull();
    }
  );

  it('the deck (?view=deck) signed out still goes to the sign-in page', async () => {
    at('/morning-cards?view=deck');
    expect(await screen.findByTestId('login')).toBeTruthy();
  });
});
