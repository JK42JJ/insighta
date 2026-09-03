/**
 * A published brief, read in the note surface.
 *
 * The standalone page the API renders is a review surface — an editor opens it
 * to check an issue before it ships. This is where a subscriber reads one, and
 * it is the note screen's typography and the note screen's node types, because
 * a newsletter that looks like a different product inside the product is a
 * different product.
 *
 * Read-only. The issue belongs to the editorial side; a subscriber who wants
 * to keep or annotate one takes a copy, and that is a separate act.
 */

import { useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import LinkExtension from '@tiptap/extension-link';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';

import { VideoBlock } from '@/pages/learning/lib/video-block';
import { Callout } from '@/pages/learning/lib/callout-block';
import { NOTE_PROSE_STYLE } from '@/pages/learning/ui/CenterPanel';
import { useBriefNote } from '@/features/newsletter-note/model/useBriefNote';
import { apiClient } from '@/shared/lib/api-client';
import { useQueryClient } from '@tanstack/react-query';

export function BriefNotePage(): JSX.Element {
  const { slug } = useParams<{ slug: string }>();
  const { issue, doc, loading, notFound, error } = useBriefNote(slug);
  const queryClient = useQueryClient();

  // The same extensions the note screen registers, minus the ones only an
  // editor needs. VideoBlock is the reason a pick is watchable here rather
  // than being a title with the id left in the data.
  const editor = useEditor(
    {
      editable: false,
      extensions: [
        StarterKit.configure({ codeBlock: false }),
        LinkExtension.configure({ openOnClick: true, autolink: true }),
        VideoBlock.configure({ HTMLAttributes: {} }),
        Callout.configure({ HTMLAttributes: {} }),
        Table.configure({ resizable: false }),
        TableRow,
        TableHeader,
        TableCell,
      ],
      content: doc ?? { type: 'doc', content: [{ type: 'paragraph' }] },
    },
    [doc]
  );

  useEffect(() => {
    if (issue) document.title = `${issue.headline.join(' ')} · ${issue.issueLabel}`;
  }, [issue]);

  // Arriving is subscribing, and arriving is reading. The reader followed a
  // link out of a digest and signed in to get here; a second button would be
  // asking twice. Both are idempotent server-side and both fail silently — a
  // record that did not write is not a reason to stop someone reading.
  //
  // Read is marked on arrival rather than on scroll depth. Depth is
  // measurable and it answers a question this product is not asking yet; the
  // row means the issue was opened, and claims nothing more.
  useEffect(() => {
    if (!issue) return;
    void apiClient.subscribeToBrief(issue.categoryKey, issue.slug).catch(() => undefined);
    void apiClient
      .markBriefRead(issue.slug)
      .then(() => {
        // The sidebar badge and the index both read this. Without the
        // invalidation the dot survives the reading of the thing it points at.
        void queryClient.invalidateQueries({ queryKey: ['brief-subscribed'] });
      })
      .catch(() => undefined);
  }, [issue, queryClient]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-muted-foreground">
        불러오는 중…
      </div>
    );
  }

  if (notFound || error || !issue) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-[13px] text-muted-foreground">
          {notFound ? '이 브리프를 찾을 수 없습니다.' : '브리프를 불러오지 못했습니다.'}
        </p>
        <Link to="/" className="text-[13px] underline underline-offset-4">
          홈으로
        </Link>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <style>{NOTE_PROSE_STYLE}</style>
      <div className="note-prose-root mx-auto w-full max-w-[720px] px-5 py-8">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

export default BriefNotePage;
