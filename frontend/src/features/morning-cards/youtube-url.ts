/** Official YouTube URL builders. Only valid 11-character video ids are accepted. */
const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

export function isValidYoutubeVideoId(id: unknown): id is string {
  return typeof id === 'string' && YOUTUBE_VIDEO_ID_PATTERN.test(id);
}

export function buildYoutubeWatchUrl(id: unknown): string | null {
  return isValidYoutubeVideoId(id) ? `https://www.youtube.com/watch?v=${id}` : null;
}

export function buildYoutubeEmbedUrl(id: unknown): string | null {
  return isValidYoutubeVideoId(id) ? `https://www.youtube.com/embed/${id}` : null;
}
