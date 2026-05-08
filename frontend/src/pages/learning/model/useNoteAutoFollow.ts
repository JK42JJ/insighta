/**
 * CP446.x — Visibility-driven auto-follow for note-mode VideoBlocks.
 *
 * Observes every `.video-block-wrap` inside the TipTap editor DOM via
 * IntersectionObserver. When `enabled` is true (= user has explicitly
 * clicked at least one VideoBlock), the topmost block with visibility
 * ratio >= VISIBLE_THRESHOLD (2/3 visible = 1/3 hidden cap) becomes
 * the active iframe. If none meet the threshold, activeKey is null
 * (every iframe unmounts → background audio stops).
 *
 * Block key = ProseMirror `pos` stored as `data-pm-pos` on the wrapper.
 * Set by VideoBlockNodeView via NodeViewWrapper attrs (we add data-pm-pos
 * downstream in this PR — for now read it from the inner element via
 * the dataset of the wrapper element). Fallback: if data-pm-pos missing,
 * we fall back to DOM child-index inside `.ProseMirror`.
 *
 * Spec (Plan→Approve→Execute, defaults Q1-Q4):
 *   Q1: auto-follow OFF when leaving note mode / entering edit mode /
 *       changing mandala.  → handled in CenterPanel useEffect, not here.
 *   Q2: continuous — scrolling back to a previously-played block resumes it
 *       automatically.
 *   Q3: viewport = TipTap editor scroll container, not window.
 *   Q4: mute=0 (handled in VideoBlock NodeView itself).
 *
 * Don't touch (CP446):
 *   - VideoBlock click handler (sets activeKey + enables auto-follow once)
 *   - PanelVideoPlayer (player mode owner; unrelated to inline iframes)
 *   - Edit-mode static thumbnail behavior
 */
import { useEffect } from 'react';
import type { Editor } from '@tiptap/react';
import { useLearningStore } from './useLearningStore';

const VISIBLE_THRESHOLD = 2 / 3; // visible >= 2/3 = hidden < 1/3
const OBSERVER_THRESHOLDS = [0, 0.25, 0.5, VISIBLE_THRESHOLD, 0.85, 1];

export interface UseNoteAutoFollowInput {
  editor: Editor | null;
  isEditable: boolean;
  enabled: boolean;
}

/**
 * Find the scrollable ancestor of `el`. Falls back to document.scrollingElement.
 * Used as the IntersectionObserver root so visibility is computed relative to
 * the editor's scroll container, not the browser window.
 */
function findScrollContainer(el: HTMLElement | null): HTMLElement | null {
  let cur: HTMLElement | null = el?.parentElement ?? null;
  while (cur && cur !== document.body) {
    const cs = window.getComputedStyle(cur);
    const oy = cs.overflowY;
    if ((oy === 'auto' || oy === 'scroll') && cur.scrollHeight > cur.clientHeight) {
      return cur;
    }
    cur = cur.parentElement;
  }
  return null;
}

export function useNoteAutoFollow({ editor, isEditable, enabled }: UseNoteAutoFollowInput): void {
  const setActiveKey = useLearningStore((s) => s.setActiveNoteVideoKey);

  useEffect(() => {
    if (!editor) return;
    if (!enabled) return;
    if (isEditable) return;

    const editorEl = editor.view.dom as HTMLElement;
    if (!editorEl) return;

    const scrollRoot = findScrollContainer(editorEl);

    // Map of wrapper element → its ProseMirror pos. Read from data-pm-pos
    // (set by VideoBlockNodeView) or fall back to DOM order.
    const visibilityMap = new Map<HTMLElement, number>();

    const recompute = () => {
      // Collect wrappers visible >= threshold; pick topmost by getBoundingClientRect.top.
      let topmost: { el: HTMLElement; top: number } | null = null;
      for (const [el, ratio] of visibilityMap) {
        if (ratio < VISIBLE_THRESHOLD) continue;
        const rect = el.getBoundingClientRect();
        if (!topmost || rect.top < topmost.top) {
          topmost = { el, top: rect.top };
        }
      }

      if (!topmost) {
        setActiveKey(null);
        return;
      }

      // Read pm-pos from dataset; fall back to DOM index among siblings.
      const posAttr = topmost.el.dataset.pmPos;
      let posNum: number | null = null;
      if (posAttr != null) {
        const parsed = Number(posAttr);
        if (Number.isFinite(parsed)) posNum = parsed;
      }
      if (posNum == null) {
        const all = Array.from(editorEl.querySelectorAll<HTMLElement>('.video-block-wrap'));
        posNum = all.indexOf(topmost.el);
      }
      setActiveKey(posNum);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          visibilityMap.set(entry.target as HTMLElement, entry.intersectionRatio);
        }
        recompute();
      },
      {
        root: scrollRoot ?? null,
        threshold: OBSERVER_THRESHOLDS,
      }
    );

    // Observe current wrappers + watch for editor DOM mutations (atoms can
    // be added/removed if the user edits, though edit mode disables this hook).
    const observeAll = () => {
      const wrappers = editorEl.querySelectorAll<HTMLElement>('.video-block-wrap');
      for (const w of wrappers) observer.observe(w);
    };
    observeAll();

    const mutationObs = new MutationObserver(() => {
      // Re-observe — IntersectionObserver dedupes existing targets.
      observeAll();
    });
    mutationObs.observe(editorEl, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      mutationObs.disconnect();
      visibilityMap.clear();
    };
  }, [editor, enabled, isEditable, setActiveKey]);
}
