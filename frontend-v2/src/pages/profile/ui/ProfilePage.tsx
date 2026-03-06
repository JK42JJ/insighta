import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Header } from '@/widgets/header/ui/Header';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { Textarea } from '@/shared/ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from '@/shared/ui/avatar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { Camera, Save, ArrowLeft } from 'lucide-react';
import { toast } from '@/shared/lib/use-toast';

export default function ProfilePage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [profile, setProfile] = useState({
    name: t('profile.defaultName'),
    email: 'user@example.com',
    bio: '',
    avatarUrl: '',
  });

  const handleSave = () => {
    localStorage.setItem('user-profile', JSON.stringify(profile));
    toast({
      title: t('common.saved'),
      description: t('profile.savedDesc'),
    });
  };

  return (
    <div className="min-h-screen bg-background">
      <Header onNavigateHome={() => navigate('/')} />

      <main className="container mx-auto px-4 py-8 max-w-2xl">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="mb-6 gap-2">
          <ArrowLeft className="w-4 h-4" />
          {t('common.back')}
        </Button>

        <Card className="bg-surface-mid border-border/50">
          <CardHeader>
            <CardTitle className="text-2xl">{t('profile.title')}</CardTitle>
            <CardDescription>{t('profile.subtitle')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Avatar Section */}
            <div className="flex items-center gap-6">
              <div className="relative">
                <Avatar className="w-24 h-24 border-4 border-primary/20">
                  <AvatarImage src={profile.avatarUrl} alt={profile.name} />
                  <AvatarFallback className="bg-primary/10 text-primary text-2xl font-medium">
                    {profile.name.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <button
                  className="absolute bottom-0 right-0 w-8 h-8 rounded-full bg-primary flex items-center justify-center hover:bg-primary/90 transition-colors"
                  aria-label={t('profile.changeAvatar')}
                >
                  <Camera className="w-4 h-4 text-primary-foreground" />
                </button>
              </div>
              <div>
                <h3 className="font-medium text-foreground">{profile.name}</h3>
                <p className="text-sm text-muted-foreground">{profile.email}</p>
              </div>
            </div>

            {/* Form Fields */}
            <div className="space-y-4">
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

            <Button onClick={handleSave} className="w-full gap-2">
              <Save className="w-4 h-4" />
              {t('profile.saveProfile')}
            </Button>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
