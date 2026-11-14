/*
 * "한 장" page (design handoff "design_handoff_insighta_page", README §출처 표시), pure and unit
 * tested: the source links after a sentence or paragraph and the YouTube address they open.
 */

export interface PageSourceRef {
  video_id: string;
  t: number;
}

export interface CiteLink {
  /** 'AI Engineer 16:01' for the first time of a video, '· 3:55' for the next ones. */
  label: string;
  href: string;
  /**
   * Space before the link (README §출처 표시, revised): 2 px after the text's trailing space,
   * 3 px between times of one video.
   */
  gap: 2 | 3;
}

const SEC_PER_MIN = 60;
const SEC_PER_HOUR = 3600;
const pad2 = (n: number): string => (n < 10 ? '0' : '') + n;

/** 961 -> '16:01', 46 -> '0:46', 3725 -> '1:02:05'. */
export function stampOf(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / SEC_PER_HOUR);
  const m = Math.floor((s % SEC_PER_HOUR) / SEC_PER_MIN);
  const r = s % SEC_PER_MIN;
  return h > 0 ? h + ':' + pad2(m) + ':' + pad2(r) : m + ':' + pad2(r);
}

/** The video on YouTube, at `t` seconds when given (opened in a new window). */
export function youtubeAt(videoId: string, t?: number): string {
  return (
    'https://www.youtube.com/watch?v=' +
    encodeURIComponent(videoId) +
    (t != null && t > 0 ? '&t=' + Math.floor(t) + 's' : '')
  );
}

/**
 * Source links in order: each video's channel with its first time, then '· time' for its next
 * times (README: "시점이 여럿이면 둘째부터 '· 3:55'로 잇고"). Sources of one video that are not
 * next to each other are grouped at the first one's place.
 */
export function citeLinks(
  sources: readonly PageSourceRef[],
  channelOf: (videoId: string) => string
): CiteLink[] {
  const order: string[] = [];
  const times = new Map<string, number[]>();
  for (const s of sources) {
    if (!times.has(s.video_id)) {
      times.set(s.video_id, []);
      order.push(s.video_id);
    }
    times.get(s.video_id)!.push(s.t);
  }
  const out: CiteLink[] = [];
  for (const id of order) {
    const ch = channelOf(id);
    // t 0 = no time in the video: the channel name alone (README "시점이 없는 영상은 채널 이름만")
    const ts = times.get(id) ?? [];
    const timed = ts.filter((t) => t > 0);
    if (timed.length === 0) {
      out.push({ label: ch || id, href: youtubeAt(id), gap: 2 });
      continue;
    }
    timed.forEach((t, i) =>
      out.push({
        label: i === 0 ? (ch ? ch + ' ' : '') + stampOf(t) : '· ' + stampOf(t),
        href: youtubeAt(id, t),
        gap: i === 0 ? 2 : 3,
      })
    );
  }
  return out;
}
