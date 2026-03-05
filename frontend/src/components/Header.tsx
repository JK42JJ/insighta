import {
  Archive,
  Home,
  Moon,
  Sun,
  LogIn,
  User,
  Settings,
  LogOut,
  CreditCard,
  LayoutGrid,
  Loader2,
  FileText,
  Shield,
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/hooks/useAuth';

interface HeaderProps {
  onNavigateHome?: () => void;
}

export function Header({ onNavigateHome }: HeaderProps) {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const { isLoggedIn, isLoading, userName, userEmail, userAvatar, signInWithGoogle, signOut } =
    useAuth();
  const [isDark, setIsDark] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);

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

  const handleLogout = async () => {
    setIsSigningOut(true);
    try {
      await signOut();
      navigate('/login');
    } catch (error) {
      console.error('Logout failed:', error);
    } finally {
      setIsSigningOut(false);
    }
  };

  useEffect(() => {
    const isDarkMode = document.documentElement.classList.contains('dark');
    setIsDark(isDarkMode);
  }, []);

  const toggleTheme = () => {
    const newIsDark = !isDark;
    setIsDark(newIsDark);
    document.documentElement.classList.toggle('dark', newIsDark);
  };

  const toggleLanguage = () => {
    const newLang = i18n.language === 'ko' ? 'en' : 'ko';
    i18n.changeLanguage(newLang);
  };

  return (
    <header className="sticky top-0 z-50 bg-surface-mid/95 backdrop-blur-md border-b border-border/50">
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          boxShadow: 'var(--shadow-sm)',
        }}
      />
      <div className="container mx-auto px-4 py-3 flex items-center justify-between relative">
        <div className="flex items-center gap-4">
          <button
            onClick={onNavigateHome}
            className="flex items-center gap-3 hover:opacity-80 transition-opacity"
          >
            <div
              className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center"
              style={{ boxShadow: 'var(--shadow-md)' }}
            >
              <Archive className="w-5 h-5 text-primary-foreground" />
            </div>
            <div className="text-left">
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-foreground tracking-tight">Insighta</h1>
                <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider bg-gradient-to-r from-primary/20 to-primary/10 text-primary border border-primary/30 rounded-md shadow-sm relative overflow-hidden">
                  <span className="relative z-10">beta</span>
                  <span className="absolute inset-0 bg-gradient-to-r from-transparent via-primary/20 to-transparent animate-[shimmer_2s_ease-in-out_infinite] -translate-x-full" />
                </span>
              </div>
              <p className="text-xs text-muted-foreground">{t('header.subtitle')}</p>
            </div>
          </button>

          {/* Home Button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={onNavigateHome}
            className="rounded-lg hover:bg-surface-light transition-all duration-200 gap-1.5"
          >
            <Home className="w-4 h-4" />
            <span className="hidden sm:inline">{t('header.home')}</span>
          </Button>

          {/* Mandala Settings Button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/settings/mandala')}
            className="rounded-lg hover:bg-surface-light transition-all duration-200 gap-1.5"
          >
            <LayoutGrid className="w-4 h-4" />
            <span className="hidden sm:inline">{t('header.mandalaDesign')}</span>
          </Button>
        </div>

        <div className="flex items-center gap-3">
          {isLoading ? (
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          ) : isLoggedIn ? (
            /* Profile Dropdown */
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 p-1 rounded-xl hover:bg-surface-light transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary/50">
                  <Avatar className="w-8 h-8 border-2 border-primary/20">
                    <AvatarImage src={userAvatar ?? undefined} alt={userName || 'User'} />
                    <AvatarFallback className="bg-primary/10 text-primary text-sm font-medium">
                      {userName?.charAt(0)?.toUpperCase() || 'U'}
                    </AvatarFallback>
                  </Avatar>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="w-56 bg-surface-mid border-border/50 z-50"
              >
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col gap-1">
                    <p className="text-sm font-medium text-foreground">{userName || 'User'}</p>
                    <p className="text-xs text-muted-foreground truncate">{userEmail || ''}</p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator className="bg-border/50" />
                <DropdownMenuItem
                  className="gap-2 cursor-pointer hover:bg-surface-light"
                  onClick={() => navigate('/profile')}
                >
                  <User className="w-4 h-4" />
                  <span>{t('header.profile')}</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="gap-2 cursor-pointer hover:bg-surface-light"
                  onClick={() => navigate('/subscription')}
                >
                  <CreditCard className="w-4 h-4" />
                  <span>{t('header.subscription')}</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="gap-2 cursor-pointer hover:bg-surface-light"
                  onClick={() => navigate('/settings')}
                >
                  <Settings className="w-4 h-4" />
                  <span>{t('header.settings')}</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator className="bg-border/50" />
                <DropdownMenuItem
                  className="gap-2 cursor-pointer hover:bg-surface-light"
                  onClick={() => navigate('/terms')}
                >
                  <FileText className="w-4 h-4" />
                  <span>{t('header.termsOfService')}</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="gap-2 cursor-pointer hover:bg-surface-light"
                  onClick={() => navigate('/privacy')}
                >
                  <Shield className="w-4 h-4" />
                  <span>{t('header.privacyPolicy')}</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator className="bg-border/50" />
                <DropdownMenuItem
                  className="gap-2 cursor-pointer hover:bg-surface-light text-destructive focus:text-destructive"
                  onClick={handleLogout}
                  disabled={isSigningOut}
                >
                  {isSigningOut ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <LogOut className="w-4 h-4" />
                  )}
                  <span>{t('common.logout')}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <>
              {/* Login Button */}
              <Button
                variant="outline"
                size="sm"
                className="rounded-lg gap-1.5"
                onClick={handleLogin}
                disabled={isSigningIn}
              >
                {isSigningIn ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <LogIn className="w-4 h-4" />
                )}
                <span>{t('common.login')}</span>
              </Button>

              {/* Sign up link - now uses Google OAuth, same as login */}
              <div className="hidden sm:flex items-center gap-1 text-sm text-muted-foreground">
                <span>{t('header.noAccount')}</span>
                <button
                  className="text-primary hover:underline font-medium"
                  onClick={handleLogin}
                  disabled={isSigningIn}
                >
                  {t('header.signUp')}
                </button>
              </div>
            </>
          )}

          {/* Language Toggle */}
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleLanguage}
            className="rounded-xl hover:bg-surface-light transition-all duration-200 text-xs font-medium px-2"
          >
            {i18n.language === 'ko' ? 'EN' : 'KO'}
          </Button>

          {/* Theme Toggle */}
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            className="rounded-xl hover:bg-surface-light transition-all duration-200"
            style={{ boxShadow: 'var(--shadow-sm)' }}
          >
            {isDark ? <Sun className="w-5 h-5 text-primary" /> : <Moon className="w-5 h-5" />}
          </Button>
        </div>
      </div>
    </header>
  );
}
