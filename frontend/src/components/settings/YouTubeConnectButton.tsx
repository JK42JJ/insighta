import { Button } from '@/components/ui/button';
import { useYouTubeAuth } from '@/hooks/useYouTubeAuth';
import { Loader2, Youtube, Check, X, AlertCircle, RefreshCw } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';

function getErrorMessage(error: unknown): string {
  if (!error) return '';

  const message = error instanceof Error ? error.message : String(error);

  // Translate common error messages to Korean
  if (message.includes('Not authenticated')) {
    return '로그인이 필요합니다. 먼저 Google 계정으로 로그인해주세요.';
  }
  if (message.includes('Popup blocked')) {
    return '팝업이 차단되었습니다. 이 사이트의 팝업을 허용해주세요.';
  }
  if (message.includes('timeout') || message.includes('Timeout')) {
    return '연결 시간이 초과되었습니다. 다시 시도해주세요.';
  }
  if (message.includes('Failed to get auth URL')) {
    return 'YouTube 인증 URL을 가져오는데 실패했습니다. 잠시 후 다시 시도해주세요.';
  }
  if (message.includes('Failed to get auth status')) {
    return 'YouTube 연결 상태를 확인할 수 없습니다. 페이지를 새로고침해주세요.';
  }
  if (message.includes('Failed to disconnect')) {
    return 'YouTube 연결 해제에 실패했습니다. 다시 시도해주세요.';
  }
  if (message.includes('network') || message.includes('Network')) {
    return '네트워크 오류가 발생했습니다. 인터넷 연결을 확인해주세요.';
  }

  return message;
}

export function YouTubeConnectButton() {
  const {
    isConnected,
    isLoading,
    isConnecting,
    isDisconnecting,
    connect,
    disconnect,
    refetch,
    error,
  } = useYouTubeAuth();

  const errorMessage = getErrorMessage(error);
  const isNotAuthenticated = errorMessage.includes('로그인이 필요합니다');

  if (isLoading) {
    return (
      <Button variant="outline" disabled>
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        확인 중...
      </Button>
    );
  }

  // Show error state with retry option
  if (error && !isNotAuthenticated) {
    return (
      <div className="space-y-3">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          className="gap-2"
        >
          <RefreshCw className="h-4 w-4" />
          다시 시도
        </Button>
      </div>
    );
  }

  if (isConnected) {
    return (
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
          <Check className="h-4 w-4" />
          <span>연결됨</span>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              disabled={isDisconnecting}
            >
              {isDisconnecting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <X className="mr-2 h-4 w-4" />
              )}
              연결 해제
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>YouTube 연결을 해제하시겠습니까?</AlertDialogTitle>
              <AlertDialogDescription>
                연결을 해제하면 비공개 플레이리스트에 접근할 수 없게 됩니다.
                등록된 플레이리스트는 유지되지만, 동기화 시 공개 플레이리스트만 접근 가능합니다.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>취소</AlertDialogCancel>
              <AlertDialogAction onClick={disconnect}>
                연결 해제
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Button
        variant="default"
        onClick={connect}
        disabled={isConnecting}
        className="bg-red-600 hover:bg-red-700 text-white"
      >
        {isConnecting ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Youtube className="mr-2 h-4 w-4" />
        )}
        Google 계정 연결하기
      </Button>
    </div>
  );
}
