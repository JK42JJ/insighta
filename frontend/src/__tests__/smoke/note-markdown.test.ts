import { describe, it, expect } from 'vitest';
import {
  parseNoteMarkdown,
  extractTimestampSeconds,
} from '@shared/lib/note-markdown';

describe('extractTimestampSeconds', () => {
  it('extracts t param from YouTube URL', () => {
    expect(
      extractTimestampSeconds('https://youtube.com/watch?v=abc&t=120')
    ).toBe(120);
  });

  it('extracts t as first param', () => {
    expect(
      extractTimestampSeconds('https://youtube.com/watch?t=42&v=abc')
    ).toBe(42);
  });

  it('returns null when no t param', () => {
    expect(
      extractTimestampSeconds('https://youtube.com/watch?v=abc')
    ).toBeNull();
  });

  it('returns null for non-numeric t', () => {
    expect(
      extractTimestampSeconds('https://youtube.com/watch?t=abc')
    ).toBeNull();
  });
});

describe('parseNoteMarkdown', () => {
  it('parses plain text', () => {
    const result = parseNoteMarkdown('Hello world');
    expect(result).toHaveLength(1);
    expect(result[0].segments).toEqual([
      { type: 'text', content: 'Hello world' },
    ]);
  });

  it('parses multiple lines', () => {
    const result = parseNoteMarkdown('Line 1\nLine 2\nLine 3');
    expect(result).toHaveLength(3);
    expect(result[0].segments[0].content).toBe('Line 1');
    expect(result[2].segments[0].content).toBe('Line 3');
  });

  it('parses markdown link', () => {
    const result = parseNoteMarkdown(
      '[Click here](https://example.com/article)'
    );
    expect(result[0].segments).toEqual([
      {
        type: 'link',
        content: 'Click here',
        url: 'https://example.com/article',
        seconds: undefined,
      },
    ]);
  });

  it('parses YouTube timestamp link', () => {
    const result = parseNoteMarkdown(
      '[0:30](https://youtube.com/watch?v=abc&t=30)'
    );
    expect(result[0].segments[0]).toMatchObject({
      type: 'timestamp',
      content: '0:30',
      url: 'https://youtube.com/watch?v=abc&t=30',
      seconds: 30,
    });
  });

  it('parses image markdown', () => {
    const result = parseNoteMarkdown(
      '![screenshot](https://example.com/img.png)'
    );
    expect(result[0].segments[0]).toMatchObject({
      type: 'image',
      content: 'screenshot',
      url: 'https://example.com/img.png',
      imageUrl: 'https://example.com/img.png',
    });
  });

  it('parses image with timestamp hash', () => {
    const result = parseNoteMarkdown(
      '![frame](https://example.com/thumb.jpg#t=45s)'
    );
    const seg = result[0].segments[0];
    expect(seg.type).toBe('image');
    expect(seg.seconds).toBe(45);
    expect(seg.imageUrl).toBe('https://example.com/thumb.jpg');
  });

  it('parses mixed text and links', () => {
    const result = parseNoteMarkdown(
      'Check [this link](https://example.com) for details'
    );
    const segs = result[0].segments;
    expect(segs).toHaveLength(3);
    expect(segs[0]).toEqual({ type: 'text', content: 'Check ' });
    expect(segs[1].type).toBe('link');
    expect(segs[2]).toEqual({ type: 'text', content: ' for details' });
  });

  it('handles empty string', () => {
    const result = parseNoteMarkdown('');
    expect(result).toHaveLength(1);
    expect(result[0].segments).toEqual([]);
  });

  it('classifies non-YouTube link without timestamp as link type', () => {
    const result = parseNoteMarkdown(
      '[article](https://example.com/page?t=30)'
    );
    expect(result[0].segments[0].type).toBe('link');
  });
});
