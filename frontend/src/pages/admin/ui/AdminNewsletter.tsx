import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, FileText, Globe, Trash2 } from 'lucide-react';
import { apiClient } from '@/shared/lib/api-client';
import { toast } from '@/shared/lib/use-toast';
import { Button } from '@/shared/ui/button';

/**
 * Admin → Newsletter — register and publish weekly brief issues.
 *
 * This screen is what replaces writing an HTML file by hand. What is submitted
 * is an IssueDocument (src/modules/newsletter/issue-schema.ts), never markup:
 * the product renders the page, the mail digest and the note chapter from that
 * one document, so anything pasted as HTML would reach exactly one surface.
 *
 * The server validates and will refuse a graded claim that carries no source,
 * so a 400 here is usually a real editorial problem. Its message is shown
 * verbatim rather than replaced with "저장 실패" -- the detail is the point.
 */

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
];

const CATEGORY_LABEL = new Map(CATEGORIES.map((c) => [c.key, c.label]));

function errorMessage(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) return String((e as Error).message);
  return String(e);
}

export function AdminNewsletter() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);

  const issuesQuery = useQuery({
    queryKey: ['admin', 'newsletter', 'issues'],
    queryFn: () => apiClient.listNewsletterIssues(),
    staleTime: 0,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['admin', 'newsletter', 'issues'] });

  /**
   * Parsed here rather than server-side-only so a malformed paste is caught
   * before a request, and so the header can show which issue is in the box.
   */
  const parsed = (() => {
    if (!draft.trim()) return null;
    try {
      return JSON.parse(draft) as { slug?: string; issueLabel?: string; categoryKey?: string };
    } catch {
      return 'invalid' as const;
    }
  })();

  const save = useMutation({
    mutationFn: async ({ publish }: { publish: boolean }) => {
      const document = JSON.parse(draft);
      return editingId
        ? apiClient.updateNewsletterIssue(editingId, document, publish)
        : apiClient.createNewsletterIssue(document, publish);
    },
    onSuccess: (res, { publish }) => {
      toast({
        title: publish ? '발행했습니다' : '저장했습니다',
        description: res.data.issue.slug,
      });
      setDraft('');
      setEditingId(null);
      void invalidate();
    },
    onError: (e) =>
      toast({ title: '등록하지 못했습니다', description: errorMessage(e), variant: 'destructive' }),
  });

  const load = useMutation({
    mutationFn: (id: string) => apiClient.getNewsletterIssue(id),
    onSuccess: (res, id) => {
      setDraft(JSON.stringify(res.data.issue.content_json, null, 2));
      setEditingId(id);
    },
    onError: (e) =>
      toast({ title: '불러오지 못했습니다', description: errorMessage(e), variant: 'destructive' }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiClient.deleteNewsletterIssue(id),
    onSuccess: () => {
      toast({ title: '삭제했습니다' });
      void invalidate();
    },
    onError: (e) =>
      toast({ title: '삭제하지 못했습니다', description: errorMessage(e), variant: 'destructive' }),
  });

  const issues = issuesQuery.data?.data.issues ?? [];

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-xl font-semibold">주간 브리프</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          IssueDocument 를 등록하면 지면 · 메일 · 노트가 같은 문서에서 렌더됩니다. HTML 은 받지
          않습니다.
        </p>
      </header>

      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">
            {editingId ? '수정 중' : '새 호 등록'}
            {parsed && parsed !== 'invalid' && parsed.slug ? (
              <span className="ml-2 font-mono text-xs text-muted-foreground">{parsed.slug}</span>
            ) : null}
          </h2>
          {parsed === 'invalid' ? (
            <span className="flex items-center gap-1 text-xs text-red-400">
              <AlertTriangle className="h-3.5 w-3.5" /> JSON 이 아닙니다
            </span>
          ) : null}
        </div>

        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          spellCheck={false}
          rows={18}
          placeholder="IssueDocument JSON 을 붙여 넣으세요"
          className="w-full rounded-md border border-border bg-background p-3 font-mono text-xs leading-relaxed"
        />

        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={() => save.mutate({ publish: false })}
            disabled={!draft.trim() || parsed === 'invalid' || save.isPending}
            variant="outline"
          >
            <FileText className="mr-1.5 h-4 w-4" />
            초안으로 저장
          </Button>
          <Button
            onClick={() => save.mutate({ publish: true })}
            disabled={!draft.trim() || parsed === 'invalid' || save.isPending}
          >
            <Globe className="mr-1.5 h-4 w-4" />
            발행
          </Button>
          {editingId ? (
            <Button
              variant="ghost"
              onClick={() => {
                setDraft('');
                setEditingId(null);
              }}
            >
              취소
            </Button>
          ) : null}
          <p className="text-xs text-muted-foreground">
            초안은 슬러그를 알아도 열리지 않습니다. 발행해야 공개됩니다.
          </p>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">등록된 호</h2>
        {issuesQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">불러오는 중…</p>
        ) : issues.length === 0 ? (
          <p className="text-sm text-muted-foreground">아직 없습니다.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="py-2 font-medium">카테고리</th>
                <th className="py-2 font-medium">호</th>
                <th className="py-2 font-medium">슬러그</th>
                <th className="py-2 font-medium">템플릿</th>
                <th className="py-2 font-medium">상태</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {issues.map((it) => (
                <tr key={it.id} className="border-b border-border/50">
                  <td className="py-2">{CATEGORY_LABEL.get(it.category_key) ?? it.category_key}</td>
                  <td className="py-2 tabular-nums">{it.issue_no}</td>
                  <td className="py-2 font-mono text-xs">{it.slug}</td>
                  <td className="py-2 font-mono text-xs text-muted-foreground">
                    {it.template_version}
                  </td>
                  <td className="py-2">
                    {it.published_at ? (
                      <span className="flex items-center gap-1 text-xs text-emerald-400">
                        <Check className="h-3.5 w-3.5" />
                        {it.published_at.slice(0, 10)}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">초안</span>
                    )}
                  </td>
                  <td className="py-2 text-right">
                    <div className="flex justify-end gap-1">
                      {/* A draft has no public page — the serving route filters
                          on published_at — so it gets the admin preview, which
                          runs the same renderer and the same template. Without
                          it an issue could only be looked at after it shipped. */}
                      <a
                        href={
                          it.published_at
                            ? `/api/v1/brief/${it.slug}`
                            : `/api/v1/admin/newsletter/issues/${it.id}/preview`
                        }
                        target="_blank"
                        rel="noreferrer"
                        className="rounded px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                      >
                        {it.published_at ? '보기' : '미리보기'}
                      </a>
                      <button
                        onClick={() => load.mutate(it.id)}
                        className="rounded px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                      >
                        수정
                      </button>
                      {/* No confirm dialog: a browser dialog blocks the page, and
                          an issue is recoverable from the file it was pasted from. */}
                      <button
                        onClick={() => remove.mutate(it.id)}
                        className="rounded px-2 py-1 text-xs text-muted-foreground hover:text-red-400"
                        aria-label="삭제"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

export default AdminNewsletter;
