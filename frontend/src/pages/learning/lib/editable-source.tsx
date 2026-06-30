/**
 * EditableSource — Obsidian-style inline source editor for attr-backed nodes
 * (mermaid diagram source, equation LaTeX). Read mode shows `preview`; edit mode
 * (editor editable) reveals a "edit source" toggle that swaps in a code textarea
 * bound to the node attr. Changes are debounced into `onCommit`
 * (node.updateAttributes) so the artifact re-renders + the note auto-saves, and the
 * source round-trips through the doc. The control region is contentEditable=false
 * and stops mouse/key propagation so ProseMirror never steals the textarea's
 * keystrokes or selection.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

const COMMIT_DEBOUNCE_MS = 400;
const TEXTAREA_ROWS = 6;

export interface EditableSourceProps {
  /** Current committed source (the node attr value). */
  source: string;
  /** True when the host editor is editable (drives the edit affordance). */
  editable: boolean;
  /** Persist a new source into the node attr (triggers re-render + auto-save). */
  onCommit: (next: string) => void;
  /** Rendered artifact shown in both modes (SVG diagram / KaTeX equation). */
  preview: ReactNode;
  /** Toggle button label, e.g. "소스 편집" / "수식 편집". */
  label: string;
}

export function EditableSource({
  source,
  editable,
  onCommit,
  preview,
  label,
}: EditableSourceProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(source);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Resync the draft when the attr changes externally (restore / regenerate).
  useEffect(() => {
    setDraft(source);
  }, [source]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const schedule = useCallback(
    (value: string) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => onCommit(value), COMMIT_DEBOUNCE_MS);
    },
    [onCommit]
  );

  return (
    <>
      {preview}
      {editable && (
        <div className="note-source-edit" contentEditable={false}>
          {editing && (
            <textarea
              className="note-source-textarea"
              value={draft}
              rows={TEXTAREA_ROWS}
              spellCheck={false}
              // Keep ProseMirror out of the textarea's input handling.
              onMouseDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
              onChange={(e) => {
                setDraft(e.target.value);
                schedule(e.target.value);
              }}
            />
          )}
          <button
            type="button"
            className="note-source-btn"
            // preventDefault keeps editor focus/selection from jumping on click.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              if (editing) {
                if (timer.current) clearTimeout(timer.current);
                onCommit(draft); // flush immediately on close
              }
              setEditing((v) => !v);
            }}
          >
            {editing ? '완료' : label}
          </button>
        </div>
      )}
    </>
  );
}
