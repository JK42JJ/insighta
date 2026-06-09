/**
 * Regression — convertToInsightCard renders from the B2-narrowed video shape.
 *
 * Background: CP492 B2 narrowed the `get-all-video-states` Edge Function
 * embed from `video:youtube_videos (*)` (all ~35 columns, incl. fat Json
 * `thumbnails`/`region_restriction` and arrays `tags`/`topic_categories`)
 * down to the 9 columns the card actually renders. That cut the dominant
 * cost in the 667kB / multi-second payload for heavy users (5047 rows).
 *
 * This test pins the contract: those 9 video columns are *sufficient* to
 * produce a fully-rendered InsightCard. If a future refactor makes the
 * converter depend on a column the Edge Function no longer selects, this
 * breaks — surfacing the silent "card renders blank" regression at CI.
 */
import { describe, it, expect } from 'vitest';
import { convertToInsightCard } from './youtubeToInsightCard';
import type { UserVideoStateWithVideo } from '@/entities/youtube/model/types';

/** A state row whose `video` carries ONLY the 9 B2-selected columns. */
function narrowedState(): UserVideoStateWithVideo {
  return {
    id: 'state-1',
    user_id: 'user-1',
    video_id: 'vid-1',
    is_in_ideation: false,
    user_note: 'note',
    watch_position_seconds: 42,
    is_watched: false,
    cell_index: 3,
    level_id: 'level-1',
    mandala_id: 'mandala-1',
    sort_order: 5,
    added_to_ideation_at: '2026-01-01T00:00:00Z',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    pinned_at: null,
    auto_added: false,
    video: {
      // The 9 columns B2 selects — no thumbnails/tags/localized_*/etc.
      youtube_video_id: 'abc123',
      title: 'How to Learn Anything',
      description: 'A guide.',
      thumbnail_url: 'https://img.example/abc123.jpg',
      channel_title: 'LearnCo',
      duration_seconds: 615,
      published_at: '2025-12-01T00:00:00Z',
      view_count: 12345,
      like_count: 678,
    } as UserVideoStateWithVideo['video'],
  };
}

describe('convertToInsightCard — B2 9-column contract', () => {
  it('produces a fully-rendered card from the narrowed video shape', () => {
    const card = convertToInsightCard(narrowedState());
    expect(card).not.toBeNull();
    // Core render fields
    expect(card!.title).toBe('How to Learn Anything');
    expect(card!.thumbnail).toBe('https://img.example/abc123.jpg');
    expect(card!.videoUrl).toBe('https://www.youtube.com/watch?v=abc123');
    expect(card!.cellIndex).toBe(3);
    expect(card!.mandalaId).toBe('mandala-1');
    expect(card!.lastWatchPosition).toBe(42);
    // Metadata extras the card reads from youtube_videos columns
    const meta = card!.metadata as Record<string, unknown>;
    expect(meta.author).toBe('LearnCo');
    expect(meta['channel_title']).toBe('LearnCo');
    expect(meta['duration_seconds']).toBe(615);
    expect(meta['view_count']).toBe(12345);
    expect(meta['like_count']).toBe(678);
    expect(meta['published_at']).toBe('2025-12-01T00:00:00Z');
  });

  it('returns null when video embed is missing (defensive)', () => {
    const state = narrowedState();
    delete (state as { video?: unknown }).video;
    expect(convertToInsightCard(state)).toBeNull();
  });

  // CP498 PR3c — user-scoped relevance plumbing (uvs.relevance_pct → relevancePct).
  it('maps uvs.relevance_pct → relevancePct', () => {
    const state = narrowedState();
    state.relevance_pct = 73;
    expect(convertToInsightCard(state)!.relevancePct).toBe(73);
  });

  it('relevancePct defaults to null when relevance_pct is absent', () => {
    expect(convertToInsightCard(narrowedState())!.relevancePct).toBeNull();
  });
});
