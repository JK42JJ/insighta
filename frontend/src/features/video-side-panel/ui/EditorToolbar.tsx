/**
 * BubbleMenu toolbar for the video side panel editor.
 * Styled per insighta-side-editor-mockup-v3.html:
 *   bg: rgba(30,32,48,0.95), backdrop-blur(12px), border rgba(255,255,255,0.07)
 *   buttons: 26x24px, rounded 5px
 *
 * Buttons: B, I, </>, | H2, H3, | bullet, ordered, | link
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import type { Editor } from '@tiptap/react';
import { cn } from '@/shared/lib/utils';

export interface EditorToolbarProps {
  editor: Editor;
}

interface ToolbarButtonProps {
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
  mono?: boolean;
}

function ToolbarButton({ active, onClick, label, children, mono }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'flex h-6 w-[26px] items-center justify-center rounded-[5px]',
        'text-[11px] font-semibold transition-all duration-100',
        mono && "font-['JetBrains_Mono',monospace] text-[10px]",
        active
          ? 'bg-[rgba(129,140,248,0.15)] text-[#818cf8]'
          : 'text-[#9394a0] hover:bg-[rgba(255,255,255,0.07)] hover:text-[#ededf0]'
      )}
    >
      {children}
    </button>
  );
}

function Separator() {
  return <span className="mx-px h-3.5 w-px bg-[rgba(255,255,255,0.06)]" aria-hidden />;
}

export function EditorToolbar({ editor }: EditorToolbarProps) {
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const linkInputRef = useRef<HTMLInputElement>(null);

  const openLinkInput = useCallback(() => {
    const previous = editor.getAttributes('link')['href'] as string | undefined;
    setLinkUrl(previous ?? '');
    setShowLinkInput(true);
  }, [editor]);

  useEffect(() => {
    if (showLinkInput) {
      linkInputRef.current?.focus();
      linkInputRef.current?.select();
    }
  }, [showLinkInput]);

  const applyLink = useCallback(() => {
    let url = linkUrl.trim();
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
    } else {
      if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
      editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
    }
    setShowLinkInput(false);
    setLinkUrl('');
  }, [editor, linkUrl]);

  const cancelLink = useCallback(() => {
    setShowLinkInput(false);
    setLinkUrl('');
    editor.commands.focus();
  }, [editor]);

  const handleLinkKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        applyLink();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelLink();
      }
    },
    [applyLink, cancelLink]
  );

  if (showLinkInput) {
    return (
      <div
        className={cn(
          'flex items-center gap-1.5 rounded-lg px-2 py-1.5',
          'bg-[rgba(30,32,48,0.95)] backdrop-blur-[12px]',
          'border border-[rgba(255,255,255,0.07)]',
          'shadow-[0_5px_20px_rgba(0,0,0,0.45)]'
        )}
      >
        <input
          ref={linkInputRef}
          type="url"
          value={linkUrl}
          onChange={(e) => setLinkUrl(e.target.value)}
          onKeyDown={handleLinkKeyDown}
          placeholder="https://..."
          className={cn(
            'h-6 w-[200px] rounded-[5px] border-0 bg-[rgba(255,255,255,0.06)] px-2',
            'text-[12px] text-[#ededf0] placeholder:text-[#4e4f5c]',
            'outline-none ring-0'
          )}
        />
        <button
          type="button"
          onClick={applyLink}
          className="flex h-6 items-center rounded-[5px] bg-[rgba(129,140,248,0.15)] px-2 text-[11px] font-medium text-[#818cf8] hover:bg-[rgba(129,140,248,0.25)]"
        >
          ✓
        </button>
        <button
          type="button"
          onClick={cancelLink}
          className="flex h-6 items-center rounded-[5px] px-1.5 text-[11px] text-[#9394a0] hover:bg-[rgba(255,255,255,0.07)] hover:text-[#ededf0]"
        >
          ✕
        </button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex items-center gap-px rounded-lg p-[3px]',
        'bg-[rgba(30,32,48,0.95)] backdrop-blur-[12px]',
        'border border-[rgba(255,255,255,0.07)]',
        'shadow-[0_5px_20px_rgba(0,0,0,0.45)]'
      )}
    >
      <ToolbarButton
        label="Bold"
        active={editor.isActive('bold')}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <strong>B</strong>
      </ToolbarButton>
      <ToolbarButton
        label="Italic"
        active={editor.isActive('italic')}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <em>I</em>
      </ToolbarButton>
      <ToolbarButton
        label="Inline code"
        active={editor.isActive('code')}
        onClick={() => editor.chain().focus().toggleCode().run()}
        mono
      >
        {'</>'}
      </ToolbarButton>

      <Separator />

      <ToolbarButton
        label="Heading 2"
        active={editor.isActive('heading', { level: 2 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        H2
      </ToolbarButton>
      <ToolbarButton
        label="Heading 3"
        active={editor.isActive('heading', { level: 3 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      >
        H3
      </ToolbarButton>

      <Separator />

      <ToolbarButton
        label="Bullet list"
        active={editor.isActive('bulletList')}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        {'\u2022'}
      </ToolbarButton>
      <ToolbarButton
        label="Ordered list"
        active={editor.isActive('orderedList')}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        1.
      </ToolbarButton>

      <Separator />

      <ToolbarButton label="Link" active={editor.isActive('link')} onClick={openLinkInput}>
        {'🔗'}
      </ToolbarButton>
    </div>
  );
}
