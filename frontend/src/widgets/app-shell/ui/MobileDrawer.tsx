import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import {
  Home,
  Settings,
  User,
  CreditCard,
  HelpCircle,
  LogOut,
  Loader2,
} from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { useAuth } from '@/features/auth/model/useAuth';
import { Avatar, AvatarFallback, AvatarImage } from '@/shared/ui/avatar';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/shared/ui/sheet';

interface MobileDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigateHome?: () => void;
}

interface NavItem {
  to: string;
  icon: typeof Home;
  labelKey: string;
  exact?: boolean;
}

const MAIN_NAV: NavItem[] = [
  { to: '/', icon: Home, labelKey: 'sidebar.home', exact: true },
];

const ACCOUNT_NAV: NavItem[] = [
  { to: '/profile', icon: User, labelKey: 'header.profile' },
  { to: '/subscription', icon: CreditCard, labelKey: 'header.subscription' },
  { to: '/settings', icon: Settings, labelKey: 'sidebar.settings' },
  { to: '/help', icon: HelpCircle, labelKey: 'header.help' },
];

export function MobileDrawer({ open, onOpenChange, onNavigateHome }: MobileDrawerProps) {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const { userName, userAvatar, signOut } = useAuth();
  const [isSigningOut, setIsSigningOut] = useState(false);

  const isActive = (path: string, exact?: boolean) => {
    if (exact) return location.pathname === path;
    return location.pathname.startsWith(path);
  };

  const handleNav = (to: string) => {
    if (to === '/' && onNavigateHome) {
      onNavigateHome();
    } else {
      navigate(to);
    }
    onOpenChange(false);
  };

  const handleLogout = async () => {
    setIsSigningOut(true);
    try {
      await signOut();
      navigate('/login');
    } finally {
      setIsSigningOut(false);
      onOpenChange(false);
    }
  };

  const renderNavItem = (item: NavItem) => {
    const active = isActive(item.to, item.exact);
    const Icon = item.icon;

    return (
      <li key={item.to}>
        <button
          onClick={() => handleNav(item.to)}
          className={cn(
            'w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors',
            active ? 'bg-primary/10 text-primary' : 'text-foreground/80 hover:bg-surface-light'
          )}
          aria-current={active ? 'page' : undefined}
        >
          <Icon className="w-5 h-5 shrink-0" aria-hidden="true" />
          <span>{t(item.labelKey)}</span>
        </button>
      </li>
    );
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-72 p-0 bg-surface-mid">
        <SheetHeader className="p-4 pb-2">
          <SheetTitle className="sr-only">{t('sidebar.navigation')}</SheetTitle>
        </SheetHeader>

        {/* User profile section */}
        <div className="px-4 pb-4 flex items-center gap-3">
          <Avatar className="w-10 h-10 border-2 border-primary/20">
            <AvatarImage src={userAvatar ?? undefined} alt={userName || 'User'} />
            <AvatarFallback className="bg-primary/10 text-primary font-medium">
              {userName?.charAt(0)?.toUpperCase() || 'U'}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">{userName || 'User'}</p>
            <p className="text-xs text-muted-foreground">Pioneer</p>
          </div>
        </div>

        <div className="h-px bg-border/50 mx-4" />

        {/* Main navigation */}
        <nav className="p-2" aria-label={t('sidebar.navigation')}>
          <ul className="space-y-0.5" role="list">
            {MAIN_NAV.map(renderNavItem)}
          </ul>

          <div className="h-px bg-border/50 mx-2 my-2" />

          <ul className="space-y-0.5" role="list">
            {ACCOUNT_NAV.map(renderNavItem)}
          </ul>

          <div className="h-px bg-border/50 mx-2 my-2" />

          {/* Logout */}
          <button
            onClick={handleLogout}
            disabled={isSigningOut}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium text-destructive/80 hover:bg-destructive/10 hover:text-destructive transition-colors"
          >
            {isSigningOut ? (
              <Loader2 className="w-5 h-5 shrink-0 animate-spin" />
            ) : (
              <LogOut className="w-5 h-5 shrink-0" aria-hidden="true" />
            )}
            <span>{t('common.logout')}</span>
          </button>
        </nav>
      </SheetContent>
    </Sheet>
  );
}
