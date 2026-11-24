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
