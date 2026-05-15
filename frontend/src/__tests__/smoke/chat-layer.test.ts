import { describe, it, expect } from 'vitest';
import { computeChatLayer, buildInstructions } from '@/pages/learning/ui/ChatAssistant';

const base = {
  regionAware: false,
  noteSelectionText: null as string | null,
  playerState: 'unstarted',
  playerTimeSec: 0,
  currentSection: null as string | null,
  selectedCellIndex: null as number | null,
  videoId: '',
  mandalaId: '',
};

describe('computeChatLayer (CP446+1, region awareness flag)', () => {
  it('returns "global" when nothing is set', () => {
    expect(computeChatLayer({ ...base })).toBe('global');
  });

  it('returns "mandala" when only mandalaId is present', () => {
    expect(computeChatLayer({ ...base, mandalaId: 'm-1' })).toBe('mandala');
  });

  it('returns "video" when videoId is present without cell', () => {
    expect(computeChatLayer({ ...base, mandalaId: 'm-1', videoId: 'v-1' })).toBe('video');
  });

  it('returns "cell" when section or cell is selected', () => {
    expect(
      computeChatLayer({ ...base, mandalaId: 'm-1', videoId: 'v-1', selectedCellIndex: 3 })
    ).toBe('cell');
    expect(
      computeChatLayer({ ...base, mandalaId: 'm-1', videoId: 'v-1', currentSection: 'Ch1 > S1' })
    ).toBe('cell');
  });

  it('does NOT promote to "video-time" when regionAware is false', () => {
    expect(
      computeChatLayer({
        ...base,
        regionAware: false,
        mandalaId: 'm-1',
        videoId: 'v-1',
        playerState: 'playing',
        playerTimeSec: 30,
      })
    ).toBe('video');
  });

  it('promotes to "video-time" when regionAware AND playing AND time > 0', () => {
    expect(
      computeChatLayer({
        ...base,
        regionAware: true,
        mandalaId: 'm-1',
        videoId: 'v-1',
        playerState: 'playing',
        playerTimeSec: 30,
      })
    ).toBe('video-time');
  });

  it('"note" wins over "video-time" when both conditions hold', () => {
    expect(
      computeChatLayer({
        ...base,
        regionAware: true,
        mandalaId: 'm-1',
        videoId: 'v-1',
        playerState: 'playing',
        playerTimeSec: 30,
        noteSelectionText: 'selected paragraph',
      })
    ).toBe('note');
  });

  it('does NOT return "note" when regionAware is false even if selection exists', () => {
    expect(
      computeChatLayer({
        ...base,
        regionAware: false,
        mandalaId: 'm-1',
        videoId: 'v-1',
        noteSelectionText: 'selected paragraph',
      })
    ).toBe('video');
  });
});

describe('buildInstructions — video-summary fallback', () => {
  const VIDEO_ID = 'abc123XYZ_0';

  it('uses rich summary content when present', () => {
    const out = buildInstructions(
      VIDEO_ID,
      { title: 'Asset Allocation 101', structured: { core_argument: 'Diversify early.' } },
      null,
      'ko'
    );
    expect(out).toContain('Asset Allocation 101');
    expect(out).toContain('Diversify early.');
    expect(out).not.toContain('transcript is provided below');
  });

  it('feeds the transcript and authorizes summarizing when no rich summary exists', () => {
    const transcript = 'This video explains how to build retirement wealth through ETFs.';
    const out = buildInstructions(VIDEO_ID, null, transcript, 'ko');
    expect(out).toContain('### Transcript');
    expect(out).toContain(transcript);
    expect(out).toContain('SHOULD summarize the video');
    // The hard refusal instruction must NOT be present in the transcript path.
    expect(out).not.toContain('Do NOT fabricate a summary');
  });

  it('truncates an over-long transcript and notes the truncation', () => {
    const longTranscript = 'word '.repeat(10000); // 50000 chars > 20000 cap
    const out = buildInstructions(VIDEO_ID, null, longTranscript, 'en');
    expect(out).toContain('Transcript truncated for length');
    expect(out.length).toBeLessThan(longTranscript.length + 2000);
  });

  it('falls back to a non-fabrication refusal when neither summary nor transcript exists', () => {
    const out = buildInstructions(VIDEO_ID, null, null, 'ko');
    expect(out).toContain('Do NOT fabricate a summary');
    expect(out).toContain('No transcript or AI analysis is available');
  });

  it('always keeps the language rule regardless of content path', () => {
    for (const args of [
      buildInstructions(VIDEO_ID, null, null, 'en'),
      buildInstructions(VIDEO_ID, null, 'some transcript', 'en'),
    ]) {
      expect(args).toContain('respond in the same language as the user');
    }
  });
});
