import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Header } from '@/widgets/header/ui/Header';
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
import { ArrowLeft, Bell, Globe, Palette, Shield, Trash2 } from 'lucide-react';
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

export default function SettingsPage() {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
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
    <div className="min-h-screen bg-background">
      <Header onNavigateHome={() => navigate('/')} />

      <main id="main-content" className="container mx-auto px-4 py-8 max-w-2xl">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="mb-6 gap-2">
          <ArrowLeft className="w-4 h-4" />
          {t('common.back')}
        </Button>

        <h1 className="text-3xl font-bold text-foreground mb-8">{t('settings.title')}</h1>

        <div className="space-y-6">
          {/* YouTube Sync */}
          <YouTubeSyncCard />

          {/* Notifications */}
          <Card className="bg-surface-mid border-border/50">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Bell className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-lg">{t('settings.notifications')}</CardTitle>
                  <CardDescription>{t('settings.notificationsDesc')}</CardDescription>
                </div>
              </div>
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
                  onCheckedChange={(checked) => setSettings({ ...settings, emailUpdates: checked })}
                />
              </div>
            </CardContent>
          </Card>

          {/* Appearance */}
          <Card className="bg-surface-mid border-border/50">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Palette className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-lg">{t('settings.appearance')}</CardTitle>
                  <CardDescription>{t('settings.appearanceDesc')}</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
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

          {/* Language */}
          <Card className="bg-surface-mid border-border/50">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Globe className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-lg">{t('settings.language')}</CardTitle>
                  <CardDescription>{t('settings.languageDesc')}</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
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
            </CardContent>
          </Card>

          {/* Data & Privacy */}
          <Card className="bg-surface-mid border-border/50">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Shield className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-lg">{t('settings.dataPrivacy')}</CardTitle>
                  <CardDescription>{t('settings.dataPrivacyDesc')}</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
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
              <Separator className="bg-border/50" />
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

          <Button onClick={handleSave} className="w-full">
            {t('settings.saveSettings')}
          </Button>
        </div>
      </main>
    </div>
  );
}
