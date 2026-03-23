import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { Badge } from '@/shared/ui/badge';
import { Switch } from '@/shared/ui/switch';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/shared/ui/collapsible';
import { toast } from '@/shared/lib/use-toast';
import { apiClient } from '@/shared/lib/api-client';
import { Loader2, Trash2, Save, Key, Eye, EyeOff, GripVertical, ChevronDown } from 'lucide-react';
import { cn } from '@/shared/lib/utils';

interface LlmKeyEntry {
  provider: string;
  status: string;
  priority: number;
  maskedKey: string;
  updatedAt: string;
}

interface ProviderItem {
  id: string;
  label: string;
  placeholder: string;
  saved?: LlmKeyEntry;
}

const PROVIDER_DEFS = [
  { id: 'openrouter', label: 'OpenRouter', placeholder: 'sk-or-v1-...' },
  { id: 'gemini', label: 'Google Gemini', placeholder: 'AIzaSy...' },
  { id: 'openai', label: 'OpenAI', placeholder: 'sk-...' },
  { id: 'anthropic', label: 'Anthropic', placeholder: 'sk-ant-...' },
  { id: 'perplexity', label: 'Perplexity', placeholder: 'pplx-...' },
] as const;

function SortableProviderRow({
  item,
  activePosition,
  inputValue,
  isVisible,
  isLoading,
  onInputChange,
  onToggleVisibility,
  onSave,
  onDelete,
  onToggleActive,
}: {
  item: ProviderItem;
  activePosition: number | null;
  inputValue: string;
  isVisible: boolean;
  isLoading: boolean;
  onInputChange: (value: string) => void;
  onToggleVisibility: () => void;
  onSave: () => void;
  onDelete: () => void;
  onToggleActive: (checked: boolean) => void;
}) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const isActive = item.saved?.status === 'active';
  const hasSavedKey = !!item.saved;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex items-start gap-3 rounded-lg border border-border/50 bg-surface-light/50 p-3 transition-shadow',
        isDragging && 'z-10 shadow-lg opacity-80'
      )}
    >
      <button
        {...attributes}
        {...listeners}
        className="mt-2 cursor-grab touch-none text-muted-foreground hover:text-foreground active:cursor-grabbing"
      >
        <GripVertical className="w-4 h-4" />
      </button>

      <div className="mt-1.5">
        <Switch
          checked={isActive}
          onCheckedChange={onToggleActive}
          disabled={!hasSavedKey}
          className="scale-75"
        />
      </div>

      <div className="w-6 mt-2 text-center">
        {activePosition != null ? (
          <Badge variant="default" className="text-xs px-1.5 py-0">
            {activePosition}
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">&mdash;</span>
        )}
      </div>

      <div className="flex-1 space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">{item.label}</Label>
          {item.saved && (
            <Badge variant="outline" className="text-xs">
              {item.saved.maskedKey}
            </Badge>
          )}
        </div>

        <div className="flex gap-2">
          <div className="relative flex-1">
            <Input
              type={isVisible ? 'text' : 'password'}
              placeholder={hasSavedKey ? t('settings.llmKeys.updateKey') : item.placeholder}
              value={inputValue}
              onChange={(e) => onInputChange(e.target.value)}
              className="bg-surface-light border-border/50 pr-10 h-8 text-sm"
              disabled={isLoading}
            />
            <button
              type="button"
              onClick={onToggleVisibility}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {isVisible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </div>

          <Button
            size="sm"
            onClick={onSave}
            disabled={!inputValue.trim() || isLoading}
            className="gap-1 h-8"
          >
            {isLoading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            {t('common.save')}
          </Button>

          {hasSavedKey && (
            <Button
              size="sm"
              variant="destructive"
              onClick={onDelete}
              disabled={isLoading}
              className="gap-1 h-8"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export function LlmKeysSettingsTab() {
  const { t } = useTranslation();
  const [savedKeys, setSavedKeys] = useState<LlmKeyEntry[]>([]);
  const [providerOrder, setProviderOrder] = useState<string[]>(PROVIDER_DEFS.map((p) => p.id));
  const [inputValues, setInputValues] = useState<Record<string, string>>({});
  const [visibleInputs, setVisibleInputs] = useState<Record<string, boolean>>({});
  const [loadingProvider, setLoadingProvider] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  );

  const fetchKeys = useCallback(async () => {
    try {
      const res = await apiClient.getLlmKeys();
      setSavedKeys(res.data);

      const savedProviders = res.data
        .sort((a: LlmKeyEntry, b: LlmKeyEntry) => a.priority - b.priority)
        .map((k: LlmKeyEntry) => k.provider);
      const unsavedProviders = PROVIDER_DEFS.map((p) => p.id).filter(
        (id) => !savedProviders.includes(id)
      );
      setProviderOrder([...savedProviders, ...unsavedProviders]);
    } catch {
      // Silent fail
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  const providerItems: ProviderItem[] = useMemo(() => {
    return providerOrder.map((id) => {
      const def = PROVIDER_DEFS.find((p) => p.id === id)!;
      const saved = savedKeys.find((k) => k.provider === id);
      return { ...def, saved };
    });
  }, [providerOrder, savedKeys]);

  const activePositions = useMemo(() => {
    const positions: Record<string, number> = {};
    let count = 0;
    for (const id of providerOrder) {
      const saved = savedKeys.find((k) => k.provider === id);
      if (saved?.status === 'active') {
        count++;
        positions[id] = count;
      }
    }
    return positions;
  }, [providerOrder, savedKeys]);

  const savePriorities = useCallback(
    async (newOrder: string[], updatedKeys?: LlmKeyEntry[]) => {
      const keys = updatedKeys || savedKeys;
      const items = newOrder
        .map((id, index) => {
          const saved = keys.find((k) => k.provider === id);
          if (!saved) return null;
          return { provider: id, priority: index, status: saved.status };
        })
        .filter(Boolean) as { provider: string; priority: number; status: string }[];

      if (items.length > 0) {
        try {
          await apiClient.updateLlmKeyPriorities(items);
        } catch {
          toast({
            title: t('settings.llmKeys.error'),
            description: t('settings.llmKeys.priorityError'),
            variant: 'destructive',
          });
        }
      }
    },
    [savedKeys, t]
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIndex = providerOrder.indexOf(active.id as string);
      const newIndex = providerOrder.indexOf(over.id as string);
      const newOrder = arrayMove(providerOrder, oldIndex, newIndex);
      setProviderOrder(newOrder);
      savePriorities(newOrder);
    },
    [providerOrder, savePriorities]
  );

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

  const handleToggleActive = useCallback(
    async (providerId: string, checked: boolean) => {
      const newStatus = checked ? 'active' : 'inactive';
      const updatedKeys = savedKeys.map((k) =>
        k.provider === providerId ? { ...k, status: newStatus } : k
      );
      setSavedKeys(updatedKeys);
      await savePriorities(providerOrder, updatedKeys);
    },
    [savedKeys, providerOrder, savePriorities]
  );

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
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card className="bg-surface-mid border-border/50">
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-surface-light/30 transition-colors">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Key className="w-5 h-5" />
                <CardTitle className="text-lg">{t('settings.llmKeys.title')}</CardTitle>
                <Badge variant="secondary" className="text-xs">
                  {t('settings.llmKeys.advanced')}
                </Badge>
              </div>
              <ChevronDown
                className={cn(
                  'w-5 h-5 text-muted-foreground transition-transform',
                  isOpen && 'rotate-180'
                )}
              />
            </div>
            <CardDescription>{t('settings.llmKeys.description')}</CardDescription>
          </CardHeader>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <CardContent className="space-y-3 pt-0">
            <p className="text-xs text-muted-foreground">{t('settings.llmKeys.dragHint')}</p>

            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext items={providerOrder} strategy={verticalListSortingStrategy}>
                <div className="space-y-2">
                  {providerItems.map((item) => (
                    <SortableProviderRow
                      key={item.id}
                      item={item}
                      activePosition={activePositions[item.id] ?? null}
                      inputValue={inputValues[item.id] || ''}
                      isVisible={visibleInputs[item.id] || false}
                      isLoading={loadingProvider === item.id}
                      onInputChange={(value) =>
                        setInputValues((prev) => ({ ...prev, [item.id]: value }))
                      }
                      onToggleVisibility={() =>
                        setVisibleInputs((prev) => ({ ...prev, [item.id]: !prev[item.id] }))
                      }
                      onSave={() => handleSave(item.id)}
                      onDelete={() => handleDelete(item.id)}
                      onToggleActive={(checked) => handleToggleActive(item.id, checked as boolean)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
