/**
 * Note Manager Unit Tests
 *
 * Tests for NoteManager implementation:
 * - Note CRUD operations
 * - Note search with filters
 * - Note export (Markdown, JSON, CSV)
 * - Timestamp formatting
 */

import { NoteManager, getNoteManager } from '../../../src/modules/note/manager';
import { logger } from '../../../src/utils/logger';
import type {
  CreateNoteInput,
  UpdateNoteInput,
  NoteSearchFilters,
  ExportFormat,
} from '../../../src/modules/note/types';
import * as fs from 'fs';
import * as path from 'path';

// Mock dependencies
jest.mock('../../../src/config', () => ({
  config: {
    app: {
      isDevelopment: false,
    },
    paths: {
      logs: '/tmp/logs',
    },
  },
}));
// Mock database
const mockDb: any = {
  video: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
  },
  videoNote: {
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
  },
};

jest.mock('../../../src/modules/database', () => ({
  getPrismaClient: jest.fn(() => mockDb),
}));
jest.mock('../../../src/utils/logger');
jest.mock('fs');
jest.mock('path', () => {
  const actualPath = jest.requireActual('path');
  return {
    ...actualPath,
    dirname: jest.fn((p) => actualPath.dirname(p)),
  };
});

describe('NoteManager', () => {
  let manager: NoteManager;

  // Mock data
  const mockVideo = {
    id: 'video-db-1',
    youtubeId: 'video-yt-1',
    title: 'Test Video',
  };

  const mockDbNote = {
    id: 'note-1',
    videoId: 'video-db-1',
    timestamp: 120,
    content: 'This is a test note',
    tags: JSON.stringify(['important', 'review']),
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-02'),
  };

  const mockVideoNote = {
    id: 'note-1',
    videoId: 'video-db-1',
    timestamp: 120,
    content: 'This is a test note',
    tags: ['important', 'review'],
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-02'),
  };

  beforeEach(() => {
    jest.clearAllMocks();

    manager = new NoteManager();
  });

  describe('createNote', () => {
    const createInput: CreateNoteInput = {
      videoId: 'video-yt-1',
      timestamp: 120,
      content: 'This is a test note',
      tags: ['important', 'review'],
    };

    test('should create note successfully', async () => {
      mockDb.video.findUnique.mockResolvedValue(mockVideo);
      mockDb.videoNote.create.mockResolvedValue(mockDbNote);

      const result = await manager.createNote(createInput);

      expect(result.success).toBe(true);
      expect(result.note).toEqual(mockVideoNote);
      expect(mockDb.video.findUnique).toHaveBeenCalledWith({
        where: { youtubeId: 'video-yt-1' },
      });
      expect(mockDb.videoNote.create).toHaveBeenCalledWith({
        data: {
          videoId: 'video-db-1',
          timestamp: 120,
          content: 'This is a test note',
          tags: JSON.stringify(['important', 'review']),
        },
      });
      expect(logger.info).toHaveBeenCalledWith('Note created', { noteId: 'note-1' });
    });

    test('should create note without tags', async () => {
      const inputWithoutTags = { ...createInput, tags: undefined };
      mockDb.video.findUnique.mockResolvedValue(mockVideo);
      mockDb.videoNote.create.mockResolvedValue({ ...mockDbNote, tags: null });

      const result = await manager.createNote(inputWithoutTags);

      expect(result.success).toBe(true);
      expect(mockDb.videoNote.create).toHaveBeenCalledWith({
        data: {
          videoId: 'video-db-1',
          timestamp: 120,
          content: 'This is a test note',
          tags: null,
        },
      });
    });

    test('should return error when video not found', async () => {
      mockDb.video.findUnique.mockResolvedValue(null);

      const result = await manager.createNote(createInput);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Video not found in database');
      expect(mockDb.videoNote.create).not.toHaveBeenCalled();
    });

    test('should handle database errors', async () => {
      const dbError = new Error('Database connection failed');
      mockDb.video.findUnique.mockRejectedValue(dbError);

      const result = await manager.createNote(createInput);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Database connection failed');
      expect(logger.error).toHaveBeenCalled();
    });

    test('should handle non-Error objects', async () => {
      mockDb.video.findUnique.mockRejectedValue('Unknown error');

      const result = await manager.createNote(createInput);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown error');
    });
  });

  describe('updateNote', () => {
    const updateInput: UpdateNoteInput = {
      content: 'Updated content',
      tags: ['updated'],
      timestamp: 180,
    };

    test('should update note successfully', async () => {
      const updatedDbNote = {
        ...mockDbNote,
        content: 'Updated content',
        tags: JSON.stringify(['updated']),
        timestamp: 180,
      };
      mockDb.videoNote.update.mockResolvedValue(updatedDbNote);

      const result = await manager.updateNote('note-1', updateInput);

      expect(result.success).toBe(true);
      expect(result.note?.content).toBe('Updated content');
      expect(result.note?.tags).toEqual(['updated']);
      expect(result.note?.timestamp).toBe(180);
      expect(mockDb.videoNote.update).toHaveBeenCalledWith({
        where: { id: 'note-1' },
        data: {
          content: 'Updated content',
          tags: JSON.stringify(['updated']),
          timestamp: 180,
        },
      });
    });

    test('should update only specified fields', async () => {
      const partialUpdate: UpdateNoteInput = {
        content: 'Only content updated',
      };
      mockDb.videoNote.update.mockResolvedValue({
        ...mockDbNote,
        content: 'Only content updated',
      });

      const result = await manager.updateNote('note-1', partialUpdate);

      expect(result.success).toBe(true);
      expect(mockDb.videoNote.update).toHaveBeenCalledWith({
        where: { id: 'note-1' },
        data: {
          content: 'Only content updated',
        },
      });
    });

    test('should handle note not found', async () => {
      const notFoundError = new Error('Record not found');
      mockDb.videoNote.update.mockRejectedValue(notFoundError);

      const result = await manager.updateNote('non-existent', updateInput);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Record not found');
      expect(logger.error).toHaveBeenCalled();
    });

    test('should handle database errors', async () => {
      const dbError = new Error('Database error');
      mockDb.videoNote.update.mockRejectedValue(dbError);

      const result = await manager.updateNote('note-1', updateInput);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Database error');
    });
  });

  describe('deleteNote', () => {
    test('should delete note successfully', async () => {
      mockDb.videoNote.delete.mockResolvedValue(mockDbNote);

      const result = await manager.deleteNote('note-1');

      expect(result.success).toBe(true);
      expect(mockDb.videoNote.delete).toHaveBeenCalledWith({
        where: { id: 'note-1' },
      });
      expect(logger.info).toHaveBeenCalledWith('Note deleted', { noteId: 'note-1' });
    });

    test('should handle note not found', async () => {
      const notFoundError = new Error('Record not found');
      mockDb.videoNote.delete.mockRejectedValue(notFoundError);

      const result = await manager.deleteNote('non-existent');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Record not found');
      expect(logger.error).toHaveBeenCalled();
    });

    test('should handle database errors', async () => {
      const dbError = new Error('Database error');
      mockDb.videoNote.delete.mockRejectedValue(dbError);

      const result = await manager.deleteNote('note-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Database error');
    });
  });

  describe('getNote', () => {
    test('should get note by ID successfully', async () => {
      mockDb.videoNote.findUnique.mockResolvedValue(mockDbNote);

      const result = await manager.getNote('note-1');

      expect(result).toEqual(mockVideoNote);
      expect(mockDb.videoNote.findUnique).toHaveBeenCalledWith({
        where: { id: 'note-1' },
      });
    });

    test('should return null when note not found', async () => {
      mockDb.videoNote.findUnique.mockResolvedValue(null);

      const result = await manager.getNote('non-existent');

      expect(result).toBeNull();
    });

    test('should handle database errors', async () => {
      const dbError = new Error('Database error');
      mockDb.videoNote.findUnique.mockRejectedValue(dbError);

      const result = await manager.getNote('note-1');

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('searchNotes', () => {
    const mockNotes = [
      mockDbNote,
      {
        ...mockDbNote,
        id: 'note-2',
        timestamp: 240,
        content: 'Second note',
        tags: JSON.stringify(['important']),
      },
      {
        ...mockDbNote,
        id: 'note-3',
        timestamp: 360,
        content: 'Third note',
        tags: null,
      },
    ];

    test('should search notes by video ID', async () => {
      mockDb.video.findUnique.mockResolvedValue(mockVideo);
      mockDb.videoNote.findMany.mockResolvedValue(mockNotes);

      const filters: NoteSearchFilters = { videoId: 'video-yt-1' };
      const result = await manager.searchNotes(filters);

      expect(result).toHaveLength(3);
      expect(mockDb.video.findUnique).toHaveBeenCalledWith({
        where: { youtubeId: 'video-yt-1' },
      });
      expect(mockDb.videoNote.findMany).toHaveBeenCalledWith({
        where: { videoId: 'video-db-1' },
        orderBy: [{ videoId: 'asc' }, { timestamp: 'asc' }],
      });
    });

    test('should search notes by timestamp range', async () => {
      mockDb.videoNote.findMany.mockResolvedValue([mockNotes[0], mockNotes[1]]);

      const filters: NoteSearchFilters = {
        timestampRange: { start: 100, end: 250 },
      };
      await manager.searchNotes(filters);

      expect(mockDb.videoNote.findMany).toHaveBeenCalledWith({
        where: {
          timestamp: { gte: 100, lte: 250 },
        },
        orderBy: [{ videoId: 'asc' }, { timestamp: 'asc' }],
      });
    });

    test('should search notes by content', async () => {
      mockDb.videoNote.findMany.mockResolvedValue([mockNotes[1]]);

      const filters: NoteSearchFilters = { contentSearch: 'Second' };
      await manager.searchNotes(filters);

      expect(mockDb.videoNote.findMany).toHaveBeenCalledWith({
        where: {
          content: { contains: 'Second' },
        },
        orderBy: [{ videoId: 'asc' }, { timestamp: 'asc' }],
      });
    });

    test('should filter notes by tags (client-side)', async () => {
      mockDb.videoNote.findMany.mockResolvedValue(mockNotes);

      const filters: NoteSearchFilters = { tags: ['review'] };
      const result = await manager.searchNotes(filters);

      // Only notes with 'review' tag (note-1 has ['important', 'review'])
      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe('note-1');
    });

    test('should combine multiple filters', async () => {
      mockDb.video.findUnique.mockResolvedValue(mockVideo);
      mockDb.videoNote.findMany.mockResolvedValue([mockNotes[0]]);

      const filters: NoteSearchFilters = {
        videoId: 'video-yt-1',
        timestampRange: { start: 100, end: 150 },
        contentSearch: 'test',
      };
      await manager.searchNotes(filters);

      expect(mockDb.videoNote.findMany).toHaveBeenCalledWith({
        where: {
          videoId: 'video-db-1',
          timestamp: { gte: 100, lte: 150 },
          content: { contains: 'test' },
        },
        orderBy: [{ videoId: 'asc' }, { timestamp: 'asc' }],
      });
    });

    test('should return empty array when no notes found', async () => {
      mockDb.videoNote.findMany.mockResolvedValue([]);

      const filters: NoteSearchFilters = { videoId: 'non-existent' };
      const result = await manager.searchNotes(filters);

      expect(result).toEqual([]);
    });

    test('should handle database errors', async () => {
      const dbError = new Error('Database error');
      mockDb.videoNote.findMany.mockRejectedValue(dbError);

      const filters: NoteSearchFilters = {};
      const result = await manager.searchNotes(filters);

      expect(result).toEqual([]);
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('getVideoNotes', () => {
    test('should get all notes for a video', async () => {
      mockDb.video.findUnique.mockResolvedValue(mockVideo);
      mockDb.videoNote.findMany.mockResolvedValue([mockDbNote]);

      const result = await manager.getVideoNotes('video-yt-1');

      expect(result).toHaveLength(1);
      expect(result[0]!.videoId).toBe('video-db-1');
    });
  });

  describe('exportNotes', () => {
    const mockNotes = [mockDbNote];

    beforeEach(() => {
      mockDb.video.findUnique.mockResolvedValue(mockVideo);
      mockDb.video.findFirst.mockResolvedValue(mockVideo);
      mockDb.videoNote.findMany.mockResolvedValue(mockNotes);
    });

    test('should export notes to Markdown format', async () => {
      const filters: NoteSearchFilters = {};
      const result = await manager.exportNotes(filters, 'markdown');

      expect(result.success).toBe(true);
      expect(result.format).toBe('markdown');
      expect(result.content).toContain('# Video Notes');
      expect(result.content).toContain('## Test Video');
      expect(result.content).toContain('[2:00]');
      expect(result.content).toContain('This is a test note');
    });

    test('should export notes to JSON format', async () => {
      const filters: NoteSearchFilters = {};
      const result = await manager.exportNotes(filters, 'json');

      expect(result.success).toBe(true);
      expect(result.format).toBe('json');
      expect(result.content).toBeDefined();

      const parsed = JSON.parse(result.content!);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].content).toBe('This is a test note');
    });

    test('should export notes to CSV format', async () => {
      const filters: NoteSearchFilters = {};
      const result = await manager.exportNotes(filters, 'csv');

      expect(result.success).toBe(true);
      expect(result.format).toBe('csv');
      expect(result.content).toContain('Video ID,Timestamp,Tags,Content');
      expect(result.content).toContain('video-db-1,120');
    });

    test('should save to file when output path provided', async () => {
      (path.dirname as jest.Mock).mockReturnValue('/tmp');
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.writeFileSync as jest.Mock).mockImplementation(() => {});

      const filters: NoteSearchFilters = {};
      const outputPath = '/tmp/notes.md';
      const result = await manager.exportNotes(filters, 'markdown', outputPath);

      expect(result.success).toBe(true);
      expect(result.filepath).toBe(outputPath);
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        outputPath,
        expect.any(String),
        'utf-8'
      );
    });

    test('should create directory if not exists when saving file', async () => {
      (path.dirname as jest.Mock).mockReturnValue('/tmp/notes');
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      (fs.mkdirSync as jest.Mock).mockImplementation(() => {});
      (fs.writeFileSync as jest.Mock).mockImplementation(() => {});

      const filters: NoteSearchFilters = {};
      const outputPath = '/tmp/notes/export.md';
      const result = await manager.exportNotes(filters, 'markdown', outputPath);

      expect(result.success).toBe(true);
      expect(fs.mkdirSync).toHaveBeenCalledWith('/tmp/notes', { recursive: true });
    });

    test('should return error when no notes found', async () => {
      mockDb.videoNote.findMany.mockResolvedValue([]);

      const filters: NoteSearchFilters = {};
      const result = await manager.exportNotes(filters, 'markdown');

      expect(result.success).toBe(false);
      expect(result.error).toBe('No notes found matching the filters');
    });

    test('should handle unsupported format', async () => {
      const filters: NoteSearchFilters = {};
      const result = await manager.exportNotes(filters, 'xml' as ExportFormat);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unsupported format');
    });

    test('should handle file write errors', async () => {
      (path.dirname as jest.Mock).mockReturnValue('/tmp');
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.writeFileSync as jest.Mock).mockImplementation(() => {
        throw new Error('Permission denied');
      });

      const filters: NoteSearchFilters = {};
      const result = await manager.exportNotes(filters, 'markdown', '/tmp/notes.md');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Permission denied');
    });
  });

  describe('formatTimestamp', () => {
    test('should format timestamp with hours', () => {
      const formatted = (manager as any).formatTimestamp(3661); // 1:01:01
      expect(formatted).toBe('1:01:01');
    });

    test('should format timestamp without hours', () => {
      const formatted = (manager as any).formatTimestamp(125); // 2:05
      expect(formatted).toBe('2:05');
    });

    test('should pad minutes and seconds', () => {
      const formatted = (manager as any).formatTimestamp(3605); // 1:00:05
      expect(formatted).toBe('1:00:05');
    });

    test('should format zero timestamp', () => {
      const formatted = (manager as any).formatTimestamp(0);
      expect(formatted).toBe('0:00');
    });
  });

  describe('mapToVideoNote', () => {
    test('should map database note to VideoNote', () => {
      const mapped = (manager as any).mapToVideoNote(mockDbNote);

      expect(mapped).toEqual(mockVideoNote);
    });

    test('should handle note without tags', () => {
      const noteWithoutTags = { ...mockDbNote, tags: null };
      const mapped = (manager as any).mapToVideoNote(noteWithoutTags);

      expect(mapped.tags).toEqual([]);
    });
  });

  describe('getNoteManager', () => {
    test('should return singleton instance', () => {
      const instance1 = getNoteManager();
      const instance2 = getNoteManager();

      expect(instance1).toBe(instance2);
    });

    test('should return NoteManager instance', () => {
      const instance = getNoteManager();

      expect(instance).toBeInstanceOf(NoteManager);
    });
  });
});
