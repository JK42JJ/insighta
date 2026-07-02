/**
 * ⌘K CommandPalette smoke — open/close, quick actions, grouped results,
 * and the SearchBar-no-longer-owns-⌘K regression.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import fs from 'fs';
import path from 'path';
import { CommandPalette } from '@/widgets/command-palette';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const mod = await importOriginal<typeof import('react-router-dom')>();
  return { ...mod, useNavigate: () => navigateMock };
});

vi.mock('@/features/auth/model/useAuth', () => ({
  useAuth: () => ({ isLoggedIn: true, isTokenReady: true }),
}));

const searchAllMock = vi.fn();
vi.mock('@/shared/lib/api-client', () => ({
  apiClient: { searchAll: (...args: unknown[]) => searchAllMock(...args) },
}));

function renderPalette() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <CommandPalette />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const openPalette = () => fireEvent.keyDown(document, { key: 'k', metaKey: true });

beforeEach(() => {
  navigateMock.mockReset();
  searchAllMock.mockReset();
});

describe('CommandPalette', () => {
  it('opens on Cmd+K and shows quick actions when input is empty', async () => {
    renderPalette();
    expect(screen.queryByRole('combobox')).toBeNull();
    openPalette();
    await waitFor(() => expect(screen.getByRole('combobox')).toBeTruthy());
    expect(screen.getByText('새 만다라')).toBeTruthy();
    expect(screen.getByText('템플릿 찾기')).toBeTruthy();
  });

  it('quick action navigates to the wizard and closes', async () => {
    renderPalette();
    openPalette();
    await waitFor(() => expect(screen.getByText('새 만다라')).toBeTruthy());
    fireEvent.click(screen.getByText('새 만다라'));
    expect(navigateMock).toHaveBeenCalledWith('/mandalas/new');
    await waitFor(() => expect(screen.queryByRole('combobox')).toBeNull());
  });

  it('typed query renders grouped results from searchAll', async () => {
    searchAllMock.mockResolvedValue({
      query: '수동태',
      groups: {
        cards: {
          items: [
            {
              kind: 'video',
              id: 'uvs-1',
              title: '수동태 개념끝',
              channelTitle: '채널A',
              thumbnailUrl: null,
              url: null,
              videoId: 'vid1',
              note: null,
              mandalaId: 'm-1',
              cellIndex: 2,
              createdAt: '2026-01-01T00:00:00.000Z',
            },
          ],
          total: 7,
          partial: false,
        },
        mandalas: { items: [], total: 0, partial: false },
        notes: { items: [], total: 0, partial: false },
        summaries: { items: [], total: 0, partial: false },
      },
      tookMs: 42,
    });
    renderPalette();
    openPalette();
    await waitFor(() => expect(screen.getByRole('combobox')).toBeTruthy());
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '수동태' } });
    // debounce(300ms) + query resolve
    await waitFor(() => expect(screen.getByText('수동태 개념끝')).toBeTruthy(), {
      timeout: 2000,
    });
    expect(searchAllMock).toHaveBeenCalledWith('수동태', 5);
    expect(screen.getByText('카드')).toBeTruthy();
  });

  it('REGRESSION: SearchBar no longer binds its own ⌘K listener', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../features/search/ui/SearchBar.tsx'),
      'utf-8'
    );
    expect(src).not.toMatch(/metaKey.*key === 'k'/);
  });
});
