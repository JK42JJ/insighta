import { describe, expect, it } from 'vitest';

import { citeLinks, stampOf, youtubeAt } from '@/features/morning-feed/watch-page-model';

const CH: Record<string, string> = { QHBjufYK8TA: 'AI Engineer', YkhmBOctzWE: 'Sean AI' };

describe('page source links (README §출처 표시)', () => {
  it('times read as m:ss, or h:mm:ss past an hour', () => {
    expect([961, 46, 0, 3725].map(stampOf)).toEqual(['16:01', '0:46', '0:00', '1:02:05']);
  });
  it('opens the video at the second', () => {
    expect(youtubeAt('QHBjufYK8TA', 961)).toBe(
      'https://www.youtube.com/watch?v=QHBjufYK8TA&t=961s'
    );
    expect(youtubeAt('QHBjufYK8TA', 0)).toBe('https://www.youtube.com/watch?v=QHBjufYK8TA');
  });
  it('channel and first time, then "· time" for the same video, each its own link', () => {
    const l = citeLinks(
      [
        { video_id: 'YkhmBOctzWE', t: 210 },
        { video_id: 'YkhmBOctzWE', t: 235 },
        { video_id: 'QHBjufYK8TA', t: 961 },
      ],
      (id) => CH[id] ?? ''
    );
    expect(l.map((x) => [x.label, x.gap])).toEqual([
      ['Sean AI 3:30', 2],
      ['· 3:55', 3],
      ['AI Engineer 16:01', 2],
    ]);
    expect(l[1]!.href).toMatch(/t=235s$/);
  });

  it('a source without a time (t 0) shows the channel alone', () => {
    const l = citeLinks([{ video_id: 'QHBjufYK8TA', t: 0 }], (id) => CH[id] ?? '');
    expect(l.map((x) => x.label)).toEqual(['AI Engineer']);
    expect(l[0]!.href).toBe('https://www.youtube.com/watch?v=QHBjufYK8TA');
  });
});
