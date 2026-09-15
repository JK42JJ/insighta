/**
 * How the newest row per pipeline surface is judged.
 *
 * The judgement is separated from the query so it can be tested without a
 * database. The case that motivated the split: llm_call_logs stopped being a
 * pipeline signal on 2026-09-10 (trend-collector disabled), so its age is
 * reported but must never turn the check red on its own.
 */

import { interpretFreshness, type FreshnessRow } from '../../../scripts/keel/checks';
import { MS_PER_DAY, MS_PER_HOUR } from '../../../src/utils/time-constants';

const NOW = Date.UTC(2026, 8, 15, 12, 0, 0);
const hoursAgo = (h: number): Date => new Date(NOW - h * MS_PER_HOUR);
const daysAgo = (d: number): Date => new Date(NOW - d * MS_PER_DAY);

const row = (t: string, newest: Date | null): FreshnessRow => ({ t, newest });

const MAC_MINI_HINT =
  ' — only the internal transcript route writes this, and the Mac Mini collector is what calls it';

describe('interpretFreshness', () => {
  it('reports the LLM calls age without STALE and stays ok when the pipeline surfaces are fresh', () => {
    // 30 h exceeds the 26 h allowance. Before the spend shutdown that meant a
    // scheduled job had stopped; now it means nobody used an LLM feature today.
    const r = interpretFreshness(
      [
        row('llm_call_logs', hoursAgo(30)),
        row('video_summaries', daysAgo(2)),
        row('pipeline_events', hoursAgo(12)),
      ],
      NOW
    );
    expect(r.ok).toBe(true);
    expect(r.detail).toBe('LLM calls 30h · summaries 2d · transcript pipeline 12h');
    expect(r.detail).not.toContain('STALE');
    expect(r.context['llm_call_logs']).toMatchObject({
      hours: 30,
      allowed: 26,
      informational: true,
    });
  });

  it('marks both pipeline surfaces STALE, not LLM calls, and keeps the detail format', () => {
    const r = interpretFreshness(
      [
        row('llm_call_logs', hoursAgo(1)),
        row('video_summaries', daysAgo(23)),
        row('pipeline_events', daysAgo(54)),
      ],
      NOW
    );
    expect(r.ok).toBe(false);
    expect(r.detail).toBe(
      `LLM calls 1h · summaries 23d STALE · transcript pipeline 54d STALE${MAC_MINI_HINT}`
    );
    expect(r.detail.split(' · ')[0]).toBe('LLM calls 1h');
  });

  it('shows "LLM calls never" for an empty table and lets the other two decide ok', () => {
    const fresh = interpretFreshness(
      [
        row('llm_call_logs', null),
        row('video_summaries', daysAgo(2)),
        row('pipeline_events', hoursAgo(12)),
      ],
      NOW
    );
    expect(fresh.ok).toBe(true);
    expect(fresh.detail).toContain('LLM calls never');
    expect(fresh.detail).not.toContain('STALE');
    expect(fresh.context['llm_call_logs']).toBeNull();

    const stale = interpretFreshness(
      [
        row('llm_call_logs', null),
        row('video_summaries', daysAgo(23)),
        row('pipeline_events', daysAgo(54)),
      ],
      NOW
    );
    expect(stale.ok).toBe(false);
    expect(stale.detail).toContain('LLM calls never');
    expect(stale.detail).toContain('summaries 23d STALE');
    expect(stale.detail).toContain('transcript pipeline 54d STALE');
  });

  it('treats a missing llm_call_logs row the same as an empty table', () => {
    const r = interpretFreshness(
      [row('video_summaries', daysAgo(2)), row('pipeline_events', hoursAgo(12))],
      NOW
    );
    expect(r.ok).toBe(true);
    expect(r.detail).toContain('LLM calls never');
  });

  it('names the Mac Mini collector only when the transcript pipeline is stale', () => {
    // The hint exists because the previous wording pointed at the wrong
    // dependency; it must survive the informational change unchanged.
    const transcriptStale = interpretFreshness(
      [
        row('llm_call_logs', hoursAgo(1)),
        row('video_summaries', daysAgo(2)),
        row('pipeline_events', daysAgo(54)),
      ],
      NOW
    );
    expect(transcriptStale.ok).toBe(false);
    expect(transcriptStale.detail).toContain('Mac Mini collector');
    expect(transcriptStale.detail).toContain('only the internal transcript route writes this');

    const summariesOnly = interpretFreshness(
      [
        row('llm_call_logs', hoursAgo(1)),
        row('video_summaries', daysAgo(23)),
        row('pipeline_events', hoursAgo(12)),
      ],
      NOW
    );
    expect(summariesOnly.ok).toBe(false);
    expect(summariesOnly.detail).not.toContain('Mac Mini collector');
  });

  it('still fails when a gating surface has no rows at all', () => {
    const r = interpretFreshness(
      [
        row('llm_call_logs', hoursAgo(1)),
        row('video_summaries', daysAgo(2)),
        row('pipeline_events', null),
      ],
      NOW
    );
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('transcript pipeline never');
    expect(r.detail).toContain('Mac Mini collector');
  });
});
