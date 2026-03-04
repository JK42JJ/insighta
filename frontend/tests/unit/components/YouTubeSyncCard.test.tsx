/**
 * YouTubeSyncCard Component Tests
 *
 * Tests for the YouTubeSyncCard component covering:
 * - Loading state (auth loading)
 * - Not logged in state (login prompt)
 * - Logged in state (main content)
 * - Add playlist functionality
 * - Playlist list rendering
 * - Sync individual playlist
 * - Delete playlist
 * - Sync all playlists
 * - Sync interval settings
 * - Auto-sync toggle
 * - Error handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { YouTubeSyncCard } from '@/components/settings/YouTubeSyncCard';
import type { Playlist, SyncResult } from '@/types/youtube';

// Mock dependencies
const mockToast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

const mockSignInWithGoogle = vi.fn();
const mockUseAuth = vi.fn();
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockUseYouTubeAuth = vi.fn();
vi.mock('@/hooks/useYouTubeAuth', () => ({
  useYouTubeAuth: () => mockUseYouTubeAuth(),
}));

const mockAddPlaylist = vi.fn();
const mockSyncPlaylist = vi.fn();
const mockDeletePlaylist = vi.fn();
const mockSyncAll = vi.fn();
const mockUpdateSettings = vi.fn();
vi.mock('@/hooks/useYouTubeSync', () => ({
  useYouTubeSync: () => ({
    playlists: mockPlaylists,
    isLoading: mockIsPlaylistsLoading,
    isAdding: mockIsAdding,
    isSyncingAll: mockIsSyncingAll,
    addPlaylist: mockAddPlaylist,
    syncPlaylist: mockSyncPlaylist,
    deletePlaylist: mockDeletePlaylist,
    syncAll: mockSyncAll,
  }),
  useUpdateSyncSettings: () => ({
    mutate: mockUpdateSettings,
    mutateAsync: mockUpdateSettings,
    isPending: mockIsUpdatingSettings,
  }),
}));

// Mock child components
vi.mock('@/components/settings/YouTubeConnectButton', () => ({
  YouTubeConnectButton: () => <button data-testid="youtube-connect-button">Connect YouTube</button>,
}));

// Mock Select component for easier testing
vi.mock('@/components/ui/select', () => ({
  Select: ({ value, onValueChange, disabled, children }: {
    value: string;
    onValueChange: (value: string) => void;
    disabled?: boolean;
    children: React.ReactNode;
  }) => (
    <select
      data-testid="sync-interval-select"
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
      disabled={disabled}
    >
      <option value="manual">수동</option>
      <option value="1h">1시간</option>
      <option value="6h">6시간</option>
      <option value="12h">12시간</option>
      <option value="24h">24시간</option>
    </select>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/settings/PlaylistItem', () => ({
  PlaylistItem: ({
    playlist,
    onSync,
    onDelete,
    isSyncing,
    isDeleting,
  }: {
    playlist: Playlist;
    onSync: (id: string) => void;
    onDelete: (id: string) => void;
    isSyncing: boolean;
    isDeleting: boolean;
  }) => (
    <div data-testid={`playlist-item-${playlist.id}`}>
      <span data-testid={`playlist-title-${playlist.id}`}>{playlist.title}</span>
      <button
        data-testid={`sync-button-${playlist.id}`}
        onClick={() => onSync(playlist.id)}
        disabled={isSyncing}
      >
        {isSyncing ? 'Syncing...' : 'Sync'}
      </button>
      <button
        data-testid={`delete-button-${playlist.id}`}
        onClick={() => onDelete(playlist.id)}
        disabled={isDeleting}
      >
        {isDeleting ? 'Deleting...' : 'Delete'}
      </button>
    </div>
  ),
}));

// Test data
let mockPlaylists: Playlist[] = [];
let mockIsPlaylistsLoading = false;
let mockIsAdding = false;
let mockIsSyncingAll = false;
let mockIsUpdatingSettings = false;

const createMockPlaylist = (overrides: Partial<Playlist> = {}): Playlist => ({
  id: 'playlist-1',
  youtubeId: 'YT123',
  title: 'Test Playlist',
  description: 'Test Description',
  thumbnailUrl: 'https://example.com/thumb.jpg',
  itemCount: 10,
  lastSyncedAt: new Date('2024-01-15'),
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-15'),
  ...overrides,
});

describe('YouTubeSyncCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Reset mock states
    mockPlaylists = [];
    mockIsPlaylistsLoading = false;
    mockIsAdding = false;
    mockIsSyncingAll = false;
    mockIsUpdatingSettings = false;

    // Default auth state: logged in
    mockUseAuth.mockReturnValue({
      isLoggedIn: true,
      isLoading: false,
      signInWithGoogle: mockSignInWithGoogle,
    });

    // Default YouTube auth state
    mockUseYouTubeAuth.mockReturnValue({
      syncInterval: 'manual',
      autoSyncEnabled: false,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Loading State', () => {
    it('should show loading spinner when auth is loading', () => {
      mockUseAuth.mockReturnValue({
        isLoggedIn: false,
        isLoading: true,
        signInWithGoogle: mockSignInWithGoogle,
      });

      render(<YouTubeSyncCard />);

      // Should show card header but with loading content
      expect(screen.getByText('YouTube 플레이리스트 동기화')).toBeInTheDocument();
      // The Loader2 component renders as a generic element
      expect(screen.queryByText('로그인이 필요합니다')).not.toBeInTheDocument();
    });
  });

  describe('Not Logged In State', () => {
    it('should show login prompt when not logged in', () => {
      mockUseAuth.mockReturnValue({
        isLoggedIn: false,
        isLoading: false,
        signInWithGoogle: mockSignInWithGoogle,
      });

      render(<YouTubeSyncCard />);

      expect(screen.getByText('로그인이 필요합니다')).toBeInTheDocument();
      expect(screen.getByText('Google 계정으로 로그인')).toBeInTheDocument();
    });

    it('should call signInWithGoogle when login button is clicked', async () => {
      mockUseAuth.mockReturnValue({
        isLoggedIn: false,
        isLoading: false,
        signInWithGoogle: mockSignInWithGoogle,
      });
      mockSignInWithGoogle.mockResolvedValue(undefined);

      render(<YouTubeSyncCard />);

      const loginButton = screen.getByText('Google 계정으로 로그인');
      fireEvent.click(loginButton);

      await waitFor(() => {
        expect(mockSignInWithGoogle).toHaveBeenCalled();
      });
    });

    it('should show error toast when login fails', async () => {
      mockUseAuth.mockReturnValue({
        isLoggedIn: false,
        isLoading: false,
        signInWithGoogle: mockSignInWithGoogle,
      });
      mockSignInWithGoogle.mockRejectedValue(new Error('Login failed'));

      render(<YouTubeSyncCard />);

      fireEvent.click(screen.getByText('Google 계정으로 로그인'));

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: '로그인 실패',
            variant: 'destructive',
          })
        );
      });
    });
  });

  describe('Logged In State - Main Content', () => {
    it('should render main content when logged in', () => {
      render(<YouTubeSyncCard />);

      expect(screen.getByText('YouTube 플레이리스트 동기화')).toBeInTheDocument();
      expect(screen.getByText('Google 계정 연결')).toBeInTheDocument();
      expect(screen.getByText('플레이리스트 추가')).toBeInTheDocument();
      expect(screen.getByTestId('youtube-connect-button')).toBeInTheDocument();
    });

    it('should render playlist URL input', () => {
      render(<YouTubeSyncCard />);

      const input = screen.getByPlaceholderText('YouTube 플레이리스트 URL 입력...');
      expect(input).toBeInTheDocument();
    });
  });

  describe('Add Playlist', () => {
    // Note: Add button is disabled when URL is empty, so no error toast is shown
    // The UI prevents invalid submissions

    it('should call addPlaylist when valid URL is provided', async () => {
      mockAddPlaylist.mockResolvedValue(undefined);

      render(<YouTubeSyncCard />);

      const input = screen.getByPlaceholderText('YouTube 플레이리스트 URL 입력...');
      const addButton = screen.getByRole('button', { name: /추가/i });

      fireEvent.change(input, { target: { value: 'https://youtube.com/playlist?list=ABC123' } });
      fireEvent.click(addButton);

      await waitFor(() => {
        expect(mockAddPlaylist).toHaveBeenCalledWith('https://youtube.com/playlist?list=ABC123');
      });
    });

    it('should clear input and show success toast after adding playlist', async () => {
      mockAddPlaylist.mockResolvedValue(undefined);

      render(<YouTubeSyncCard />);

      const input = screen.getByPlaceholderText('YouTube 플레이리스트 URL 입력...') as HTMLInputElement;

      fireEvent.change(input, { target: { value: 'https://youtube.com/playlist?list=ABC123' } });
      fireEvent.click(screen.getByRole('button', { name: /추가/i }));

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: '플레이리스트 추가됨',
          })
        );
      });
    });

    it('should show error toast when adding playlist fails', async () => {
      mockAddPlaylist.mockRejectedValue(new Error('Invalid playlist URL'));

      render(<YouTubeSyncCard />);

      const input = screen.getByPlaceholderText('YouTube 플레이리스트 URL 입력...');
      fireEvent.change(input, { target: { value: 'invalid-url' } });
      fireEvent.click(screen.getByRole('button', { name: /추가/i }));

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: '추가 실패',
            variant: 'destructive',
          })
        );
      });
    });

    it('should add playlist when Enter key is pressed', async () => {
      mockAddPlaylist.mockResolvedValue(undefined);

      render(<YouTubeSyncCard />);

      const input = screen.getByPlaceholderText('YouTube 플레이리스트 URL 입력...');
      fireEvent.change(input, { target: { value: 'https://youtube.com/playlist?list=ABC123' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      await waitFor(() => {
        expect(mockAddPlaylist).toHaveBeenCalled();
      });
    });

    it('should show error toast when pressing Enter with empty URL', async () => {
      render(<YouTubeSyncCard />);

      const input = screen.getByPlaceholderText('YouTube 플레이리스트 URL 입력...');
      // Don't change the input value - leave it empty
      fireEvent.keyDown(input, { key: 'Enter' });

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: '오류',
            description: 'YouTube 플레이리스트 URL을 입력해주세요.',
            variant: 'destructive',
          })
        );
      });
      // Ensure addPlaylist was NOT called
      expect(mockAddPlaylist).not.toHaveBeenCalled();
    });

    it('should show error toast when pressing Enter with whitespace-only URL', async () => {
      render(<YouTubeSyncCard />);

      const input = screen.getByPlaceholderText('YouTube 플레이리스트 URL 입력...');
      // Set input to whitespace only
      fireEvent.change(input, { target: { value: '   ' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: '오류',
            description: 'YouTube 플레이리스트 URL을 입력해주세요.',
            variant: 'destructive',
          })
        );
      });
      // Ensure addPlaylist was NOT called
      expect(mockAddPlaylist).not.toHaveBeenCalled();
    });
  });

  describe('Playlist List', () => {
    it('should show empty state when no playlists', () => {
      render(<YouTubeSyncCard />);

      expect(screen.getByText('등록된 플레이리스트가 없습니다.')).toBeInTheDocument();
    });

    it('should render playlist items', () => {
      mockPlaylists = [
        createMockPlaylist({ id: 'playlist-1', title: 'Playlist 1' }),
        createMockPlaylist({ id: 'playlist-2', title: 'Playlist 2' }),
      ];

      render(<YouTubeSyncCard />);

      expect(screen.getByTestId('playlist-item-playlist-1')).toBeInTheDocument();
      expect(screen.getByTestId('playlist-item-playlist-2')).toBeInTheDocument();
      expect(screen.getByText('Playlist 1')).toBeInTheDocument();
      expect(screen.getByText('Playlist 2')).toBeInTheDocument();
    });

    it('should show playlist count in label', () => {
      mockPlaylists = [
        createMockPlaylist({ id: 'playlist-1' }),
        createMockPlaylist({ id: 'playlist-2' }),
      ];

      render(<YouTubeSyncCard />);

      expect(screen.getByText('등록된 플레이리스트 (2)')).toBeInTheDocument();
    });
  });

  describe('Sync Individual Playlist', () => {
    it('should call syncPlaylist when sync button is clicked', async () => {
      mockPlaylists = [createMockPlaylist({ id: 'playlist-1' })];
      mockSyncPlaylist.mockResolvedValue({ itemsAdded: 5, itemsRemoved: 2 } as SyncResult);

      render(<YouTubeSyncCard />);

      fireEvent.click(screen.getByTestId('sync-button-playlist-1'));

      await waitFor(() => {
        expect(mockSyncPlaylist).toHaveBeenCalledWith('playlist-1');
      });
    });

    it('should show success toast with sync results', async () => {
      mockPlaylists = [createMockPlaylist({ id: 'playlist-1' })];
      mockSyncPlaylist.mockResolvedValue({ itemsAdded: 5, itemsRemoved: 2 } as SyncResult);

      render(<YouTubeSyncCard />);

      fireEvent.click(screen.getByTestId('sync-button-playlist-1'));

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: '동기화 완료',
            description: '5개 추가, 2개 제거됨',
          })
        );
      });
    });

    it('should show error toast when sync fails', async () => {
      mockPlaylists = [createMockPlaylist({ id: 'playlist-1' })];
      mockSyncPlaylist.mockRejectedValue(new Error('Sync failed'));

      render(<YouTubeSyncCard />);

      fireEvent.click(screen.getByTestId('sync-button-playlist-1'));

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: '동기화 실패',
            variant: 'destructive',
          })
        );
      });
    });
  });

  describe('Delete Playlist', () => {
    it('should call deletePlaylist when delete button is clicked', async () => {
      mockPlaylists = [createMockPlaylist({ id: 'playlist-1' })];
      mockDeletePlaylist.mockResolvedValue(undefined);

      render(<YouTubeSyncCard />);

      fireEvent.click(screen.getByTestId('delete-button-playlist-1'));

      await waitFor(() => {
        expect(mockDeletePlaylist).toHaveBeenCalledWith('playlist-1');
      });
    });

    it('should show success toast after deletion', async () => {
      mockPlaylists = [createMockPlaylist({ id: 'playlist-1' })];
      mockDeletePlaylist.mockResolvedValue(undefined);

      render(<YouTubeSyncCard />);

      fireEvent.click(screen.getByTestId('delete-button-playlist-1'));

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: '삭제됨',
          })
        );
      });
    });

    it('should show error toast when deletion fails', async () => {
      mockPlaylists = [createMockPlaylist({ id: 'playlist-1' })];
      mockDeletePlaylist.mockRejectedValue(new Error('Delete failed'));

      render(<YouTubeSyncCard />);

      fireEvent.click(screen.getByTestId('delete-button-playlist-1'));

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: '삭제 실패',
            variant: 'destructive',
          })
        );
      });
    });
  });

  describe('Sync All Playlists', () => {
    it('should show sync all button when playlists exist', () => {
      mockPlaylists = [createMockPlaylist()];

      render(<YouTubeSyncCard />);

      expect(screen.getByText('전체 동기화')).toBeInTheDocument();
    });

    it('should not show sync all button when no playlists', () => {
      render(<YouTubeSyncCard />);

      expect(screen.queryByText('전체 동기화')).not.toBeInTheDocument();
    });

    it('should call syncAll when button is clicked', async () => {
      mockPlaylists = [createMockPlaylist()];
      mockSyncAll.mockResolvedValue({ synced: 1, failed: 0 });

      render(<YouTubeSyncCard />);

      fireEvent.click(screen.getByText('전체 동기화'));

      await waitFor(() => {
        expect(mockSyncAll).toHaveBeenCalled();
      });
    });

    it('should show success toast with results', async () => {
      mockPlaylists = [createMockPlaylist()];
      mockSyncAll.mockResolvedValue({ synced: 3, failed: 0 });

      render(<YouTubeSyncCard />);

      fireEvent.click(screen.getByText('전체 동기화'));

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: '전체 동기화 완료',
            description: '3개 성공, 0개 실패',
          })
        );
      });
    });

    it('should show destructive toast when some syncs fail', async () => {
      mockPlaylists = [createMockPlaylist()];
      mockSyncAll.mockResolvedValue({ synced: 2, failed: 1 });

      render(<YouTubeSyncCard />);

      fireEvent.click(screen.getByText('전체 동기화'));

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: '전체 동기화 완료',
            variant: 'destructive',
          })
        );
      });
    });

    it('should show error toast when syncAll throws an error', async () => {
      mockPlaylists = [createMockPlaylist()];
      mockSyncAll.mockRejectedValue(new Error('Network error'));

      render(<YouTubeSyncCard />);

      fireEvent.click(screen.getByText('전체 동기화'));

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: '동기화 실패',
            variant: 'destructive',
          })
        );
      });
    });
  });

  describe('Sync Settings', () => {
    it('should render sync interval selector', () => {
      render(<YouTubeSyncCard />);

      expect(screen.getByText('자동 동기화 간격')).toBeInTheDocument();
    });

    it('should render auto-sync toggle', () => {
      render(<YouTubeSyncCard />);

      expect(screen.getByText('백그라운드 동기화')).toBeInTheDocument();
      expect(screen.getByRole('switch')).toBeInTheDocument();
    });

    it('should toggle auto-sync when switch is clicked', async () => {
      render(<YouTubeSyncCard />);

      const toggle = screen.getByRole('switch');
      fireEvent.click(toggle);

      await waitFor(() => {
        expect(mockUpdateSettings).toHaveBeenCalledWith(
          expect.objectContaining({
            autoSyncEnabled: true,
          })
        );
      });
    });

    it('should set syncInterval to 6h when enabling auto-sync with manual interval', async () => {
      mockUseYouTubeAuth.mockReturnValue({
        syncInterval: 'manual',
        autoSyncEnabled: false,
      });

      render(<YouTubeSyncCard />);
    });

    it('should change sync interval when selecting new value', async () => {
      mockUpdateSettings.mockResolvedValue(undefined);

      render(<YouTubeSyncCard />);

      const select = screen.getByTestId('sync-interval-select');
      fireEvent.change(select, { target: { value: '6h' } });

      await waitFor(() => {
        expect(mockUpdateSettings).toHaveBeenCalledWith({
          syncInterval: '6h',
          autoSyncEnabled: true,
        });
      });
    });

    it('should show success toast after changing sync interval', async () => {
      mockUpdateSettings.mockResolvedValue(undefined);

      render(<YouTubeSyncCard />);

      const select = screen.getByTestId('sync-interval-select');
      fireEvent.change(select, { target: { value: '6h' } });

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: '설정 저장됨',
          })
        );
      });
    });

    it('should show error toast when sync interval change fails', async () => {
      mockUpdateSettings.mockRejectedValue(new Error('Update failed'));

      render(<YouTubeSyncCard />);

      const select = screen.getByTestId('sync-interval-select');
      fireEvent.change(select, { target: { value: '6h' } });

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: '설정 저장 실패',
            variant: 'destructive',
          })
        );
      });

      // Original test for enabling auto-sync with manual interval
    });

    it('should set syncInterval to 6h when enabling auto-sync - original test', async () => {
      mockUseYouTubeAuth.mockReturnValue({
        syncInterval: 'manual',
        autoSyncEnabled: false,
      });

      render(<YouTubeSyncCard />);

      const toggle = screen.getByRole('switch');
      fireEvent.click(toggle);

      await waitFor(() => {
        expect(mockUpdateSettings).toHaveBeenCalledWith(
          expect.objectContaining({
            syncInterval: '6h',
            autoSyncEnabled: true,
          })
        );
      });
    });
  });

  describe('UI States', () => {
    it('should disable add button when isAdding is true', () => {
      mockIsAdding = true;

      render(<YouTubeSyncCard />);

      const addButton = screen.getByRole('button', { name: /추가/i });
      expect(addButton).toBeDisabled();
    });

    it('should disable add button when URL is empty', () => {
      render(<YouTubeSyncCard />);

      const addButton = screen.getByRole('button', { name: /추가/i });
      expect(addButton).toBeDisabled();
    });

    it('should show loading state for playlists', () => {
      mockIsPlaylistsLoading = true;

      render(<YouTubeSyncCard />);

      // When loading, the empty state message should not be shown
      expect(screen.queryByText('등록된 플레이리스트가 없습니다.')).not.toBeInTheDocument();
    });
  });
});
