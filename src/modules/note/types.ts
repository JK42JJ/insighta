/**
 * Note Module Types
 *
 * Data structures for video note-taking functionality
 */

/**
 * Video note with metadata
 */
export interface VideoNote {
  id: string;
  videoId: string;
  timestamp: number; // in seconds
  content: string; // Markdown text
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Note creation input
 */
export interface CreateNoteInput {
  videoId: string;
  timestamp: number;
  content: string;
  tags?: string[];
}

/**
 * Note update input
 */
export interface UpdateNoteInput {
  content?: string;
  tags?: string[];
  timestamp?: number;
}

/**
 * Note search filters
 */
export interface NoteSearchFilters {
  videoId?: string;
  tags?: string[];
  contentSearch?: string; // Search in content
  timestampRange?: {
    start: number;
    end: number;
  };
}

/**
 * Note operation result
 */
export interface NoteOperationResult {
  success: boolean;
  note?: VideoNote;
  error?: string;
}

/**
 * Export format options
 */
export type ExportFormat = 'markdown' | 'json' | 'csv';

/**
 * Export result
 */
export interface ExportResult {
  success: boolean;
  format: ExportFormat;
  content?: string;
  filepath?: string;
  error?: string;
}
