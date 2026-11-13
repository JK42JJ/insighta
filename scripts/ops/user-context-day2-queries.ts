/**
 * Day-2 queries from a context snapshot (no DB, no network): branches in CONTAINS weight order,
 * each branch's top-N concepts by WANTS weight (concepts with an AVOIDS edge are skipped), one
 * Korean and one English query per concept. Prints the list with the weights that ordered it.
 *
 * Usage: npx tsx scripts/ops/user-context-day2-queries.ts <ctx_v2.json> <out.json>
 */
import * as fs from 'fs';

import { branchOrder, restoreGraph, type ContextGraph } from '@/modules/user-context';
import { buildRuleBasedQueriesSync } from '@/skills/plugins/video-discover/v2/keyword-builder';
import { edgeWeight, getEdge, outEdges } from '@/modules/user-context/graph';

const CONCEPTS_PER_BRANCH = 4;
const SEARCH_UNITS = 100;
const DETAIL_UNITS_ESTIMATE = 40;

function koQuery(term: string): string {
  const plain = term.replace(/·/g, ' ').replace(/\s+/g, ' ').trim();
  if (plain.includes('에이전트')) return plain;
  if (plain.startsWith('AI ')) return `AI 에이전트 ${plain.slice('AI '.length)}`;
  return `AI 에이전트 ${plain}`;
}

const [ctxPath, outPath] = process.argv.slice(2);
const g: ContextGraph = restoreGraph(JSON.parse(fs.readFileSync(ctxPath, 'utf-8')).snapshot);
const ctxId = g.contextId;
const out: Array<{
  branch: string;
  branchWeight: number;
  concept: string;
  wants: number;
  judgments: number;
  lang: 'ko' | 'en';
  query: string;
}> = [];
const skipped: Array<{ branch: string; concept: string; reason: string }> = [];
for (const b of branchOrder(g)) {
  const concepts = outEdges(g, b.node.id, 'RELEVANT_TO')
    .map((e) => g.nodes.get(e.targetId))
    .filter((n): n is NonNullable<typeof n> => !!n && n.type === 'concept')
    .map((n) => ({
      node: n,
      wants: edgeWeight(g, ctxId, 'WANTS', n.id),
      judgments:
        Number(getEdge(g, ctxId, 'WANTS', n.id)?.properties['likes'] ?? 0) +
        Number(getEdge(g, ctxId, 'WANTS', n.id)?.properties['skips'] ?? 0),
      avoid: getEdge(g, ctxId, 'AVOIDS', n.id)?.weight ?? 0,
    }))
    // WANTS desc; equal weights → fewer judgments first (James 2026-11-13: explore the less-tested
    // concept); then title.
    .sort(
      (x, y) =>
        y.wants - x.wants || x.judgments - y.judgments || x.node.title.localeCompare(y.node.title)
    );
  let taken = 0;
  for (const c of concepts) {
    if (taken >= CONCEPTS_PER_BRANCH) break;
    if (c.wants <= 0) {
      skipped.push({
        branch: b.node.title,
        concept: c.node.title,
        reason: 'WANTS 0 (James: not searched)',
      });
      continue;
    }
    if (c.avoid > 0) {
      skipped.push({ branch: b.node.title, concept: c.node.title, reason: `AVOIDS ${c.avoid}` });
      continue;
    }
    const en = String(c.node.properties['en'] ?? c.node.title);
    out.push({
      branch: b.node.title,
      branchWeight: b.weight,
      concept: c.node.title,
      wants: c.wants,
      judgments: c.judgments,
      lang: 'ko',
      query: koQuery(c.node.title),
    });
    out.push({
      branch: b.node.title,
      branchWeight: b.weight,
      concept: c.node.title,
      wants: c.wants,
      judgments: c.judgments,
      lang: 'en',
      query: en,
    });
    taken++;
  }
}
// Current arm (James 2026-11-13): the app's rule queries (goal phrase + branch name), Korean and English.
const CURRENT_KO = {
  centerGoal: 'AI Agent 서비스 출시',
  subGoals: ['만드는 법', '운영하는 법', '파는 법', '업계 동향'],
};
const CURRENT_EN = {
  centerGoal: 'AI agent service launch',
  subGoals: ['how to build', 'how to operate', 'how to sell', 'industry trends'],
};
const current = [
  ...buildRuleBasedQueriesSync({ ...CURRENT_KO, targetLevel: 'standard', language: 'ko' }).map(
    (q) => ({ lang: 'ko' as const, query: q.query, source: q.source })
  ),
  ...buildRuleBasedQueriesSync({ ...CURRENT_EN, targetLevel: 'standard', language: 'en' }).map(
    (q) => ({ lang: 'en' as const, query: q.query, source: q.source })
  ),
];
const searches = out.length + current.length;
fs.writeFileSync(
  outPath,
  JSON.stringify(
    {
      queries: out,
      current,
      skipped,
      quota: {
        contextSearches: out.length,
        currentSearches: current.length,
        units: searches * SEARCH_UNITS + DETAIL_UNITS_ESTIMATE,
      },
    },
    null,
    1
  )
);
for (const q of current) process.stdout.write(`current | ${q.lang} | ${q.query} (${q.source})\n`);
for (const q of out)
  process.stdout.write(
    `${q.branch} (${q.branchWeight}) | ${q.concept} (WANTS ${q.wants}, 판정 ${q.judgments}) | ${q.lang} | ${q.query}\n`
  );
process.stdout.write(
  `skipped: ${JSON.stringify(skipped)}\nsearches ${out.length} context + ${current.length} current -> about ${searches * SEARCH_UNITS + DETAIL_UNITS_ESTIMATE} units\n`
);
