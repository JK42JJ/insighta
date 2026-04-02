import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/features/auth/model/useAuth';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { Textarea } from '@/shared/ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from '@/shared/ui/avatar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { Camera, Save, BarChart3, Calendar, Layers } from 'lucide-react';
import { toast } from '@/shared/lib/use-toast';

export function ProfileSettingsTab() {
  const { t } = useTranslation();
  const { userName, userEmail, userAvatar } = useAuth();

  const [profile, setProfile] = useState({
    name: userName || t('profile.defaultName'),
    email: userEmail || '',
    bio: '',
    avatarUrl: userAvatar || '',
  });

  const handleSave = () => {
    localStorage.setItem('user-profile', JSON.stringify(profile));
    toast({
      title: t('common.saved'),
      description: t('profile.savedDesc'),
    });
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-6">
        <Card className="bg-surface-mid border-border/50">
          <CardHeader>
            <CardTitle>{t('profile.personalInfo', 'Personal Information')}</CardTitle>
            <CardDescription>{t('profile.subtitle')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center gap-6">
              <div className="relative">
                <Avatar className="w-20 h-20 border-4 border-primary/20">
                  <AvatarImage src={profile.avatarUrl} alt={profile.name} />
                  <AvatarFallback className="bg-primary/10 text-primary text-xl font-medium">
                    {profile.name.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <button
                  className="absolute bottom-0 right-0 w-7 h-7 rounded-full bg-primary flex items-center justify-center hover:bg-primary/90 transition-colors"
                  aria-label={t('profile.changeAvatar')}
                >
                  <Camera className="w-3.5 h-3.5 text-primary-foreground" />
                </button>
              </div>
              <div>
                <h3 className="font-medium text-foreground">{profile.name}</h3>
                <p className="text-sm text-muted-foreground">{profile.email}</p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="name">{t('profile.name')}</Label>
                  <Input
                    id="name"
                    value={profile.name}
                    onChange={(e) => setProfile({ ...profile, name: e.target.value })}
                    placeholder={t('profile.namePlaceholder')}
                    className="bg-surface-light border-border/50"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">{t('profile.email')}</Label>
                  <Input
                    id="email"
                    type="email"
                    value={profile.email}
                    onChange={(e) => setProfile({ ...profile, email: e.target.value })}
                    placeholder={t('profile.emailPlaceholder')}
                    className="bg-surface-light border-border/50"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="bio">{t('profile.bio')}</Label>
                <Textarea
                  id="bio"
                  value={profile.bio}
                  onChange={(e) => setProfile({ ...profile, bio: e.target.value })}
                  placeholder={t('profile.bioPlaceholder')}
                  className="bg-surface-light border-border/50 min-h-[100px]"
                />
              </div>
            </div>

            <Button onClick={handleSave} className="gap-2">
              <Save className="w-4 h-4" />
              {t('profile.saveProfile')}
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6">
        <Card className="bg-surface-mid border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t('profile.activity', 'Activity')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                <Layers className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">
                  {t('profile.totalMandalas', 'Total Mandalas')}
                </p>
                <p className="text-xs text-muted-foreground">-</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                <BarChart3 className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">
                  {t('profile.totalCards', 'Total Cards')}
                </p>
                <p className="text-xs text-muted-foreground">-</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                <Calendar className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">
                  {t('profile.memberSince', 'Member Since')}
                </p>
                <p className="text-xs text-muted-foreground">-</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
