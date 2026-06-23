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
import { useEffect, useRef, useState } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { Play } from 'lucide-react';
import { useLearningStore } from '@/pages/learning/model/useLearningStore';
import { loadYouTubeAPI, type YTPlayer } from '@/widgets/video-player/model/youtube-api';

// CP446.x — YT.PlayerState constants. Avoid relying on window.YT.PlayerState
// at module load (loaded async).
const YT_STATE_PLAYING = 1;
const YT_STATE_PAUSED = 2;
const YT_STATE_ENDED = 0;

export interface VideoBlockOptions {
  HTMLAttributes: Record<string, unknown>;
}

export interface VideoBlockAttrs {
  vid: string;
  fromSec: number;
  endSec: number; // segment end (YouTube `end` param); 0 ⇒ play to video end (older books)
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
  const setAutoFollow = useLearningStore((s) => s.setNoteAutoFollow);
  // CP445.x — img onError 시 thumbnail 깨진 vid → block 숨김 (간단 path).
  // 더 strict 한 youtube_videos 테이블 query / fetch 검증은 별 PR.
  const [thumbBroken, setThumbBroken] = useState(false);
  // §redesign — playing-state progress bar. The active block owns its own
  // YT.Player (playerRef below); we poll getCurrentTime/getDuration so the
  // gold progress bar reflects THIS segment's playback (not the main player).
  const [progressPct, setProgressPct] = useState(0);

  // getPos() can return undefined transiently; coerce to a stable key.
  const pos = typeof getPos === 'function' ? (getPos() as number | undefined) : undefined;
  const myKey = typeof pos === 'number' ? pos : -1;
  const isActive = activeKey !== null && activeKey === myKey;
  const isEditable = editor.isEditable;

  // CP446.x — when active iframe is mounted, register YT.Player to track
  // user-driven play/pause. On PAUSED → disable auto-follow (user explicitly
  // stopped → scrolling shouldn't autoplay other blocks). On PLAYING →
  // re-enable (user resumed). Stable iframe id per block via useRef.
  const iframeIdRef = useRef(`vb-${Math.random().toString(36).slice(2, 10)}`);
  const playerRef = useRef<YTPlayer | null>(null);
  useEffect(() => {
    if (!isActive || isEditable) return;
    let cancelled = false;
    let player: YTPlayer | null = null;
    let pollId: ReturnType<typeof setInterval> | null = null;

    loadYouTubeAPI().then(() => {
      if (cancelled) return;
      const elementId = iframeIdRef.current;
      // The iframe with this id must be in the DOM at this point (rendered
      // by isActive branch below). Defensive: skip if missing.
      if (!document.getElementById(elementId)) return;
      try {
        player = new window.YT.Player(elementId, {
          events: {
            onStateChange: (event) => {
              if (event.data === YT_STATE_PLAYING) {
                // User resumed (or autoplay started) — keep auto-follow on.
                setAutoFollow(true);
              } else if (event.data === YT_STATE_PAUSED || event.data === YT_STATE_ENDED) {
                // Explicit pause/end = user no longer wants automatic playback.
                setAutoFollow(false);
              }
            },
          },
        });
        playerRef.current = player;
        // Progress polling (500ms) — drives the gold progress bar.
        pollId = setInterval(() => {
          const p = playerRef.current;
          if (!p) return;
          try {
            const dur = p.getDuration();
            const cur = p.getCurrentTime();
            if (dur > 0) setProgressPct(Math.min(100, Math.max(0, (cur / dur) * 100)));
          } catch {
            // player not ready — skip this tick
          }
        }, 500);
      } catch {
        // YT.Player init failed — let iframe play without state tracking.
      }
    });

    return () => {
      cancelled = true;
      if (pollId) clearInterval(pollId);
      setProgressPct(0);
      const p = playerRef.current;
      playerRef.current = null;
      if (p) {
        try {
          p.destroy();
        } catch {
          // ignore destroy errors
        }
      }
    };
  }, [isActive, isEditable, setAutoFollow]);

  if (thumbBroken && !isActive) {
    // Hide entire block when thumbnail load failed (deleted / private / fake vid).
    return <NodeViewWrapper data-type="video-block" className="video-block-wrap hidden" />;
  }

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (isEditable) return; // edit mode: thumbnail is static; ProseMirror owns the click
    if (!attrs.vid) return;
    // CP446.x — explicit play activity = enable auto-follow mode. Subsequent
    // scrolls drive activeKey via IntersectionObserver (useNoteAutoFollow).
    setActiveKey(myKey);
    setAutoFollow(true);
  };

  return (
    <NodeViewWrapper
      data-type="video-block"
      data-vid={attrs.vid}
      data-from-sec={String(attrs.fromSec)}
      // CP446.x — expose ProseMirror pos so useNoteAutoFollow can resolve
      // the IntersectionObserver-detected element back to the activeKey
      // (which is the pos number stored in Zustand).
      data-pm-pos={typeof pos === 'number' ? String(pos) : undefined}
      className="video-block-wrap"
    >
      {isActive && !isEditable ? (
        <div className="video-block-frame video-block-frame--active">
          <iframe
            id={iframeIdRef.current}
            // Segment playback: start..end bounds this topic-group's span so the
            // player stops at the segment end (not the full video). rel=0 +
            // modestbranding + iv_load_policy=3 suppress recommendations/branding/
            // annotations as far as the YouTube iframe API allows (best-effort —
            // "More videos" on pause + the logo cannot be fully removed).
            src={`https://www.youtube.com/embed/${attrs.vid}?autoplay=1&mute=0&start=${Math.floor(
              attrs.fromSec
            )}${attrs.endSec > attrs.fromSec ? `&end=${Math.ceil(attrs.endSec)}` : ''}&rel=0&modestbranding=1&iv_load_policy=3&enablejsapi=1`}
            title={attrs.sectionTitle ?? `Video ${attrs.vid}`}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            className="video-block-iframe"
          />
          {/* §redesign — gold playing progress bar (driven by this block's player). */}
          <span className="video-block-progress" aria-hidden>
            <i style={{ width: `${progressPct}%` }} />
          </span>
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
          {/* Segment info only — NO "now playing" wording (state is shown by the
              player chrome). "MM:SS–MM:SS · 구간명" when a segment end exists. */}
          {attrs.endSec > attrs.fromSec ? `${ts}–${formatTs(attrs.endSec)}` : ts} ·{' '}
          {attrs.sectionTitle}
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
      endSec: {
        default: 0,
        parseHTML: (el) => Number(el.getAttribute('data-end-sec') ?? 0),
        renderHTML: (attrs) => ({ 'data-end-sec': String(attrs['endSec'] ?? 0) }),
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
