/**
 * markSkippedSummary — CP500+ PR-B. Terminal skipped vrs row for genuine
 * cannot-generate cases. Validates: never clobbers a 'pass' row, upserts when
 * absent/non-pass, fail-open on errors.
 */

const findUnique = jest.fn();
const upsert = jest.fn();

jest.mock('@/modules/database/client', () => ({
  getPrismaClient: () => ({ video_rich_summaries: { findUnique, upsert } }),
}));

import { markSkippedSummary } from '@/modules/skills/mark-skipped-summary';

describe('markSkippedSummary', () => {
  beforeEach(() => {
    findUnique.mockReset();
    upsert.mockReset();
    upsert.mockResolvedValue({});
  });

  it('does NOT clobber a real V2 pass row', async () => {
    findUnique.mockResolvedValue({ quality_flag: 'pass', template_version: 'v2' });
    await markSkippedSummary('v1', 'no_transcript', 'u1');
    expect(upsert).not.toHaveBeenCalled();
  });

  it('CP504 — overwrites a v1/pass row with skipped (it cannot upgrade to v2)', async () => {
    // A v1 'pass' is an OLD summary; if v2 generation can never succeed
    // (NO_TRANSCRIPT), the video must be marked terminal so fill-book stops
    // re-enqueuing it and the spinner ends.
    findUnique.mockResolvedValue({ quality_flag: 'pass', template_version: 'v1' });
    await markSkippedSummary('v1', 'no_transcript', 'u1');
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0][0].update.quality_flag).toBe('skipped');
  });

  it('upserts a skipped row (quality_flag=skipped + core.skip_reason) when absent', async () => {
    findUnique.mockResolvedValue(null);
    await markSkippedSummary('v2', 'no_transcript', 'u1');
    expect(upsert).toHaveBeenCalledTimes(1);
    const arg = upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ video_id: 'v2' });
    expect(arg.create.quality_flag).toBe('skipped');
    expect(arg.create.core).toEqual({ skip_reason: 'no_transcript' });
    expect(arg.update.quality_flag).toBe('skipped');
  });

  it('upserts over a non-pass row (e.g. pending → skipped)', async () => {
    findUnique.mockResolvedValue({ quality_flag: 'pending' });
    await markSkippedSummary('v3', 'no_youtube_metadata', null);
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0][0].create.core).toEqual({ skip_reason: 'no_youtube_metadata' });
  });

  it('fails open (never throws) when the DB errors', async () => {
    findUnique.mockRejectedValue(new Error('db down'));
    await expect(markSkippedSummary('v4', 'no_transcript')).resolves.toBeUndefined();
  });
});
