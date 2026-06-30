/**
 * Callout — TipTap content node for markdown admonitions (`> [!note|tip|warning]`).
 *
 * Mirrors the figure-block.tsx custom-node pattern (Node.create + ReactNodeView)
 * so the doc shape stays schema-valid — an unregistered node type makes
 * ProseMirror throw on load. Unlike FigureBlock this is NOT an atom: it carries
 * editable `block+` content (the admonition body) rendered through NodeViewContent.
 *
 * Three kinds (note / tip / warning) each get an icon + Korean label header and a
 * note-mode-tokened box (CSS in CenterPanel NOTE_PROSE_STYLE + index.css). The
 * `kind` attribute is the discriminator; renderHTML emits a content hole (0) so
 * editor.getHTML()/paste round-trips, while the live UI is the React NodeView.
 */
import { Node, mergeAttributes } from '@tiptap/core';
import {
  ReactNodeViewRenderer,
  NodeViewWrapper,
  NodeViewContent,
  type NodeViewProps,
} from '@tiptap/react';
import { Info, Lightbulb, AlertTriangle } from 'lucide-react';

export interface CalloutOptions {
  HTMLAttributes: Record<string, unknown>;
}

export type CalloutKind = 'note' | 'tip' | 'warning';

const KIND_META: Record<CalloutKind, { label: string; Icon: typeof Info }> = {
  note: { label: '노트', Icon: Info },
  tip: { label: '팁', Icon: Lightbulb },
  warning: { label: '주의', Icon: AlertTriangle },
};

function normalizeKind(raw: unknown): CalloutKind {
  return raw === 'tip' || raw === 'warning' ? raw : 'note';
}

function CalloutNodeView({ node }: NodeViewProps) {
  const kind = normalizeKind(node.attrs['kind']);
  const { label, Icon } = KIND_META[kind];
  return (
    <NodeViewWrapper className="note-callout" data-kind={kind}>
      <div className="note-callout-head" contentEditable={false}>
        <Icon className="note-callout-icon" aria-hidden />
        <span className="note-callout-label">{label}</span>
      </div>
      <NodeViewContent className="note-callout-body" />
    </NodeViewWrapper>
  );
}

export const Callout = Node.create<CalloutOptions>({
  name: 'callout',

  group: 'block',
  content: 'block+',
  defining: true,

  addOptions() {
    return { HTMLAttributes: {} };
  },

  addAttributes() {
    return {
      kind: {
        default: 'note',
        parseHTML: (el) => normalizeKind(el.getAttribute('data-kind')),
        renderHTML: (attrs) => ({ 'data-kind': normalizeKind(attrs['kind']) }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="callout"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    // 0 = content hole for serialization (editor.getHTML / paste). Live UI = NodeView.
    return [
      'div',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-type': 'callout',
        class: 'note-callout',
      }),
      0,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(CalloutNodeView);
  },
});
