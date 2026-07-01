/**
 * Golden cohort — the FIXED mandala set for the Phase 3 Eval Harness (G2-b).
 *
 * WHY fixed IDs (not name lookup): the harness's whole value is comparing the
 * SAME cohort before/after an intervention (embedding backfill, algorithm
 * version). Resolving by title at run time would silently drift the set when a
 * title is duplicated or renamed → before/after becomes invalid. So the IDs are
 * resolved ONCE (prod query, 2026-07-01) and frozen here as the SSOT.
 *
 * Selection (matches the horizon-0 / M2 core set + SSOT §7 spec: tech-ko ≥2,
 * volatile ≥2, evergreen ≥2). Card counts (uvs) resolved 2026-07-01; two entries
 * (K8S 전문가 60, K8s 상용운영 55) match the horizon-0 doc's card counts exactly,
 * confirming these are the M2-measured mandalas.
 *
 * ⚠️ James confirms this set ("이 만다라들이 맞나"). English coverage is thin in
 * prod (few en mandalas with meaningful card counts) → 8 ko + 2 en vs the 5+5
 * target; adjust here if a different cohort is preferred. Editing this list is
 * the ONLY way the cohort changes — never resolve by title at run time.
 */

export interface GoldenCohortEntry {
  mandalaId: string;
  title: string;
  /** Rough tags for read-side grouping (tech/finance/evergreen/volatile). */
  tags: string[];
}

export const GOLDEN_COHORT: readonly GoldenCohortEntry[] = [
  {
    mandalaId: '9bb88bfb-7226-4f28-a679-5378cccf6ac4',
    title: '중등 영문법 한 달 완성하기',
    tags: ['ko', 'evergreen', 'language'],
  },
  {
    mandalaId: '387f5309-bf24-4aba-ab02-62e53babca44',
    title: '100일 영어 회화 완성하기',
    tags: ['ko', 'evergreen', 'language'],
  },
  {
    mandalaId: '54d55a78-dd50-4184-9387-ef54c29568b3',
    title: 'K8S 전문가 되기',
    tags: ['tech', 'volatile'],
  }, // horizon-0 uvs=60 ✓
  {
    mandalaId: 'e2b565c1-e7d1-44d2-8156-55da59f68722',
    title: 'K8s 상용 서비스 운영 전문가 되기',
    tags: ['ko', 'tech', 'volatile'],
  }, // horizon-0 uvs=55 ✓
  {
    mandalaId: '669d1909-cb5d-480a-980b-bf376db62174',
    title: 'Python 코딩테스트 패스하기',
    tags: ['ko', 'tech'],
  },
  {
    mandalaId: 'cca14d65-5e60-4345-bc83-a98acd25cc94',
    title: 'Docker와 Kubernetes로 배우는 클라우드 인프라',
    tags: ['ko', 'tech', 'volatile'],
  },
  {
    mandalaId: '66a097ce-6b04-4232-b626-9cef83807a65',
    title: 'ETF 투자로 노후 자산 만들기',
    tags: ['ko', 'finance', 'volatile'],
  },
  {
    mandalaId: '7f72e5d8-bd1c-4821-a7fb-2332ac0b15eb',
    title: '26년 금융 투자 전문가 되기',
    tags: ['ko', 'finance', 'volatile'],
  },
  {
    mandalaId: '82d0169f-f4bf-4c88-8cad-92661f6b252a',
    title: 'Build retirement assets via ETF',
    tags: ['en', 'finance'],
  },
  {
    mandalaId: '2558166f-7b48-48ec-a599-b0ca76575ab3',
    title: 'Complete a daily coding challenge',
    tags: ['en', 'tech'],
  },
];

export const GOLDEN_COHORT_IDS: readonly string[] = GOLDEN_COHORT.map((e) => e.mandalaId);
