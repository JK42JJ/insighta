/**
 * Domain-fit T3 client — frozen prompt + raw Ollama /api/generate call.
 *
 * Verbatim reproduction of the frozen T3 spec (docs/qa/domain-fit-probe-T3.md,
 * R12-validated: false-not-fit-on-legit 3.3% overall / 0% on niche_legit,
 * drift-detection 95.5%). Deliberately NOT reusing the generic
 * `OllamaGenerationProvider` (src/modules/llm/ollama.ts) — that provider
 * calls `/api/chat` with `think:false` framing, a different template shape
 * that was never validated against this spec. Reproducibility over reuse
 * here: the frozen prompt must hit `/api/generate` with `raw:true`.
 *
 * Local-inference only. No Anthropic / OpenRouter / YouTube API calls.
 */

import { logger } from '@/utils/logger';
import type { DomainFitShadowConfig } from '@/config/domain-fit-shadow';

const log = logger.child({ module: 'domain-fit-shadow/client' });

export type DomainFitLabel = '적합' | '비적합';

export interface DomainFitResult {
  fit: DomainFitLabel | null;
  ms: number;
  ok: boolean;
  error?: string;
}

export interface DomainFitScalarResult extends DomainFitResult {
  /** 0.0-1.0 confidence from the T3_SCALAR variant; null on parse failure. */
  score: number | null;
}

/** Frozen T3 (verbatim — do not alter; see docs/qa/domain-fit-probe-T3.md). */
export function buildT3Prompt(goal: string, title: string): string {
  return `### Instruction:\n다음 영상 제목과 목표의 주제 적합성을 분류하라 (적합/비적합). JSON만 출력: {"fit": "적합"|"비적합"}\n\n### Input:\n영상 제목: ${title}\n관련 목표: ${goal}\n\n### Output:\n`;
}

/**
 * Frozen T3_SCALAR (verbatim — do not alter; "R12 scalar-capture variant" in
 * docs/qa/domain-fit-probe-T3.md). Additive, separate call — never substitutes
 * for the frozen binary T3 call above. R14-1: captures a 0.0-1.0 confidence
 * alongside the binary label so a future rerank multiplier sim has a REAL
 * gradient to work with (R13-2 found the binary label alone forces a
 * synthetic-proxy-score simulation with no usable 0.15/0.2/0.3 differentiation).
 */
export function buildT3ScalarPrompt(goal: string, title: string): string {
  return `### Instruction:\n다음 영상 제목과 목표의 주제 적합성을 분류하라 (적합/비적합). 그리고 0.0~1.0 사이의 적합도 confidence 점수도 함께 산정하라 (1.0=완전히 같은 주제, 0.0=전혀 무관). JSON만 출력: {"fit": "적합"|"비적합", "score": 0.0~1.0}\n\n### Input:\n영상 제목: ${title}\n관련 목표: ${goal}\n\n### Output:\n`;
}

/** Frozen parse strategy (verbatim — see runner.mjs parseFit / probe spec §Parse strategy). */
export function parseFit(raw: string): { parsed: DomainFitLabel | null; ok: boolean } {
  try {
    const m = raw.match(/\{[^{}]*\}/);
    if (m) {
      const obj = JSON.parse(m[0]) as { fit?: unknown };
      if (obj.fit === '적합' || obj.fit === '비적합') {
        return { parsed: obj.fit, ok: true };
      }
    }
  } catch {
    /* fallthrough to fragile fallback, flagged parse_clean:false */
  }
  const hasNonfit = raw.includes('비적합');
  const hasFit = raw.includes('"적합"') || (raw.includes('적합') && !hasNonfit);
  if (hasNonfit) return { parsed: '비적합', ok: false };
  if (hasFit) return { parsed: '적합', ok: false };
  return { parsed: null, ok: false };
}

/** Frozen parse strategy for the T3_SCALAR variant (fit + numeric score). */
export function parseFitScalar(raw: string): {
  parsed: DomainFitLabel | null;
  score: number | null;
  ok: boolean;
} {
  try {
    const m = raw.match(/\{[^{}]*\}/);
    if (m) {
      const obj = JSON.parse(m[0]) as { fit?: unknown; score?: unknown };
      if (obj.fit === '적합' || obj.fit === '비적합') {
        const score =
          typeof obj.score === 'number' && Number.isFinite(obj.score) ? obj.score : null;
        return { parsed: obj.fit, score, ok: true };
      }
    }
  } catch {
    /* fallthrough to fragile fallback, flagged parse_clean:false */
  }
  const { parsed } = parseFit(raw);
  return { parsed, score: null, ok: false };
}

/**
 * Single T3 binary classification call. Never throws — timeouts/transport
 * errors resolve to `{ fit: null, ok: false, error }` so a burst of shadow
 * calls can `Promise.all` safely (one bad candidate never poisons the batch).
 */
export async function classifyDomainFit(
  goal: string,
  title: string,
  cfg: Pick<DomainFitShadowConfig, 'ollamaUrl' | 'model' | 'timeoutMs'>
): Promise<DomainFitResult> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const res = await fetch(`${cfg.ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: cfg.model,
        prompt: buildT3Prompt(goal, title),
        raw: true,
        stream: false,
        options: { temperature: 0.1, num_predict: 60 },
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      return {
        fit: null,
        ms: Date.now() - started,
        ok: false,
        error: `http ${res.status}: ${body.slice(0, 200)}`,
      };
    }
    const json = (await res.json()) as { response?: string };
    const { parsed } = parseFit(json.response ?? '');
    return { fit: parsed, ms: Date.now() - started, ok: parsed !== null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.debug(`domain-fit shadow call failed (swallowed): ${msg}`);
    return { fit: null, ms: Date.now() - started, ok: false, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * R14-1 — additive scalar-capture call (T3_SCALAR). A SEPARATE call from
 * `classifyDomainFit`, never a substitute — the frozen binary T3 result stays
 * the primary label; this only adds a confidence gradient for the rerank
 * simulation. Same never-throws contract as `classifyDomainFit`.
 */
export async function classifyDomainFitScalar(
  goal: string,
  title: string,
  cfg: Pick<DomainFitShadowConfig, 'ollamaUrl' | 'model' | 'timeoutMs'>
): Promise<DomainFitScalarResult> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const res = await fetch(`${cfg.ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: cfg.model,
        prompt: buildT3ScalarPrompt(goal, title),
        raw: true,
        stream: false,
        options: { temperature: 0.1, num_predict: 60 },
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      return {
        fit: null,
        score: null,
        ms: Date.now() - started,
        ok: false,
        error: `http ${res.status}: ${body.slice(0, 200)}`,
      };
    }
    const json = (await res.json()) as { response?: string };
    const { parsed, score } = parseFitScalar(json.response ?? '');
    return { fit: parsed, score, ms: Date.now() - started, ok: parsed !== null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.debug(`domain-fit shadow scalar call failed (swallowed): ${msg}`);
    return { fit: null, score: null, ms: Date.now() - started, ok: false, error: msg };
  } finally {
    clearTimeout(timer);
  }
}
