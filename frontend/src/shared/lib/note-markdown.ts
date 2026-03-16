export interface ParsedSegment {
  type: 'text' | 'timestamp' | 'link' | 'image';
  content: string;
  url?: string;
  seconds?: number;
  imageUrl?: string;
}

export interface ParsedLine {
  segments: ParsedSegment[];
}

const COMBINED_REGEX = /!\[([^\]]*)\]\((https?:\/\/[^)]+)\)|\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;

export function extractTimestampSeconds(url: string): number | null {
  const tMatch = url.match(/[?&]t=(\d+)/);
  return tMatch ? parseInt(tMatch[1], 10) : null;
}

function extractImageSeconds(url: string): number | null {
  const tMatch = url.match(/#t=(\d+)s/);
  return tMatch ? parseInt(tMatch[1], 10) : null;
}

function isYouTubeUrl(url: string): boolean {
  return url.includes('youtube.com') || url.includes('youtu.be');
}

export function parseNoteMarkdown(note: string): ParsedLine[] {
  return note.split('\n').map((line) => {
    const segments: ParsedSegment[] = [];
    const regex = new RegExp(COMBINED_REGEX.source, 'g');
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(line)) !== null) {
      if (match.index > lastIndex) {
        segments.push({
          type: 'text',
          content: line.slice(lastIndex, match.index),
        });
      }

      const isImage = match[0].startsWith('!');

      if (isImage) {
        const imgAlt = match[1];
        const imgUrl = match[2];
        segments.push({
          type: 'image',
          content: imgAlt,
          url: imgUrl,
          imageUrl: imgUrl.replace(/#t=\d+s$/, ''),
          seconds: extractImageSeconds(imgUrl),
        });
      } else {
        const label = match[3];
        const url = match[4];
        const isYT = isYouTubeUrl(url);
        const seconds = isYT ? extractTimestampSeconds(url) : null;

        segments.push({
          type: isYT && seconds !== null ? 'timestamp' : 'link',
          content: label,
          url,
          seconds: seconds ?? undefined,
        });
      }

      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < line.length) {
      segments.push({
        type: 'text',
        content: line.slice(lastIndex),
      });
    }

    if (segments.length === 0 && line) {
      segments.push({ type: 'text', content: line });
    }

    return { segments };
  });
}
