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

describe('config + observability', () => {
  it('flag default OFF (unset = 기존 동작, hard rule) + provisional knobs', () => {
    const cfg = loadDiversityGuardConfig({} as NodeJS.ProcessEnv);
    expect(cfg.enabled).toBe(false);
    expect(cfg.seriesSim).toBe(0.8);
    expect(cfg.channelSoftCap).toBe(2);
  });

  it('env overrides parse', () => {
    const cfg = loadDiversityGuardConfig({
      V5_DIVERSITY_GUARD: 'true',
      V5_SERIES_DEDUP_SIM: '0.7',
      V5_CHANNEL_SOFT_CAP: '3',
    } as unknown as NodeJS.ProcessEnv);
    expect(cfg).toEqual({ enabled: true, seriesSim: 0.7, channelSoftCap: 3 });
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
