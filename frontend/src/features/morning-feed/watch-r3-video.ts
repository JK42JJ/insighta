import type { WatchVideo } from '@/features/morning-feed/watch-list';
import type { R3Video } from '@/features/morning-feed/watch-r3-feed';

const CHECK_MARK = '✓';

/** One live video as the watch screen draws it; blocks without data stay empty (hidden). */
export function r3VideoOf(v: WatchVideo, i: number): R3Video {
  return {
    key: v.videoId ?? v.title + i,
    videoId: v.videoId,
    title: v.title,
    channel: v.ch,
    initial: v.ini,
    altIcon: i % 2 === 1,
    durationSec: v.durationSec,
    publishedAt: v.publishedAt,
    thumbUrl: v.thumbUrl,
    ambient: v.ambient,
    why: (v.reasonLines ?? []).join(' '),
    summary: v.oneLiner ?? '',
    // the handoff draws only confirmed checks ('✓ …'); others have no place in the design
    checks: (v.checks ?? [])
      .filter((c) => c.text.startsWith(CHECK_MARK))
      .map((c) => c.text.slice(CHECK_MARK.length).trim()),
    chapters: v.chapters ?? [],
  };
}
