/**
 * The judge that is a model.
 *
 * Batched, because the cost of judging 450 candidates one at a time is the
 * prompt repeated 450 times. Asks for three axes and a reason per candidate,
 * and treats a missing answer as an error rather than as approval — the same
 * failure policy `curation/topic-judge` settled on after a batch that returned
 * partial results was read as "everything passed".
 *
 * The credit breaker sits in front of the call: when the account is empty this
 * throws immediately instead of spending a round trip, and the run can be
 * restarted with the console judge without redoing S0.
 */

import { config } from '@/config/index';
import { logger } from '@/utils/logger';
import { creditGate, creditBlockMessage, noteCreditRefusal } from '@/modules/llm/credit-guard';
import { JudgeError, type JudgeCandidate, type JudgeVerdict, type TopicJudge } from './types';

const log = logger.child({ module: 'newsletter/judge/openrouter' });

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const BATCH_SIZE = 40;
const REQUEST_TIMEOUT_MS = 60_000;

const SYSTEM_PROMPT = [
  'You screen YouTube videos for a weekly brief about AI engineering.',
  'For each numbered candidate answer three independent questions:',
  '  safe      — nothing harmful, sexual, or deceptive.',
  '  learnable — teaches something a working engineer can act on.',
  '              A news roundup with no first-hand material is not learnable.',
  '  inScope   — about AI itself: models, pricing, agents, inference, the',
  '              tooling around them. General programming belongs elsewhere.',
  'Reply with JSON only: {"r":[{"i":0,"s":true,"l":true,"c":true,"w":"reason"}]}',
  'Answer every candidate. Omitting one is an error, not a rejection.',
].join('\n');

function buildUserPrompt(batch: JudgeCandidate[]): string {
  return batch
    .map(
      (c, i) =>
        `${i}. ${c.title}\n   channel: ${c.channelTitle}` +
        `${c.durationSeconds ? ` | ${Math.round(c.durationSeconds / 60)}min` : ''}` +
        `${c.viewCount != null ? ` | ${c.viewCount} views` : ''}`
    )
    .join('\n');
}

interface ReplyRow {
  i?: number;
  s?: boolean;
  l?: boolean;
  c?: boolean;
  w?: string;
}

export function createOpenRouterJudge(opts?: {
  model?: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}): TopicJudge {
  const model = opts?.model ?? config.openrouter.model;
  const apiKey = opts?.apiKey ?? config.openrouter.apiKey;
  const fetchFn = opts?.fetchImpl ?? fetch;

  return {
    name: 'openrouter',
    provenance: `openrouter/${model}`,

    async judge(candidates: JudgeCandidate[]): Promise<JudgeVerdict[]> {
      if (!apiKey) throw new JudgeError('OPENROUTER_API_KEY not configured');

      const out: JudgeVerdict[] = [];
      for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
        const batch = candidates.slice(i, i + BATCH_SIZE);

        const credit = await creditGate(`openrouter/${model}`);
        if (!credit.allowed) throw new JudgeError(creditBlockMessage(credit));

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        let res: Response;
        try {
          res = await fetchFn(OPENROUTER_API_URL, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model,
              messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: buildUserPrompt(batch) },
              ],
              temperature: 0,
              max_tokens: 4096,
              response_format: { type: 'json_object' },
            }),
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timer);
        }

        if (!res.ok) {
          const detail = `OpenRouter HTTP ${res.status}`;
          await noteCreditRefusal(`openrouter/${model}`, 'newsletter-judge', detail);
          throw new JudgeError(detail);
        }

        const json = (await res.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        void import('@/modules/llm/call-logger')
          .then(({ logLLMCall }) =>
            logLLMCall({
              module: 'newsletter-judge',
              model: `openrouter/${model}`,
              inputTokens: json.usage?.prompt_tokens,
              outputTokens: json.usage?.completion_tokens,
              status: 'success',
            })
          )
          .catch(() => undefined);

        const content = json.choices?.[0]?.message?.content ?? '';
        const cleaned = content.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
        let rows: ReplyRow[];
        try {
          rows = (JSON.parse(cleaned) as { r?: ReplyRow[] }).r ?? [];
        } catch {
          throw new JudgeError(`judge returned unparseable content: ${content.slice(0, 120)}`);
        }

        const byIndex = new Map(
          rows.filter((r) => typeof r.i === 'number').map((r) => [r.i as number, r])
        );
        for (let k = 0; k < batch.length; k++) {
          const r = byIndex.get(k);
          const c = batch[k] as JudgeCandidate;
          if (
            !r ||
            typeof r.s !== 'boolean' ||
            typeof r.l !== 'boolean' ||
            typeof r.c !== 'boolean'
          ) {
            throw new JudgeError(`judge returned no usable verdict for index ${k} (${c.videoId})`);
          }
          out.push({
            videoId: c.videoId,
            safe: r.s,
            learnable: r.l,
            inScope: r.c,
            why: (r.w ?? '').trim() || 'no reason given',
          });
        }
        log.info('judge batch complete', { from: i, size: batch.length });
      }
      return out;
    },
  };
}
