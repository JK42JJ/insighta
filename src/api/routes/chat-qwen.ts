/**
 * src/api/routes/chat-qwen.ts
 *
 * POST /api/v1/chat/qwen — qwen-lora serving path (CopilotKit 우회).
 *
 * Design: docs/design/insighta-chatbot-prompt-serving-design.md §5.
 * Builds the system prompt via `buildQwenSystemPrompt` (SSOT mirror of
 * convert-to-sft-v2.py), then streams a chat completion from the
 * Ollama endpoint at QWEN_LORA_API_URL.
 *
 * Auth: `fastify.authenticate` (JWT). user_id from request.user.userId.
 *
 * Request body:
 *   message: string                 — user prompt (latest turn only).
 *   videoId: string                 — required for v2 lookup (Block A-D).
 *   mandalaId?: string              — optional, drives Block E (mandala
 *                                     context) when layer >= cell.
 *   cellIndex?: number              — 1..8, sub-goal index. cell_name is
 *                                     resolved from user_mandala_levels
 *                                     root.subjects[cellIndex-1].
 *   language?: 'ko' | 'en'          — default 'ko'.
 *   layer?: ChatLayer               — explicit override; otherwise
 *                                     derived from regionContext + body.
 *   regionContext?: { activeRegion, layer, playerTimeSec, playerState,
 *                     currentSection, noteSelectionText }
 *
 * Response: text/event-stream (SSE).
 *   data: {"content":"..."}\n\n     — incremental tokens
 *   data: [DONE]\n\n                — terminal marker
 *   event: error\ndata: {...}\n\n   — upstream / config error
 *
 * Don't touch:
 *   - prompt-builder.ts SSOT (CP447 design — mirror with Python).
 *   - CopilotKit /api/v1/chat route — handled separately (claude/auto modes).
 */

import type { FastifyPluginAsync } from 'fastify';
import { getPrismaClient } from '@/modules/database/client';
import {
  buildQwenSystemPrompt,
  type ChatLayer,
  type V2Summary,
  type MandalaContext,
  type RegionContext,
  type Lang,
} from '@/modules/chatbot-rag/prompt-builder';
import { logger } from '@/utils/logger';
import { config } from '@/config/index';

const log = logger.child({ module: 'api/chat-qwen' });

interface QwenChatBody {
  message?: string;
  videoId?: string;
  mandalaId?: string;
  cellIndex?: number;
  language?: 'ko' | 'en';
  layer?: ChatLayer;
  regionContext?: {
    activeRegion?: string;
    layer?: string;
    playerTimeSec?: number | null;
    playerState?: string | null;
    currentSection?: string | null;
    noteSelectionText?: string | null;
  };
}

const VALID_LAYERS: ReadonlyArray<ChatLayer> = [
  'global',
  'mandala',
  'cell',
  'video',
  'video-time',
  'note',
];

function deriveLayer(body: QwenChatBody): ChatLayer {
  if (body.layer && VALID_LAYERS.includes(body.layer)) return body.layer;
  const r = body.regionContext;
  if (r?.layer && VALID_LAYERS.includes(r.layer as ChatLayer)) return r.layer as ChatLayer;
  if (r?.noteSelectionText) return 'note';
  if (r?.playerTimeSec != null) return 'video-time';
  if (body.cellIndex != null) return 'cell';
  if (body.videoId) return 'video';
  if (body.mandalaId) return 'mandala';
  return 'global';
}

export const chatQwenRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Body: QwenChatBody }>(
    '/chat/qwen',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      if (!request.user || !('userId' in request.user)) {
        return reply.code(401).send({ error: 'unauthorized' });
      }
      const userId = request.user.userId;
      const body = request.body ?? {};
      const { message, videoId, mandalaId, cellIndex, regionContext } = body;
      if (!message || typeof message !== 'string' || message.trim() === '') {
        return reply.code(400).send({ error: 'message required' });
      }
      if (!videoId || typeof videoId !== 'string') {
        return reply.code(400).send({ error: 'videoId required' });
      }

      const language: Lang = body.language === 'en' ? 'en' : 'ko';
      const layer = deriveLayer(body);

      const ollamaUrl = config.qwenLora.apiUrl;
      if (!ollamaUrl) {
        log.warn('QWEN_LORA_API_URL not configured');
        return reply.code(503).send({ error: 'qwen_lora_not_configured' });
      }
      const model = config.qwenLora.model;

      const prisma = getPrismaClient();

      // (1) v2 data fetch
      const [vrsRow, ytRow] = await Promise.all([
        prisma.video_rich_summaries.findUnique({
          where: { video_id: videoId },
          select: { core: true, analysis: true, segments: true },
        }),
        prisma.youtube_videos.findUnique({
          where: { youtube_video_id: videoId },
          select: { title: true },
        }),
      ]);
      const v2Data: V2Summary = {
        title: ytRow?.title ?? null,
        core: (vrsRow?.core as V2Summary['core']) ?? null,
        analysis: (vrsRow?.analysis as V2Summary['analysis']) ?? null,
        segments: (vrsRow?.segments as V2Summary['segments']) ?? null,
      };

      // (2) mandala context — only when layer wants Block E (mandala/cell)
      let mandalaContext: MandalaContext | undefined;
      if (mandalaId && (layer === 'mandala' || layer === 'cell')) {
        const mandala = await prisma.user_mandalas.findFirst({
          where: { id: mandalaId, user_id: userId },
          select: { id: true, title: true },
        });
        if (mandala) {
          const root = await prisma.user_mandala_levels.findFirst({
            where: { mandala_id: mandalaId, level_key: 'root' },
            select: { center_goal: true, center_label: true, subjects: true, subject_labels: true },
          });
          let cellName: string | null = null;
          if (cellIndex != null && cellIndex >= 1 && cellIndex <= 8 && root?.subjects) {
            const candidate = root.subjects[cellIndex - 1];
            if (typeof candidate === 'string' && candidate.length > 0) {
              cellName = candidate;
            }
          }
          mandalaContext = {
            mandala_name: mandala.title,
            center_goal: root?.center_label || root?.center_goal || mandala.title,
            cell_name: cellName,
            cell_index: cellIndex ?? null,
            relevance_rationale: v2Data.analysis?.mandala_fit?.relevance_rationale ?? null,
          };
        }
      }

      // (3) build system prompt (SSOT via prompt-builder.ts)
      const builderRegion: RegionContext | undefined = regionContext
        ? {
            active_region: regionContext.activeRegion ?? 'chat',
            layer: regionContext.layer ?? layer,
            player_time_sec: regionContext.playerTimeSec ?? null,
            player_state: regionContext.playerState ?? null,
            current_section: regionContext.currentSection ?? null,
            note_selection_text: regionContext.noteSelectionText ?? null,
          }
        : undefined;

      const systemPrompt = buildQwenSystemPrompt({
        layer,
        language,
        v2Data,
        mandalaContext,
        regionContext: builderRegion,
      });

      // (4) SSE stream from Ollama → client
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      const writeSse = (payload: Record<string, unknown>, eventName?: string) => {
        if (eventName) reply.raw.write(`event: ${eventName}\n`);
        reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
      };

      let upstreamResp: Response;
      try {
        upstreamResp = await fetch(`${ollamaUrl.replace(/\/$/, '')}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: message },
            ],
            stream: true,
          }),
        });
      } catch (err) {
        log.error('ollama fetch failed', {
          error: err instanceof Error ? err.message : String(err),
        });
        writeSse({ error: 'upstream_unreachable' }, 'error');
        reply.raw.end();
        return;
      }

      if (!upstreamResp.ok || !upstreamResp.body) {
        const errText = await upstreamResp.text().catch(() => '');
        log.error('ollama call failed', {
          status: upstreamResp.status,
          errText: errText.slice(0, 200),
        });
        writeSse({ error: 'upstream_failed', status: upstreamResp.status }, 'error');
        reply.raw.end();
        return;
      }

      // Ollama /api/chat streams NDJSON: one JSON object per line, last with done:true.
      const reader = upstreamResp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
              const obj = JSON.parse(trimmed) as {
                message?: { content?: string };
                done?: boolean;
                error?: string;
              };
              if (obj.error) {
                writeSse({ error: 'upstream_inline', detail: obj.error }, 'error');
                continue;
              }
              const content = obj.message?.content ?? '';
              if (content) writeSse({ content });
            } catch {
              // skip malformed line; Ollama occasionally emits keepalive whitespace
            }
          }
        }
        if (buffer.trim()) {
          try {
            const obj = JSON.parse(buffer) as { message?: { content?: string } };
            const content = obj.message?.content ?? '';
            if (content) writeSse({ content });
          } catch {
            // ignore tail noise
          }
        }
        reply.raw.write('data: [DONE]\n\n');
      } catch (err) {
        log.error('chat-qwen stream error', {
          error: err instanceof Error ? err.message : String(err),
        });
        try {
          writeSse({ error: 'stream_failed' }, 'error');
        } catch {
          /* socket already closed */
        }
      } finally {
        try {
          reply.raw.end();
        } catch {
          /* already ended */
        }
      }
    }
  );
};
