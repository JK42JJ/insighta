/**
 * Summary Generator
 *
 * Generates AI-powered summaries for YouTube videos using captions
 * Supports Google Gemini API
 */

import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import { getPrismaClient } from '../database';
import { getCaptionExtractor } from '../caption';
import { logger } from '../../utils/logger';
import type {
  VideoSummary,
  SummarizationLevel,
  SummarizationOptions,
  SummarizationResult,
  KeyTimestamp,
} from './types';

/**
 * Summary Generator Service
 *
 * Note: Database and caption extractor are lazily loaded to avoid
 * initializing at class instantiation time. This is required for
 * serverless environments where credentials may not be available
 * until the actual request is made.
 */
export class SummaryGenerator {
  // Lazy getters for dependencies - only initialize when actually needed
  private get db() {
    return getPrismaClient();
  }
  private get captionExtractor() {
    return getCaptionExtractor();
  }
  private genAI: GoogleGenerativeAI | null = null;

  constructor() {
    // Initialize Gemini if API key is available
    const apiKey = process.env['GEMINI_API_KEY'];
    if (apiKey) {
      this.genAI = new GoogleGenerativeAI(apiKey);
      logger.info('Gemini AI client initialized');
    } else {
      logger.warn('Gemini API key not found. Summarization will not work.');
    }
  }

  /**
   * Generate summary for a video
   */
  public async generateSummary(
    videoId: string,
    options: SummarizationOptions = {}
  ): Promise<SummarizationResult> {
    try {
      const level = options.level || 'medium';
      const language = options.language || 'en';

      logger.info('Generating summary', { videoId, level, language });

      if (!this.genAI) {
        throw new Error('Gemini API key not configured');
      }

      // Get or extract captions
      let caption = await this.captionExtractor.getCaption(videoId, language);
      if (!caption) {
        const extractResult = await this.captionExtractor.extractCaptions(videoId, language);
        if (!extractResult.success || !extractResult.caption) {
          throw new Error(extractResult.error || 'Failed to extract captions');
        }
        caption = extractResult.caption;
      }

      // Get video details for context
      const video = await this.db.video.findUnique({
        where: { youtubeId: videoId },
      });

      if (!video) {
        throw new Error('Video not found in database');
      }

      // Generate summary using Gemini
      const summary = await this.generateWithGemini(video.title, caption.fullText, level);

      // Save to database (update UserVideoState)
      await this.db.userVideoState.upsert({
        where: { videoId: video.id },
        create: {
          videoId: video.id,
          summary: summary.summary,
          tags: JSON.stringify(summary.keywords),
        },
        update: {
          summary: summary.summary,
          tags: JSON.stringify(summary.keywords),
        },
      });

      logger.info('Summary generated and saved', {
        videoId,
        level,
        keyPointsCount: summary.keyPoints.length,
        keywordsCount: summary.keywords.length,
      });

      return {
        success: true,
        videoId,
        summary,
      };
    } catch (error) {
      logger.error('Failed to generate summary', { videoId, error });
      return {
        success: false,
        videoId,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Generate summary using Gemini API
   */
  private async generateWithGemini(
    videoTitle: string,
    transcript: string,
    level: SummarizationLevel
  ): Promise<VideoSummary> {
    if (!this.genAI) {
      throw new Error('Gemini client not initialized');
    }

    const systemPrompt = this.getSystemPrompt(level);
    const userPrompt = this.getUserPrompt(videoTitle, transcript);

    // Get Gemini model (using gemini-pro for text generation)
    const model = this.genAI.getGenerativeModel({
      model: process.env['GEMINI_MODEL'] || 'gemini-pro',
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: this.getMaxTokens(level),
      },
      safetySettings: [
        {
          category: HarmCategory.HARM_CATEGORY_HARASSMENT,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
      ],
    });

    // Combine system and user prompts for Gemini
    const prompt = `${systemPrompt}\n\n${userPrompt}`;

    const result = await model.generateContent(prompt);
    const response = result.response;
    const content = response.text();

    // Debug: Log raw API response
    logger.debug('Gemini API raw response', {
      contentLength: content.length,
      contentPreview: content.substring(0, 500),
      fullContent: content
    });

    // Parse the structured response
    const summary = this.parseAIResponse(content, level);

    return summary;
  }

  /**
   * Get system prompt based on summarization level
   */
  private getSystemPrompt(level: SummarizationLevel): string {
    const prompts = {
      short: `You are a concise video content analyzer. Analyze the video's main topic, purpose, and key themes.
IMPORTANT: Describe the video's content and purpose, do NOT quote or reproduce any copyrighted text, lyrics, or scripts.

Respond ONLY with valid JSON in this exact format:
{
  "summary": "1-2 sentence description of what the video is about and its main purpose",
  "keyPoints": ["3-5 main themes or topics discussed"],
  "keywords": ["5-10 relevant topic keywords"]
}`,
      medium: `You are a video content analyzer. Create comprehensive summaries with key insights.
Output format (JSON):
{
  "summary": "2-3 paragraph summary",
  "keyPoints": ["5-8 main points with details"],
  "keywords": ["10-15 keywords"],
  "timestamps": [{"time": seconds, "description": "key moment"}]
}`,
      detailed: `You are a detailed educational content analyzer. Create in-depth summaries with full context.
Output format (JSON):
{
  "summary": "Detailed 3-5 paragraph summary covering all major topics",
  "keyPoints": ["10-15 comprehensive points with explanations"],
  "keywords": ["15-20 keywords and concepts"],
  "timestamps": [{"time": seconds, "description": "important timestamp"}]
}`,
    };

    return prompts[level];
  }

  /**
   * Get user prompt with video content
   */
  private getUserPrompt(title: string, transcript: string): string {
    // Limit transcript length to avoid token limits
    const maxLength = 15000; // ~4000 tokens
    const trimmedTranscript =
      transcript.length > maxLength ? transcript.substring(0, maxLength) + '...' : transcript;

    return `Video Title: ${title}

Transcript:
${trimmedTranscript}

Please analyze this video and provide a structured summary in JSON format as specified.`;
  }

  /**
   * Get max tokens based on level
   */
  private getMaxTokens(level: SummarizationLevel): number {
    const tokens = {
      short: 500,
      medium: 1000,
      detailed: 2000,
    };
    return tokens[level];
  }

  /**
   * Parse AI response into structured summary
   */
  private parseAIResponse(content: string, level: SummarizationLevel): VideoSummary {
    try {
      // Try to extract JSON from response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const data = JSON.parse(jsonMatch[0]);

      const summary: VideoSummary = {
        videoId: '', // Will be set by caller
        level,
        summary: data.summary || content,
        keyPoints: Array.isArray(data.keyPoints) ? data.keyPoints : [],
        keywords: Array.isArray(data.keywords) ? data.keywords : [],
      };

      if (data.timestamps && Array.isArray(data.timestamps)) {
        summary.timestamps = data.timestamps as KeyTimestamp[];
      }

      return summary;
    } catch (error) {
      logger.warn('Failed to parse JSON response, using raw content', { error });
      // Fallback to basic parsing
      return {
        videoId: '',
        level,
        summary: content,
        keyPoints: [],
        keywords: [],
      };
    }
  }

  /**
   * Get summary from database
   */
  public async getSummary(videoId: string): Promise<VideoSummary | null> {
    try {
      const video = await this.db.video.findUnique({
        where: { youtubeId: videoId },
        include: { userState: true },
      });

      if (!video || !video.userState || !video.userState.summary) {
        return null;
      }

      return {
        videoId,
        level: 'medium', // Default level
        summary: video.userState.summary,
        keyPoints: [],
        keywords: video.userState.tags ? JSON.parse(video.userState.tags) : [],
      };
    } catch (error) {
      logger.error('Failed to get summary from database', { videoId, error });
      return null;
    }
  }

  /**
   * Generate summaries for all videos in a playlist
   */
  public async generatePlaylistSummaries(
    playlistId: string,
    options: SummarizationOptions = {}
  ): Promise<SummarizationResult[]> {
    try {
      logger.info('Generating summaries for playlist', { playlistId, options });

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

      const results: SummarizationResult[] = [];

      // Generate summary for each video
      for (const item of playlistItems) {
        const result = await this.generateSummary(item.video.youtubeId, options);
        results.push(result);

        // Add a delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      const successCount = results.filter(r => r.success).length;
      logger.info('Playlist summarization completed', {
        playlistId,
        total: results.length,
        successful: successCount,
        failed: results.length - successCount,
      });

      return results;
    } catch (error) {
      logger.error('Failed to generate playlist summaries', { playlistId, error });
      throw error;
    }
  }
}

/**
 * Singleton instance
 */
let generatorInstance: SummaryGenerator | null = null;

/**
 * Get summary generator instance
 */
export function getSummaryGenerator(): SummaryGenerator {
  if (!generatorInstance) {
    generatorInstance = new SummaryGenerator();
  }
  return generatorInstance;
}

export default getSummaryGenerator;
