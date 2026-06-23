/**
 * note-document-generator §2 — videoBlock carries endSec from seg_ref.to_sec
 * (segment playback bound), max across the vid group; falls back to last atom
 * ts when seg_ref absent (older books). Pure generator → no mocks.
 */
import { describe, it, expect } from 'vitest';
import { buildInitialNoteDoc } from '@/pages/learning/lib/note-document-generator';
import type { MandalaBookData } from '@/shared/lib/api-client';

type VBlock = { type: string; attrs: { vid: string; fromSec: number; endSec: number } };
const videoBlocks = (doc: { content?: unknown[] }): VBlock[] =>
  (doc.content ?? []).filter((n): n is VBlock => (n as VBlock).type === 'videoBlock');

const book = (atoms: MandalaBookData['chapters'][0]['sections'][0]['atoms']): MandalaBookData => ({
  chapters: [{ ch: 0, title: '백엔드', sections: [{ title: 'API 라우팅', atoms }] }],
});

describe('note-document-generator — segment endSec', () => {
  it('endSec = max seg_ref.to_sec across the vid group', () => {
    const doc = buildInitialNoteDoc(
      book([
        { vid: 'vidA', ts: 10, text: 'a', seg_ref: { from_sec: 10, to_sec: 40 } },
        { vid: 'vidA', ts: 50, text: 'b', seg_ref: { from_sec: 50, to_sec: 95 } },
      ])
    );
    const vb = videoBlocks(doc).find((v) => v.attrs.vid === 'vidA')!;
    expect(vb.attrs.fromSec).toBe(10);
    expect(vb.attrs.endSec).toBe(95); // furthest segment boundary
  });

  it('falls back to last atom ts when seg_ref absent (older book)', () => {
    const doc = buildInitialNoteDoc(book([
      { vid: 'vidB', ts: 30, text: 'c' },
      { vid: 'vidB', ts: 120, text: 'd' },
    ]));
    const vb = videoBlocks(doc).find((v) => v.attrs.vid === 'vidB')!;
    expect(vb.attrs.endSec).toBe(120); // last atom ts (no seg_ref)
  });

  it('per-vid group → distinct videoBlocks with their own endSec', () => {
    const doc = buildInitialNoteDoc(
      book([
        { vid: 'vidA', ts: 10, text: 'a', seg_ref: { from_sec: 10, to_sec: 40 } },
        { vid: 'vidB', ts: 30, text: 'c', seg_ref: { from_sec: 30, to_sec: 200 } },
      ])
    );
    const vbs = videoBlocks(doc);
    expect(vbs.find((v) => v.attrs.vid === 'vidA')!.attrs.endSec).toBe(40);
    expect(vbs.find((v) => v.attrs.vid === 'vidB')!.attrs.endSec).toBe(200);
  });
});
