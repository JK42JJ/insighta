import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { Separator } from '@/shared/ui/separator';
import { Badge } from '@/shared/ui/badge';
import { toast } from '@/shared/lib/use-toast';
import { apiClient } from '@/shared/lib/api-client';
import { Loader2, Trash2, Save, Key, Eye, EyeOff } from 'lucide-react';

interface LlmKeyEntry {
  provider: string;
  status: string;
  maskedKey: string;
  updatedAt: string;
}

const PROVIDERS = [
  { id: 'openrouter', label: 'OpenRouter', placeholder: 'sk-or-v1-...' },
  { id: 'gemini', label: 'Google Gemini', placeholder: 'AIzaSy...' },
  { id: 'openai', label: 'OpenAI', placeholder: 'sk-...' },
  { id: 'anthropic', label: 'Anthropic', placeholder: 'sk-ant-...' },
  { id: 'perplexity', label: 'Perplexity', placeholder: 'pplx-...' },
] as const;

export function LlmKeysSettingsTab() {
  const { t } = useTranslation();
  const [savedKeys, setSavedKeys] = useState<LlmKeyEntry[]>([]);
  const [inputValues, setInputValues] = useState<Record<string, string>>({});
  const [visibleInputs, setVisibleInputs] = useState<Record<string, boolean>>({});
  const [loadingProvider, setLoadingProvider] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchKeys = useCallback(async () => {
    try {
      const res = await apiClient.getLlmKeys();
      setSavedKeys(res.data);
    } catch {
      // Silent fail on load — user will see empty state
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  const getSavedKey = (providerId: string) => savedKeys.find((k) => k.provider === providerId);

  const handleSave = async (providerId: string) => {
    const apiKey = inputValues[providerId]?.trim();
    if (!apiKey) return;

    setLoadingProvider(providerId);
    try {
      await apiClient.saveLlmKey(providerId, apiKey);
      toast({
        title: t('settings.llmKeys.saved'),
        description: t('settings.llmKeys.savedDesc', { provider: providerId }),
      });
      setInputValues((prev) => ({ ...prev, [providerId]: '' }));
      setVisibleInputs((prev) => ({ ...prev, [providerId]: false }));
      await fetchKeys();
    } catch {
      toast({
        title: t('settings.llmKeys.error'),
        description: t('settings.llmKeys.saveError'),
        variant: 'destructive',
      });
    } finally {
      setLoadingProvider(null);
    }
  };

  const handleDelete = async (providerId: string) => {
    setLoadingProvider(providerId);
    try {
      await apiClient.deleteLlmKey(providerId);
      toast({
        title: t('settings.llmKeys.deleted'),
        description: t('settings.llmKeys.deletedDesc', { provider: providerId }),
      });
      await fetchKeys();
    } catch {
      toast({
        title: t('settings.llmKeys.error'),
        description: t('settings.llmKeys.deleteError'),
        variant: 'destructive',
      });
    } finally {
      setLoadingProvider(null);
    }
  };

  const toggleInputVisibility = (providerId: string) => {
    setVisibleInputs((prev) => ({ ...prev, [providerId]: !prev[providerId] }));
  };

  if (isLoading) {
    return (
      <Card className="bg-surface-mid border-border/50">
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-surface-mid border-border/50">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Key className="w-5 h-5" />
          {t('settings.llmKeys.title')}
        </CardTitle>
        <CardDescription>{t('settings.llmKeys.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {PROVIDERS.map(({ id, label, placeholder }, index) => {
          const saved = getSavedKey(id);
          const isProviderLoading = loadingProvider === id;
          const inputValue = inputValues[id] || '';
          const isVisible = visibleInputs[id] || false;

          return (
            <div key={id}>
              {index > 0 && <Separator className="bg-border/50 mb-4" />}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">{label}</Label>
                  {saved && (
                    <Badge variant="outline" className="text-xs">
                      {saved.maskedKey}
                    </Badge>
                  )}
                </div>

                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      type={isVisible ? 'text' : 'password'}
                      placeholder={saved ? t('settings.llmKeys.updateKey') : placeholder}
                      value={inputValue}
                      onChange={(e) =>
                        setInputValues((prev) => ({ ...prev, [id]: e.target.value }))
                      }
                      className="bg-surface-light border-border/50 pr-10"
                      disabled={isProviderLoading}
                    />
                    <button
                      type="button"
                      onClick={() => toggleInputVisibility(id)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {isVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>

                  <Button
                    size="sm"
                    onClick={() => handleSave(id)}
                    disabled={!inputValue.trim() || isProviderLoading}
                    className="gap-1"
                  >
                    {isProviderLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Save className="w-4 h-4" />
                    )}
                    {t('common.save')}
                  </Button>

                  {saved && (
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => handleDelete(id)}
                      disabled={isProviderLoading}
                      className="gap-1"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
