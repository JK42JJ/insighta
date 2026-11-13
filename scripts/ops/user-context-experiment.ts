/**
 * Experiment context v1 (James 2026-11-13): build the user-context graph from James's goal and
 * answers, optionally persist it to the stg ontology, and print the search queries of both arms.
 * No network calls; DB write only with --persist (stg DIRECT_URL passed inline, never printed).
 *
 * Usage:
 *   npx tsx scripts/ops/user-context-experiment.ts            # print structure + queries
 *   DATABASE_URL=... npx tsx scripts/ops/user-context-experiment.ts --persist
 */
import * as fs from 'fs';

import { buildRuleBasedQueriesSync } from '@/skills/plugins/video-discover/v2/keyword-builder';
import {
  branchOrder,
  createContextGraph,
  persistGraph,
  snapshotGraph,
  type ContextGraph,
  type UserContextDb,
} from '@/modules/user-context';
import { cloneGraph, ensureNode, freeze, setEdge } from '@/modules/user-context/graph';

const USER_ID = 'bdf3c0ae-33f5-43d5-b8a8-2cf824e6625c';
const CONTEXT_KEY = 'experiment:ai-agent-service:2026-11-13';
const RECENCY_DAYS = 90;
const MAX_DURATION_SECONDS = 3600;
const CHANNEL_CAP_PER_BATCH = 1;
const CONCEPT_SEED_WEIGHT = 1.0;
/** James 2026-11-13: liked channels stay as nodes but do not count in scoring. */
const CHANNEL_REFERENCE_WEIGHT = 0;
const CONCEPTS_PER_BRANCH_IN_SEARCH = 4;

const GOAL =
  'AI Agent 서비스 출시 — RSI(재귀적 자기 개선)를 지향하는 완전 자율 개선 에이전트로, 사용자에게 꼭 필요한 영상을 지속적으로 제공해 인사이트를 주는 서비스';
const WHY =
  '최근 기술 방향과 트렌드를 놓치지 않으면서, 시장에 맞는 아키텍처로 서비스를 만들고 계속 개선할 수 있는 전체 생태계를 만들기 위해';

/** Branch → concepts (ko term, en search term). Proposed by CC from James's branch descriptions. */
const BRANCHES: Array<{ title: string; concepts: Array<[string, string]> }> = [
  {
    title: '만드는 법',
    concepts: [
      ['에이전트 아키텍처', 'AI agent architecture'],
      ['멀티에이전트 오케스트레이션', 'multi-agent orchestration'],
      ['도구 호출·MCP', 'MCP tool calling agents'],
      ['자기 개선 에이전트', 'self-improving AI agent'],
      ['메모리·컨텍스트 관리', 'agent memory context engineering'],
      ['코딩 에이전트', 'Claude Code agent workflow'],
      ['에이전트 프레임워크', 'agent framework LangGraph'],
    ],
  },
  {
    title: '운영하는 법',
    concepts: [
      ['에이전트 평가', 'LLM agent evals'],
      ['LLM 비용 최적화', 'LLM cost optimization production'],
      ['관측·트레이싱', 'LLM observability tracing'],
      ['신뢰성·가드레일', 'AI agent reliability guardrails'],
      ['모델 라우팅', 'LLM model routing'],
      ['에이전트 보안·권한', 'AI agent security permissions'],
    ],
  },
  {
    title: '파는 법',
    concepts: [
      ['AI 제품 가격 정책', 'AI product pricing'],
      ['AI 에이전트 비즈니스 사례', 'AI agent startup case study'],
      ['고객 확보·GTM', 'AI startup go to market'],
      ['B2B SaaS 판매', 'B2B AI SaaS sales'],
      ['제품-시장 적합성', 'AI product market fit'],
    ],
  },
  {
    title: '업계 동향',
    concepts: [
      ['새 모델 출시', 'new AI model release'],
      ['에이전트 도구·플랫폼', 'AI agent platform launch'],
      ['경쟁 서비스 분석', 'AI agent startups comparison'],
      ['AI 업계 뉴스', 'AI industry news this week'],
      ['오픈소스 모델', 'open source LLM release'],
    ],
  },
];

/** Channels James liked on stg in tech/AI-related goals; reference only (small weight). */
const LIKED_CHANNELS: Array<[string, string]> = [
  ['UCxZ2AlaT0hOmxzZVbF_j_Sw', '코드팩토리'],
  ['UCQNE2JmbasNYbjGAcuBiRRg', '조코딩 JoCoding'],
  ['UCfZCgp-n4yLLEaX6E30Xh4w', '조코딩 AX 파트너스'],
  ['UCc3-QWjpSyx7D_x7kh3TdgQ', '레인 | AI 바이브코딩'],
  ['UCXKXULkq--aSgzScYeLYJog', '단테랩스'],
  ['UCdLZ0MsYS4hmqFgOYCB6C9w', 'CONNECT AI LAB'],
  ['UCeN2YeJcBCRJoXgzF_OU3qw', '안될공학 - IT 테크 신기술'],
  ['UCxPcb3p7xndgnYBvZW_lcmg', '홍아린 AI'],
  ['UCGpsgNbzdF7BECCVbB1COHw', 'Julian Goldie SEO'],
  ['UCkqIr5Mnmgp51naHROP0GWQ', '모아AI'],
  ['UCBtG00ljZ8R_DBQCTR4C00A', '기술노트with 알렉'],
  ['UCffVnkcGUD58U06oaLILdog', 'CODER X DOX 코더엑스독스'],
  ['UCgheNMc3gGHLsT-RISdCzDQ', '세바시 강연 Sebasi Talk'],
  ['UC-SyuGFlZXpGdR7WszgYBhw', '성공지식백과'],
  ['UC5OcAD9FTJ4uCHuehXbC2vQ', 'AI 트렌드 마스터'],
  ['UCDnzXvZkFFh0ItA5RGVQGMg', '엠엔엘 - 스타트업 클럽'],
  ['UCnZWBQxDrms6psxVc8WCuNQ', '사업계획서의 정석, 비즈니스 성공방정식'],
];

export function buildExperimentContext(): ContextGraph {
  let g = createContextGraph({
    userId: USER_ID,
    contextKey: CONTEXT_KEY,
    goalText: GOAL,
    why: WHY,
    level: 'standard',
    language: 'ko',
    recencyDays: RECENCY_DAYS,
    branches: BRANCHES.map((b) => ({ title: b.title, concepts: b.concepts.map(([ko]) => ko) })),
  });
  const m = cloneGraph(g);
  const ctx = m.nodes.get(m.contextId);
  if (!ctx) throw new Error('context node missing');
  ctx.properties = {
    ...ctx.properties,
    languages: ['ko', 'en'],
    max_duration_seconds: MAX_DURATION_SECONDS,
    channel_cap_per_batch: CHANNEL_CAP_PER_BATCH,
    avoid: ['입문용 개념 설명'],
    known_skills: ['인프라 운영', 'Claude Code 활용 기초', 'AI/ML 기초'],
    format_preference: null,
  };
  for (const b of BRANCHES) {
    for (const [ko, en] of b.concepts) {
      const c = ensureNode(m, 'concept', ko, ko, { en });
      setEdge(m, m.contextId, 'WANTS', c.id, CONCEPT_SEED_WEIGHT, { seed: 'james-2026-11-13' });
    }
  }
  for (const [id, name] of LIKED_CHANNELS) {
    const ch = ensureNode(m, 'channel', id, name, { channel_id: id });
    setEdge(m, m.contextId, 'WANTS', ch.id, CHANNEL_REFERENCE_WEIGHT, { seed: 'liked-on-stg' });
  }
  g = freeze(m);
  return g;
}

/** Korean query from a concept: middle dots become spaces; 'AI 에이전트' is added once. */
function koQuery(term: string): string {
  const plain = term.replace(/·/g, ' ').replace(/\s+/g, ' ').trim();
  if (plain.includes('에이전트')) return plain;
  if (plain.startsWith('AI ')) return `AI 에이전트 ${plain.slice('AI '.length)}`;
  return `AI 에이전트 ${plain}`;
}

/** Context arm: per branch (weight order), its first N concepts, one ko and one en query each. */
export function contextQueries(g: ContextGraph): Array<{ branch: string; lang: 'ko' | 'en'; query: string }> {
  const out: Array<{ branch: string; lang: 'ko' | 'en'; query: string }> = [];
  for (const b of branchOrder(g)) {
    const spec = BRANCHES.find((x) => x.title === b.node.title);
    if (!spec) continue;
    for (const [ko, en] of spec.concepts.slice(0, CONCEPTS_PER_BRANCH_IN_SEARCH)) {
      out.push({ branch: b.node.title, lang: 'ko', query: koQuery(ko) });
      out.push({ branch: b.node.title, lang: 'en', query: en });
    }
  }
  return out;
}

/** Current-method arm: the app's rule-based builder on the same goal (no server LLM). */
export function currentQueries(): string[] {
  return buildRuleBasedQueriesSync({
    centerGoal: 'AI Agent 서비스 출시',
    subGoals: BRANCHES.map((b) => b.title),
    targetLevel: 'standard',
    language: 'ko',
  }).map((q) => q.query);
}

async function main(): Promise<void> {
  const g = buildExperimentContext();
  const snap = snapshotGraph(g);
  const out = process.env['CTX_OUT'];
  if (out) fs.writeFileSync(out, JSON.stringify({ snapshot: snap, contextQueries: contextQueries(g), currentQueries: currentQueries() }, null, 1));
  process.stdout.write(`nodes ${g.nodes.size} edges ${g.edges.size}\n`);
  process.stdout.write(`context queries ${contextQueries(g).length}, current queries ${currentQueries().length}\n`);
  if (process.argv.includes('--persist')) {
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();
    try {
      // The writes are one statement each to a remote DB; Prisma's default 5s interactive
      // transaction limit is too short (P2028), so this one-off run allows longer.
      const TX_TIMEOUT_MS = 120_000;
      const TX_MAX_WAIT_MS = 10_000;
      const db = {
        $transaction: <T>(fn: (tx: unknown) => Promise<T>): Promise<T> =>
          prisma.$transaction(fn as never, { timeout: TX_TIMEOUT_MS, maxWait: TX_MAX_WAIT_MS }) as Promise<T>,
        $queryRawUnsafe: prisma.$queryRawUnsafe.bind(prisma),
        $executeRawUnsafe: prisma.$executeRawUnsafe.bind(prisma),
      };
      const res = await persistGraph(db as unknown as UserContextDb, g);
      process.stdout.write(`persisted ${JSON.stringify(res)}\n`);
    } finally {
      await prisma.$disconnect();
    }
  }
}

void main();
