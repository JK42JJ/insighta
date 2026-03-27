import { describe, it, expect } from 'vitest';
import {
  detectFileType,
  isSupportedFileType,
  getFileIcon,
} from '@shared/lib/fileUpload';

describe('detectFileType', () => {
  it('detects .txt files', () => {
    expect(detectFileType('notes.txt')).toBe('txt');
  });

  it('detects .md files', () => {
    expect(detectFileType('README.md')).toBe('md');
  });

  it('detects .markdown files', () => {
    expect(detectFileType('guide.markdown')).toBe('md');
  });

  it('detects .pdf files', () => {
    expect(detectFileType('paper.pdf')).toBe('pdf');
  });

  it('returns other for unsupported extensions', () => {
    expect(detectFileType('image.png')).toBe('other');
    expect(detectFileType('script.js')).toBe('other');
    expect(detectFileType('data.csv')).toBe('other');
  });

  it('is case-insensitive', () => {
    expect(detectFileType('NOTES.TXT')).toBe('txt');
    expect(detectFileType('Report.PDF')).toBe('pdf');
    expect(detectFileType('README.MD')).toBe('md');
  });

  it('handles files with multiple dots', () => {
    expect(detectFileType('my.notes.txt')).toBe('txt');
    expect(detectFileType('v2.0.release.pdf')).toBe('pdf');
  });

  it('handles files with no extension', () => {
    expect(detectFileType('Makefile')).toBe('other');
  });
});

describe('isSupportedFileType', () => {
  it('returns true for supported types', () => {
    expect(isSupportedFileType('doc.txt')).toBe(true);
    expect(isSupportedFileType('doc.md')).toBe(true);
    expect(isSupportedFileType('doc.pdf')).toBe(true);
  });

  it('returns false for unsupported types', () => {
    expect(isSupportedFileType('image.png')).toBe(false);
    expect(isSupportedFileType('video.mp4')).toBe(false);
  });
});

describe('getFileIcon', () => {
  it('returns correct icon for txt', () => {
    expect(getFileIcon('txt')).toBe('📄');
  });

  it('returns correct icon for md', () => {
    expect(getFileIcon('md')).toBe('📝');
  });

  it('returns correct icon for pdf', () => {
    expect(getFileIcon('pdf')).toBe('📕');
  });

  it('returns default icon for other types', () => {
    expect(getFileIcon('other')).toBe('📎');
    expect(getFileIcon('youtube')).toBe('📎');
  });
});
