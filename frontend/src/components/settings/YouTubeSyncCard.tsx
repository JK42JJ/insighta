import { useState } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useYouTubeAuth } from '@/hooks/useYouTubeAuth';
import { useYouTubeSync, useUpdateSyncSettings } from '@/hooks/useYouTubeSync';
import { YouTubeConnectButton } from './YouTubeConnectButton';
import { PlaylistItem } from './PlaylistItem';
import { Loader2, Plus, RefreshCw, Youtube, LogIn } from 'lucide-react';
import type { SyncInterval } from '@/types/youtube';

const SYNC_INTERVALS: { value: SyncInterval; label: string }[] = [
  { value: 'manual', label: '수동' },
  { value: '1h', label: '1시간마다' },
  { value: '6h', label: '6시간마다' },
  { value: '12h', label: '12시간마다' },
  { value: '24h', label: '24시간마다' },
];

export function YouTubeSyncCard() {
  const { toast } = useToast();
  const { isLoggedIn, isLoading: isAuthLoading, signInWithGoogle } = useAuth();
  const [playlistUrl, setPlaylistUrl] = useState('');
  const [syncingPlaylistId, setSyncingPlaylistId] = useState<string | null>(null);
  const [deletingPlaylistId, setDeletingPlaylistId] = useState<string | null>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);

  const { syncInterval, autoSyncEnabled } = useYouTubeAuth();

  const handleSignIn = async () => {
    setIsSigningIn(true);
    try {
      await signInWithGoogle();
    } catch (error) {
      console.error('Sign in failed:', error);
      toast({
        title: '로그인 실패',
        description: error instanceof Error ? error.message : '로그인 중 오류가 발생했습니다.',
        variant: 'destructive',
      });
    } finally {
      setIsSigningIn(false);
    }
  };
  const {
    playlists,
    isLoading,
    isAdding,
    isSyncingAll,
    addPlaylist,
    syncPlaylist,
    deletePlaylist,
    syncAll,
  } = useYouTubeSync();
  const updateSettings = useUpdateSyncSettings();

  const handleAddPlaylist = async () => {
    if (!playlistUrl.trim()) {
      toast({
        title: '오류',
        description: 'YouTube 플레이리스트 URL을 입력해주세요.',
        variant: 'destructive',
      });
      return;
    }

    try {
      await addPlaylist(playlistUrl.trim());
      setPlaylistUrl('');
      toast({
        title: '플레이리스트 추가됨',
        description: '플레이리스트가 성공적으로 추가되었습니다. 동기화를 시작해주세요.',
      });
    } catch (error) {
      toast({
        title: '추가 실패',
        description: error instanceof Error ? error.message : '플레이리스트를 추가하지 못했습니다.',
        variant: 'destructive',
      });
    }
  };

  const handleSyncPlaylist = async (playlistId: string) => {
    setSyncingPlaylistId(playlistId);
    try {
      const result = await syncPlaylist(playlistId);
      toast({
        title: '동기화 완료',
        description: `${result.itemsAdded}개 추가, ${result.itemsRemoved}개 제거됨`,
      });
    } catch (error) {
      toast({
        title: '동기화 실패',
        description: error instanceof Error ? error.message : '동기화 중 오류가 발생했습니다.',
        variant: 'destructive',
      });
    } finally {
      setSyncingPlaylistId(null);
    }
  };

  const handleDeletePlaylist = async (playlistId: string) => {
    setDeletingPlaylistId(playlistId);
    try {
      await deletePlaylist(playlistId);
      toast({
        title: '삭제됨',
        description: '플레이리스트가 삭제되었습니다.',
      });
    } catch (error) {
      toast({
        title: '삭제 실패',
        description: error instanceof Error ? error.message : '삭제 중 오류가 발생했습니다.',
        variant: 'destructive',
      });
    } finally {
      setDeletingPlaylistId(null);
    }
  };

  const handleSyncAll = async () => {
    try {
      const result = await syncAll();
      toast({
        title: '전체 동기화 완료',
        description: `${result.synced}개 성공, ${result.failed}개 실패`,
        variant: result.failed > 0 ? 'destructive' : 'default',
      });
    } catch (error) {
      toast({
        title: '동기화 실패',
        description: error instanceof Error ? error.message : '동기화 중 오류가 발생했습니다.',
        variant: 'destructive',
      });
    }
  };

  const handleSyncIntervalChange = async (value: SyncInterval) => {
    try {
      await updateSettings.mutateAsync({
        syncInterval: value,
        autoSyncEnabled: value !== 'manual',
      });
      toast({
        title: '설정 저장됨',
        description: `동기화 간격이 "${SYNC_INTERVALS.find(i => i.value === value)?.label}"(으)로 변경되었습니다.`,
      });
    } catch (error) {
      toast({
        title: '설정 저장 실패',
        description: error instanceof Error ? error.message : '설정을 저장하지 못했습니다.',
        variant: 'destructive',
      });
    }
  };

  // Show login prompt if not authenticated
  if (isAuthLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Youtube className="h-5 w-5 text-red-600" />
            YouTube 플레이리스트 동기화
          </CardTitle>
          <CardDescription>
            YouTube 플레이리스트를 자동으로 동기화하여 아이디에이션 팔레트에서 사용합니다
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!isLoggedIn) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Youtube className="h-5 w-5 text-red-600" />
            YouTube 플레이리스트 동기화
          </CardTitle>
          <CardDescription>
            YouTube 플레이리스트를 자동으로 동기화하여 아이디에이션 팔레트에서 사용합니다
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 space-y-4">
            <div className="flex flex-col items-center gap-3">
              <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
                <LogIn className="h-8 w-8 text-muted-foreground" />
              </div>
              <div>
                <p className="font-medium">로그인이 필요합니다</p>
                <p className="text-sm text-muted-foreground">
                  YouTube 플레이리스트 동기화 기능을 사용하려면 먼저 로그인하세요.
                </p>
              </div>
            </div>
            <Button
              onClick={handleSignIn}
              disabled={isSigningIn}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {isSigningIn ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Youtube className="mr-2 h-4 w-4" />
              )}
              Google 계정으로 로그인
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Youtube className="h-5 w-5 text-red-600" />
          YouTube 플레이리스트 동기화
        </CardTitle>
        <CardDescription>
          YouTube 플레이리스트를 자동으로 동기화하여 아이디에이션 팔레트에서 사용합니다
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Google Account Connection */}
        <div className="space-y-2">
          <Label>Google 계정 연결</Label>
          <p className="text-sm text-muted-foreground">
            비공개 플레이리스트에 접근하려면 Google 계정을 연결하세요.
          </p>
          <YouTubeConnectButton />
        </div>

        <Separator />

        {/* Add Playlist */}
        <div className="space-y-2">
          <Label htmlFor="playlist-url">플레이리스트 추가</Label>
          <div className="flex gap-2">
            <Input
              id="playlist-url"
              placeholder="YouTube 플레이리스트 URL 입력..."
              value={playlistUrl}
              onChange={(e) => setPlaylistUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !isAdding) {
                  handleAddPlaylist();
                }
              }}
            />
            <Button
              onClick={handleAddPlaylist}
              disabled={isAdding || !playlistUrl.trim()}
            >
              {isAdding ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              <span className="ml-2 hidden sm:inline">추가</span>
            </Button>
          </div>
        </div>

        {/* Registered Playlists */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>
              등록된 플레이리스트 ({playlists.length})
            </Label>
            {playlists.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleSyncAll}
                disabled={isSyncingAll}
              >
                {isSyncingAll ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                전체 동기화
              </Button>
            )}
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : playlists.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Youtube className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>등록된 플레이리스트가 없습니다.</p>
              <p className="text-sm">위에서 YouTube 플레이리스트 URL을 추가해보세요.</p>
            </div>
          ) : (
            <ScrollArea className="h-[300px]">
              <div className="space-y-2 pr-4">
                {playlists.map((playlist) => (
                  <PlaylistItem
                    key={playlist.id}
                    playlist={playlist}
                    onSync={handleSyncPlaylist}
                    onDelete={handleDeletePlaylist}
                    isSyncing={syncingPlaylistId === playlist.id}
                    isDeleting={deletingPlaylistId === playlist.id}
                  />
                ))}
              </div>
            </ScrollArea>
          )}
        </div>

        <Separator />

        {/* Sync Settings */}
        <div className="space-y-4">
          <Label>동기화 설정</Label>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="sync-interval" className="text-sm font-normal">
                자동 동기화 간격
              </Label>
              <p className="text-xs text-muted-foreground">
                플레이리스트를 자동으로 동기화할 주기를 선택하세요
              </p>
            </div>
            <Select
              value={syncInterval}
              onValueChange={(value) => handleSyncIntervalChange(value as SyncInterval)}
              disabled={updateSettings.isPending}
            >
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SYNC_INTERVALS.map((interval) => (
                  <SelectItem key={interval.value} value={interval.value}>
                    {interval.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="auto-sync" className="text-sm font-normal">
                백그라운드 동기화
              </Label>
              <p className="text-xs text-muted-foreground">
                브라우저가 열려있을 때 자동으로 동기화합니다
              </p>
            </div>
            <Switch
              id="auto-sync"
              checked={autoSyncEnabled}
              onCheckedChange={(checked) =>
                updateSettings.mutate({
                  autoSyncEnabled: checked,
                  syncInterval: checked && syncInterval === 'manual' ? '6h' : syncInterval,
                })
              }
              disabled={updateSettings.isPending}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
