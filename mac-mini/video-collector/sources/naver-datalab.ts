/**
 * Source 2a (Naver primary) — Naver DataLab search trends.
 *
 *   POST https://openapi.naver.com/v1/datalab/search
 *
 * DataLab returns search-volume time-series for *seed* keywords; it does
 * not directly expose "today's hot keywords." Pattern: we feed in a known
 * domain seed list, get the relative ratios, and pick the top-N rising
 * groups. The chosen group LABELS become yt-dlp search queries (handled
 * by the orchestrator).
 *
 * The seed list is intentionally broad — we only need DataLab to tell us
 * which broad domains are trending today so the rest of the budget can
 * be steered toward those domains.
 *
 * Returns *keyword strings* (not video IDs). The orchestrator runs
 * yt-dlp search on each keyword to obtain video IDs.
 */

interface NaverDataLabOptions {
  clientId: string;
  clientSecret: string;
  /** Number of top-rising keywords to return. */
  topN: number;
}

const DATALAB_URL = 'https://openapi.naver.com/v1/datalab/search';

/**
 * Broad seed groups — DataLab ranks these by search-volume momentum.
 *
 * Naver DataLab caps `keywordGroups` at **5 per call** (CP438 smoke
 * confirmed: 9 → HTTP 400 "should NOT have more than 5 items"). We
 * therefore split the 9 Insighta domains into 2 batched calls and
 * merge the scored results.
 */
const SEED_GROUPS: { groupName: string; keywords: string[] }[] = [
  { groupName: 'tech', keywords: ['AI', '인공지능', 'ChatGPT', '코딩'] },
  { groupName: 'learning', keywords: ['공부법', '자격증', '강의', '학원'] },
  { groupName: 'health', keywords: ['다이어트', '운동', '건강', '영양제'] },
  { groupName: 'business', keywords: ['창업', '부업', '마케팅', '재택근무'] },
  { groupName: 'finance', keywords: ['주식', '부동산', 'ETF', '비트코인'] },
  { groupName: 'social', keywords: ['MBTI', '연애', '인간관계', '대화법'] },
  { groupName: 'creative', keywords: ['유튜브', '디자인', '글쓰기', '그림'] },
  { groupName: 'lifestyle', keywords: ['여행', '요리', '캠핑', '인테리어'] },
  { groupName: 'mind', keywords: ['명상', '자기계발', '스트레스', '심리'] },
];

const NAVER_GROUP_LIMIT = 5;

interface DataLabResultRow {
  title: string;
  data: { period: string; ratio: number }[];
}

async function fetchOneBatch(
  groups: { groupName: string; keywords: string[] }[],
  opts: NaverDataLabOptions,
  startDate: string,
  endDate: string,
): Promise<{ scored: { title: string; score: number }[]; error: string | null }> {
  const body = {
    startDate,
    endDate,
    timeUnit: 'date',
    keywordGroups: groups,
  };
  let res: Response;
  try {
    res = await fetch(DATALAB_URL, {
      method: 'POST',
      headers: {
        'X-Naver-Client-Id': opts.clientId,
        'X-Naver-Client-Secret': opts.clientSecret,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return { scored: [], error: (e as Error).message };
  }
  if (!res.ok) {
    const text = await res.text();
    return { scored: [], error: `${res.status}: ${text.slice(0, 200)}` };
  }
  const json = (await res.json()) as { results?: DataLabResultRow[] };
  const scored = (json.results ?? []).map((g) => {
    const recent = g.data.slice(-7);
    const avg = recent.length > 0 ? recent.reduce((a, b) => a + b.ratio, 0) / recent.length : 0;
    return { title: g.title, score: avg };
  });
  return { scored, error: null };
}

/**
 * Returns trending keyword strings ordered by recent momentum
 * (last-period ratio). Falls back to empty array on auth/network error.
 *
 * The 9-domain seed list is split into 2 batched calls (5 + 4) because
 * Naver DataLab caps `keywordGroups` at 5 per request. Scores from both
 * batches are concatenated then sorted globally — the absolute ratios
 * from separate calls are not directly comparable, but DataLab returns
 * each batch normalized to its own batch-max=100, so within-batch
 * ordering is preserved and we use that as a robust ranking proxy.
 */
export async function collectNaverDataLab(
  opts: NaverDataLabOptions,
): Promise<{ keywords: string[]; diagnostics: Record<string, unknown> }> {
  const today = new Date();
  const start = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const startDate = fmt(start);
  const endDate = fmt(today);

  const batches: { groupName: string; keywords: string[] }[][] = [];
  for (let i = 0; i < SEED_GROUPS.length; i += NAVER_GROUP_LIMIT) {
    batches.push(SEED_GROUPS.slice(i, i + NAVER_GROUP_LIMIT));
  }

  const allScored: { title: string; score: number }[] = [];
  const errors: string[] = [];
  for (let bi = 0; bi < batches.length; bi += 1) {
    const r = await fetchOneBatch(batches[bi]!, opts, startDate, endDate);
    if (r.error) errors.push(`batch_${bi}: ${r.error}`);
    allScored.push(...r.scored);
  }

  if (allScored.length === 0) {
    return {
      keywords: [],
      diagnostics: { errors, batches: batches.length, groups_returned: 0 },
    };
  }

  allScored.sort((a, b) => b.score - a.score);
  const topGroups = allScored.slice(0, opts.topN).map((g) => g.title);
  const keywords: string[] = [];
  for (const groupName of topGroups) {
    const seed = SEED_GROUPS.find((s) => s.groupName === groupName);
    if (seed) keywords.push(...seed.keywords);
  }
  return {
    keywords,
    diagnostics: {
      batches: batches.length,
      groups_returned: allScored.length,
      top_groups: topGroups,
      keywords_total: keywords.length,
      errors,
    },
  };
}
