/**
 * Notes API Routes Unit Tests
 */

import Fastify, { FastifyInstance } from 'fastify';
import jwt from '@fastify/jwt';

// Mock dependencies
const mockGetVideo = jest.fn();
const mockSearchNotes = jest.fn();
const mockCreateNote = jest.fn();
const mockGetNote = jest.fn();
const mockUpdateNote = jest.fn();
const mockDeleteNote = jest.fn();
const mockExportNotes = jest.fn();

jest.mock('../../../src/modules/video', () => ({
  getVideoManager: () => ({
    getVideo: mockGetVideo,
  }),
}));

jest.mock('../../../src/modules/note/manager', () => ({
  getNoteManager: () => ({
    searchNotes: mockSearchNotes,
    createNote: mockCreateNote,
    getNote: mockGetNote,
    updateNote: mockUpdateNote,
    deleteNote: mockDeleteNote,
    exportNotes: mockExportNotes,
  }),
}));

import { noteRoutes } from '../../../src/api/routes/notes';

describe('Notes API Routes', () => {
  let app: FastifyInstance;
  let token: string;

  beforeEach(async () => {
    app = Fastify();

    // Register JWT
    await app.register(jwt, {
      secret: 'test-secret-key-for-notes-routes-testing',
    });

    // Add authenticate decorator
    app.decorate('authenticate', async function (request: any) {
      try {
        await request.jwtVerify();
      } catch (err) {
        const authError = new Error('Unauthorized') as any;
        authError.statusCode = 401;
        authError.code = 'UNAUTHORIZED';
        throw authError;
      }
    });

    // Add error handler
    app.setErrorHandler((error: any, request, reply) => {
      const timestamp = new Date().toISOString();
      const path = request.url;

      // Handle authentication errors
      if (error.statusCode === 401 || error.code === 'UNAUTHORIZED') {
        return reply.code(401).send({
          error: { code: 'UNAUTHORIZED', message: 'Invalid token', timestamp, path },
        });
      }
      // Handle Fastify JSON schema validation errors (AJV)
      if (error.validation || error.code === 'FST_ERR_VALIDATION') {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: error.message || 'Request validation failed',
            details: { validation: error.validation },
            timestamp,
            path,
          },
        });
      }
      // Handle Zod validation errors
      if (error.name === 'ZodError' || error.issues) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Validation failed',
            details: { issues: error.issues },
            timestamp,
            path,
          },
        });
      }
      return reply.code(error.statusCode || 500).send({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message || 'Internal server error',
          timestamp,
          path,
        },
      });
    });

    // Register routes - noteRoutes has both /videos/:id/notes and standalone /notes endpoints
    // We need to register with prefix /api/v1 to match routes
    await app.register(noteRoutes, { prefix: '/api/v1/notes' });

    await app.ready();

    // Generate test token
    token = app.jwt.sign({ userId: 'test-user-id' });

    // Reset mocks
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /api/v1/notes/videos/:id/notes', () => {
    test('should list notes for a video', async () => {
      const mockVideo = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        youtubeId: 'test123',
      };

      const mockNotes = [
        {
          id: 'note1',
          videoId: 'video123',
          timestamp: 120,
          content: 'Test note 1',
          tags: ['tag1', 'tag2'],
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
        },
        {
          id: 'note2',
          videoId: 'video123',
          timestamp: 240,
          content: 'Test note 2',
          tags: ['tag2'],
          createdAt: new Date('2024-01-02'),
          updatedAt: new Date('2024-01-02'),
        },
      ];

      mockGetVideo.mockResolvedValue(mockVideo);
      mockSearchNotes.mockResolvedValue(mockNotes);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/notes/videos/123e4567-e89b-12d3-a456-426614174000/notes',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.notes).toHaveLength(2);
      expect(body.total).toBe(2);
      expect(body.notes[0].content).toBe('Test note 1');
    });

    test('should filter notes by tags', async () => {
      const mockVideo = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        youtubeId: 'test123',
      };

      mockGetVideo.mockResolvedValue(mockVideo);
      mockSearchNotes.mockResolvedValue([]);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/notes/videos/123e4567-e89b-12d3-a456-426614174000/notes?tags=tag1&tags=tag2',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(mockSearchNotes).toHaveBeenCalledWith(
        expect.objectContaining({
          tags: ['tag1', 'tag2'],
        })
      );
    });

    test('should filter notes by timestamp range', async () => {
      const mockVideo = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        youtubeId: 'test123',
      };

      mockGetVideo.mockResolvedValue(mockVideo);
      mockSearchNotes.mockResolvedValue([]);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/notes/videos/123e4567-e89b-12d3-a456-426614174000/notes?timestampStart=100&timestampEnd=300',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(mockSearchNotes).toHaveBeenCalledWith(
        expect.objectContaining({
          timestampRange: {
            start: 100,
            end: 300,
          },
        })
      );
    });

    test('should require authentication', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/notes/videos/123e4567-e89b-12d3-a456-426614174000/notes',
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('POST /api/v1/notes/videos/:id/notes', () => {
    test('should create a note', async () => {
      const mockVideo = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        youtubeId: 'test123',
      };

      const mockNote = {
        id: 'note1',
        videoId: 'video123',
        timestamp: 120,
        content: 'New note',
        tags: ['tag1'],
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
      };

      mockGetVideo.mockResolvedValue(mockVideo);
      mockCreateNote.mockResolvedValue({
        success: true,
        note: mockNote,
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/notes/videos/123e4567-e89b-12d3-a456-426614174000/notes',
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          timestamp: 120,
          content: 'New note',
          tags: ['tag1'],
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.note.content).toBe('New note');
      expect(body.note.timestamp).toBe(120);
    });

    test('should validate required fields', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/notes/videos/123e4567-e89b-12d3-a456-426614174000/notes',
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          // Missing timestamp and content
          tags: ['tag1'],
        },
      });

      expect(response.statusCode).toBe(400);
    });

    test('should return 500 when creation fails', async () => {
      const mockVideo = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        youtubeId: 'test123',
      };

      mockGetVideo.mockResolvedValue(mockVideo);
      mockCreateNote.mockResolvedValue({
        success: false,
        error: 'Database error',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/notes/videos/123e4567-e89b-12d3-a456-426614174000/notes',
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          timestamp: 120,
          content: 'New note',
        },
      });

      expect(response.statusCode).toBe(500);
    });
  });

  describe('GET /api/v1/notes/:noteId', () => {
    test('should get a specific note', async () => {
      const mockNote = {
        id: 'note1',
        videoId: 'video123',
        timestamp: 120,
        content: 'Test note',
        tags: ['tag1'],
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
      };

      mockGetNote.mockResolvedValue(mockNote);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/notes/123e4567-e89b-12d3-a456-426614174000',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.note.content).toBe('Test note');
    });

    test('should return 404 for non-existent note', async () => {
      mockGetNote.mockResolvedValue(null);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/notes/123e4567-e89b-12d3-a456-426614174000',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('PATCH /api/v1/notes/:noteId', () => {
    test('should update a note', async () => {
      const mockNote = {
        id: 'note1',
        videoId: 'video123',
        timestamp: 120,
        content: 'Updated note',
        tags: ['tag1', 'tag2'],
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-02'),
      };

      mockUpdateNote.mockResolvedValue({
        success: true,
        note: mockNote,
      });

      const response = await app.inject({
        method: 'PATCH',
        url: '/api/v1/notes/123e4567-e89b-12d3-a456-426614174000',
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          content: 'Updated note',
          tags: ['tag1', 'tag2'],
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.note.content).toBe('Updated note');
    });

    test('should return 404 when update fails', async () => {
      mockUpdateNote.mockResolvedValue({
        success: false,
        error: 'Note not found',
      });

      const response = await app.inject({
        method: 'PATCH',
        url: '/api/v1/notes/123e4567-e89b-12d3-a456-426614174000',
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          content: 'Updated note',
        },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('DELETE /api/v1/notes/:noteId', () => {
    test('should delete a note', async () => {
      mockDeleteNote.mockResolvedValue({
        success: true,
      });

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/v1/notes/123e4567-e89b-12d3-a456-426614174000',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.message).toBe('Note deleted successfully');
    });

    test('should return 404 when deletion fails', async () => {
      mockDeleteNote.mockResolvedValue({
        success: false,
        error: 'Note not found',
      });

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/v1/notes/123e4567-e89b-12d3-a456-426614174000',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('GET /api/v1/notes/export', () => {
    test('should export notes in markdown format', async () => {
      const mockExportResult = {
        success: true,
        format: 'markdown' as const,
        content: '# Video Notes\n\n## Test Video\n...',
      };

      mockExportNotes.mockResolvedValue(mockExportResult);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/notes/export?format=markdown',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.format).toBe('markdown');
      expect(body.content).toContain('# Video Notes');
    });

    test('should export notes in json format', async () => {
      const mockNotes = [
        {
          id: 'note1',
          videoId: 'video123',
          timestamp: 120,
          content: 'Test note',
          tags: ['tag1'],
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
        },
      ];

      mockExportNotes.mockResolvedValue({
        success: true,
        format: 'json' as const,
        content: JSON.stringify(mockNotes, null, 2),
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/notes/export?format=json',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.format).toBe('json');
    });

    test('should export notes in csv format', async () => {
      mockExportNotes.mockResolvedValue({
        success: true,
        format: 'csv' as const,
        content:
          'Video ID,Timestamp,Tags,Content,Created At,Updated At\nvideo123,120,"tag1","Test note",2024-01-01,2024-01-01',
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/notes/export?format=csv',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.format).toBe('csv');
      expect(body.content).toContain('Video ID,Timestamp');
    });

    test('should filter export by videoId', async () => {
      mockExportNotes.mockResolvedValue({
        success: true,
        format: 'markdown' as const,
        content: '# Notes',
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/notes/export?videoId=test123&format=markdown',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(mockExportNotes).toHaveBeenCalledWith(
        expect.objectContaining({
          videoId: 'test123',
        }),
        'markdown'
      );
    });

    test('should filter export by tags', async () => {
      mockExportNotes.mockResolvedValue({
        success: true,
        format: 'markdown' as const,
        content: '# Notes',
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/notes/export?tags=tag1&tags=tag2&format=markdown',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(mockExportNotes).toHaveBeenCalledWith(
        expect.objectContaining({
          tags: ['tag1', 'tag2'],
        }),
        'markdown'
      );
    });

    test('should return 404 when no notes found', async () => {
      mockExportNotes.mockResolvedValue({
        success: false,
        format: 'markdown' as const,
        error: 'No notes found',
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/notes/export?format=markdown',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(404);
    });
  });
});
