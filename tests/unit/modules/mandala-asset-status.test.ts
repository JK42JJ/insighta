/**
 * P1 — deriveMandalaAssetStatus: per-mandala deck/note/v2 status for the sidebar.
 * note = none (no note row) / stale (book re-filled past the note) / fresh.
 */
import { deriveMandalaAssetStatus } from '@/modules/mandala/manager';

describe('deriveMandalaAssetStatus', () => {
  it('note=none when there is no note row', () => {
    expect(
      deriveMandalaAssetStatus({
        deckStatus: null,
        bookVersion: 5,
        v2Done: 3,
        v2GatePassed: 4,
        noteBasedOnVersion: null,
      }).note
    ).toBe('none');
  });

  it('note=stale when book.version > note.based_on_book_version', () => {
    expect(
      deriveMandalaAssetStatus({
        deckStatus: 'done',
        bookVersion: 7,
        v2Done: 10,
        v2GatePassed: 10,
        noteBasedOnVersion: 5,
      }).note
    ).toBe('stale');
  });

  it('note=fresh when note is at (or ahead of) the current book version', () => {
    expect(
      deriveMandalaAssetStatus({
        deckStatus: null,
        bookVersion: 5,
        v2Done: 5,
        v2GatePassed: 5,
        noteBasedOnVersion: 5,
      }).note
    ).toBe('fresh');
  });

  it('passes deck status and v2 coverage through unchanged', () => {
    const s = deriveMandalaAssetStatus({
      deckStatus: 'building',
      bookVersion: 2,
      v2Done: 16,
      v2GatePassed: 18,
      noteBasedOnVersion: 2,
    });
    expect(s).toEqual({ deck: 'building', note: 'fresh', v2Done: 16, v2GatePassed: 18 });
  });

  it('note=fresh (not stale) when a note exists but there is no book version', () => {
    // defensive: note present, book missing → cannot be "re-filled past", treat as fresh
    expect(
      deriveMandalaAssetStatus({
        deckStatus: null,
        bookVersion: null,
        v2Done: null,
        v2GatePassed: null,
        noteBasedOnVersion: 0,
      }).note
    ).toBe('fresh');
  });
});
