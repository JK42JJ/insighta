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

export interface V2QuickResult {
  core: {
    one_liner: string;
  };
  analysis: {
    core_argument: string;
    mandala_fit: {
      mandala_relevance_pct: number;
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
- core.one_liner: A short, direct label phrase. Think of how a Korean mandala sub-goal is labelled (e.g. "기초 체력", "장거리 지구력") — concise, scannable. NOT a sentence with verbs like "…을 설명합니다".
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

  return RICH_SUMMARY_V2_QUICK_PROMPT.replace(/\{language\}/g, input.language)
    .replace(/\{language_label\}/g, languageLabel)
    .replace(/\{title\}/g, input.title)
    .replace(/\{channel\}/g, input.channel)
    .replace(/\{description\}/g, descTrim)
    .replace(/\{mandala_center_goal\}/g, input.mandalaCenterGoal || '(empty)')
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

export function validateV2Quick(raw: unknown): V2QuickResult {
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

  return {
    core: {
      one_liner: requireString(cc['one_liner'], 'core.one_liner', 80),
    },
    analysis: {
      core_argument: requireString(aa['core_argument'], 'analysis.core_argument', 500),
      mandala_fit: {
        mandala_relevance_pct: requireInteger(
          mff['mandala_relevance_pct'],
          'analysis.mandala_fit.mandala_relevance_pct'
        ),
      },
    },
  };
}
