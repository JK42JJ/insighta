import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { config } from '@/config/index';
import { createSuccessResponse } from '../../schemas/common.schema';
import { getChatbotSettings, updateChatbotSettings } from '@/modules/chatbot-settings/service';
import { resolveChatbotModel, type ProviderDefaults } from '../copilotkit-model-resolver';

const OPENROUTER_DEFAULT_MODEL = 'google/gemini-2.5-flash';

function buildProviderDefaults(): ProviderDefaults {
  return {
    openrouter: OPENROUTER_DEFAULT_MODEL,
    local: config.ollama.generateModel,
    qwenRunpod: config.qwenLora.model,
  };
}

// Empty string in PUT body is treated as "clear override" (null).
const trimmedModel = z
  .string()
  .max(200)
  .transform((s) => s.trim())
  .nullable();

const updateModelsBodySchema = z.object({
  qwenRunpodModel: trimmedModel.optional(),
  openrouterModel: trimmedModel.optional(),
});

interface AuthenticatedUser {
  sub?: string;
  user_id?: string;
}

function getUserId(request: FastifyRequest): string {
  const user = (request as FastifyRequest & { user?: AuthenticatedUser }).user;
  return user?.sub ?? user?.user_id ?? '';
}

export async function adminChatbotRoutes(fastify: FastifyInstance) {
  const adminAuth = { onRequest: [fastify.authenticate, fastify.authenticateAdmin] };

  // Read-only summary kept for backward compat (existing FE admin health page).
  // CP475+3: also surface the per-provider override values so the admin UI
  // can render them without an extra fetch.
  fastify.get('/', adminAuth, async (_request, reply) => {
    const provider = config.chatbot.provider;
    const settings = await getChatbotSettings();
    const defaults = buildProviderDefaults();
    const liveModel = resolveChatbotModel(provider, config.chatbot.model, defaults, {
      qwenRunpodModel: settings.qwenRunpodModel,
      openrouterModel: settings.openrouterModel,
    });

    return reply.send(
      createSuccessResponse({
        provider,
        model: liveModel,
        localUrl: config.chatbot.localUrl,
        availableProviders: ['gemini', 'openrouter', 'local', 'qwen-runpod'],
        hasGeminiKey: !!config.gemini.apiKey,
        hasOpenRouterKey: !!config.openrouter.apiKey,
        // CP475+3 — admin-editable model overrides.
        overrides: {
          qwenRunpodModel: settings.qwenRunpodModel,
          openrouterModel: settings.openrouterModel,
        },
        defaults: {
          qwenRunpod: defaults.qwenRunpod,
          openrouter: defaults.openrouter,
          local: defaults.local,
        },
        envExplicit: config.chatbot.model ?? null,
        updatedAt: settings.updatedAt.toISOString(),
        updatedBy: settings.updatedBy,
      })
    );
  });

  // CP475+3 — dedicated admin endpoint for per-provider model overrides.
  // Reuses the singleton settings row. Empty string is normalised to null.
  fastify.get('/models', adminAuth, async (_request, reply) => {
    const settings = await getChatbotSettings();
    return reply.send(
      createSuccessResponse({
        qwenRunpodModel: settings.qwenRunpodModel,
        openrouterModel: settings.openrouterModel,
        updatedAt: settings.updatedAt.toISOString(),
        updatedBy: settings.updatedBy,
        defaults: buildProviderDefaults(),
        envExplicit: config.chatbot.model ?? null,
      })
    );
  });

  fastify.put('/models', adminAuth, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = updateModelsBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        status: 400,
        code: 'INVALID_BODY',
        message: parsed.error.message,
      });
    }

    const userId = getUserId(request);
    if (!userId) {
      return reply.status(401).send({
        status: 401,
        code: 'NO_USER',
        message: 'authenticated user id missing from token',
      });
    }

    // Normalise: empty string → null (clear override). Leaves undefined
    // fields unchanged (Prisma update no-op).
    const qwenRunpodModel =
      parsed.data.qwenRunpodModel === undefined
        ? undefined
        : parsed.data.qwenRunpodModel === null || parsed.data.qwenRunpodModel.length === 0
          ? null
          : parsed.data.qwenRunpodModel;
    const openrouterModel =
      parsed.data.openrouterModel === undefined
        ? undefined
        : parsed.data.openrouterModel === null || parsed.data.openrouterModel.length === 0
          ? null
          : parsed.data.openrouterModel;

    const updated = await updateChatbotSettings({
      qwenRunpodModel,
      openrouterModel,
      updatedBy: userId,
    });

    return reply.send(
      createSuccessResponse({
        qwenRunpodModel: updated.qwenRunpodModel,
        openrouterModel: updated.openrouterModel,
        updatedAt: updated.updatedAt.toISOString(),
        updatedBy: updated.updatedBy,
      })
    );
  });
}
