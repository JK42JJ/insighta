/**
 * Rich Summary v2 — quick (fast-path) prompt.
 *
 * Produces ONLY the three fields the user needs to see within 3-4 seconds of
 * clicking the bookmark icon:
 *   - core.one_liner (≤20자, sidebar entry text)
 *   - analysis.core_argument (2-3 문장, card body)
 *   - analysis.mandala_fit.mandala_relevance_pct (0-100, relevance badge)
 *
 * Designed to run on Claude Haiku via OpenRouter — low latency (~1s),
 * low cost. The remaining v2 layered fields (segments.sections,
 * segments.atoms, analysis.entities, analysis.key_concepts, lora.qa_pairs)
 * are filled in by the regular `generateRichSummaryV2` (Sonnet) running
 * in the background after the quick result is persisted.
 *
 * Hard rule alignment:
 *   - PROD-only LLM (Anthropic via OpenRouter); never called from scripts/tests.
 *   - JSON output only — caller validates with `validateV2Quick` below.
 */

import { composeRubricScore } from '@/modules/relevance/relevance-composition';

export interface V2QuickResult {
  core: {
    one_liner: string;
  };
  analysis: {
    core_argument: string;
    mandala_fit: {
      mandala_relevance_pct: number;
      /** Present ONLY in rubric mode — raw axes (logged, not persisted yet). */
      rubric?: {
        cell_fit_pct: number | null;
        goal_contribution_pct: number;
        actionability_pct: number;
      };
    };
  };
}

export interface QuickPromptInput {
  title: string;
  description: string;
  channel: string;
  language: 'ko' | 'en';
  transcript: string;
  mandalaCenterGoal: string;
  /**
   * CP499+ rubric mode (RELEVANCE_RUBRIC_ENABLED) — the LLM scores 3 axes
   * (cell_fit / goal_contribution / actionability) and the COMPOSITE is
   * computed in code (relevance-composition.ts). Why: a single LLM composite
   * collapses into round-number modes and compresses on abstract goals
   * (sd 6.8 measured). Absent/false ⇒ the legacy single-axis prompt,
   * byte-identical to pre-CP499+ output.
   */
  rubric?: boolean;
  /** Rubric mode only — the cell sub-goal, printed as a separate CELL GOAL line. */
  cellGoal?: string;
}

const RICH_SUMMARY_V2_QUICK_PROMPT = `You are a learning content analyst. Output ONLY valid JSON matching this exact shape — no markdown fences, no commentary, no chain-of-thought.

Schema:
{
  "core": {
    "one_liner": "<{language_label}, ≤ 20 characters, no quotes, no trailing punctuation>"
  },
  "analysis": {
    "core_argument": "<{language_label}, 2-3 sentences capturing the central thesis>",
    "mandala_fit": {
      "mandala_relevance_pct": <integer 0..100>
    }
  }
}

Rules:
- Output language MUST be {language} ({language_label}).
- core.one_liner: A short, direct label phrase, **STRICT ≤ 18 characters** (count includes spaces). Think mandala sub-goal: "기초 체력", "월배당 ETF 전략", "절세 노하우".
  - DO NOT write full sentences. DO NOT enumerate ("A, B, C 그리고 D"). DO NOT use verbs like "…을 설명합니다", "…에 대해 알아봅니다".
  - GOOD: "월배당 ETF 전략" (10) / "노후 자산 관리" (8) / "온라인 창업 핵심" (8)
  - BAD: "미국 10대 부자들이 SNS, 리셀, AI SaaS, 드롭쉬핑으로 돈 버는 4가지 방식" (a sentence)
  - BAD: "이 영상은 ETF 전략을 설명합니다" (verb sentence)
  - If you cannot summarize in 18 chars, output ONLY the most central concept noun phrase.
- analysis.core_argument: 2-3 sentences that state the video's actual claim or insight directly. Forbidden filler: "이 영상은", "이 콘텐츠는", "…을 설명한다", "…을 주장한다", "…을 안내합니다", "…을 보여준다". Write as a declarative claim ("X 는 Y 다", "X 하려면 Y 가 핵심이다").
- analysis.mandala_fit.mandala_relevance_pct: integer 0-100 measuring how well the video fits the user's mandala center goal below. Score 0 when the goal is empty or genuinely unrelated; reserve 90+ for videos that clearly address the exact goal. Be conservative.
- Prefer transcript content over title/description for evidence. When transcript is empty, fall back to title + description.

VIDEO TITLE: {title}
CHANNEL: {channel}
DESCRIPTION (truncated 400 chars): {description}
MANDALA CENTER GOAL: {mandala_center_goal}

TRANSCRIPT (truncated 4000 chars):
{transcript}
`;

/**
 * CP499+ rubric variant — same prompt body, but mandala_fit asks for 3 raw
 * axes instead of one composite. The composite is computed in code
 * (relevance-composition.ts), which is the score-compression fix. Weights and
 * axis definitions are PROVISIONAL gate-validation targets, not law.
 */
const RUBRIC_MANDALA_FIT_SCHEMA = `"mandala_fit": {
      "cell_fit_pct": <integer 0..100, or null when CELL GOAL is "(none)">,
      "goal_contribution_pct": <integer 0..100>,
      "actionability_pct": <integer 0..100>
    }`;

const RUBRIC_MANDALA_FIT_RULES = `- analysis.mandala_fit.cell_fit_pct: integer 0-100 — how well the video fits the CELL GOAL below. Output null when CELL GOAL is "(none)".
- analysis.mandala_fit.goal_contribution_pct: integer 0-100 — ask ONE question: "if a person whose goal is the MANDALA CENTER GOAL below watches this video, do they make REAL PROGRESS toward that goal?" Score the progress, NOT topical overlap.
  * SURFACE OVERLAP is NOT contribution: sharing words/domain/mood with the goal while leaving the viewer no closer scores LOW (≤40). Example: center goal "행복한 삶을 위한 나만의 프레임워크 만들기" + video "다른그림찾기 두뇌운동 — 매일 꾸준히 하면 좋은 습관" → shares "일상/습관" framing but builds no framework → 30.
  * INDIRECT CONTRIBUTION COUNTS: a video that never names the goal but transfers experience, methods, or hard-won lessons that move this exact journey forward scores HIGH (≥70). Example: center goal "클로드 코드로 1인 SaaS 빌드하기" + video "비개발자가 바이브코딩으로 500만원 벌며 깨달은 점" → real solo-builder economics for the same journey → 75.
  * Score 0 when the goal is empty or genuinely unrelated; reserve 90+ for videos that clearly address the exact goal.
- analysis.mandala_fit.actionability_pct: integer 0-100 — how directly a viewer can ACT on this video toward the goal. Concrete methods/steps/tools score high; abstract motivation/general talk scores low. Judge this axis independently from the other two.`;

const SINGLE_AXIS_SCHEMA = `"mandala_fit": {
      "mandala_relevance_pct": <integer 0..100>
    }`;

const SINGLE_AXIS_RULE = `- analysis.mandala_fit.mandala_relevance_pct: integer 0-100 measuring how well the video fits the user's mandala center goal below. Score 0 when the goal is empty or genuinely unrelated; reserve 90+ for videos that clearly address the exact goal. Be conservative.`;

const MAX_DESC_CHARS = 400;
const MAX_TRANSCRIPT_CHARS = 4000;

export function buildV2QuickPrompt(input: QuickPromptInput): string {
  const languageLabel = input.language === 'ko' ? 'Korean (한국어)' : 'English';
  const descTrim =
    input.description.length > MAX_DESC_CHARS
      ? `${input.description.slice(0, MAX_DESC_CHARS)}…`
      : input.description;
  const transcriptText = input.transcript?.trim() ?? '';
  const transcriptTrim =
    transcriptText.length > MAX_TRANSCRIPT_CHARS
      ? `${transcriptText.slice(0, MAX_TRANSCRIPT_CHARS)}…`
      : transcriptText || '(no transcript)';

  let template = RICH_SUMMARY_V2_QUICK_PROMPT;
  if (input.rubric) {
    template = template
      .replace(SINGLE_AXIS_SCHEMA, RUBRIC_MANDALA_FIT_SCHEMA)
      .replace(SINGLE_AXIS_RULE, RUBRIC_MANDALA_FIT_RULES)
      .replace(
        'MANDALA CENTER GOAL: {mandala_center_goal}',
        'MANDALA CENTER GOAL: {mandala_center_goal}\nCELL GOAL: {cell_goal}'
      );
  }

  return template
    .replace(/\{language\}/g, input.language)
    .replace(/\{language_label\}/g, languageLabel)
    .replace(/\{title\}/g, input.title)
    .replace(/\{channel\}/g, input.channel)
    .replace(/\{description\}/g, descTrim)
    .replace(/\{mandala_center_goal\}/g, input.mandalaCenterGoal || '(empty)')
    .replace(/\{cell_goal\}/g, input.cellGoal?.trim() || '(none)')
    .replace(/\{transcript\}/g, transcriptTrim);
}

export class V2QuickValidationError extends Error {
  constructor(
    message: string,
    public readonly path: string
  ) {
    super(message);
    this.name = 'V2QuickValidationError';
  }
}

function requireString(value: unknown, path: string, maxLen = 2000): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new V2QuickValidationError('expected non-empty string', path);
  }
  if (value.length > maxLen) {
    throw new V2QuickValidationError(`string exceeds ${maxLen} chars`, path);
  }
  return value;
}

function requireInteger(value: unknown, path: string, min = 0, max = 100): number {
  const n = typeof value === 'number' ? Math.round(value) : NaN;
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new V2QuickValidationError(`expected integer in [${min}, ${max}]`, path);
  }
  return n;
}

/**
 * CP476+ — hard cap on core.one_liner for sidebar entry legibility.
 *
 * The quick prompt instructs ≤ 20 chars + no trailing punctuation +
 * mandala-sub-goal style (e.g. "기초 체력"). LLM compliance is good
 * (15/16 mandalas pass) but the long tail produces full sentences.
 * Rather than fail the whole quick path on a length violation, we
 * truncate at 20 chars (slice + trim) and strip trailing
 * `.!?,;:、。…` so the sidebar always renders a clean label.
 */
const ONE_LINER_HARD_CAP = 20;
const TRAILING_PUNCT_RE = /[.!?,;:、。…\s]+$/;

export function trimOneLinerLabel(raw: string): string {
  let s = raw.trim();
  if (s.length > ONE_LINER_HARD_CAP) {
    s = s.slice(0, ONE_LINER_HARD_CAP);
  }
  // Strip trailing punctuation/whitespace AFTER truncation so a slice
  // that lands on ", " or "." doesn't render mid-clause.
  s = s.replace(TRAILING_PUNCT_RE, '');
  return s;
}

/**
 * CP499+ — rubric-mode validation. The LLM emits 3 raw axes; the composite
 * `mandala_relevance_pct` is computed HERE (composeRubricScore) so every
 * consumer keeps reading the same field. opts.rubric MUST match the
 * buildV2QuickPrompt rubric flag of the call that produced `raw`.
 */
export function validateV2Quick(raw: unknown, opts: { rubric?: boolean } = {}): V2QuickResult {
  if (typeof raw !== 'object' || raw === null) {
    throw new V2QuickValidationError('root must be an object', '$');
  }
  const r = raw as Record<string, unknown>;
  const c = r['core'];
  if (typeof c !== 'object' || c === null) {
    throw new V2QuickValidationError('core must be object', 'core');
  }
  const cc = c as Record<string, unknown>;
  const a = r['analysis'];
  if (typeof a !== 'object' || a === null) {
    throw new V2QuickValidationError('analysis must be object', 'analysis');
  }
  const aa = a as Record<string, unknown>;
  const mf = aa['mandala_fit'];
  if (typeof mf !== 'object' || mf === null) {
    throw new V2QuickValidationError('mandala_fit must be object', 'analysis.mandala_fit');
  }
  const mff = mf as Record<string, unknown>;

  let mandalaFit: V2QuickResult['analysis']['mandala_fit'];
  if (opts.rubric) {
    const cellFit =
      mff['cell_fit_pct'] === null || mff['cell_fit_pct'] === undefined
        ? null
        : requireInteger(mff['cell_fit_pct'], 'analysis.mandala_fit.cell_fit_pct');
    const goalContribution = requireInteger(
      mff['goal_contribution_pct'],
      'analysis.mandala_fit.goal_contribution_pct'
    );
    const actionability = requireInteger(
      mff['actionability_pct'],
      'analysis.mandala_fit.actionability_pct'
    );
    mandalaFit = {
      mandala_relevance_pct: composeRubricScore({
        cellFitPct: cellFit,
        goalContributionPct: goalContribution,
        actionabilityPct: actionability,
      }),
      rubric: {
        cell_fit_pct: cellFit,
        goal_contribution_pct: goalContribution,
        actionability_pct: actionability,
      },
    };
  } else {
    mandalaFit = {
      mandala_relevance_pct: requireInteger(
        mff['mandala_relevance_pct'],
        'analysis.mandala_fit.mandala_relevance_pct'
      ),
    };
  }

  return {
    core: {
      // CP476+ — soft truncate at 20 chars. LLM occasionally ignores the
      // "≤ 20 characters" prompt rule (~1 outlier per 80 rows observed in
      // prod sampling 2026-05-20: one entry was a full 51-char sentence
      // "미국 10대 부자들이 SNS, 리셀, AI SaaS..."). Sidebar legibility
      // depends on a hard cap, but raising the validator error rate would
      // also fail valid 21-25 char outputs, so we accept up to 200 chars
      // raw and trim instead of rejecting. Also strip trailing punctuation
      // (rule says "no trailing punctuation"; some outputs still include
      // periods).
      one_liner: trimOneLinerLabel(requireString(cc['one_liner'], 'core.one_liner', 200)),
    },
    analysis: {
      core_argument: requireString(aa['core_argument'], 'analysis.core_argument', 500),
      mandala_fit: mandalaFit,
    },
  };
}
