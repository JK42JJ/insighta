import { Archive, Loader2 } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';

export default function Login() {
  const navigate = useNavigate();
  const { isLoggedIn, isLoading, signInWithGoogle } = useAuth();
  const [isSigningIn, setIsSigningIn] = useState(false);

  // Redirect to home if already logged in
  useEffect(() => {
    if (!isLoading && isLoggedIn) {
      navigate('/', { replace: true });
    }
  }, [isLoggedIn, isLoading, navigate]);

  const handleLogin = async () => {
    setIsSigningIn(true);
    try {
      await signInWithGoogle();
    } catch (error) {
      console.error('Login failed:', error);
    } finally {
      setIsSigningIn(false);
    }
  };

  // Show loading while checking auth state
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Main Content */}
      <div className="flex-1 flex items-center justify-center px-4">
        <div className="w-full max-w-md space-y-8">
          {/* Logo & Branding */}
          <div className="text-center space-y-4">
            <div className="flex justify-center">
              <div
                className="w-20 h-20 rounded-2xl bg-primary flex items-center justify-center"
                style={{ boxShadow: 'var(--shadow-lg)' }}
              >
                <Archive className="w-10 h-10 text-primary-foreground" />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-center gap-2">
                <h1 className="text-3xl font-bold text-foreground tracking-tight">TubeArchive</h1>
                <span className="inline-flex items-center px-2 py-0.5 text-xs font-semibold uppercase tracking-wider bg-gradient-to-r from-primary/20 to-primary/10 text-primary border border-primary/30 rounded-md">
                  beta
                </span>
              </div>
              <p className="mt-2 text-muted-foreground">만다라트 기반 YouTube 아카이브</p>
            </div>
          </div>

          {/* Description */}
          <div className="bg-surface-mid/50 rounded-xl p-6 border border-border/50 space-y-4">
            <h2 className="text-lg font-semibold text-foreground">
              당신의 학습을 체계적으로 관리하세요
            </h2>
            <ul className="space-y-3 text-sm text-muted-foreground">
              <li className="flex items-start gap-2">
                <span className="text-primary mt-0.5">•</span>
                <span>YouTube 동영상을 만다라트 구조로 정리</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary mt-0.5">•</span>
                <span>타임스탬프 기반 메모 작성</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary mt-0.5">•</span>
                <span>아이디어 드래그 앤 드롭으로 쉬운 정리</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary mt-0.5">•</span>
                <span>플레이리스트 자동 동기화</span>
              </li>
            </ul>
          </div>

          {/* Login Button */}
          <div className="space-y-4">
            <Button
              className="w-full h-12 text-base font-medium gap-2 rounded-xl"
              onClick={handleLogin}
              disabled={isSigningIn}
              size="lg"
            >
              {isSigningIn ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path
                    fill="currentColor"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="currentColor"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="currentColor"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  />
                  <path
                    fill="currentColor"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  />
                </svg>
              )}
              Google로 계속하기
            </Button>

            <p className="text-center text-xs text-muted-foreground">
              로그인하면{' '}
              <Link
                to="/terms"
                className="text-foreground underline hover:text-primary transition-colors"
              >
                서비스 이용약관
              </Link>{' '}
              및{' '}
              <Link
                to="/privacy"
                className="text-foreground underline hover:text-primary transition-colors"
              >
                개인정보처리방침
              </Link>
              에 동의하는 것으로 간주됩니다.
            </p>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="py-6 text-center text-sm text-muted-foreground space-y-1">
        <div className="flex items-center justify-center gap-3">
          <Link to="/terms" className="hover:text-foreground transition-colors">
            이용약관
          </Link>
          <span>·</span>
          <Link to="/privacy" className="hover:text-foreground transition-colors">
            개인정보처리방침
          </Link>
        </div>
        <p>&copy; 2026 Insighta. All rights reserved.</p>
      </footer>
    </div>
  );
}
