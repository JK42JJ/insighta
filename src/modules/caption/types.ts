/**
 * Caption Module Types
 *
 * Data structures for video caption extraction and management
 */

/**
 * Caption segment with timestamp
 */
export interface CaptionSegment {
  text: string;
  start: number; // in seconds
  duration: number; // in seconds
}

/**
 * Caption metadata
 */
export interface CaptionMetadata {
  videoId: string;
  language: string;
  fullText: string;
  segments: CaptionSegment[];
}

/**
 * Caption extraction result
 */
export interface CaptionExtractionResult {
  success: boolean;
  videoId: string;
  language: string;
  caption?: CaptionMetadata;
  error?: string;
}

/**
 * Available caption languages for a video
 */
export interface AvailableLanguages {
  videoId: string;
  languages: string[];
}
