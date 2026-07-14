/**
 * Card-cell fitness judge — gA single-judge DEBOOST wiring (2026-07-12).
 *
 * The quality report's judge benchmark (150 human labels, 8 configs) showed
 * NO single judge is safe for REMOVAL (best config still false-blocks 19-22%
 * of fit cards — fatal for scarce niche supply). The confirmed design is a
 * two-judge unanimous-removal stack; until the local B' leg exists, this
 * module wires gA (Gemini Flash via the OpenRouter gateway — the benchmark's
 * exact config) as a DEBOOST-ONLY signal: unfit cards are never deleted, they
 * sink to the bottom of the 관련도순 default sort.
 *
 * Prompt contract [확정, report §7.3 금지 조항]:
 *  - Input is EXACTLY: video title, cell topic, center goal. NO descriptions
 *    (they substitute the judgment question), NO few-shot examples (surface
 *    feature learning).
 *  - Anchor: "판단 기준은 이 셀의 주제 단독이다. 도메인 관련성은 적합의
 *    근거가 아니다."
 *  - temperature 0, JSON output.
 */
import { OpenRouterGenerationProvider } from '@/modules/llm/openrouter';
import { logger } from '@/utils/logger';

const log = logger.child({ module: 'card-cell-judge' });

/**
 * Unanimous 2-judge stack (2026-07-13 — 반려견 false-sink incident: single gA
 * sank 5 clearly-relevant dog-training cards). The quality report's confirmed
 * design: NO single judge is safe; sinking requires UNANIMOUS unfit across
 * different model families. A failed/unparseable leg votes fit (fail-open =
 * blocks sinking, never causes it).
 */
export const JUDGE_MODELS = ['google/gemini-2.5-flash', 'deepseek/deepseek-v4-flash'] as const;
/** @deprecated single-judge era; kept for log compat. */
export const JUDGE_MODEL = JUDGE_MODELS[0];
const JUDGE_TEMPERATURE = 0;
const JUDGE_MAX_TOKENS = 800;

export interface JudgeItem {
  videoId: string;
  title: string;
}

export interface JudgeVerdict {
  videoId: string;
  fit: boolean;
}

export function buildJudgePrompt(params: {
  centerGoal: string;
  cellTopic: string;
  items: JudgeItem[];
}): string {
  const list = params.items.map((it, i) => `${i + 1}. ${it.title}`).join('\n');
  return [
    `당신은 학습 큐레이션 판별기다. 아래 영상 제목들이 이 셀의 학습 주제에 적합한지 판정하라.`,
    ``,
    `중심 목표: ${params.centerGoal}`,
    `셀 주제: ${params.cellTopic}`,
    ``,
    `판단 기준은 이 셀의 주제 단독이다. 도메인 관련성은 적합의 근거가 아니다.`,
    `해당 주제를 배우는 데 기여하지 않는 담론·잡담·무관 콘텐츠는 unfit이다.`,
    `중심 목표의 학습 대상과 다른 대상을 위한 콘텐츠는 unfit이다. 예: 목표의 대상이 반려견인데 사람·아동·학생·내담자를 다루는 심리·교육·상담 콘텐츠.`,
    `제목만으로 판별이 불가능하면 fit으로 판정하라(보수적).`,
    ``,
    `영상 제목:`,
    list,
    ``,
    `JSON 배열로만 답하라. 각 항목: {"n": 번호, "fit": true|false}`,
  ].join('\n');
}

/** Parse the model's JSON (tolerates fenced blocks). null = unparseable. */
export function parseJudgeResponse(raw: string, items: JudgeItem[]): JudgeVerdict[] | null {
  try {
    const cleaned = raw.replace(/```json|```/g, '').trim();
    const start = cleaned.indexOf('[');
    const end = cleaned.lastIndexOf(']');
    if (start < 0 || end <= start) return null;
    const arr = JSON.parse(cleaned.slice(start, end + 1)) as Array<{ n: number; fit: boolean }>;
    if (!Array.isArray(arr)) return null;
    const byN = new Map<number, boolean>();
    for (const e of arr) {
      if (typeof e?.n === 'number' && typeof e?.fit === 'boolean') byN.set(e.n, e.fit);
    }
    // Fail-open per item: missing verdict = fit (never punish on parser gaps).
    return items.map((it, i) => ({ videoId: it.videoId, fit: byN.get(i + 1) ?? true }));
  } catch {
    return null;
  }
}

/**
 * Judge one cell's cards. Fail-open at every level: provider error or parse
 * failure returns all-fit (deboost is an enhancement, never a serving risk).
 */
export async function judgeCellCards(params: {
  centerGoal: string;
  cellTopic: string;
  items: JudgeItem[];
  generateImpl?: (
    model: string,
    prompt: string,
    options?: { temperature?: number; maxTokens?: number; format?: 'json' }
  ) => Promise<string>;
}): Promise<JudgeVerdict[]> {
  if (params.items.length === 0) return [];
  const prompt = buildJudgePrompt(params);
  const generate =
    params.generateImpl ??
    (async (
      model: string,
      p: string,
      o?: { temperature?: number; maxTokens?: number; format?: 'json' }
    ) => {
      const provider = new OpenRouterGenerationProvider(model);
      return provider.generate(p, o);
    });

  // One vote per model; any leg failure = that leg votes all-fit.
  const legs = await Promise.all(
    JUDGE_MODELS.map(async (model): Promise<JudgeVerdict[]> => {
      try {
        const raw = await generate(model, prompt, {
          temperature: JUDGE_TEMPERATURE,
          maxTokens: JUDGE_MAX_TOKENS,
          format: 'json',
        });
        const verdicts = parseJudgeResponse(raw, params.items);
        if (!verdicts) {
          log.warn(`judge leg unparseable — leg votes fit (model=${model})`, {
            cellTopic: params.cellTopic,
          });
          return params.items.map((it) => ({ videoId: it.videoId, fit: true }));
        }
        return verdicts;
      } catch (err) {
        log.warn(`judge leg failed — leg votes fit (model=${model})`, {
          cellTopic: params.cellTopic,
          error: err instanceof Error ? err.message : String(err),
        });
        return params.items.map((it) => ({ videoId: it.videoId, fit: true }));
      }
    })
  );

  // Unanimous rule: unfit ONLY when every leg says unfit.
  return params.items.map((it, i) => ({
    videoId: it.videoId,
    fit: legs.some((leg) => leg[i]?.fit !== false),
  }));
}

export interface JudgeLegDetail {
  model: string;
  verdicts: JudgeVerdict[];
}

export interface JudgeDetailedResult {
  final: JudgeVerdict[];
  legs: JudgeLegDetail[];
}

/**
 * T11 Stage1 — per-leg detail for the supervisor's shadow metrics (split
 * rate + directional decomposition gA-only vs gB-only unfit). Same legs and
 * unanimous rule as judgeCellCards; exposed separately so existing callers
 * keep the simple contract.
 */
export async function judgeCellCardsDetailed(params: {
  centerGoal: string;
  cellTopic: string;
  items: JudgeItem[];
  /** Leg models (default: production JUDGE_MODELS). Panel runs pass more. */
  models?: readonly string[];
  generateImpl?: (
    model: string,
    prompt: string,
    options?: { temperature?: number; maxTokens?: number; format?: 'json' }
  ) => Promise<string>;
}): Promise<JudgeDetailedResult> {
  if (params.items.length === 0) return { final: [], legs: [] };
  const models = params.models ?? JUDGE_MODELS;
  const prompt = buildJudgePrompt(params);
  const generate =
    params.generateImpl ??
    (async (
      model: string,
      p: string,
      o?: { temperature?: number; maxTokens?: number; format?: 'json' }
    ) => {
      const provider = new OpenRouterGenerationProvider(model);
      return provider.generate(p, o);
    });
  const legs = await Promise.all(
    models.map(async (model): Promise<JudgeLegDetail> => {
      try {
        const raw = await generate(model, prompt, {
          temperature: JUDGE_TEMPERATURE,
          maxTokens: JUDGE_MAX_TOKENS,
          format: 'json',
        });
        const verdicts = parseJudgeResponse(raw, params.items);
        return {
          model,
          verdicts: verdicts ?? params.items.map((it) => ({ videoId: it.videoId, fit: true })),
        };
      } catch {
        return { model, verdicts: params.items.map((it) => ({ videoId: it.videoId, fit: true })) };
      }
    })
  );
  // Continuity: `final` stays the PRODUCTION unanimous pair even when a
  // wider panel runs — panel legs are experiment data, not the verdict.
  const prodLegs = legs.filter((l) => (JUDGE_MODELS as readonly string[]).includes(l.model));
  const verdictLegs = prodLegs.length > 0 ? prodLegs : legs;
  const final = params.items.map((it, i) => ({
    videoId: it.videoId,
    fit: verdictLegs.some((leg) => leg.verdicts[i]?.fit !== false),
  }));
  return { final, legs };
}
