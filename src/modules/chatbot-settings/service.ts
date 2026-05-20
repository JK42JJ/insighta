/**
 * Chatbot model settings — admin-overridable per-provider model names.
 *
 * Resolver order (applied in src/api/routes/copilotkit.ts):
 *   1. explicit env CHATBOT_MODEL              ← global override (legacy)
 *   2. this DB row (chatbot_settings.id=1)     ← admin UI override
 *   3. per-provider hardcoded default          ← bottom-of-stack safety
 *
 * The DB row is a singleton (id=1 CHECK). NULL fields mean "no override —
 * fall through to the next layer". So clearing an admin override = PUT
 * with the field set to null.
 *
 * Cache: module-level, 5-minute TTL. PUT calls invalidate immediately so
 * the next request sees the new value without waiting for TTL.
 *
 * CP475+3 — admin UI dynamic chatbot model control.
 */

import { getPrismaClient } from '@/modules/database/client';
import { logger } from '@/utils/logger';

const log = logger.child({ module: 'chatbot-settings/service' });

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface ChatbotSettings {
  qwenRunpodModel: string | null;
  openrouterModel: string | null;
  updatedAt: Date;
  updatedBy: string | null;
}

export interface UpdateChatbotSettingsInput {
  /** Pass `null` to clear an override, `undefined` to leave unchanged. */
  qwenRunpodModel?: string | null;
  openrouterModel?: string | null;
  /** Admin user id (for audit). */
  updatedBy: string;
}

// ---------------------------------------------------------------------------
// In-memory cache
// ---------------------------------------------------------------------------

let cachedSettings: ChatbotSettings | null = null;
let cachedAt = 0;

/** Reset cache — call when settings are updated to ensure next read is fresh. */
export function invalidateChatbotSettingsCache(): void {
  cachedSettings = null;
  cachedAt = 0;
}

/** Test-only hook to inject a known state. */
export function _setCacheForTesting(settings: ChatbotSettings | null): void {
  cachedSettings = settings;
  cachedAt = settings ? Date.now() : 0;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns the singleton settings row (`id=1`), creating it lazily if missing.
 * Cached for 5 minutes. Cache is invalidated on every successful write.
 *
 * On DB failure, returns a safe all-null settings object so the resolver can
 * still fall through to env / hardcoded defaults — chatbot must keep working
 * even if the admin-settings table is temporarily unreachable.
 */
export async function getChatbotSettings(): Promise<ChatbotSettings> {
  const now = Date.now();
  if (cachedSettings && now - cachedAt < CACHE_TTL_MS) {
    return cachedSettings;
  }

  try {
    const prisma = getPrismaClient();
    const row = await prisma.chatbot_settings.findUnique({ where: { id: 1 } });

    const settings: ChatbotSettings = row
      ? {
          qwenRunpodModel: row.qwen_runpod_model,
          openrouterModel: row.openrouter_model,
          updatedAt: row.updated_at,
          updatedBy: row.updated_by,
        }
      : {
          qwenRunpodModel: null,
          openrouterModel: null,
          updatedAt: new Date(0),
          updatedBy: null,
        };

    cachedSettings = settings;
    cachedAt = now;
    return settings;
  } catch (err) {
    log.warn('chatbot_settings load failed; returning empty', {
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      qwenRunpodModel: null,
      openrouterModel: null,
      updatedAt: new Date(0),
      updatedBy: null,
    };
  }
}

/**
 * Upserts the singleton settings row. `undefined` fields are left unchanged;
 * `null` fields explicitly clear an override. Returns the new settings.
 */
export async function updateChatbotSettings(
  input: UpdateChatbotSettingsInput
): Promise<ChatbotSettings> {
  const prisma = getPrismaClient();

  // Build update + create payloads. For Prisma, undefined fields are skipped
  // (no-op), null fields are written as DB null.
  const updateData: {
    qwen_runpod_model?: string | null;
    openrouter_model?: string | null;
    updated_at: Date;
    updated_by: string;
  } = {
    updated_at: new Date(),
    updated_by: input.updatedBy,
  };
  if (input.qwenRunpodModel !== undefined) updateData.qwen_runpod_model = input.qwenRunpodModel;
  if (input.openrouterModel !== undefined) updateData.openrouter_model = input.openrouterModel;

  const row = await prisma.chatbot_settings.upsert({
    where: { id: 1 },
    update: updateData,
    create: {
      id: 1,
      qwen_runpod_model: input.qwenRunpodModel ?? null,
      openrouter_model: input.openrouterModel ?? null,
      updated_at: updateData.updated_at,
      updated_by: input.updatedBy,
    },
  });

  invalidateChatbotSettingsCache();

  const fresh: ChatbotSettings = {
    qwenRunpodModel: row.qwen_runpod_model,
    openrouterModel: row.openrouter_model,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
  cachedSettings = fresh;
  cachedAt = Date.now();
  return fresh;
}
