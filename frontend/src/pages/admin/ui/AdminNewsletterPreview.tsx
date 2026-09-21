import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { apiClient } from '@/shared/lib/api-client';

/**
 * Admin → Newsletter → the rendered page for one issue, draft included.
 *
 * A draft has no public page: the serving route filters on `published_at`, and
 * that filter is the access control. The admin route renders the same document
 * with the same template, but it is admin-only, and a browser navigation cannot
 * send an Authorization header -- so the list's `<a href>` to it answered 401
 * on every click and a draft could only be read after it shipped.
 *
 * This screen is the navigation target instead. It is a real URL, so it
 * reloads, bookmarks and opens in a new tab, and the credential stays in a
 * fetch header where it belongs. The page arrives as HTML and is handed to a
 * frame through a blob URL rather than `srcdoc`: no escaping of a 50 KB
 * document, and the frame gets an opaque origin of its own.
 *
 * Its own route rather than a panel inside AdminLayout: the thing under review
 * is a page, and reviewing it in a 700 px column reviews a different layout
 * than the one that ships.
 */
export function AdminNewsletterPreview() {
  const { id = '' } = useParams<{ id: string }>();
  const [frameUrl, setFrameUrl] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin', 'newsletter', 'preview', id],
    queryFn: () => apiClient.getNewsletterIssuePreview(id),
    enabled: !!id,
    // Rendered on read from the stored document, so a reload is how an editor
    // sees an edit. Nothing to gain from serving them the previous render.
    staleTime: 0,
    retry: false,
  });

  useEffect(() => {
    if (!data) return;
    const url = URL.createObjectURL(new Blob([data], { type: 'text/html;charset=utf-8' }));
    setFrameUrl(url);
    // Held by the browser until revoked, and this document can be visited many
    // times in one session.
    return () => {
      URL.revokeObjectURL(url);
      setFrameUrl(null);
    };
  }, [data]);

  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2">
        <a
          href="/admin/newsletter"
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          뉴스레터
        </a>
        <span className="text-xs text-muted-foreground">미리보기</span>
        <span className="font-mono text-xs text-muted-foreground">{id}</span>
      </header>

      {isLoading && <p className="p-4 text-sm text-muted-foreground">불러오는 중…</p>}

      {error && (
        /* The route answers text/plain with the reason: a schema failure lists
           the fields that do not match the contract. Shown verbatim -- that
           detail is what an editor needs, and it is why the preview refuses to
           half-render a broken document. */
        <pre className="m-4 overflow-auto whitespace-pre-wrap rounded border border-border bg-card p-3 text-xs text-red-400">
          {error instanceof Error ? error.message : String(error)}
        </pre>
      )}

      {frameUrl && (
        <iframe
          src={frameUrl}
          title="브리프 미리보기"
          className="min-h-0 flex-1 border-0 bg-white"
          /* The page is text, inline CSS and links that already carry
             target="_blank"; allow-popups is what lets those open. No
             allow-same-origin and no allow-scripts: the document needs
             neither, and the frame cannot reach this app either way. */
          sandbox="allow-popups allow-popups-to-escape-sandbox"
        />
      )}
    </div>
  );
}

export default AdminNewsletterPreview;
