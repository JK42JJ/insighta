import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Globe, Users, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';
import { apiClient } from '@/shared/lib/api-client';

interface PublicMandala {
  id: string;
  userId: string;
  title: string;
  isPublic: boolean;
  shareSlug: string | null;
  createdAt: string;
  updatedAt: string;
  levels: Array<{
    id: string;
    levelKey: string;
    centerGoal: string;
    subjects: string[];
    position: number;
    depth: number;
  }>;
}

export default function ExplorePage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [mandalas, setMandalas] = useState<PublicMandala[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const limit = 12;

  useEffect(() => {
    const fetchMandalas = async () => {
      setLoading(true);
      try {
        const result = await apiClient.listPublicMandalas(page, limit);
        setMandalas(result.mandalas as unknown as PublicMandala[]);
        setTotal(result.total);
      } catch {
        // silently fail for now
      } finally {
        setLoading(false);
      }
    };
    fetchMandalas();
  }, [page]);

  const totalPages = Math.ceil(total / limit);

  const getRootLevel = (mandala: PublicMandala) => {
    return mandala.levels.find((l) => l.depth === 0);
  };

  return (
    <div className="min-h-screen bg-surface-base">
      <header className="sticky top-0 z-50 bg-surface-mid/95 backdrop-blur-md border-b border-border/50">
        <div className="container mx-auto px-4 py-3 flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate('/')}
            className="rounded-lg"
            aria-label={t('common.back')}
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex items-center gap-2">
            <Globe className="w-5 h-5 text-primary" />
            <h1 className="text-xl font-bold text-foreground">{t('explore.title')}</h1>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : mandalas.length === 0 ? (
          <div className="text-center py-20">
            <Globe className="w-12 h-12 mx-auto text-muted-foreground/50 mb-4" />
            <h2 className="text-lg font-semibold text-foreground mb-2">
              {t('explore.empty')}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t('explore.emptyDesc')}
            </p>
          </div>
        ) : (
          <>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {mandalas.map((mandala) => {
                const root = getRootLevel(mandala);
                return (
                  <Card
                    key={mandala.id}
                    className="bg-surface-mid border-border/50 hover:border-primary/50 transition-all cursor-pointer group"
                    onClick={() =>
                      mandala.shareSlug && navigate(`/explore/${mandala.shareSlug}`)
                    }
                  >
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base group-hover:text-primary transition-colors truncate">
                        {mandala.title}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {root && (
                        <>
                          <p className="text-sm font-medium text-foreground/80 mb-2">
                            {root.centerGoal}
                          </p>
                          <div className="flex flex-wrap gap-1">
                            {root.subjects.slice(0, 4).map((s, i) => (
                              <span
                                key={i}
                                className="text-xs px-2 py-0.5 bg-surface-light rounded-full text-muted-foreground"
                              >
                                {s}
                              </span>
                            ))}
                            {root.subjects.length > 4 && (
                              <span className="text-xs px-2 py-0.5 text-muted-foreground">
                                +{root.subjects.length - 4}
                              </span>
                            )}
                          </div>
                        </>
                      )}
                      <div className="flex items-center gap-1 mt-3 text-xs text-muted-foreground">
                        <Users className="w-3 h-3" />
                        <span>
                          {new Date(mandala.updatedAt).toLocaleDateString()}
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {totalPages > 1 && (
              <div className="flex justify-center gap-2 mt-8">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                >
                  {t('common.previous')}
                </Button>
                <span className="flex items-center px-3 text-sm text-muted-foreground">
                  {page} / {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                >
                  {t('common.next')}
                </Button>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
