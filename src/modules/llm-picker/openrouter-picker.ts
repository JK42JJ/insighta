/**
 * OpenRouter-backed VideoPicker — works for any chat model on OpenRouter.
 *
 * Default model = anthropic/claude-haiku-4.5 (CP490+ directive).
 * Swap via env LLM_PICKER_MODEL = anthropic/claude-sonnet-4.6
 *                               | google/gemini-2.5-flash
 *                               | any OpenRouter slug.
 */

import { OpenRouterGenerationProvider } from '../llm/openrouter';
import { logger } from '../../utils/logger';
import { getLlmPickerConfig } from '../../config/llm-picker';
import type { PickInput, PickResult, VideoPicker } from './types';

const log = logger.child({ module: 'llm-picker/openrouter' });

interface RawPickItem {
  videoId?: string;
  video_id?: string;
  id?: string;
  score?: number;
  reason?: string;
}

interface RawPickPayload {
  picks?: RawPickItem[];
  results?: RawPickItem[];
}

export class OpenRouterVideoPicker implements VideoPicker {
  readonly name = 'openrouter-picker';
  private readonly provider: OpenRouterGenerationProvider;
  private readonly modelSlug: string;

  constructor(modelSlug?: string) {
    const cfg = getLlmPickerConfig();
    this.modelSlug = modelSlug ?? cfg.model;
    this.provider = new OpenRouterGenerationProvider(this.modelSlug);
  }

  get model(): string {
    return this.modelSlug;
  }

  async pick(input: PickInput, signal?: AbortSignal): Promise<PickResult[]> {
    const cfg = getLlmPickerConfig();
    const prompt = buildPrompt(input);

    const raw = await this.provider.generate(prompt, {
      temperature: cfg.temperature,
      maxTokens: 1024,
      format: 'json',
      signal,
    });

    return parsePicks(raw, input.candidates, input.maxPicks);
  }
}

function buildPrompt(input: PickInput): string {
  const lang = input.language === 'ko' ? 'Korean' : 'English';
  const candList = input.candidates
    .map(
      (c, i) =>
        `${i + 1}. id=${c.videoId} | title="${truncate(c.title, 140)}" | channel="${truncate(c.channelTitle, 60)}" | desc="${truncate(c.description, 220)}"`
    )
    .join('\n');

  const subGoalsLine = input.subGoals.length ? input.subGoals.join(', ') : '(none)';
  const focusLine = input.focusTags.length ? input.focusTags.join(', ') : '(none)';

  return `You are a curator selecting YouTube videos for a learner's mandala-art study cell.

# Learner context (${lang})
- Parent goal: ${input.parentGoal}
- Current cell topic: ${input.cellTopic}
- Sub-goals around the parent: ${subGoalsLine}
- User-chosen focus tags: ${focusLine}
- Target level: ${input.targetLevel}

# Candidates (${input.candidates.length})
${candList}

# Task
Pick up to ${input.maxPicks} videos that BEST match the current cell topic.
Reject off-topic clickbait, ads, irrelevant compilations.
Prefer concrete educational/practical videos over generic "top 10" lists.
Score each pick on a 0..1 scale (1 = perfect match).

# Output format (strict JSON)
{
  "picks": [
    { "videoId": "<exact id from list>", "score": 0.0_to_1.0, "reason": "<one short sentence>" }
  ]
}
Return ONLY the JSON object. No prose.`;
}

function truncate(s: string, n: number): string {
  if (!s) return '';
  const clean = s.replace(/\s+/g, ' ').trim();
  return clean.length <= n ? clean : clean.slice(0, n - 1) + '…';
}

function parsePicks(
  raw: string,
  candidates: PickInput['candidates'],
  maxPicks: number
): PickResult[] {
  const validIds = new Set(candidates.map((c) => c.videoId));
  let payload: RawPickPayload;
  try {
    payload = JSON.parse(extractJson(raw)) as RawPickPayload;
  } catch (err) {
    log.warn(`picker JSON parse failed: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
  const items = payload.picks ?? payload.results ?? [];
  const out: PickResult[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    const id = (it.videoId ?? it.video_id ?? it.id ?? '').trim();
    if (!id || !validIds.has(id) || seen.has(id)) continue;
    const score =
      typeof it.score === 'number' && Number.isFinite(it.score)
        ? Math.max(0, Math.min(1, it.score))
        : 0.5;
    const reason = typeof it.reason === 'string' ? it.reason.slice(0, 240) : '';
    out.push({ videoId: id, score, reason });
    seen.add(id);
    if (out.length >= maxPicks) break;
  }
  return out;
}

function extractJson(raw: string): string {
  const trimmed = raw.trim();
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1]!.trim();
  const objStart = trimmed.indexOf('{');
  const objEnd = trimmed.lastIndexOf('}');
  if (objStart >= 0 && objEnd > objStart) return trimmed.slice(objStart, objEnd + 1);
  return trimmed;
}
