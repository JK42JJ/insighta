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

  it('uses v1 structured content when present', () => {
    const out = buildInstructions(
      VIDEO_ID,
      {
        videoId: VIDEO_ID,
        oneLiner: 'Asset Allocation 101',
        structured: { core_argument: 'Diversify early.', actionables: ['Open an IRA'] },
        qualityScore: 0.9,
        model: 'test',
        updatedAt: '2026-05-15T00:00:00Z',
      } as never,
      null,
      'ko'
    );
    expect(out).toContain('Asset Allocation 101');
    expect(out).toContain('Diversify early.');
    expect(out).toContain('Open an IRA');
    expect(out).not.toContain('transcript is provided below');
  });

  it('uses v2 layered content (core/analysis) when structured is null — CP461 fix', () => {
    const out = buildInstructions(
      VIDEO_ID,
      {
        videoId: VIDEO_ID,
        oneLiner: null,
        structured: null,
        templateVersion: 'v2',
        core: { one_liner: 'MZ세대가 원하는 배우자', domain: 'finance' },
        analysis: {
          core_argument: '결혼 통계는 시대의 변화를 보여준다',
          key_concepts: [{ term: '자본소득', definition: '자본에서 발생하는 소득' }],
          actionables: ['결혼 관련 통계와 부동산 지표를 함께 살펴 시대 흐름을 직접 파악하라'],
        },
        qualityScore: 0.85,
        model: 'test',
        updatedAt: '2026-05-15T00:00:00Z',
      } as never,
      null,
      'ko'
    );
    expect(out).toContain('MZ세대가 원하는 배우자');
    expect(out).toContain('결혼 통계는 시대의 변화를 보여준다');
    expect(out).toContain('자본소득');
    expect(out).toContain('결혼 관련 통계');
    // Must NOT fall back to refusal or transcript paths.
    expect(out).not.toContain('Do NOT fabricate a summary');
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

  it('falls back to refusal when rich summary row exists but every field is empty', () => {
    // Mirrors a degraded row (e.g. quality_flag='low') where Prisma returns
    // an object but every content field is null/empty. Must not pretend to
    // summarize.
    const out = buildInstructions(
      VIDEO_ID,
      {
        videoId: VIDEO_ID,
        oneLiner: null,
        structured: null,
        core: null,
        analysis: null,
        qualityScore: null,
        model: null,
        updatedAt: '2026-05-15T00:00:00Z',
      } as never,
      null,
      'ko'
    );
    expect(out).toContain('Do NOT fabricate a summary');
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
