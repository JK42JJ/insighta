#!/usr/bin/env npx tsx
/**
 * level-query-diff — print the rule-based search queries that the
 * video-discover keyword builder produces per (centerGoal × target_level).
 *
 * Read-only: calls the exported `buildRuleBasedQueriesSync` only. No network,
 * no LLM, no DB. Importing the builder loads `src/config` (dotenv + zod with
 * defaults), which reads .env if present but does not connect anywhere.
 *
 * Purpose: compare the `level` query before/after the target_level mapping
 * fix (wizard values foundation | standard | advanced vs the old
 * beginner/intermediate/advanced/expert map). Run the same file on both
 * commits and diff the output:
 *
 *   KB=src/skills/plugins/video-discover/v2/keyword-builder.ts
 *   npx tsx scripts/ops/level-query-diff.ts > /tmp/level-new.txt
 *   cp $KB /tmp/kb-new.bak && git show <old-commit>:$KB > $KB
 *   npx tsx scripts/ops/level-query-diff.ts > /tmp/level-old.txt
 *   cp /tmp/kb-new.bak $KB          # restore the new builder
 *   diff /tmp/level-old.txt /tmp/level-new.txt
 *
 * subGoals are left empty so the list is core + level only (the subgoal
 * queries do not depend on target_level).
 *
 * The sample levels are literals on purpose: the script must also run on the
 * old commit, where the shared TARGET_LEVELS constant does not exist.
 */

import {
  buildRuleBasedQueriesSync,
  type KeywordLanguage,
  type SearchQuery,
} from '../../src/skills/plugins/video-discover/v2/keyword-builder';

interface SampleGoal {
  centerGoal: string;
  language: KeywordLanguage;
}

const SAMPLE_GOALS: readonly SampleGoal[] = [
  { centerGoal: 'AI 에이전트로 업무 자동화', language: 'ko' },
  { centerGoal: '주식 투자 기초', language: 'ko' },
  { centerGoal: '영어 회화 실력 향상', language: 'ko' },
  { centerGoal: 'learn data analysis with python', language: 'en' },
];

const SAMPLE_LEVELS: readonly string[] = ['foundation', 'standard', 'advanced'];

const NO_LEVEL_QUERY = '(none)';

function formatQuery(q: SearchQuery): string {
  const cell = q.cellIndex === undefined || q.cellIndex === null ? '' : ` cell=${q.cellIndex}`;
  return `    [${q.source}${cell}] ${q.query}`;
}

function main(): void {
  for (const goal of SAMPLE_GOALS) {
    for (const level of SAMPLE_LEVELS) {
      const queries = buildRuleBasedQueriesSync({
        centerGoal: goal.centerGoal,
        subGoals: [],
        targetLevel: level,
        language: goal.language,
      });
      const levelQuery = queries.find((q) => q.source === 'level')?.query ?? NO_LEVEL_QUERY;
      process.stdout.write(`${goal.language} | ${goal.centerGoal} | target_level=${level}\n`);
      process.stdout.write(`  level query: ${levelQuery}\n`);
      process.stdout.write(`  rule queries (${queries.length}):\n`);
      for (const q of queries) process.stdout.write(`${formatQuery(q)}\n`);
      process.stdout.write('\n');
    }
  }
}

main();
