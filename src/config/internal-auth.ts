/**
 * Shared config for internal skill trigger endpoints.
 *
 * Both batch-video-collector and trend-collector (and future internal
 * triggers) read the same token + bot user ID. Centralized here to
 * satisfy the hardcode-audit process.env rule and avoid duplication.
 */

const DEFAULT_INTERNAL_USER_ID = '00000000-0000-0000-0000-000000000000';

export function getInternalBatchToken(): string | undefined {
  return process.env['INTERNAL_BATCH_TOKEN'];
}

export function getInternalUserId(): string {
  return process.env['INSIGHTA_BOT_USER_ID']?.trim() || DEFAULT_INTERNAL_USER_ID;
}
