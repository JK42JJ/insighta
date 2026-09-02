/**
 * Admin — the channels a brief reads, and the ones nothing reads.
 *
 * Two lists on one screen because they are the same decision seen from either
 * side, and because the blocklist has had a working API since 2026-07 with no
 * page to drive it: every entry so far was added by curl.
 *
 * Trust is scoped to the newsletter. Nothing here changes video-discover,
 * curation, or the Redis whitelist, and trust does not exempt a video from the
 * format gate or cross-validation — it only means the channel is collected
 * every week instead of waiting for a query to happen to match it.
 *
 * A channel is added by pasting whatever you have. The server resolves it and
 * refuses what it cannot find, so the list never holds an id that points
 * nowhere.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient, type TrustedChannel, type BlocklistEntry } from '@/shared/lib/api-client';
import { cn } from '@/shared/lib/utils';

const CATEGORIES = [
  { key: 'ai-tech', label: 'AI · 기술' },
  { key: 'career', label: '취업 · 커리어' },
  { key: 'english', label: '영어' },
  { key: 'investing', label: '투자 · 경제' },
  { key: 'shopping', label: '쇼핑' },
  { key: 'productivity', label: '생산성' },
  { key: 'dev', label: '개발' },
  { key: 'health', label: '건강' },
  { key: 'startup', label: '창업' },
  { key: 'news-trend', label: '뉴스 · 트렌드' },
] as const;

function TrustedList({ category }: { category: string }) {
  const qc = useQueryClient();
  const [ref, setRef] = useState('');
  const [reason, setReason] = useState('');
  const [tier, setTier] = useState<'core' | 'watch'>('core');
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'trusted-channels', category],
    queryFn: () => apiClient.listTrustedChannels(category),
    staleTime: 10_000,
  });

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ['admin', 'trusted-channels', category] });

  const add = useMutation({
    mutationFn: () =>
      apiClient.addTrustedChannel({
        ref: ref.trim(),
        categoryKey: category,
        tier,
        reason: reason.trim(),
      }),
    onSuccess: () => {
      setRef('');
      setReason('');
      setError(null);
      void invalidate();
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : '추가하지 못했습니다'),
  });

  const patch = useMutation({
    mutationFn: (v: { id: string; body: Parameters<typeof apiClient.updateTrustedChannel>[1] }) =>
      apiClient.updateTrustedChannel(v.id, v.body),
    onSuccess: () => void invalidate(),
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiClient.deleteTrustedChannel(id),
    onSuccess: () => void invalidate(),
  });

  const entries: TrustedChannel[] = data?.data.entries ?? [];
  const canAdd = ref.trim().length > 1 && reason.trim().length > 2 && !add.isPending;

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-baseline gap-2 mb-1">
        <span className="text-sm font-medium">신뢰 채널</span>
        <span className="text-xs text-muted-foreground">
          매주 전수 수집합니다. 검색이 놓쳐도 빠지지 않습니다.
        </span>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        신뢰는 <span className="text-foreground">수집 대상</span>을 정할 뿐, 형식 게이트와
        교차검증은 똑같이 거칩니다. 차단 목록에 있으면 차단이 이깁니다.
      </p>

      <div className="flex flex-col gap-2 mb-4">
        <div className="flex gap-2">
          <input
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            placeholder="youtube.com/@handle · @handle · UC..."
            className="flex-1 px-3 py-1.5 rounded-md border border-border bg-background text-sm font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <select
            value={tier}
            onChange={(e) => setTier(e.target.value as 'core' | 'watch')}
            className="px-2 py-1.5 rounded-md border border-border bg-background text-sm"
          >
            <option value="core">core</option>
            <option value="watch">watch</option>
          </select>
        </div>
        <div className="flex gap-2">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="왜 신뢰하는가 — 나중에 이 줄만 보고 판단하게 됩니다"
            className="flex-1 px-3 py-1.5 rounded-md border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <button
            onClick={() => add.mutate()}
            disabled={!canAdd}
            className={cn(
              'px-4 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap',
              canAdd
                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                : 'bg-muted text-muted-foreground cursor-not-allowed'
            )}
          >
            {add.isPending ? '확인 중…' : '추가'}
          </button>
        </div>
        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>

      {isLoading ? (
        <p className="text-xs text-muted-foreground">불러오는 중…</p>
      ) : entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          아직 없습니다. 채널을 붙여넣으면 서버가 실재를 확인한 뒤 등록합니다.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left text-xs font-medium text-muted-foreground px-2 py-2">
                  채널
                </th>
                <th className="text-left text-xs font-medium text-muted-foreground px-2 py-2">
                  tier
                </th>
                <th className="text-left text-xs font-medium text-muted-foreground px-2 py-2">
                  사유
                </th>
                <th className="text-left text-xs font-medium text-muted-foreground px-2 py-2">
                  최근수집
                </th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr
                  key={e.id}
                  className={cn(
                    'border-b border-border last:border-0 hover:bg-muted/20',
                    !e.is_active && 'opacity-45'
                  )}
                >
                  <td className="px-2 py-2">
                    <a
                      href={`https://www.youtube.com/channel/${e.channel_id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-foreground hover:underline"
                    >
                      {e.channel_title ?? e.channel_id}
                    </a>
                    <span className="block text-[10px] text-muted-foreground font-mono">
                      {e.channel_id}
                    </span>
                  </td>
                  <td className="px-2 py-2">
                    <select
                      value={e.tier}
                      onChange={(ev) =>
                        patch.mutate({
                          id: e.id,
                          body: { tier: ev.target.value as 'core' | 'watch' },
                        })
                      }
                      className="px-1.5 py-0.5 rounded border border-border bg-background text-xs font-mono"
                    >
                      <option value="core">core</option>
                      <option value="watch">watch</option>
                    </select>
                  </td>
                  <td className="px-2 py-2 text-muted-foreground max-w-md">{e.reason}</td>
                  <td className="px-2 py-2 text-xs text-muted-foreground font-mono">
                    {e.last_seen_at ? new Date(e.last_seen_at).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-2 py-2 text-right whitespace-nowrap">
                    <button
                      onClick={() => patch.mutate({ id: e.id, body: { isActive: !e.is_active } })}
                      className="text-xs text-muted-foreground hover:text-foreground mr-3"
                    >
                      {e.is_active ? '보류' : '재개'}
                    </button>
                    <button
                      onClick={() => remove.mutate(e.id)}
                      className="text-xs text-muted-foreground hover:text-red-500"
                    >
                      삭제
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function BlockedList() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'channel-blocklist'],
    queryFn: () => apiClient.listChannelBlocklist(),
    staleTime: 30_000,
  });

  const entries = data?.entries ?? [];

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-baseline gap-2 mb-4">
        <span className="text-sm font-medium">차단 채널</span>
        <span className="text-xs text-muted-foreground">
          모든 표면에서 제외됩니다. 신뢰 목록에 있어도 차단이 이깁니다.
        </span>
      </div>
      {isLoading ? (
        <p className="text-xs text-muted-foreground">불러오는 중…</p>
      ) : entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">비어 있습니다.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left text-xs font-medium text-muted-foreground px-2 py-2">
                  채널
                </th>
                <th className="text-left text-xs font-medium text-muted-foreground px-2 py-2">
                  사유
                </th>
                <th className="text-left text-xs font-medium text-muted-foreground px-2 py-2">
                  등록
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-b border-border last:border-0 hover:bg-muted/20">
                  <td className="px-2 py-2">
                    {e.channel_name ?? '—'}
                    {e.channel_id && (
                      <span className="block text-[10px] text-muted-foreground font-mono">
                        {e.channel_id}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-muted-foreground">{e.reason}</td>
                  <td className="px-2 py-2 text-xs text-muted-foreground font-mono">
                    {new Date(e.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function AdminChannels() {
  const [category, setCategory] = useState<string>('ai-tech');

  return (
    <div className="p-6 flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">채널</h1>
        <p className="text-sm text-muted-foreground mt-1">
          브리프가 매주 읽을 채널과, 아무것도 읽지 않을 채널.
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {CATEGORIES.map((c) => (
          <button
            key={c.key}
            onClick={() => setCategory(c.key)}
            className={cn(
              'px-3 py-1 rounded-md text-xs font-medium transition-colors border',
              category === c.key
                ? 'border-primary bg-primary/10 text-foreground'
                : 'border-border text-muted-foreground hover:text-foreground'
            )}
          >
            {c.label}
          </button>
        ))}
      </div>

      <TrustedList category={category} />
      <BlockedList />
    </div>
  );
}
