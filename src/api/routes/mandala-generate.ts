import { FastifyPluginCallback } from 'fastify';
import { config } from '../../config';

// ============================================================================
// Mandala Generate Routes — HuggingFace Space integration
// Calls Gradio API on HF Space for mandala plan generation with JSON auto-repair
// ============================================================================

// ─── Constants ───

const HF_SPACE_URL = config.huggingface.spaceUrl;
const HF_REQUEST_TIMEOUT_MS = 120_000; // 2 min (CPU inference is slow)
const MAX_RETRIES = 2;

// ─── Types ───

interface GenerateBody {
  prompt: string;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  jsonMode?: boolean;
}

interface GradioResponse {
  data: string[];
}

// ─── JSON repair utility ───

function repairJson(text: string): string {
  // Strip markdown code fences
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/g, '');
  cleaned = cleaned.replace(/\s*```$/g, '');

  // Strip <think>...</think> blocks
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

  // Try to find JSON object or array
  for (const [startChar, endChar] of [
    ['{', '}'],
    ['[', ']'],
  ] as const) {
    const startIdx = cleaned.indexOf(startChar);
    if (startIdx === -1) continue;

    let depth = 0;
    for (let i = startIdx; i < cleaned.length; i++) {
      if (cleaned[i] === startChar) depth++;
      else if (cleaned[i] === endChar) {
        depth--;
        if (depth === 0) {
          const candidate = cleaned.slice(startIdx, i + 1);
          try {
            JSON.parse(candidate);
            return candidate;
          } catch {
            break;
          }
        }
      }
    }
  }

  // Last resort: try the whole text
  try {
    JSON.parse(cleaned);
    return cleaned;
  } catch {
    // noop
  }

  // Try adding missing closing braces/brackets
  const openBraces = (cleaned.match(/{/g) || []).length - (cleaned.match(/}/g) || []).length;
  const openBrackets = (cleaned.match(/\[/g) || []).length - (cleaned.match(/]/g) || []).length;
  if (openBraces > 0 || openBrackets > 0) {
    const fixed =
      cleaned + ']'.repeat(Math.max(0, openBrackets)) + '}'.repeat(Math.max(0, openBraces));
    try {
      JSON.parse(fixed);
      return fixed;
    } catch {
      // noop
    }
  }

  return cleaned;
}

// ─── Gradio API call ───

async function callGradioApi(
  prompt: string,
  systemPrompt: string,
  maxTokens: number,
  temperature: number,
  topP: number,
  jsonMode: boolean
): Promise<string> {
  const apiUrl = `${HF_SPACE_URL}/api/predict`;

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      data: [prompt, systemPrompt, maxTokens, temperature, topP, jsonMode],
    }),
    signal: AbortSignal.timeout(HF_REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(`HF Space returned ${response.status}: ${errorText}`);
  }

  const result = (await response.json()) as GradioResponse;

  if (!result.data || !Array.isArray(result.data) || result.data.length === 0) {
    throw new Error('Empty response from HF Space');
  }

  const text = result.data[0];
  if (typeof text !== 'string') {
    throw new Error('Invalid response format from HF Space');
  }

  return text;
}

// ─── Route plugin ───

export const mandalaGenerateRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  /**
   * POST /api/v1/mandala/generate
   * Generate a mandala learning plan via HuggingFace Space
   */
  fastify.post<{ Body: GenerateBody }>(
    '/generate',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const { prompt, systemPrompt, maxTokens, temperature, topP, jsonMode } = request.body;

      if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
        return reply.code(400).send({ error: 'prompt is required' });
      }

      const effectiveSystemPrompt =
        systemPrompt ??
        'You are a helpful assistant that generates mandala learning plans in JSON format.';
      const effectiveMaxTokens = maxTokens ?? 2048;
      const effectiveTemperature = temperature ?? 0.7;
      const effectiveTopP = topP ?? 0.9;
      const effectiveJsonMode = jsonMode ?? true;

      let lastError: Error | null = null;

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const rawOutput = await callGradioApi(
            prompt.trim(),
            effectiveSystemPrompt,
            effectiveMaxTokens,
            effectiveTemperature,
            effectiveTopP,
            effectiveJsonMode
          );

          // Try to parse as JSON if json mode is on
          let parsed: unknown = null;
          let repaired = rawOutput;

          if (effectiveJsonMode) {
            repaired = repairJson(rawOutput);
            try {
              parsed = JSON.parse(repaired);
            } catch {
              // JSON parse failed even after repair — return raw text
              request.log.warn(
                { attempt, rawLength: rawOutput.length },
                'JSON parse failed after repair'
              );
            }
          }

          return reply.send({
            success: true,
            data: parsed ?? repaired,
            raw: rawOutput,
            meta: {
              model: 'insighta-mandala-v13',
              quantization: 'Q8_0',
              jsonRepaired: repaired !== rawOutput,
              attempt: attempt + 1,
            },
          });
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
          request.log.warn(
            { err: lastError, attempt: attempt + 1 },
            'HF Space call failed, retrying...'
          );

          // Wait before retry (exponential backoff)
          if (attempt < MAX_RETRIES) {
            await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
          }
        }
      }

      request.log.error({ err: lastError }, 'All HF Space call attempts failed');
      return reply.code(502).send({
        error: 'Failed to generate mandala plan',
        detail: lastError?.message ?? 'Unknown error',
      });
    }
  );

  /**
   * GET /api/v1/mandala/status
   * Check HF Space availability
   */
  fastify.get('/status', async (_request, reply) => {
    try {
      const response = await fetch(HF_SPACE_URL, {
        method: 'GET',
        signal: AbortSignal.timeout(10_000),
      });

      return reply.send({
        status: response.ok ? 'online' : 'degraded',
        spaceUrl: HF_SPACE_URL,
        model: 'insighta-mandala-v13',
        quantization: 'Q8_0',
        httpStatus: response.status,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return reply.send({
        status: 'offline',
        spaceUrl: HF_SPACE_URL,
        model: 'insighta-mandala-v13',
        error: message,
      });
    }
  });

  done();
};
