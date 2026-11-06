/**
 * Staged candidate pipeline: freshness -> language -> duplicate -> relevance -> cap.
 * Every input candidate gets exactly one terminal decision. Reasons are short
 * codes only; untrusted titles never appear in them.
 */

import type { MorningCardsConfig } from './config';
import { resolveFreshnessClass } from './config';
import { isFresh } from './freshness';

export interface Candidate {
  videoId: string;
  title: string;
  channelId: string;
  channelTitle: string;
  publishedAt: string | null;
  language: string | null;
}

export type Stage = 'freshness' | 'language' | 'duplicate' | 'relevance' | 'cap';

export interface Decision {
  videoId: string;
  stage: Stage;
  passed: boolean;
  reason: string;
  score?: number;
}

export interface RelevanceScorer {
  /** Returns an integer 0-100. */
  score(candidate: Candidate, ctx: { fieldId: string; topicText: string }): Promise<number>;
}

export interface PipelineInput {
  fieldId: string;
  topicText: string;
  candidates: Candidate[];
  now: Date;
  config: MorningCardsConfig;
  deps: { scorer: RelevanceScorer };
}

export interface PipelineResult {
  passed: Candidate[];
  decisions: Decision[];
}

const MAX_SCORE = 100;

function at(list: Candidate[], i: number): Candidate {
  const c = list[i];
  if (!c) throw new Error('candidate index out of range');
  return c;
}

export function normalizeTitle(title: string): string {
  return (title ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

function clampScore(n: unknown): number | null {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  return Math.min(MAX_SCORE, Math.max(0, Math.round(n)));
}

export async function runPipeline(input: PipelineInput): Promise<PipelineResult> {
  const { fieldId, topicText, candidates, now, config, deps } = input;
  const decisions = new Map<number, Decision>();
  const freshnessClass = resolveFreshnessClass(fieldId, topicText, config);

  let alive: number[] = [];
  candidates.forEach((c, i) => {
    const f = isFresh({ publishedAt: c.publishedAt, now, freshnessClass, config });
    if (!f.passed) {
      decisions.set(i, { videoId: c.videoId, stage: 'freshness', passed: false, reason: f.reason });
    } else alive.push(i);
  });

  const allowed = new Set(config.allowedLanguages);
  const afterLang: number[] = [];
  for (const i of alive) {
    const c = at(candidates, i);
    if (!c.language || !allowed.has(c.language)) {
      decisions.set(i, {
        videoId: c.videoId,
        stage: 'language',
        passed: false,
        reason: 'language_not_allowed',
      });
    } else afterLang.push(i);
  }
  alive = afterLang;

  const seenIds = new Set<string>();
  const seenTitles = new Set<string>();
  const afterDup: number[] = [];
  for (const i of alive) {
    const c = at(candidates, i);
    const title = normalizeTitle(c.title);
    if (seenIds.has(c.videoId)) {
      decisions.set(i, {
        videoId: c.videoId,
        stage: 'duplicate',
        passed: false,
        reason: 'duplicate_video',
      });
    } else if (title && seenTitles.has(title)) {
      decisions.set(i, {
        videoId: c.videoId,
        stage: 'duplicate',
        passed: false,
        reason: 'duplicate_title',
      });
    } else {
      seenIds.add(c.videoId);
      if (title) seenTitles.add(title);
      afterDup.push(i);
    }
  }
  alive = afterDup;

  const scored: { i: number; score: number }[] = [];
  for (const i of alive) {
    const c = at(candidates, i);
    let score: number | null = null;
    try {
      score = clampScore(await deps.scorer.score(c, { fieldId, topicText }));
    } catch {
      score = null;
    }
    if (score === null) {
      decisions.set(i, {
        videoId: c.videoId,
        stage: 'relevance',
        passed: false,
        reason: 'scorer_failed',
      });
    } else if (score < config.minRelevance) {
      decisions.set(i, {
        videoId: c.videoId,
        stage: 'relevance',
        passed: false,
        reason: 'below_min_relevance',
        score,
      });
    } else scored.push({ i, score });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const ta = Date.parse(at(candidates, a.i).publishedAt as string);
    const tb = Date.parse(at(candidates, b.i).publishedAt as string);
    return tb - ta;
  });

  const passed: Candidate[] = [];
  scored.forEach(({ i, score }, rank) => {
    const c = at(candidates, i);
    if (rank < config.maxCardsPerField) {
      decisions.set(i, { videoId: c.videoId, stage: 'cap', passed: true, reason: 'passed', score });
      passed.push(c);
    } else {
      decisions.set(i, {
        videoId: c.videoId,
        stage: 'cap',
        passed: false,
        reason: 'over_cap',
        score,
      });
    }
  });

  return { passed, decisions: candidates.map((_, i) => decisions.get(i) as Decision) };
}
