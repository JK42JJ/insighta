/**
 * Note Manager
 *
 * Manages video notes with CRUD operations, search, and export functionality
 */

import { getPrismaClient } from '../database';
import { logger } from '../../utils/logger';
import type {
  VideoNote,
  CreateNoteInput,
  UpdateNoteInput,
  NoteSearchFilters,
  NoteOperationResult,
  ExportFormat,
  ExportResult,
} from './types';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Note Manager Service
 */
export class NoteManager {
  private db = getPrismaClient();

  /**
   * Create a new note
   */
  public async createNote(input: CreateNoteInput): Promise<NoteOperationResult> {
    try {
      logger.info('Creating note', { videoId: input.videoId, timestamp: input.timestamp });

      // Verify video exists
      const video = await this.db.video.findUnique({
        where: { youtubeId: input.videoId },
      });

      if (!video) {
        return {
          success: false,
          error: 'Video not found in database',
        };
      }

      // Create note
      const note = await this.db.videoNote.create({
        data: {
          videoId: video.id,
          timestamp: input.timestamp,
          content: input.content,
          tags: input.tags ? JSON.stringify(input.tags) : null,
        },
      });

      logger.info('Note created', { noteId: note.id });

      return {
        success: true,
        note: this.mapToVideoNote(note),
      };
    } catch (error) {
      logger.error('Failed to create note', { error });
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Update an existing note
   */
  public async updateNote(noteId: string, input: UpdateNoteInput): Promise<NoteOperationResult> {
    try {
      logger.info('Updating note', { noteId });

      const updateData: any = {};
      if (input.content !== undefined) updateData.content = input.content;
      if (input.timestamp !== undefined) updateData.timestamp = input.timestamp;
      if (input.tags !== undefined) updateData.tags = JSON.stringify(input.tags);

      const note = await this.db.videoNote.update({
        where: { id: noteId },
        data: updateData,
      });

      logger.info('Note updated', { noteId });

      return {
        success: true,
        note: this.mapToVideoNote(note),
      };
    } catch (error) {
      logger.error('Failed to update note', { noteId, error });
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Delete a note
   */
  public async deleteNote(noteId: string): Promise<NoteOperationResult> {
    try {
      logger.info('Deleting note', { noteId });

      await this.db.videoNote.delete({
        where: { id: noteId },
      });

      logger.info('Note deleted', { noteId });

      return {
        success: true,
      };
    } catch (error) {
      logger.error('Failed to delete note', { noteId, error });
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get a note by ID
   */
  public async getNote(noteId: string): Promise<VideoNote | null> {
    try {
      const note = await this.db.videoNote.findUnique({
        where: { id: noteId },
      });

      if (!note) {
        return null;
      }

      return this.mapToVideoNote(note);
    } catch (error) {
      logger.error('Failed to get note', { noteId, error });
      return null;
    }
  }

  /**
   * Search notes with filters
   */
  public async searchNotes(filters: NoteSearchFilters): Promise<VideoNote[]> {
    try {
      logger.info('Searching notes', { filters });

      const where: any = {};

      // Filter by video
      if (filters.videoId) {
        const video = await this.db.video.findUnique({
          where: { youtubeId: filters.videoId },
        });
        if (video) {
          where.videoId = video.id;
        }
      }

      // Filter by timestamp range
      if (filters.timestampRange) {
        where.timestamp = {
          gte: filters.timestampRange.start,
          lte: filters.timestampRange.end,
        };
      }

      // Filter by content search
      if (filters.contentSearch) {
        where.content = {
          contains: filters.contentSearch,
        };
      }

      const notes = await this.db.videoNote.findMany({
        where,
        orderBy: [{ videoId: 'asc' }, { timestamp: 'asc' }],
      });

      // Filter by tags (client-side since tags are stored as JSON)
      let filteredNotes = notes;
      if (filters.tags && filters.tags.length > 0) {
        filteredNotes = notes.filter(note => {
          if (!note.tags) return false;
          const noteTags = JSON.parse(note.tags);
          return filters.tags!.some(tag => noteTags.includes(tag));
        });
      }

      return filteredNotes.map(note => this.mapToVideoNote(note));
    } catch (error) {
      logger.error('Failed to search notes', { filters, error });
      return [];
    }
  }

  /**
   * Get all notes for a video
   */
  public async getVideoNotes(videoId: string): Promise<VideoNote[]> {
    return this.searchNotes({ videoId });
  }

  /**
   * Export notes in specified format
   */
  public async exportNotes(
    filters: NoteSearchFilters,
    format: ExportFormat,
    outputPath?: string
  ): Promise<ExportResult> {
    try {
      logger.info('Exporting notes', { filters, format });

      const notes = await this.searchNotes(filters);

      if (notes.length === 0) {
        return {
          success: false,
          format,
          error: 'No notes found matching the filters',
        };
      }

      let content: string;

      switch (format) {
        case 'markdown':
          content = await this.exportToMarkdown(notes);
          break;
        case 'json':
          content = this.exportToJSON(notes);
          break;
        case 'csv':
          content = this.exportToCSV(notes);
          break;
        default:
          return {
            success: false,
            format,
            error: `Unsupported format: ${format}`,
          };
      }

      // Save to file if path provided
      if (outputPath) {
        const dir = path.dirname(outputPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(outputPath, content, 'utf-8');
        logger.info('Notes exported to file', { filepath: outputPath });
        return {
          success: true,
          format,
          filepath: outputPath,
        };
      }

      return {
        success: true,
        format,
        content,
      };
    } catch (error) {
      logger.error('Failed to export notes', { error });
      return {
        success: false,
        format,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Export notes to Markdown format
   */
  private async exportToMarkdown(notes: VideoNote[]): Promise<string> {
    const lines: string[] = ['# Video Notes\n'];

    // Group notes by video
    const notesByVideo = new Map<string, VideoNote[]>();
    for (const note of notes) {
      if (!notesByVideo.has(note.videoId)) {
        notesByVideo.set(note.videoId, []);
      }
      notesByVideo.get(note.videoId)!.push(note);
    }

    // Format each video's notes
    for (const [videoId, videoNotes] of notesByVideo) {
      // Get video title
      const video = await this.db.video.findFirst({
        where: { id: videoId },
      });

      lines.push(`## ${video?.title || videoId}\n`);
      if (video?.youtubeId) {
        lines.push(`**Video ID**: ${video.youtubeId}\n`);
      }
      lines.push('');

      // Add each note
      for (const note of videoNotes) {
        const timestamp = this.formatTimestamp(note.timestamp);
        lines.push(`### [${timestamp}]`);
        if (note.tags.length > 0) {
          lines.push(`**Tags**: ${note.tags.join(', ')}`);
        }
        lines.push('');
        lines.push(note.content);
        lines.push('');
        lines.push('---\n');
      }
    }

    return lines.join('\n');
  }

  /**
   * Export notes to JSON format
   */
  private exportToJSON(notes: VideoNote[]): string {
    return JSON.stringify(notes, null, 2);
  }

  /**
   * Export notes to CSV format
   */
  private exportToCSV(notes: VideoNote[]): string {
    const lines: string[] = ['Video ID,Timestamp,Tags,Content,Created At,Updated At'];

    for (const note of notes) {
      const row = [
        note.videoId,
        note.timestamp.toString(),
        `"${note.tags.join(', ')}"`,
        `"${note.content.replace(/"/g, '""')}"`, // Escape quotes
        note.createdAt.toISOString(),
        note.updatedAt.toISOString(),
      ];
      lines.push(row.join(','));
    }

    return lines.join('\n');
  }

  /**
   * Format timestamp as HH:MM:SS
   */
  private formatTimestamp(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  }

  /**
   * Map database note to VideoNote type
   */
  private mapToVideoNote(note: any): VideoNote {
    return {
      id: note.id,
      videoId: note.videoId,
      timestamp: note.timestamp,
      content: note.content,
      tags: note.tags ? JSON.parse(note.tags) : [],
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
    };
  }
}

/**
 * Singleton instance
 */
let managerInstance: NoteManager | null = null;

/**
 * Get note manager instance
 */
export function getNoteManager(): NoteManager {
  if (!managerInstance) {
    managerInstance = new NoteManager();
  }
  return managerInstance;
}

export default getNoteManager;
