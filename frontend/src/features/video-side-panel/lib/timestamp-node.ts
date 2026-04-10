/**
 * Tiptap TimestampPlugin — renders YouTube timestamp links as clickable pills.
 *
 * Compatible with MemoEditor format: [⏱ MM:SS](https://youtube.com/watch?v=ID&t=60s)
 *
 * Approach:
 *   - Decorations add `.timestamp-pill` class to text nodes with YouTube timestamp links.
 *   - CSS in PanelNoteEditor styles them as pills (rounded, bg, indigo text).
 *   - Click handler intercepts clicks on these decorated elements and calls onSeek().
 *   - No schema changes — MemoEditor ↔ PanelNoteEditor content stays compatible.
 */
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { Extension } from '@tiptap/core';

const YOUTUBE_TIMESTAMP_RE = /[?&]t=(\d+)/;

function isYouTubeTimestampUrl(url: string): boolean {
  return (
    (url.includes('youtube.com') || url.includes('youtu.be')) && YOUTUBE_TIMESTAMP_RE.test(url)
  );
}

function extractSeconds(url: string): number | null {
  const match = url.match(YOUTUBE_TIMESTAMP_RE);
  return match ? parseInt(match[1], 10) : null;
}

const timestampPluginKey = new PluginKey('timestampPill');

export interface TimestampPluginOptions {
  onSeek?: (seconds: number) => void;
}

export const TimestampPlugin = Extension.create<TimestampPluginOptions>({
  name: 'timestampPlugin',

  addOptions() {
    return { onSeek: undefined };
  },

  addProseMirrorPlugins() {
    const { onSeek } = this.options;

    return [
      new Plugin({
        key: timestampPluginKey,

        props: {
          decorations: (state) => {
            const { doc } = state;
            const decorations: Decoration[] = [];

            doc.descendants((node, pos) => {
              if (!node.isText) return;

              const linkMark = node.marks.find((m) => m.type.name === 'link');
              if (!linkMark) return;

              const href = linkMark.attrs['href'] as string | undefined;
              if (!href || !isYouTubeTimestampUrl(href)) return;

              const seconds = extractSeconds(href);
              if (seconds === null) return;

              decorations.push(
                Decoration.inline(pos, pos + node.nodeSize, {
                  class: 'timestamp-pill',
                  'data-timestamp-seconds': String(seconds),
                })
              );
            });

            return DecorationSet.create(doc, decorations);
          },

          handleDOMEvents: {
            click: (view, event) => {
              const target = event.target as HTMLElement;

              // Check if clicked element or parent has timestamp-pill class
              const pill = target.classList.contains('timestamp-pill')
                ? target
                : target.closest('.timestamp-pill');

              if (!pill) return false;

              const seconds = pill.getAttribute('data-timestamp-seconds');
              if (seconds && onSeek) {
                event.preventDefault();
                event.stopPropagation();
                onSeek(parseInt(seconds, 10));
                return true;
              }
              return false;
            },
          },
        },
      }),
    ];
  },
});
