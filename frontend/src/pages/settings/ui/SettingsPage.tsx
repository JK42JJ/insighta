import { useEffect, useRef, useCallback, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useTheme } from 'next-themes';

import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';
import { Label } from '@/shared/ui/label';
import { Switch } from '@/shared/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { Avatar, AvatarFallback, AvatarImage } from '@/shared/ui/avatar';
import { TierBadge } from '@/shared/ui/tier-badge';
import { Trash2, Check, Download } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { toast } from '@/shared/lib/use-toast';
import { useAuth } from '@/features/auth/model/useAuth';
import { useLocalCardsAsInsight } from '@/features/card-management/model/useLocalCards';
import { apiClient } from '@/shared/lib/api-client';
import { MandalaSettingsTab } from './MandalaSettingsTab';
import { ProfileSettingsTab } from './ProfileSettingsTab';
import { SourceManagementTab } from './SourceManagementTab';
import { ConnectedServicesTab } from './ConnectedServicesTab';
import { SubscriptionSettingsTab } from './SubscriptionSettingsTab';
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
} from '@/shared/ui/alert-dialog';

type SettingsCategory =
  | 'general'
  | 'profile'
  | 'mandalas'
  | 'appearance'
  | 'notifications'
  | 'sources'
  | 'services'
  | 'subscription'
  | 'data';

const VALID_TABS: SettingsCategory[] = [
  'general',
  'profile',
  'mandalas',
  'appearance',
  'notifications',
  'sources',
  'services',
  'subscription',
  'data',
];

/** Auto-save helper: persist to localStorage and dispatch event */
function autoSave(key: string, value: Record<string, unknown>) {
  localStorage.setItem(key, JSON.stringify(value));
  window.dispatchEvent(new Event('app-settings-changed'));
}

export default function SettingsPage() {
  const { t, i18n } = useTranslation();
  const { userName, userEmail, userAvatar } = useAuth();
  const { subscription } = useLocalCardsAsInsight();
  const { theme, setTheme } = useTheme();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeCategory = (searchParams.get('tab') as SettingsCategory) || 'general';
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  // Redirect invalid/legacy tab
  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab === 'integrations') {
      setSearchParams({ tab: 'sources' }, { replace: true });
      return;
    }
    if (tab && !VALID_TABS.includes(tab as SettingsCategory)) {
      setSearchParams({ tab: 'general' }, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // Settings state with auto-save
  const getSettings = () => {
    try {
      const saved = localStorage.getItem('app-settings');
      const parsed = saved ? JSON.parse(saved) : {};
      return {
        language: i18n.language,
        theme: parsed.theme ?? 'dark',
        cardFlipOnHover: parsed.cardFlipOnHover ?? true,
      };
    } catch {
      return {
        language: i18n.language,
        theme: 'dark',
        cardFlipOnHover: true,
      };
    }
  };

  // Settings state — useState so UI re-renders instantly on change
  const [settings, setSettings] = useState(getSettings);

  const toastTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const updateSetting = useCallback(
    (key: string, value: unknown) => {
      setSettings((prev) => {
        const updated = { ...prev, [key]: value };
        autoSave('app-settings', updated);
        return updated;
      });

      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      toastTimerRef.current = setTimeout(() => {
        toast({
          title: t('settings.settingsSaved'),
          description: t('settings.settingsSavedDesc'),
        });
      }, 1500);
    },
    [t]
  );

  const handleLanguageChange = (value: string) => {
    i18n.changeLanguage(value);
    updateSetting('language', value);
  };

  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async (format: 'json' | 'csv') => {
    setIsExporting(true);
    try {
      const { mandalas } = await apiClient.listMandalas(1, 100);
      const data = mandalas.map((m) => ({
        id: m.id,
        title: m.title,
        createdAt: m.createdAt,
        levels: m.levels,
      }));

      let content: string;
      let mimeType: string;
      let extension: string;

      if (format === 'json') {
        content = JSON.stringify(data, null, 2);
        mimeType = 'application/json';
        extension = 'json';
      } else {
        const rows = data.flatMap((m) =>
          (m.levels ?? []).map((l) =>
            [
              m.id,
              m.title,
              m.createdAt,
              l.levelKey,
              l.centerGoal,
              (l.subjects ?? []).join('; '),
              l.depth,
              l.position,
            ]
              .map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`)
              .join(',')
          )
        );
        const header = 'mandala_id,title,created_at,level_key,center_goal,subjects,depth,position';
        content = [header, ...rows].join('\n');
        mimeType = 'text/csv';
        extension = 'csv';
      }

      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `insighta-export-${new Date().toISOString().slice(0, 10)}.${extension}`;
      a.click();
      URL.revokeObjectURL(url);

      toast({ title: t('settings.exportSuccess', 'Export complete') });
    } catch {
      toast({ title: t('settings.exportFailed', 'Export failed'), variant: 'destructive' });
    } finally {
      setIsExporting(false);
    }
  };

  const [isDeleting, setIsDeleting] = useState(false);

  const handleDeleteData = async () => {
    setIsDeleting(true);
    try {
      await apiClient.deleteAccount();
      localStorage.clear();
      toast({
        title: t('settings.dataDeleted'),
        description: t('settings.dataDeletedDesc'),
        variant: 'destructive',
      });
      window.location.href = '/';
    } catch {
      toast({ title: t('common.error'), variant: 'destructive' });
      setIsDeleting(false);
    }
  };

  return (
    <div className="px-6 md:px-10 py-8 w-full max-w-3xl mx-auto">
      {/* General */}
      {activeCategory === 'general' && (
        <>
          <div className="mb-6">
            <h2 className="text-xl font-bold text-foreground">{t('settings.general')}</h2>
            <p className="text-sm text-muted-foreground mt-1">
              {t('settings.generalDesc', 'Profile and basic app settings')}
            </p>
          </div>

          {/* Profile Card */}
          <div
            className="flex items-center gap-4 p-5 mb-4 bg-surface-mid border border-border/50 rounded-xl hover:border-primary/40 hover:bg-surface-mid/80 cursor-pointer transition-colors"
            onClick={() => setSearchParams({ tab: 'profile' })}
          >
            <Avatar className="w-14 h-14 border-2 border-primary/20">
              <AvatarImage src={userAvatar ?? undefined} alt={userName || 'User'} />
              <AvatarFallback className="bg-primary/10 text-primary text-xl font-bold">
                {userName?.charAt(0)?.toUpperCase() || 'U'}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-base font-bold text-foreground">{userName || 'User'}</span>
                <TierBadge tier={subscription.tier} />
              </div>
              <p className="text-sm text-muted-foreground truncate">{userEmail || ''}</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="border-border/50 text-muted-foreground hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation();
                setSearchParams({ tab: 'profile' });
              }}
            >
              {t('settings.editProfile', 'Edit Profile')}
            </Button>
          </div>

          <Card className="bg-surface-mid border-border/50">
            <CardContent className="divide-y divide-border/30">
              <div className="flex items-center justify-between py-4">
                <div>
                  <Label htmlFor="language">{t('settings.languageSelect')}</Label>
                  <p className="text-sm text-muted-foreground">
                    {t('settings.languageSelectDesc')}
                  </p>
                </div>
                <Select value={settings.language} onValueChange={handleLanguageChange}>
                  <SelectTrigger className="w-32 bg-surface-light border-border/50">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ko">한국어</SelectItem>
                    <SelectItem value="en">English</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* Profile */}
      {activeCategory === 'profile' && (
        <>
          <div className="mb-6">
            <h2 className="text-xl font-bold text-foreground">{t('profile.title')}</h2>
            <p className="text-sm text-muted-foreground mt-1">{t('profile.subtitle')}</p>
          </div>
          <ProfileSettingsTab />
        </>
      )}

      {/* Mandalas */}
      {activeCategory === 'mandalas' && (
        <>
          <div className="mb-6">
            <h2 className="text-xl font-bold text-foreground">{t('settings.mandalas')}</h2>
            <p className="text-sm text-muted-foreground mt-1">{t('settings.mandalaDesc')}</p>
          </div>
          <MandalaSettingsTab />
        </>
      )}

      {/* Appearance */}
      {activeCategory === 'appearance' && (
        <>
          <div className="mb-6">
            <h2 className="text-xl font-bold text-foreground">{t('settings.appearance')}</h2>
            <p className="text-sm text-muted-foreground mt-1">{t('settings.appearanceDesc')}</p>
          </div>

          {/* Theme 3-way Preview Card */}
          <Card className="bg-surface-mid border-border/50 mb-4">
            <CardContent className="p-5">
              <Label className="mb-3 block">{t('settings.theme')}</Label>
              <div className="grid grid-cols-3 gap-3">
                {(['light', 'dark', 'system'] as const).map((opt) => {
                  const isSelected = theme === opt;
                  return (
                    <button
                      key={opt}
                      onClick={() => {
                        setTheme(opt);
                        updateSetting('theme', opt);
                      }}
                      className={cn(
                        'relative p-3 rounded-xl border-2 transition-all duration-200 text-center',
                        isSelected
                          ? 'border-primary shadow-[0_0_0_3px_hsl(var(--primary)/0.15)]'
                          : 'border-border hover:border-muted-foreground/40'
                      )}
                    >
                      {isSelected && (
                        <span className="absolute top-2 right-2 w-5 h-5 bg-primary rounded-full flex items-center justify-center animate-in zoom-in-50 duration-300">
                          <Check className="w-3 h-3 text-primary-foreground" />
                        </span>
                      )}
                      <div
                        className={cn(
                          'w-full h-12 rounded-lg mb-2.5 relative overflow-hidden',
                          opt === 'dark' &&
                            'bg-gradient-to-br from-[hsl(220,16%,8%)] to-[hsl(220,13%,18%)]',
                          opt === 'light' && 'bg-gradient-to-br from-[hsl(220,14%,96%)] to-white',
                          opt === 'system' &&
                            'bg-gradient-to-r from-[hsl(220,16%,8%)] via-[hsl(220,16%,8%)] to-white'
                        )}
                      >
                        <div
                          className={cn(
                            'absolute bottom-1.5 left-1/2 -translate-x-1/2 w-2/5 h-1 rounded-full',
                            opt === 'dark' && 'bg-primary',
                            opt === 'light' && 'bg-primary/80',
                            opt === 'system' && 'bg-gradient-to-r from-primary to-primary/80'
                          )}
                        />
                      </div>
                      <span
                        className={cn(
                          'text-xs font-semibold',
                          isSelected ? 'text-primary' : 'text-muted-foreground'
                        )}
                      >
                        {t(`settings.theme${opt.charAt(0).toUpperCase() + opt.slice(1)}`)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-surface-mid border-border/50">
            <CardContent className="divide-y divide-border/30">
              <div className="flex items-center justify-between py-4">
                <div>
                  <Label htmlFor="cardFlipOnHover">{t('settings.cardFlipOnHover')}</Label>
                  <p className="text-sm text-muted-foreground">
                    {t('settings.cardFlipOnHoverDesc')}
                  </p>
                </div>
                <Switch
                  id="cardFlipOnHover"
                  checked={settings.cardFlipOnHover}
                  onCheckedChange={(checked) => updateSetting('cardFlipOnHover', checked)}
                />
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* Notifications */}
      {activeCategory === 'notifications' && (
        <>
          <div className="mb-6">
            <h2 className="text-xl font-bold text-foreground">{t('settings.notifications')}</h2>
            <p className="text-sm text-muted-foreground mt-1">{t('settings.notificationsDesc')}</p>
          </div>
          <Card className="bg-surface-mid border-border/50">
            <CardContent className="py-12 text-center text-muted-foreground">
              <p className="text-sm">{t('common.comingSoon', 'Coming soon')}</p>
            </CardContent>
          </Card>
        </>
      )}

      {/* Source Management */}
      {activeCategory === 'sources' && (
        <>
          <div className="mb-6">
            <h2 className="text-xl font-bold text-foreground">{t('settings.sourceManagement')}</h2>
            <p className="text-sm text-muted-foreground mt-1">
              {t('settings.sourceManagementDesc')}
            </p>
          </div>
          <SourceManagementTab />
        </>
      )}

      {/* Connected Services */}
      {activeCategory === 'services' && (
        <>
          <div className="mb-6">
            <h2 className="text-xl font-bold text-foreground">{t('settings.connectedServices')}</h2>
            <p className="text-sm text-muted-foreground mt-1">
              {t('settings.connectedServicesDesc')}
            </p>
          </div>
          <ConnectedServicesTab />
        </>
      )}

      {/* Subscription */}
      {activeCategory === 'subscription' && (
        <>
          <div className="mb-6">
            <h2 className="text-xl font-bold text-foreground">{t('settings.subscription')}</h2>
            <p className="text-sm text-muted-foreground mt-1">{t('settings.subscriptionDesc')}</p>
          </div>
          <SubscriptionSettingsTab />
        </>
      )}

      {/* Data & Privacy */}
      {activeCategory === 'data' && (
        <>
          <div className="mb-6">
            <h2 className="text-xl font-bold text-foreground">{t('settings.dataPrivacy')}</h2>
            <p className="text-sm text-muted-foreground mt-1">{t('settings.dataPrivacyDesc')}</p>
          </div>
          <Card className="bg-surface-mid border-border/50">
            <CardContent className="divide-y divide-border/30">
              <div className="flex items-center justify-between py-4">
                <div>
                  <Label>{t('settings.exportData', 'Export Data')}</Label>
                  <p className="text-sm text-muted-foreground">
                    {t('settings.exportDataDesc', 'Download all your data as JSON')}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-border/50 gap-1.5"
                    onClick={() => handleExport('json')}
                    disabled={isExporting}
                  >
                    <Download className="w-3.5 h-3.5" />
                    JSON
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-border/50 gap-1.5"
                    onClick={() => handleExport('csv')}
                    disabled={isExporting}
                  >
                    <Download className="w-3.5 h-3.5" />
                    CSV
                  </Button>
                </div>
              </div>
              <div className="flex items-center justify-between py-4">
                <div>
                  <Label className="text-destructive">{t('settings.deleteAllData')}</Label>
                  <p className="text-sm text-muted-foreground">{t('settings.deleteAllDataDesc')}</p>
                </div>
                <AlertDialog
                  onOpenChange={(open) => {
                    if (!open) setDeleteConfirmText('');
                  }}
                >
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" size="sm" className="gap-2">
                      <Trash2 className="w-4 h-4" />
                      {t('common.delete')}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent className="bg-surface-mid border-border/50">
                    <AlertDialogHeader>
                      <AlertDialogTitle>{t('settings.deleteConfirmTitle')}</AlertDialogTitle>
                      <AlertDialogDescription>
                        {t('settings.deleteConfirmDesc')}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <div className="py-2">
                      <input
                        type="text"
                        value={deleteConfirmText}
                        onChange={(e) => setDeleteConfirmText(e.target.value)}
                        placeholder={t(
                          'settings.deleteTypePlaceholder',
                          'Type "DELETE" to confirm'
                        )}
                        className="w-full px-3 py-2 text-sm bg-surface-light border border-border/50 rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-destructive"
                      />
                    </div>
                    <AlertDialogFooter>
                      <AlertDialogCancel className="bg-surface-light border-border/50">
                        {t('common.cancel')}
                      </AlertDialogCancel>
                      <AlertDialogAction
                        onClick={handleDeleteData}
                        disabled={deleteConfirmText !== 'DELETE' || isDeleting}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {t('common.delete')}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
              <div className="flex items-center justify-between py-4">
                <div>
                  <Label>{t('settings.termsOfService', 'Terms of Service')}</Label>
                </div>
                <a
                  href="/terms"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-primary hover:underline"
                >
                  {t('settings.viewTerms', 'View')}
                </a>
              </div>
              <div className="flex items-center justify-between py-4">
                <div>
                  <Label>{t('settings.privacyPolicy', 'Privacy Policy')}</Label>
                </div>
                <a
                  href="/privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-primary hover:underline"
                >
                  {t('settings.viewPolicy', 'View')}
                </a>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
