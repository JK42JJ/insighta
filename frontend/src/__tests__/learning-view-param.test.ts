/**
 * ?view=note deep-link guard — the note-ready email CTA lands in note mode.
 * LearningPage flips the store to 'note' when isNoteViewParam matches; this
 * pins the param contract (exact 'note', nothing else).
 */

import { describe, it, expect } from 'vitest';
import { isNoteViewParam } from '@/pages/learning/model/useLearningStore';

describe('isNoteViewParam', () => {
  it('matches only view=note', () => {
    expect(isNoteViewParam('note')).toBe(true);
    expect(isNoteViewParam(null)).toBe(false);
    expect(isNoteViewParam('')).toBe(false);
    expect(isNoteViewParam('player')).toBe(false);
    expect(isNoteViewParam('NOTE')).toBe(false);
  });
});
