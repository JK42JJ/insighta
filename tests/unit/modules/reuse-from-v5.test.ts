/**
 * CP494 ③ reuse loop — prepareReuseRow pure builder.
 * Quality gate, dropped-field re-extraction (description/like_count), source tag,
 * short re-gate revival guard, scrub-restore (title/desc in update), no source overwrite.
 *
 * R19 addition — reusePickedToPool's domain-fit WRITE-edge shadow wiring
 * (enforce-0: the shadow schedule call never gates or alters the upsert).
 */

const mockUpsert = jest.fn().mockResolvedValue({});
const mockShortGateFields = jest.fn().mockResolvedValue({ is_short: false });
const mockScheduleWriteShadow = jest.fn();

jest.mock('@/modules/database/client', () => ({
  getPrismaClient: () => ({ video_pool: { upsert: (...args: unknown[]) => mockUpsert(...args) } }),
}));
jest.mock('@/modules/video-pool/is-short', () => ({
  shortGateFields: (...args: unknown[]) => mockShortGateFields(...args),
}));
jest.mock('@/modules/domain-fit-shadow/write-shadow', () => ({
  scheduleDomainFitWriteShadow: (...args: unknown[]) => mockScheduleWriteShadow(...args),
}));

import {
  prepareReuseRow,
  reusePickedToPool,
  REUSE_SOURCE,
  type ReuseInput,
} from '@/modules/video-pool/reuse-from-v5';

const card = (over = {}) => ({
  videoId: 'vid12345678',
  title: '도커 컨테이너 입문 강의',
  channelTitle: 'devchan',
  channelId: 'UC_x',
  thumbnailUrl: 'https://t/x.jpg',
  publishedAt: '2026-05-01T00:00:00Z',
  durationSec: 600,
  viewCount: 50000,
  ...over,
});
const fanout = (desc = '도커 설명') => new Map([['vid12345678', { description: desc }]]);
const meta = (like = '321') => new Map([['vid12345678', { statistics: { likeCount: like } }]]);

describe('prepareReuseRow (CP494 reuse loop)', () => {
  test('accepted pick → builds row, source=user_live, re-extracts desc/like, silver tier', () => {
    const r = prepareReuseRow(card(), fanout(), meta(), 'ko', { is_short: false });
    expect(r).not.toBeNull();
    expect(r!.create.source).toBe(REUSE_SOURCE);
    expect(r!.create.source).toBe('user_live');
    expect(r!.create.description).toBe('도커 설명'); // re-extracted (V5Card drops it)
    expect(r!.create.like_count).toBe(BigInt(321)); // re-extracted from metaById
    expect(r!.create.quality_tier).toBe('silver'); // 50k views
    expect(r!.create.is_active).toBe(true); // non-short
    expect(r!.create.video_id).toBe('vid12345678');
  });

  test('update payload: revives + restores title/desc, but NEVER overwrites source', () => {
    const r = prepareReuseRow(card(), fanout('새 설명'), meta(), 'ko', { is_short: false });
    expect(r!.update).not.toHaveProperty('source'); // preserve existing authoritative source
    expect(r!.update.title).toBe('도커 컨테이너 입문 강의'); // scrub-restore (P0 title='' → fresh)
    expect(r!.update.description).toBe('새 설명');
    expect(r!.update.is_active).toBe(true);
    expect(r!.update.refreshed_at).toBeInstanceOf(Date);
    expect(r!.update.expires_at).toBeInstanceOf(Date);
  });

  test('quality reject (viewCount null = missing meta) → null (not pooled)', () => {
    expect(prepareReuseRow(card({ viewCount: null }), fanout(), meta(), 'ko', {})).toBeNull();
  });

  test('quality reject (below view floor) → null', () => {
    expect(
      prepareReuseRow(card({ viewCount: 50 }), fanout(), meta(), 'ko', { is_short: false })
    ).toBeNull();
  });

  test('short re-gate guard: is_short=true → is_active=false in both create and update', () => {
    const r = prepareReuseRow(card(), fanout(), meta(), 'ko', { is_short: true });
    expect(r!.create.is_active).toBe(false);
    expect(r!.update.is_active).toBe(false);
    expect(r!.update.is_short).toBe(true);
  });

  test('missing fanout/meta → description null, like 0 (graceful)', () => {
    const r = prepareReuseRow(card(), new Map(), new Map(), 'ko', { is_short: false });
    expect(r!.create.description).toBeNull();
    expect(r!.create.like_count).toBe(BigInt(0));
  });
});

describe('reusePickedToPool — R19 domain-fit WRITE-edge shadow wiring (enforce-0)', () => {
  beforeEach(() => {
    mockUpsert.mockClear();
    mockShortGateFields.mockClear();
    mockScheduleWriteShadow.mockClear();
  });

  const baseInput = (over: Partial<ReuseInput> = {}): ReuseInput => ({
    cards: [card()],
    fanoutById: fanout(),
    metaById: meta(),
    language: 'ko',
    centerGoal: '도커 입문',
    ...over,
  });

  test('schedules the write-shadow call per accepted card, before the upsert (fire-and-forget, never awaited)', async () => {
    const callOrder: string[] = [];
    mockScheduleWriteShadow.mockImplementation(() => callOrder.push('shadow'));
    mockUpsert.mockImplementation(() => {
      callOrder.push('upsert');
      return Promise.resolve({});
    });

    const result = await reusePickedToPool(baseInput());

    expect(result.reused).toBe(1);
    expect(mockScheduleWriteShadow).toHaveBeenCalledTimes(1);
    expect(mockScheduleWriteShadow).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'reuse',
        centerGoal: '도커 입문',
        videoId: 'vid12345678',
        source: REUSE_SOURCE,
      })
    );
    expect(callOrder).toEqual(['shadow', 'upsert']); // scheduled before, never gates, the upsert
  });

  test('is a no-op (zero calls) when centerGoal is omitted — enforce-0, upsert unaffected', async () => {
    const result = await reusePickedToPool(baseInput({ centerGoal: undefined }));
    expect(mockScheduleWriteShadow).not.toHaveBeenCalled();
    expect(mockUpsert).toHaveBeenCalledTimes(1); // upsert still happens — write decision untouched
    expect(result.reused).toBe(1);
  });

  test('does not schedule the shadow call for a quality-rejected card (never reaches the upsert either)', async () => {
    const result = await reusePickedToPool(
      baseInput({ cards: [card({ viewCount: 50 })] }) // below view floor → prepareReuseRow returns null
    );
    expect(mockScheduleWriteShadow).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
  });

  test('the write-shadow function is called synchronously (schedule, not awaited) — a slow/hanging shadow call cannot delay the upsert', async () => {
    // Simulate the real scheduleDomainFitWriteShadow contract: it returns
    // void synchronously and dispatches its own internal work with `void`.
    // If reusePickedToPool ever accidentally `await`ed a Promise from this
    // call, this mock returning a never-resolving promise would hang the
    // test (jest would time out) — asserting the test resolves proves the
    // call site does not await it.
    mockScheduleWriteShadow.mockReturnValue(new Promise(() => {}) as unknown as void);
    await expect(reusePickedToPool(baseInput())).resolves.toEqual({ reused: 1, skipped: 0 });
  });
});
