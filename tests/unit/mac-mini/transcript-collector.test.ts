/**
 * Mac Mini transcript-collector — pure helpers (CP437).
 *
 * The Node script in mac-mini/transcript-collector/collect.ts runs out
 * of process so we don't import it as a module here. The tests in this
 * file mirror the `stripVtt` logic by re-implementing the exact same
 * regex stack and locking it against representative auto-subs samples.
 */

// Re-implement the Mac Mini collector's stripVtt to lock its behavior.
// Keep this verbatim with `mac-mini/transcript-collector/collect.ts`.
function stripVtt(vtt: string): string {
  const lines = vtt.split(/\r?\n/);
  const out: string[] = [];
  let prev = '';
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (t === 'WEBVTT') continue;
    if (/^\d+$/.test(t)) continue;
    if (/-->/u.test(t)) continue;
    if (/^Kind:|^Language:/i.test(t)) continue;
    const stripped = t.replace(/<[^>]+>/g, '').trim();
    if (stripped.length === 0) continue;
    if (stripped === prev) continue;
    out.push(stripped);
    prev = stripped;
  }
  return out.join(' ');
}

describe('Mac Mini transcript-collector / stripVtt', () => {
  test('drops WEBVTT header + Kind/Language metadata + empty lines', () => {
    const vtt = `WEBVTT
Kind: captions
Language: ko

00:00:00.000 --> 00:00:02.000
첫 번째 자막

00:00:02.500 --> 00:00:05.000
두 번째 자막
`;
    expect(stripVtt(vtt)).toBe('첫 번째 자막 두 번째 자막');
  });

  test('drops cue numeric IDs', () => {
    const vtt = `WEBVTT

1
00:00:00.000 --> 00:00:02.000
hello

2
00:00:02.500 --> 00:00:05.000
world
`;
    expect(stripVtt(vtt)).toBe('hello world');
  });

  test('strips inline timing tags <00:00:01.000><c>', () => {
    const vtt = `WEBVTT

00:00:00.000 --> 00:00:02.000
This <00:00:01.000><c>is</c> a test
`;
    expect(stripVtt(vtt)).toBe('This is a test');
  });

  test('returns empty string for VTT with no caption text', () => {
    const vtt = `WEBVTT
Kind: captions
Language: ko

00:00:00.000 --> 00:00:02.000
`;
    expect(stripVtt(vtt)).toBe('');
  });

  test('handles \\r\\n line endings (Windows-style)', () => {
    const vtt = 'WEBVTT\r\n\r\n00:00:00.000 --> 00:00:02.000\r\nhello world\r\n';
    expect(stripVtt(vtt)).toBe('hello world');
  });

  test('dedupes consecutive identical lines (YouTube auto-subs overlap)', () => {
    const vtt = `WEBVTT

00:00:00.000 --> 00:00:02.000
첫 번째 자막

00:00:02.000 --> 00:00:04.000
첫 번째 자막

00:00:04.000 --> 00:00:06.000
두 번째 자막
`;
    expect(stripVtt(vtt)).toBe('첫 번째 자막 두 번째 자막');
  });
});
