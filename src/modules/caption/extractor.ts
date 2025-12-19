/**
 * Caption Extractor
 *
 * Extracts captions/subtitles from YouTube videos
 * Supports multiple languages and automatic caption detection
 */

import { getSubtitles } from 'youtube-caption-extractor';
import { getPrismaClient } from '../database';
import { logger } from '../../utils/logger';
import type {
  CaptionSegment,
  CaptionMetadata,
  CaptionExtractionResult,
  AvailableLanguages,
} from './types';

/**
 * Caption Extractor Service
 */
export class CaptionExtractor {
  private db = getPrismaClient();

  /**
   * Extract captions for a video
   */
  public async extractCaptions(
    youtubeId: string,
    language?: string
  ): Promise<CaptionExtractionResult> {
    try {
      logger.info('Extracting captions', { videoId: youtubeId, language });

      // Get or create video record
      let video = await this.db.video.findUnique({
        where: { youtubeId },
      });

      if (!video) {
        // Video not in database yet, create a minimal record
        video = await this.db.video.create({
          data: {
            youtubeId,
            title: `Video ${youtubeId}`,
            channelId: 'unknown',
            channelTitle: 'Unknown',
            publishedAt: new Date(),
            duration: 0,
            thumbnailUrls: '[]',
          },
        });
        logger.info('Created video record', { youtubeId, videoId: video.id });
      }

      // Check if caption already exists in database
      const existing = await this.db.videoCaption.findUnique({
        where: {
          videoId_language: {
            videoId: video.id,
            language: language || 'en',
          },
        },
      });

      if (existing) {
        logger.info('Caption already exists in database', { youtubeId, language });
        return {
          success: true,
          videoId: youtubeId,
          language: language || 'en',
          caption: {
            videoId: youtubeId,
            language: existing.language,
            fullText: existing.text,
            segments: JSON.parse(existing.segments),
          },
        };
      }

      // Fetch captions from YouTube using youtube-caption-extractor
      const captionOptions = {
        videoID: youtubeId,
        lang: language || 'en',
      };
      logger.info('Fetching captions from YouTube', { youtubeId, options: captionOptions });

      const captionData = await getSubtitles(captionOptions);

      if (!captionData || captionData.length === 0) {
        throw new Error('No captions found for this video');
      }

      logger.info('Captions fetched successfully', { youtubeId, segments: captionData.length });

      // Convert to our format (ensure numeric types for start/duration)
      const segments: CaptionSegment[] = captionData.map((item: any) => ({
        text: item.text,
        start: parseFloat(item.start) || 0, // Convert to number
        duration: parseFloat(item.dur) || 0, // Convert to number
      }));

      const fullText = segments.map(s => s.text).join(' ');

      const caption: CaptionMetadata = {
        videoId: youtubeId,
        language: language || 'en',
        fullText,
        segments,
      };

      // Save to database
      await this.db.videoCaption.create({
        data: {
          videoId: video.id,
          language: language || 'en',
          text: fullText,
          segments: JSON.stringify(segments),
        },
      });

      logger.info('Caption extracted and saved', {
        youtubeId,
        videoId: video.id,
        language: language || 'en',
        segmentCount: segments.length,
      });

      return {
        success: true,
        videoId: youtubeId,
        language: language || 'en',
        caption,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      logger.error('Failed to extract captions', {
        videoId: youtubeId,
        language,
        errorMessage,
        errorStack,
        error,
      });
      return {
        success: false,
        videoId: youtubeId,
        language: language || 'en',
        error: errorMessage,
      };
    }
  }

  /**
   * Get available caption languages for a video
   */
  public async getAvailableLanguages(videoId: string): Promise<AvailableLanguages> {
    try {
      // Note: youtube-caption-extractor doesn't provide a direct way to list languages
      // We try common languages and see which ones work
      const commonLanguages = ['en', 'ko', 'ja', 'es', 'fr', 'de', 'zh'];
      const availableLanguages: string[] = [];

      for (const lang of commonLanguages) {
        try {
          const result = await getSubtitles({ videoID: videoId, lang });
          if (result && result.length > 0) {
            availableLanguages.push(lang);
          }
        } catch {
          // Language not available, skip
        }
      }

      logger.info('Available languages detected', { videoId, languages: availableLanguages });

      return {
        videoId,
        languages: availableLanguages,
      };
    } catch (error) {
      logger.error('Failed to get available languages', { videoId, error });
      return {
        videoId,
        languages: [],
      };
    }
  }

  /**
   * Get caption from database
   */
  public async getCaption(youtubeId: string, language: string = 'en'): Promise<CaptionMetadata | null> {
    try {
      // Find video by YouTube ID
      const video = await this.db.video.findUnique({
        where: { youtubeId },
      });

      if (!video) {
        return null;
      }

      const caption = await this.db.videoCaption.findUnique({
        where: {
          videoId_language: {
            videoId: video.id,
            language,
          },
        },
      });

      if (!caption) {
        return null;
      }

      return {
        videoId: youtubeId,
        language: caption.language,
        fullText: caption.text,
        segments: JSON.parse(caption.segments),
      };
    } catch (error) {
      logger.error('Failed to get caption from database', { videoId: youtubeId, language, error });
      return null;
    }
  }

  /**
   * Delete caption from database
   */
  public async deleteCaption(youtubeId: string, language: string): Promise<boolean> {
    try {
      // Find video by YouTube ID
      const video = await this.db.video.findUnique({
        where: { youtubeId },
      });

      if (!video) {
        logger.warn('Video not found for caption deletion', { youtubeId });
        return false;
      }

      await this.db.videoCaption.delete({
        where: {
          videoId_language: {
            videoId: video.id,
            language,
          },
        },
      });

      logger.info('Caption deleted', { youtubeId, language });
      return true;
    } catch (error) {
      logger.error('Failed to delete caption', { videoId: youtubeId, language, error });
      return false;
    }
  }

  /**
   * Extract captions for all videos in a playlist
   */
  public async extractPlaylistCaptions(
    playlistId: string,
    language?: string
  ): Promise<CaptionExtractionResult[]> {
    try {
      logger.info('Extracting captions for playlist', { playlistId, language });

      // Get all videos in playlist
      const playlistItems = await this.db.playlistItem.findMany({
        where: {
          playlistId,
          removedAt: null,
        },
        include: {
          video: true,
        },
        orderBy: {
          position: 'asc',
        },
      });

      const results: CaptionExtractionResult[] = [];

      // Extract captions for each video
      for (const item of playlistItems) {
        const result = await this.extractCaptions(item.video.youtubeId, language);
        results.push(result);

        // Add a small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      const successCount = results.filter(r => r.success).length;
      logger.info('Playlist caption extraction completed', {
        playlistId,
        total: results.length,
        successful: successCount,
        failed: results.length - successCount,
      });

      return results;
    } catch (error) {
      logger.error('Failed to extract playlist captions', { playlistId, error });
      throw error;
    }
  }
}

/**
 * Singleton instance
 */
let extractorInstance: CaptionExtractor | null = null;

/**
 * Get caption extractor instance
 */
export function getCaptionExtractor(): CaptionExtractor {
  if (!extractorInstance) {
    extractorInstance = new CaptionExtractor();
  }
  return extractorInstance;
}

export default getCaptionExtractor;
