import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useTheme } from 'next-themes';
import { Moon, Sun, LogIn, Loader2, Menu, Search } from 'lucide-react';
import { Button } from '@/shared/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/shared/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu';
import { useAuth } from '@/features/auth/model/useAuth';

interface AppHeaderProps {
  onMobileMenuOpen?: () => void;
}

export function AppHeader({ onMobileMenuOpen }: AppHeaderProps) {
  const { t, i18n } = useTranslation();
  const { isLoggedIn, isLoading, userName, userEmail, userAvatar } = useAuth();
  const { theme, setTheme } = useTheme();
  const isDark = theme === 'dark';
  const navigate = useNavigate();

  const toggleTheme = () => setTheme(isDark ? 'light' : 'dark');
  const toggleLanguage = () => i18n.changeLanguage(i18n.language === 'ko' ? 'en' : 'ko');

  return (
    <header className="sticky top-0 z-40 h-14 bg-surface-mid/95 backdrop-blur-md border-b border-border/50">
      <div className="h-full mx-auto max-w-7xl px-4 sm:px-6 flex items-center justify-between">
        {/* Left: Mobile menu + Logo */}
        <div className="flex items-center gap-3">
          {/* Mobile hamburger */}
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden rounded-lg"
            onClick={onMobileMenuOpen}
            aria-label={t('sidebar.openMenu')}
          >
            <Menu className="w-5 h-5" />
          </Button>

          {/* Logo */}
          <Link
            to="/"
            className="flex items-center gap-2.5 hover:opacity-80 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 rounded-lg"
          >
            <img
              src={`${import.meta.env.BASE_URL}logo.png`}
              alt="Insighta"
              className="w-7 h-7 rounded-lg dark:invert"
            />
            <span className="text-lg font-bold text-foreground tracking-tight hidden sm:inline">
              Insighta
            </span>
          </Link>
        </div>

        {/* Center: Search (placeholder for future) */}
        <div className="hidden md:flex items-center flex-1 max-w-md mx-4">
          <div className="relative w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder={t('sidebar.searchPlaceholder')}
              className="w-full h-9 pl-9 pr-4 rounded-lg bg-surface-base border border-border/50 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-shadow"
              disabled
            />
          </div>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-2">
          {/* Language Toggle */}
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleLanguage}
            aria-label={
              i18n.language === 'ko' ? t('header.switchToEnglish') : t('header.switchToKorean')
            }
            className="rounded-lg text-xs font-medium px-2 hover:bg-surface-light"
          >
            {i18n.language === 'ko' ? 'EN' : 'KO'}
          </Button>

          {/* Theme Toggle */}
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            aria-label={isDark ? t('header.switchToLight') : t('header.switchToDark')}
            className="rounded-lg hover:bg-surface-light"
          >
            {isDark ? <Sun className="w-4 h-4 text-primary" /> : <Moon className="w-4 h-4" />}
          </Button>

          {/* Auth */}
          {isLoading ? (
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          ) : isLoggedIn ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  aria-label={t('header.openUserMenu')}
                  className="flex items-center p-0.5 rounded-full hover:ring-2 hover:ring-primary/30 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                >
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
                <DropdownMenuItem asChild className="gap-2 cursor-pointer hover:bg-surface-light">
                  <Link to="/profile">{t('header.profile')}</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild className="gap-2 cursor-pointer hover:bg-surface-light">
                  <Link to="/subscription">{t('header.subscription')}</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild className="gap-2 cursor-pointer hover:bg-surface-light">
                  <Link to="/settings">{t('header.settings')}</Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="rounded-lg gap-1.5"
              onClick={() => navigate('/login')}
            >
              <LogIn className="w-4 h-4" />
              <span>{t('common.login')}</span>
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
