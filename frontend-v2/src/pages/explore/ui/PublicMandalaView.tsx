import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Globe, Bell, BellOff, Loader2, Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';
import { apiClient } from '@/shared/lib/api-client';
import type { MandalaResponse } from '@/shared/lib/api-client';

interface Activity {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: unknown;
  createdAt: string;
}

const GRID_ORDER = [0, 1, 2, 3, -1, 4, 5, 6, 7];

export function PublicMandalaView({ slug }: { slug: string }) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [mandala, setMandala] = useState<MandalaResponse | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [subscribed, setSubscribed] = useState(false);
  const [subscribing, setSubscribing] = useState(false);
  const isAuthenticated = apiClient.isAuthenticated();

  useEffect(() => {
    const fetch = async () => {
      setLoading(true);
      try {
        const result = await apiClient.getPublicMandala(slug);
        setMandala(result.mandala);

        const activityResult = await apiClient.getMandalaActivity(result.mandala.id, 1, 20);
        setActivities(activityResult.activities);

        if (isAuthenticated) {
          try {
            const subs = await apiClient.listSubscriptions(1, 100);
            setSubscribed(subs.subscriptions.some((s) => s.mandalaId === result.mandala.id));
          } catch {
            // not logged in or error
          }
        }
      } catch {
        setMandala(null);
      } finally {
        setLoading(false);
      }
    };
    fetch();
  }, [slug, isAuthenticated]);

  const handleSubscribe = async () => {
    if (!mandala || subscribing) return;
    setSubscribing(true);
    try {
      if (subscribed) {
        await apiClient.unsubscribeMandala(mandala.id);
        setSubscribed(false);
      } else {
        await apiClient.subscribeMandala(mandala.id);
        setSubscribed(true);
      }
    } catch {
      // ignore
    } finally {
      setSubscribing(false);
    }
  };

  const rootLevel = mandala?.levels.find((l) => l.depth === 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!mandala) {
    return (
      <div className="text-center py-20">
        <Globe className="w-12 h-12 mx-auto text-muted-foreground/50 mb-4" />
        <h2 className="text-lg font-semibold text-foreground mb-2">
          {t('explore.notFound')}
        </h2>
        <Button variant="outline" onClick={() => navigate('/explore')} className="mt-4">
          {t('explore.backToExplore')}
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-base">
      <header className="sticky top-0 z-50 bg-surface-mid/95 backdrop-blur-md border-b border-border/50">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate('/explore')}
              className="rounded-lg"
              aria-label={t('common.back')}
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div>
              <h1 className="text-xl font-bold text-foreground">{mandala.title}</h1>
              <p className="text-sm text-muted-foreground">
                {t('explore.readOnly')}
              </p>
            </div>
          </div>
          {isAuthenticated && (
            <Button
              variant={subscribed ? 'outline' : 'default'}
              size="sm"
              onClick={handleSubscribe}
              disabled={subscribing}
              className="gap-2"
            >
              {subscribed ? (
                <>
                  <BellOff className="w-4 h-4" />
                  {t('explore.unsubscribe')}
                </>
              ) : (
                <>
                  <Bell className="w-4 h-4" />
                  {t('explore.subscribe')}
                </>
              )}
            </Button>
          )}
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="grid lg:grid-cols-3 gap-8">
          {/* Mandala Grid (read-only) */}
          <div className="lg:col-span-2">
            {rootLevel && (
              <div className="grid grid-cols-3 gap-2 max-w-lg mx-auto aspect-square">
                {GRID_ORDER.map((subjectIdx, gridIdx) => {
                  const isCenter = subjectIdx === -1;
                  if (isCenter) {
                    return (
                      <div
                        key="center"
                        className="bg-primary/20 border-2 border-primary rounded-lg flex items-center justify-center p-3"
                      >
                        <span className="text-sm font-semibold text-center text-foreground">
                          {rootLevel.centerGoal}
                        </span>
                      </div>
                    );
                  }
                  const subject = rootLevel.subjects[subjectIdx] || '';
                  return (
                    <div
                      key={gridIdx}
                      className="bg-surface-mid border border-border/50 rounded-lg flex items-center justify-center p-3"
                    >
                      <span className="text-xs text-center text-foreground/80">
                        {subject || '-'}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Activity Feed */}
          <div>
            <h2 className="text-lg font-semibold text-foreground mb-4">
              {t('explore.recentActivity')}
            </h2>
            {activities.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('explore.noActivity')}</p>
            ) : (
              <div className="space-y-3">
                {activities.map((activity) => (
                  <Card key={activity.id} className="bg-surface-mid border-border/30">
                    <CardContent className="p-3">
                      <div className="flex items-start gap-2">
                        <Clock className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                        <div className="min-w-0">
                          <p className="text-sm text-foreground">
                            {activity.action.replace(/_/g, ' ')}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(activity.createdAt).toLocaleString()}
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
