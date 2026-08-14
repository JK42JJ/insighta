/**
 * Diversity guard (CP500+) — series-dedup + soft channel cap.
 *
 * Regression pin (James 2026-06-12): the Basphere "[Kubernetes 6주 코스]"
 * 5-1강/5-2강/6-2강 triple — all three were placed on prod mandala cca14d65
 * because dedup was videoId-only — must collapse to ONE representative =
 * the latest episode (6주 차 2강).
 */

import {
  channelDistribution,
  dedupeSeries,
  episodeOrdinals,
  hasEpisodeToken,
  seriesMarker,
  softChannelCap,
  hardChannelCap,
  crossChannelTitleDedup,
  strippedTitleSimilarity,
  type DiversityCandidate,
} from '@/skills/plugins/video-discover/diversity-guard';
import { loadDiversityGuardConfig } from '@/config/diversity-guard';

const BASPHERE = [
  '[Kubernetes 6주 코스] 5주 차 1강: 컨테이너 데이터 휘발성과 Kubernetes Volume으로 극복하기',
  '[Kubernetes 6주 코스] 5주 차 2강: 컨테이너 데이터 휘발성과 Kubernetes Volume으로 극복하기',
  '[Kubernetes 6주 코스] 6주 차 2강: Kubernetes 실전 운영 기초 (2)',
];

function cand(title: string, overrides: Partial<DiversityCandidate> = {}): DiversityCandidate {
  return { title, channelTitle: 'Basphere', channelId: 'UC-bas', ...overrides };
}

describe('episode token detection', () => {
  it('detects Korean episode forms (\\b does not work after Hangul — lookahead path)', () => {
    expect(hasEpisodeToken('5주 차 1강: 컨테이너')).toBe(true);
    expect(hasEpisodeToken('[6-2강] Kubernetes 운영 기초')).toBe(true);
    expect(hasEpisodeToken('06.Kubernetes 트러블슈팅 완벽 가이드')).toBe(true);
    expect(hasEpisodeToken('EP.3 도커 입문')).toBe(true);
    expect(hasEpisodeToken('쿠버네티스 기본 개념, 필요성 30분만에 쉽고 빠르게')).toBe(false);
    expect(hasEpisodeToken('[웨비나] Kubernetes Service 첫 걸음')).toBe(false);
  });

  it('episode ordinals order 5-1 < 5-2 < 6-2', () => {
    const o = BASPHERE.map((t) => episodeOrdinals(t));
    expect(o[0]![0]).toBe(5);
    expect(o[0]![1]).toBe(1);
    expect(o[1]![1]).toBe(2);
    expect(o[2]![0]).toBe(6);
  });

  it('series marker = leading bracket segment', () => {
    expect(seriesMarker(BASPHERE[0]!)).toBe('kubernetes 6주 코스');
    expect(seriesMarker('no bracket title')).toBeNull();
  });

  it('stripped 5-1강 vs 5-2강 are near-identical; different topics are not', () => {
    expect(strippedTitleSimilarity(BASPHERE[0]!, BASPHERE[1]!)).toBeGreaterThanOrEqual(0.8);
    expect(
      strippedTitleSimilarity(
        '06.Kubernetes 트러블슈팅 완벽 가이드',
        '12.Docker로 컨테이너화 완벽 가이드'
      )
    ).toBeLessThan(0.8);
  });
});

describe('dedupeSeries', () => {
  it('REGRESSION PIN — Basphere 5-1/5-2/6-2 → 1 card, representative = 최신 회차 (6주 차 2강)', () => {
    const { kept, dropped } = dedupeSeries(BASPHERE.map((t) => cand(t)));
    expect(kept).toHaveLength(1);
    expect(dropped).toBe(2);
    expect(kept[0]!.title).toContain('6주 차 2강');
  });

  it('representative sits at the group FIRST slot (stable order for rank consumers)', () => {
    const other = cand('도커 네트워크 한 번에 정리', { channelTitle: 'X', channelId: 'UC-x' });
    const { kept } = dedupeSeries([cand(BASPHERE[0]!), other, cand(BASPHERE[2]!)]);
    expect(kept.map((c) => c.title)).toEqual([BASPHERE[2]!, other.title]);
  });

  it('similarity tier — same-channel 연강 WITHOUT a bracket marker collapses too', () => {
    const a = cand('쿠버네티스 볼륨 정복 1강 — 데이터 휘발성', { channelId: 'UC-y' });
    const b = cand('쿠버네티스 볼륨 정복 2강 — 데이터 휘발성', { channelId: 'UC-y' });
    const { kept } = dedupeSeries([a, b]);
    expect(kept).toHaveLength(1);
    expect(kept[0]!.title).toContain('2강');
  });

  it('NO false positive — same channel, numbered but DIFFERENT topics survive (codedeck)', () => {
    const list = [
      '06.Kubernetes 트러블슈팅 완벽 가이드',
      '12.Docker로 컨테이너화 완벽 가이드',
      '20.워크플로 모니터링과 디버깅 완벽 가이드',
    ].map((t) => cand(t, { channelTitle: 'Codedeck', channelId: 'UC-cd' }));
    expect(dedupeSeries(list).kept).toHaveLength(3);
  });

  it('NO false positive — generic bracket without an episode token is never grouped', () => {
    const list = [
      '[웨비나] Kubernetes Service 첫 걸음, WordPress 시작 해보기!',
      '[웨비나] 비즈니스 연속성을 위한 AWS 클라우드 환경 재해 복구 방법',
    ].map((t) => cand(t, { channelTitle: '네이버클라우드', channelId: 'UC-nc' }));
    expect(dedupeSeries(list).kept).toHaveLength(2);
  });

  it('different channels never group even with identical series text', () => {
    const a = cand(BASPHERE[0]!, { channelId: 'UC-1', channelTitle: 'A' });
    const b = cand(BASPHERE[1]!, { channelId: 'UC-2', channelTitle: 'B' });
    expect(dedupeSeries([a, b]).kept).toHaveLength(2);
  });

  it('`against` — live candidate in the same series as an accepted pool pass is dropped', () => {
    const passedPool = [cand(BASPHERE[0]!)];
    const live = [cand(BASPHERE[1]!), cand('전혀 다른 도커 강의 모음', { channelId: 'UC-z' })];
    const { kept } = dedupeSeries(live, { against: passedPool });
    expect(kept).toHaveLength(1);
    expect(kept[0]!.title).toContain('전혀 다른');
  });

  it('EN series (Part 1/Part 2) dedupes; standalone EN titles untouched — EN 칩 경로 무영향', () => {
    const en = [
      cand('Kubernetes Tutorial Part 1 — Cluster Setup', { channelId: 'UC-en' }),
      cand('Kubernetes Tutorial Part 2 — Cluster Setup', { channelId: 'UC-en' }),
      cand('Docker Deep Dive for Beginners', { channelId: 'UC-en2' }),
    ];
    const { kept } = dedupeSeries(en);
    expect(kept).toHaveLength(2);
    expect(kept[0]!.title).toContain('Part 2');
    expect(kept[1]!.title).toContain('Deep Dive');
  });
});

describe('softChannelCap', () => {
  const mk = (ch: string, n: number, cell: number | null = null): DiversityCandidate[] =>
    Array.from({ length: n }, (_, i) => ({
      title: `${ch} video ${i + 1}`,
      channelId: ch,
      channelTitle: ch,
      cellIndex: cell,
    }));

  it('demotes (not drops) the cap-th+ card of one channel to the bucket tail', () => {
    const list = [...mk('A', 4), ...mk('B', 1)];
    const out = softChannelCap(list, 2);
    expect(out).toHaveLength(5); // nothing dropped
    expect(out.map((c) => c.title)).toEqual([
      'A video 1',
      'A video 2',
      'B video 1',
      'A video 3',
      'A video 4',
    ]);
  });

  it('single-channel bucket comes back identical — 빈 셀 불허 정합 (thin supply intact)', () => {
    const list = mk('OnlyChannel', 4);
    expect(softChannelCap(list, 2)).toEqual(list);
  });

  it('buckets are per cellIndex — demotion never crosses cells', () => {
    const list = [...mk('A', 3, 0), ...mk('A', 3, 1)];
    const out = softChannelCap(list, 2);
    // each cell keeps its own order: A1,A2,A3 within each cell (only-channel)
    expect(out.filter((c) => c.cellIndex === 0)).toHaveLength(3);
    expect(out.filter((c) => c.cellIndex === 1)).toHaveLength(3);
    expect(out.map((c) => c.title).slice(0, 3)).toEqual(['A video 1', 'A video 2', 'A video 3']);
  });
});

describe('hardChannelCap (CP511+1 — global, demote-only)', () => {
  const mk = (ch: string, n: number, cell: number | null = null): DiversityCandidate[] =>
    Array.from({ length: n }, (_, i) => ({
      title: `${ch} video ${i + 1}`,
      channelId: ch,
      channelTitle: ch,
      cellIndex: cell,
    }));

  it('REGRESSION-MEASURED — one channel at soft-cap=2/cell across 5 cells (10 total, 0 per-cell violations) still gets globally capped', () => {
    // Mirrors the measured prod pattern (mandala 7d5d759e add_cards, 2026-07-06):
    // softChannelCap alone never fires here (exactly 2/cell everywhere).
    const oneChannelAcross5Cells = [0, 1, 2, 3, 4].flatMap((cell) => mk('MALT', 2, cell));
    const other = Array.from({ length: 39 }, (_, i) => mk(`OTHER-${i}`, 1)[0]!); // 39 distinct single-appearance channels
    const list = [...oneChannelAcross5Cells, ...other];
    expect(list).toHaveLength(49);

    const afterSoft = softChannelCap(list, 2);
    // soft cap never demotes anything — every cell bucket already at exactly 2.
    expect(afterSoft).toEqual(list);

    const { reordered, demoted } = hardChannelCap(afterSoft, 3, 30);
    expect(reordered).toHaveLength(49); // count preserved — demote only
    expect(demoted).toBe(7); // MALT: 10 total, cap=3 → 7 demoted
    const primary = reordered.slice(0, reordered.length - demoted);
    expect(primary.filter((c) => c.channelId === 'MALT')).toHaveLength(3);
  });

  it('below minCandidates — skip entirely (thin-supply protection)', () => {
    const list = mk('A', 10); // one channel, 10 cards, cap would fire without the gate
    const { reordered, demoted } = hardChannelCap(list, 3, 30); // 10 < 30 → no-op
    expect(reordered).toEqual(list);
    expect(demoted).toBe(0);
  });

  it('cap<=0 — no-op (flag-off byte-identical)', () => {
    const list = mk('A', 40);
    const { reordered, demoted } = hardChannelCap(list, 0, 30);
    expect(reordered).toEqual(list);
    expect(demoted).toBe(0);
  });

  it('preserves relative order within primary + within demoted tail', () => {
    const list = mk('A', 5);
    const { reordered, demoted } = hardChannelCap(list, 2, 3);
    expect(reordered.map((c) => c.title)).toEqual([
      'A video 1',
      'A video 2',
      'A video 3',
      'A video 4',
      'A video 5',
    ]);
    expect(demoted).toBe(3);
  });
});

describe('crossChannelTitleDedup (CP511+1 — cross-channel, demote-only)', () => {
  const cand = (title: string, channelId: string): DiversityCandidate => ({
    title,
    channelId,
    channelTitle: channelId,
  });

  it('groups near-identical titles ACROSS different channels (no episode token needed)', () => {
    const a = cand('도커 완전 정복 강의 — 초보자를 위한 컨테이너 입문', 'UC-1');
    const b = cand('도커 완전 정복 강의 초보자를 위한 컨테이너 입문 총정리', 'UC-2');
    const c = cand('전혀 다른 주제의 파이썬 데이터분석 강의', 'UC-3');
    const { reordered, demoted } = crossChannelTitleDedup([a, b, c], 0.6);
    expect(reordered).toHaveLength(3); // count preserved — demote only
    expect(demoted).toBe(1);
    expect(reordered[0]).toBe(a); // representative = first occurrence
    expect(reordered[reordered.length - 1]).toBe(b); // duplicate demoted to tail
  });

  it('MEASURED LIMITATION (real prod titles, 2026-07-06) — SEO-padded 100문장 titles score far below the 0.6-0.7 conservative range', () => {
    // 3 known near-duplicate titles from one prod channel (mandala 7d5d759e,
    // trace 42da98a6) — measured token-Jaccard 0.12-0.17, i.e. this transform
    // as specified does NOT catch this specific spam pattern on real data.
    const titles = [
      '기초영어 100문장｜왕초보도 말문 트이는 생활영어 회화 매일 듣기 반복학습',
      '왕초보 영어회화 100문장 듣기 루틴｜매일 1시간만 틀어두면 자동으로 익혀집니다 (한글발음 포함)',
      '왕초보 기초 영어회화 100문장 | 생활영어 첫걸음 이것부터 외우세요(흘려듣기)',
    ].map((t, i) => cand(t, `UC-malt-${i}`));
    const { reordered, demoted } = crossChannelTitleDedup(titles, 0.65);
    expect(reordered).toHaveLength(3);
    expect(demoted).toBe(0); // documents the measured gap — not a false claim of success
  });

  it('missing title text never groups (no fabrication) — count preserved', () => {
    const a: DiversityCandidate = { title: '', channelId: 'UC-1' };
    const b: DiversityCandidate = { title: '', channelId: 'UC-2' };
    const { reordered, demoted } = crossChannelTitleDedup([a, b], 0.1);
    expect(reordered).toHaveLength(2);
    expect(demoted).toBe(0);
  });
});

describe('config + observability', () => {
  it('flag default OFF (unset = 기존 동작, hard rule) + provisional knobs', () => {
    const cfg = loadDiversityGuardConfig({} as NodeJS.ProcessEnv);
    expect(cfg.enabled).toBe(false);
    expect(cfg.seriesSim).toBe(0.8);
    expect(cfg.channelSoftCap).toBe(2);
    expect(cfg.channelHardCap).toBe(0);
    expect(cfg.channelHardCapMinCandidates).toBe(30);
    expect(cfg.crossChannelDedupEnabled).toBe(false);
    expect(cfg.crossChannelDedupSim).toBe(0.65);
  });

  it('env overrides parse', () => {
    const cfg = loadDiversityGuardConfig({
      V5_DIVERSITY_GUARD: 'true',
      V5_SERIES_DEDUP_SIM: '0.7',
      V5_CHANNEL_SOFT_CAP: '3',
      V5_CHANNEL_HARD_CAP: '3',
      V5_CHANNEL_HARD_CAP_MIN_CANDIDATES: '25',
      V5_CROSS_CHANNEL_TITLE_DEDUP: 'true',
      V5_CROSS_CHANNEL_DEDUP_SIM: '0.6',
    } as unknown as NodeJS.ProcessEnv);
    expect(cfg).toEqual({
      enabled: true,
      seriesSim: 0.7,
      channelSoftCap: 3,
      channelHardCap: 3,
      channelHardCapMinCandidates: 25,
      crossChannelDedupEnabled: true,
      crossChannelDedupSim: 0.6,
    });
  });

  it('channelDistribution computes total/distinct/top3 share', () => {
    const d = channelDistribution([
      ...['a', 'a', 'a', 'b', 'b', 'c', 'd', 'e', 'f', 'g'].map((ch) => ({
        title: 't',
        channelTitle: ch,
      })),
    ]);
    expect(d.total).toBe(10);
    expect(d.distinct).toBe(7);
    expect(d.top3SharePct).toBe(60);
  });
});
