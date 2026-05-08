/**
 * VideoBlock — TipTap atomic Node for the note mode (CP445.x revision).
 *
 * Read mode click → expand into an inline YouTube iframe (autoplay=1, mute=0).
 * Single-active enforcement: clicking another VideoBlock collapses the
 * previous one. Active key = ProseMirror `pos` (NodeView getPos()) tracked
 * in `useLearningStore.activeNoteVideoKey`.
 *
 * Edit mode (editor.isEditable=true): static thumbnail, play UI hidden,
 * click is no-op. Block remains draggable / deletable / re-orderable via
 * ProseMirror's atom + draggable mechanics (TipTap built-in).
 *
 * Note: NodeView is rendered via `ReactNodeViewRenderer` so the inner
 * component can subscribe to the Zustand store and re-render on mode /
 * active-key changes.
 *
 * Hard Rule (CLAUDE.md):
 *   - Don't touch PanelNoteEditor / TimestampPlugin (separate per-video memo)
 *   - Don't touch the YT iframe player owned by CenterPanel Row 1 (hidden in
 *     note mode by CP442 mount-preserve pattern)
 */
import { useState } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { Play } from 'lucide-react';
import { useLearningStore } from '@/pages/learning/model/useLearningStore';

export interface VideoBlockOptions {
  HTMLAttributes: Record<string, unknown>;
}

export interface VideoBlockAttrs {
  vid: string;
  fromSec: number;
  sectionTitle: string | null;
}

function formatTs(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    videoBlock: {
      /** Insert a VideoBlock at the current selection. */
      insertVideoBlock: (attrs: VideoBlockAttrs) => ReturnType;
    };
  }
}

// React component rendered as the NodeView content.
function VideoBlockNodeView({ node, getPos, editor }: NodeViewProps) {
  const attrs = node.attrs as unknown as VideoBlockAttrs;
  const ts = formatTs(attrs.fromSec);
  const activeKey = useLearningStore((s) => s.activeNoteVideoKey);
  const setActiveKey = useLearningStore((s) => s.setActiveNoteVideoKey);
  // CP445.x — img onError 시 thumbnail 깨진 vid → block 숨김 (간단 path).
  // 더 strict 한 youtube_videos 테이블 query / fetch 검증은 별 PR.
  const [thumbBroken, setThumbBroken] = useState(false);

  // getPos() can return undefined transiently; coerce to a stable key.
  const pos = typeof getPos === 'function' ? (getPos() as number | undefined) : undefined;
  const myKey = typeof pos === 'number' ? pos : -1;
  const isActive = activeKey !== null && activeKey === myKey;
  const isEditable = editor.isEditable;

  if (thumbBroken && !isActive) {
    // Hide entire block when thumbnail load failed (deleted / private / fake vid).
    return <NodeViewWrapper data-type="video-block" className="video-block-wrap hidden" />;
  }

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (isEditable) return; // edit mode: thumbnail is static; ProseMirror owns the click
    if (!attrs.vid) return;
    setActiveKey(myKey);
  };

  return (
    <NodeViewWrapper
      data-type="video-block"
      data-vid={attrs.vid}
      data-from-sec={String(attrs.fromSec)}
      className="video-block-wrap"
    >
      {isActive && !isEditable ? (
        <div className="video-block-frame video-block-frame--active">
          <iframe
            src={`https://www.youtube.com/embed/${attrs.vid}?autoplay=1&mute=0&start=${Math.floor(
              attrs.fromSec
            )}&rel=0&modestbranding=1`}
            title={attrs.sectionTitle ?? `Video ${attrs.vid}`}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            className="video-block-iframe"
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={handleClick}
          aria-label={isEditable ? `Video ${attrs.vid}` : `Play from ${ts}`}
          tabIndex={isEditable ? -1 : 0}
          className="video-block-frame"
          // Disable native HTML5 drag of the inner img (dnd-kit + TipTap drag
          // share `draggable` attribute behavior; CP443 sub-rule).
          draggable={false}
          onDragStart={(e) => e.preventDefault()}
        >
          <img
            src={`https://img.youtube.com/vi/${attrs.vid}/hqdefault.jpg`}
            alt=""
            className="video-block-thumb"
            draggable={false}
            onError={() => setThumbBroken(true)}
          />
          <span className="video-block-overlay" />
          <span
            className="video-block-play"
            // Edit mode: hide play UI per spec (still keep DOM for transition).
            style={{ opacity: isEditable ? 0 : 1 }}
            aria-hidden
          >
            <Play className="video-block-play-icon" />
          </span>
          <span className="video-block-ts" aria-hidden>
            {ts}
          </span>
        </button>
      )}
      {attrs.sectionTitle && (
        <div className="video-block-caption">
          {ts} — {attrs.sectionTitle}
        </div>
      )}
    </NodeViewWrapper>
  );
}

export const VideoBlock = Node.create<VideoBlockOptions>({
  name: 'videoBlock',

  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      vid: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-vid') ?? '',
        renderHTML: (attrs) => ({ 'data-vid': attrs['vid'] }),
      },
      fromSec: {
        default: 0,
        parseHTML: (el) => Number(el.getAttribute('data-from-sec') ?? 0),
        renderHTML: (attrs) => ({ 'data-from-sec': String(attrs['fromSec']) }),
      },
      sectionTitle: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-section-title'),
        renderHTML: (attrs) =>
          attrs['sectionTitle'] ? { 'data-section-title': String(attrs['sectionTitle']) } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="video-block"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    // Inert markup for `editor.getHTML()` export. Live UI is the React
    // NodeView below; that path is the only one users interact with.
    return [
      'div',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-type': 'video-block',
        class: 'video-block',
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(VideoBlockNodeView);
  },

  addCommands() {
    return {
      insertVideoBlock:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs,
          }),
    };
  },
});
