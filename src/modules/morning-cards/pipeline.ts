/** Staged pipeline (freshness, language, duplicate, relevance, cap); reasons are codes only. */
import { resolveFreshnessClass, type MorningCardsConfig } from './config';
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

export function normalizeTitle(title: string): string {
  return (title ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

export async function runPipeline(input: PipelineInput): Promise<PipelineResult> {
  const { fieldId, topicText, candidates, now, config, deps } = input;
  const out = new Map<Candidate, Decision>();
  const fail = (c: Candidate, stage: Stage, reason: string, score?: number): void => {
    out.set(c, { videoId: c.videoId, stage, passed: false, reason, score });
  };
  const cls = resolveFreshnessClass(fieldId, topicText, config);
  const allowed = new Set(config.allowedLanguages);
  const seenIds = new Set<string>();
  const seenTitles = new Set<string>();
  const scored: { c: Candidate; score: number }[] = [];

  // Copies keep decision keys unique even if the same object appears twice in the input.
  const items = candidates.map((c) => ({ ...c }));
  for (const c of items) {
    const fresh = isFresh({ publishedAt: c.publishedAt, now, freshnessClass: cls, config });
    if (!fresh.passed) {
      fail(c, 'freshness', fresh.reason);
      continue;
    }
    if (!c.language || !allowed.has(c.language)) {
      fail(c, 'language', 'language_not_allowed');
      continue;
    }
    const title = normalizeTitle(c.title);
    if (seenIds.has(c.videoId) || (title && seenTitles.has(title))) {
      fail(c, 'duplicate', seenIds.has(c.videoId) ? 'duplicate_video' : 'duplicate_title');
      continue;
    }
    seenIds.add(c.videoId);
    if (title) seenTitles.add(title);

    let raw: unknown = null;
    try {
      raw = await deps.scorer.score(c, { fieldId, topicText });
    } catch {
      raw = null; // scorer failure is handled below
    }
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      fail(c, 'relevance', 'scorer_failed');
      continue;
    }
    const score = Math.min(MAX_SCORE, Math.max(0, Math.round(raw)));
    if (score < config.minRelevance) fail(c, 'relevance', 'below_min_relevance', score);
    else scored.push({ c, score });
  }

  // publishedAt is valid for everything that reached scoring.
  const time = (c: Candidate): number => Date.parse(c.publishedAt as string);
  scored.sort((a, b) => b.score - a.score || time(b.c) - time(a.c));

  const passed: Candidate[] = [];
  scored.forEach(({ c, score }, rank) => {
    if (rank < config.maxCardsPerField) {
      out.set(c, { videoId: c.videoId, stage: 'cap', passed: true, reason: 'passed', score });
      passed.push(c);
    } else fail(c, 'cap', 'over_cap', score);
  });

  return { passed, decisions: items.map((c) => out.get(c) as Decision) };
}
