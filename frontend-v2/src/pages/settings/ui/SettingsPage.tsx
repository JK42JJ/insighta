import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AppShell } from '@/widgets/app-shell';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { Label } from '@/shared/ui/label';
import { Switch } from '@/shared/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui/select';
import { Separator } from '@/shared/ui/separator';
import { Bell, Globe, Palette, Shield, Trash2, Play, Settings } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { toast } from '@/shared/lib/use-toast';
import { YouTubeSyncCard } from './YouTubeSyncCard';
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

type SettingsCategory = 'general' | 'appearance' | 'notifications' | 'youtube' | 'data';

const CATEGORIES: { id: SettingsCategory; icon: typeof Settings; labelKey: string }[] = [
  { id: 'general', icon: Globe, labelKey: 'settings.general' },
  { id: 'appearance', icon: Palette, labelKey: 'settings.appearance' },
  { id: 'notifications', icon: Bell, labelKey: 'settings.notifications' },
  { id: 'youtube', icon: Play, labelKey: 'settings.youtube' },
  { id: 'data', icon: Shield, labelKey: 'settings.dataPrivacy' },
];

export default function SettingsPage() {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>('general');
  const [settings, setSettings] = useState({
    notifications: true,
    emailUpdates: false,
    autoSave: true,
    language: i18n.language,
    theme: 'dark',
  });

  const handleSave = () => {
    localStorage.setItem('app-settings', JSON.stringify(settings));
    toast({
      title: t('settings.settingsSaved'),
      description: t('settings.settingsSavedDesc'),
    });
  };

  const handleDeleteData = () => {
    localStorage.clear();
    toast({
      title: t('settings.dataDeleted'),
      description: t('settings.dataDeletedDesc'),
      variant: 'destructive',
    });
    navigate('/');
  };

  const handleLanguageChange = (value: string) => {
    setSettings({ ...settings, language: value });
    i18n.changeLanguage(value);
  };

  return (
    <AppShell>
      <div className="container mx-auto px-4 py-8 max-w-5xl">
        <h1 className="text-2xl font-bold text-foreground mb-6">{t('settings.title')}</h1>

        <div className="flex flex-col md:flex-row gap-6">
          {/* Left sidebar nav */}
          <nav className="md:w-48 flex-shrink-0">
            <ul className="flex md:flex-col gap-1 overflow-x-auto md:overflow-x-visible pb-2 md:pb-0">
              {CATEGORIES.map(({ id, icon: Icon, labelKey }) => (
                <li key={id}>
                  <button
                    onClick={() => setActiveCategory(id)}
                    className={cn(
                      'flex items-center gap-2 px-3 py-2 rounded-md text-sm whitespace-nowrap w-full text-left transition-colors',
                      activeCategory === id
                        ? 'bg-primary/10 text-primary font-medium'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
                    )}
                  >
                    <Icon className="w-4 h-4 flex-shrink-0" />
                    {t(labelKey)}
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          {/* Right content area */}
          <div className="flex-1 space-y-6">
            {/* General */}
            {activeCategory === 'general' && (
              <Card className="bg-surface-mid border-border/50">
                <CardHeader>
                  <CardTitle className="text-lg">{t('settings.general', 'General')}</CardTitle>
                  <CardDescription>{t('settings.languageDesc')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
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
                  <Separator className="bg-border/50" />
                  <div className="flex items-center justify-between">
                    <div>
                      <Label htmlFor="autoSave">{t('settings.autoSave')}</Label>
                      <p className="text-sm text-muted-foreground">{t('settings.autoSaveDesc')}</p>
                    </div>
                    <Switch
                      id="autoSave"
                      checked={settings.autoSave}
                      onCheckedChange={(checked) => setSettings({ ...settings, autoSave: checked })}
                    />
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Appearance */}
            {activeCategory === 'appearance' && (
              <Card className="bg-surface-mid border-border/50">
                <CardHeader>
                  <CardTitle className="text-lg">{t('settings.appearance')}</CardTitle>
                  <CardDescription>{t('settings.appearanceDesc')}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <div>
                      <Label htmlFor="theme">{t('settings.theme')}</Label>
                      <p className="text-sm text-muted-foreground">{t('settings.themeDesc')}</p>
                    </div>
                    <Select
                      value={settings.theme}
                      onValueChange={(value) => setSettings({ ...settings, theme: value })}
                    >
                      <SelectTrigger className="w-32 bg-surface-light border-border/50">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="light">{t('settings.themeLight')}</SelectItem>
                        <SelectItem value="dark">{t('settings.themeDark')}</SelectItem>
                        <SelectItem value="system">{t('settings.themeSystem')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Notifications */}
            {activeCategory === 'notifications' && (
              <Card className="bg-surface-mid border-border/50">
                <CardHeader>
                  <CardTitle className="text-lg">{t('settings.notifications')}</CardTitle>
                  <CardDescription>{t('settings.notificationsDesc')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label htmlFor="notifications">{t('settings.pushNotifications')}</Label>
                      <p className="text-sm text-muted-foreground">
                        {t('settings.pushNotificationsDesc')}
                      </p>
                    </div>
                    <Switch
                      id="notifications"
                      checked={settings.notifications}
                      onCheckedChange={(checked) =>
                        setSettings({ ...settings, notifications: checked })
                      }
                    />
                  </div>
                  <Separator className="bg-border/50" />
                  <div className="flex items-center justify-between">
                    <div>
                      <Label htmlFor="emailUpdates">{t('settings.emailNotifications')}</Label>
                      <p className="text-sm text-muted-foreground">
                        {t('settings.emailNotificationsDesc')}
                      </p>
                    </div>
                    <Switch
                      id="emailUpdates"
                      checked={settings.emailUpdates}
                      onCheckedChange={(checked) =>
                        setSettings({ ...settings, emailUpdates: checked })
                      }
                    />
                  </div>
                </CardContent>
              </Card>
            )}

            {/* YouTube */}
            {activeCategory === 'youtube' && <YouTubeSyncCard />}

            {/* Data & Privacy */}
            {activeCategory === 'data' && (
              <Card className="bg-surface-mid border-border/50">
                <CardHeader>
                  <CardTitle className="text-lg">{t('settings.dataPrivacy')}</CardTitle>
                  <CardDescription>{t('settings.dataPrivacyDesc')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-destructive">{t('settings.deleteAllData')}</Label>
                      <p className="text-sm text-muted-foreground">{t('settings.deleteAllDataDesc')}</p>
                    </div>
                    <AlertDialog>
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
                        <AlertDialogFooter>
                          <AlertDialogCancel className="bg-surface-light border-border/50">
                            {t('common.cancel')}
                          </AlertDialogCancel>
                          <AlertDialogAction
                            onClick={handleDeleteData}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            {t('common.delete')}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </CardContent>
              </Card>
            )}

            <Button onClick={handleSave} className="w-full md:w-auto">
              {t('settings.saveSettings')}
            </Button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
