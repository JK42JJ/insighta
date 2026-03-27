/**
 * Note Manager Unit Tests
 *
 * Tests for:
 * - formatTimestamp — HH:MM:SS formatting
 * - mapToVideoNote — DB record to VideoNote mapping
 * - exportToJSON — JSON export format
 * - exportToCSV — CSV export with escaping
 */

// ============================================================================
// Mocks
// ============================================================================

jest.mock('../../../src/modules/database', () => ({
  getPrismaClient: () => ({
    youtube_videos: { findUnique: jest.fn(), findFirst: jest.fn() },
    video_notes: {
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
  }),
}));

jest.mock('../../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// ============================================================================
// Imports
// ============================================================================

import { NoteManager } from '../../../src/modules/note/manager';

// ============================================================================
// Tests
// ============================================================================

describe('NoteManager', () => {
  describe('formatTimestamp (via exportNotes)', () => {
    // Access private method via prototype for testing
    const formatTimestamp = (seconds: number): string => {
      return (NoteManager.prototype as any).formatTimestamp.call(null, seconds);
    };

    it('formats seconds-only timestamps', () => {
      expect(formatTimestamp(0)).toBe('0:00');
      expect(formatTimestamp(5)).toBe('0:05');
      expect(formatTimestamp(30)).toBe('0:30');
      expect(formatTimestamp(59)).toBe('0:59');
    });

    it('formats minutes and seconds', () => {
      expect(formatTimestamp(60)).toBe('1:00');
      expect(formatTimestamp(90)).toBe('1:30');
      expect(formatTimestamp(125)).toBe('2:05');
      expect(formatTimestamp(3599)).toBe('59:59');
    });

    it('formats hours, minutes and seconds', () => {
      expect(formatTimestamp(3600)).toBe('1:00:00');
      expect(formatTimestamp(3661)).toBe('1:01:01');
      expect(formatTimestamp(7200)).toBe('2:00:00');
      expect(formatTimestamp(36000)).toBe('10:00:00');
    });
  });

  describe('mapToVideoNote', () => {
    const mapToVideoNote = (note: any) => {
      return (NoteManager.prototype as any).mapToVideoNote.call(null, note);
    };

    it('maps DB fields to VideoNote format', () => {
      const dbNote = {
        id: 'note-123',
        video_id: 'video-456',
        timestamp_seconds: 120,
        content: 'This is a test note',
        tags: '["tag1","tag2"]',
        created_at: new Date('2026-03-01'),
        updated_at: new Date('2026-03-02'),
      };

      const result = mapToVideoNote(dbNote);

      expect(result).toEqual({
        id: 'note-123',
        videoId: 'video-456',
        timestamp: 120,
        content: 'This is a test note',
        tags: ['tag1', 'tag2'],
        createdAt: new Date('2026-03-01'),
        updatedAt: new Date('2026-03-02'),
      });
    });

    it('handles null tags as empty array', () => {
      const dbNote = {
        id: 'note-123',
        video_id: 'video-456',
        timestamp_seconds: 0,
        content: 'No tags',
        tags: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      const result = mapToVideoNote(dbNote);
      expect(result.tags).toEqual([]);
    });

    it('handles empty tags JSON array', () => {
      const dbNote = {
        id: 'note-123',
        video_id: 'video-456',
        timestamp_seconds: 0,
        content: 'Empty tags',
        tags: '[]',
        created_at: new Date(),
        updated_at: new Date(),
      };

      const result = mapToVideoNote(dbNote);
      expect(result.tags).toEqual([]);
    });
  });

  describe('exportToJSON', () => {
    const exportToJSON = (notes: any[]) => {
      return (NoteManager.prototype as any).exportToJSON.call(null, notes);
    };

    it('exports notes as formatted JSON', () => {
      const notes = [
        {
          id: 'note-1',
          videoId: 'vid-1',
          timestamp: 60,
          content: 'Test note',
          tags: ['tag1'],
          createdAt: new Date('2026-03-01T00:00:00.000Z'),
          updatedAt: new Date('2026-03-02T00:00:00.000Z'),
        },
      ];

      const json = exportToJSON(notes);
      const parsed = JSON.parse(json);

      expect(parsed).toHaveLength(1);
      expect(parsed[0].id).toBe('note-1');
      expect(parsed[0].content).toBe('Test note');
    });

    it('handles empty array', () => {
      const json = exportToJSON([]);
      expect(JSON.parse(json)).toEqual([]);
    });
  });

  describe('exportToCSV', () => {
    const exportToCSV = (notes: any[]) => {
      return (NoteManager.prototype as any).exportToCSV.call(null, notes);
    };

    it('produces CSV with header row', () => {
      const csv = exportToCSV([]);
      expect(csv).toBe('Video ID,Timestamp,Tags,Content,Created At,Updated At');
    });

    it('escapes double quotes in content', () => {
      const notes = [
        {
          videoId: 'vid-1',
          timestamp: 30,
          tags: ['test'],
          content: 'He said "hello"',
          createdAt: new Date('2026-03-01T00:00:00.000Z'),
          updatedAt: new Date('2026-03-01T00:00:00.000Z'),
        },
      ];

      const csv = exportToCSV(notes);
      const lines = csv.split('\n');

      expect(lines).toHaveLength(2);
      // Content field should have escaped quotes
      expect(lines[1]).toContain('""hello""');
    });

    it('joins multiple tags with comma', () => {
      const notes = [
        {
          videoId: 'vid-1',
          timestamp: 0,
          tags: ['react', 'hooks', 'testing'],
          content: 'Note content',
          createdAt: new Date('2026-03-01T00:00:00.000Z'),
          updatedAt: new Date('2026-03-01T00:00:00.000Z'),
        },
      ];

      const csv = exportToCSV(notes);
      expect(csv).toContain('"react, hooks, testing"');
    });

    it('handles multiple notes', () => {
      const notes = [
        {
          videoId: 'vid-1',
          timestamp: 10,
          tags: [],
          content: 'Note 1',
          createdAt: new Date('2026-03-01T00:00:00.000Z'),
          updatedAt: new Date('2026-03-01T00:00:00.000Z'),
        },
        {
          videoId: 'vid-2',
          timestamp: 20,
          tags: ['tag'],
          content: 'Note 2',
          createdAt: new Date('2026-03-02T00:00:00.000Z'),
          updatedAt: new Date('2026-03-02T00:00:00.000Z'),
        },
      ];

      const csv = exportToCSV(notes);
      const lines = csv.split('\n');
      expect(lines).toHaveLength(3); // header + 2 data rows
    });
  });
});
