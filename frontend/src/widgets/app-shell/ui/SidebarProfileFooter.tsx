import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useTheme } from 'next-themes';
import { Moon, Sun, LogOut, HelpCircle, Loader2, Languages } from 'lucide-react';
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
import { useLocalCardsAsInsight } from '@/features/card-management/model/useLocalCards';
import { TierBadge } from '@/shared/ui/tier-badge';
import { getAuthCache, updateAuthCacheTier } from '@/features/auth/lib/auth-cache';
import { cn } from '@/shared/lib/utils';

interface SidebarProfileFooterProps {
  collapsed: boolean;
}

export function SidebarProfileFooter({ collapsed }: SidebarProfileFooterProps) {
  const { t, i18n } = useTranslation();
  const { isLoading, userName, userEmail, userAvatar, signOut } = useAuth();
  const { subscription } = useLocalCardsAsInsight();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();
  const [isSigningOut, setIsSigningOut] = useState(false);

  const cachedTier = getAuthCache()?.tier;
  const displayTier =
    subscription.tier !== 'free' ? subscription.tier : (cachedTier ?? subscription.tier);
  const showUpgrade = (displayTier ?? 'free').toLowerCase() === 'free';

  useEffect(() => {
    if (subscription.tier && subscription.tier !== 'free') {
      updateAuthCacheTier(subscription.tier);
    }
  }, [subscription.tier]);

  const isDark = theme === 'dark';
  const toggleTheme = () => setTheme(isDark ? 'light' : 'dark');
  const toggleLanguage = () => i18n.changeLanguage(i18n.language === 'ko' ? 'en' : 'ko');

  const handleLogout = async () => {
    setIsSigningOut(true);
    try {
      await signOut();
    } finally {
      setIsSigningOut(false);
    }
  };

  // Shared dropdown content — reused across collapsed and expanded branches.
  const profileDropdownContent = (
    <DropdownMenuContent
      align="end"
      side="top"
      sideOffset={8}
      onCloseAutoFocus={(e) => e.preventDefault()}
      className="w-56 bg-surface-mid border-border/50 z-50 outline-none focus:outline-none focus:ring-0 focus-visible:ring-0 focus-visible:outline-none"
    >
      <DropdownMenuLabel className="font-normal">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-foreground">{userName || 'User'}</p>
          <p className="text-xs text-muted-foreground truncate">{userEmail || ''}</p>
        </div>
      </DropdownMenuLabel>
      <DropdownMenuSeparator className="bg-border/50" />

      <DropdownMenuItem
        onClick={toggleLanguage}
        className="gap-2 cursor-pointer hover:bg-surface-light"
        aria-label={
          i18n.language === 'ko' ? t('header.switchToEnglish') : t('header.switchToKorean')
        }
      >
        <Languages className="w-4 h-4" />
        <span className="flex-1">{i18n.language === 'ko' ? 'English' : '한국어'}</span>
        <span className="text-xs text-muted-foreground">
          {i18n.language === 'ko' ? 'EN' : 'KO'}
        </span>
      </DropdownMenuItem>

      <DropdownMenuItem
        onClick={toggleTheme}
        className="gap-2 cursor-pointer hover:bg-surface-light"
        aria-label={isDark ? t('header.switchToLight') : t('header.switchToDark')}
      >
        {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        <span>{isDark ? t('header.switchToLight') : t('header.switchToDark')}</span>
      </DropdownMenuItem>

      <DropdownMenuSeparator className="bg-border/50" />

      <DropdownMenuItem asChild className="gap-2 cursor-pointer hover:bg-surface-light">
        <Link to="/settings?tab=profile">{t('header.profile')}</Link>
      </DropdownMenuItem>
      <DropdownMenuItem asChild className="gap-2 cursor-pointer hover:bg-surface-light">
        <Link to="/subscription">{t('header.subscription')}</Link>
      </DropdownMenuItem>
      <DropdownMenuItem
        onClick={() => navigate('/settings')}
        className="gap-2 cursor-pointer hover:bg-surface-light"
      >
        {t('header.settings')}
      </DropdownMenuItem>

      <DropdownMenuSeparator className="bg-border/50" />

      <DropdownMenuItem asChild className="gap-2 cursor-pointer hover:bg-surface-light">
        <Link to="/help">
          <HelpCircle className="w-4 h-4" />
          {t('header.help')}
        </Link>
      </DropdownMenuItem>
      <DropdownMenuItem
        onClick={handleLogout}
        disabled={isSigningOut || isLoading}
        className={cn(
          'gap-2 cursor-pointer text-destructive focus:text-destructive hover:bg-destructive/10'
        )}
      >
        {isSigningOut ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <LogOut className="w-4 h-4" />
        )}
        {t('common.logout')}
      </DropdownMenuItem>
    </DropdownMenuContent>
  );

  if (collapsed) {
    return (
      <div className="shrink-0 px-2 py-3 border-t border-sidebar-border/40 flex flex-col items-center">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              aria-label={t('header.openUserMenu')}
              className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            >
              <Avatar className="w-8 h-8">
                <AvatarImage src={userAvatar ?? undefined} alt={userName || 'User'} />
                <AvatarFallback className="bg-primary/10 text-primary text-sm font-medium">
                  {userName?.charAt(0)?.toUpperCase() || 'U'}
                </AvatarFallback>
              </Avatar>
            </button>
          </DropdownMenuTrigger>
          {profileDropdownContent}
        </DropdownMenu>
      </div>
    );
  }

  return (
    <div className="shrink-0 px-2 py-3 border-t border-sidebar-border/40 flex items-center justify-between gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            aria-label={t('header.openUserMenu')}
            className="flex flex-1 min-w-0 items-center gap-2 rounded-lg p-1.5 hover:bg-sidebar-accent transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          >
            <Avatar className="w-8 h-8 shrink-0">
              <AvatarImage src={userAvatar ?? undefined} alt={userName || 'User'} />
              <AvatarFallback className="bg-primary/10 text-primary text-sm font-medium">
                {userName?.charAt(0)?.toUpperCase() || 'U'}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0 flex flex-col text-left">
              <span className="truncate text-[13px] font-medium text-sidebar-foreground">
                {userName || 'User'}
              </span>
              <span className="truncate text-[11px] text-sidebar-foreground/55 capitalize">
                {displayTier || 'free'}
              </span>
            </div>
            <TierBadge tier={displayTier} className="shrink-0 sr-only" />
          </button>
        </DropdownMenuTrigger>
        {profileDropdownContent}
      </DropdownMenu>

      {showUpgrade && (
        <Link
          to="/subscription"
          className="shrink-0 inline-flex items-center px-2 py-0.5 text-[12px] font-medium rounded-md border border-sidebar-border text-sidebar-foreground/70 hover:bg-primary hover:border-primary hover:text-primary-foreground transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        >
          {t('sidebar.upgrade', 'Upgrade')}
        </Link>
      )}
    </div>
  );
}
