import { extractMarkers, snapSegmentsToMarkers } from '@/modules/skills/atom-marker-snap';

describe('atom-marker-snap (CP504 server-side timestamp guard)', () => {
  // markers at 0, 10, 30, 60s
  const transcript = '[0:00] intro\n[0:10] point a\n[0:30] point b\n[1:00] outro';

  it('extractMarkers parses [mm:ss] to sorted unique seconds', () => {
    expect(extractMarkers(transcript)).toEqual([0, 10, 30, 60]);
    expect(extractMarkers('(no transcript)')).toEqual([]);
  });

  it('snaps ≤10s, drops drift>10s / over-duration / duplicate, sorts ascending', () => {
    const segments = {
      atoms: [
        { idx: 0, type: 'fact', text: 'snap-up', timestamp_sec: 8 }, // → 10 (diff 2, snap)
        { idx: 1, type: 'tip', text: 'drift', timestamp_sec: 45 }, // nearest 30/60 diff 15 → DROP
        { idx: 2, type: 'fact', text: 'over-dur', timestamp_sec: 120 }, // > 70 → DROP
        { idx: 3, type: 'fact', text: 'exact-zero', timestamp_sec: 0 }, // keep
        { idx: 4, type: 'fact', text: 'dup', timestamp_sec: 12 }, // → 10, already seen → DROP
      ],
      sections: [{ from_sec: 0, to_sec: 200, title: 's' }],
    };
    const { segments: out, meta } = snapSegmentsToMarkers(segments, transcript, 70);
    const atoms = (out as { atoms: Array<{ timestamp_sec: number; idx: number }> }).atoms;

    // surviving atoms snapped + sorted ascending + re-indexed
    expect(atoms.map((a) => a.timestamp_sec)).toEqual([0, 10]);
    expect(atoms.map((a) => a.idx)).toEqual([0, 1]);

    expect(meta.atoms_in).toBe(5);
    expect(meta.atoms_out).toBe(2);
    expect(meta.drop_reasons.marker_drift_over_10s).toBe(1);
    expect(meta.drop_reasons.out_of_duration).toBe(1);
    expect(meta.drop_reasons.duplicate_ts).toBe(1);
    expect(meta.atom_dropped_count).toBe(3);

    // section to_sec (200) clamped into [0, duration 70]
    const sec = (out as { sections: Array<{ from_sec: number; to_sec: number }> }).sections[0]!;
    expect(sec.to_sec).toBeLessThanOrEqual(70);
  });

  it('passes through unchanged when transcript has no markers (cannot SNAP)', () => {
    const segments = { atoms: [{ idx: 0, type: 'fact', text: 'x', timestamp_sec: 999 }] };
    const { segments: out, meta } = snapSegmentsToMarkers(segments, '(no transcript)', null);
    expect((out as { atoms: Array<{ timestamp_sec: number }> }).atoms[0]!.timestamp_sec).toBe(999);
    expect(meta.marker_count).toBe(0);
    expect(meta.atoms_out).toBe(1);
  });
});
