/**
 * Unit tests for the chatbot-settings service (CP475+3).
 *
 * Covers:
 *   - First read populates the cache; second read within TTL hits cache.
 *   - DB failure returns safe all-null settings (chatbot must keep working).
 *   - Update invalidates the cache + writes new settings.
 *   - `_setCacheForTesting(null)` resets cache for ordering between tests.
 */

const mockFindUnique = jest.fn();
const mockUpsert = jest.fn();

jest.mock('@/modules/database/client', () => ({
  getPrismaClient: () => ({
    chatbot_settings: {
      findUnique: mockFindUnique,
      upsert: mockUpsert,
    },
  }),
}));

jest.mock('@/utils/logger', () => {
  type Logger = {
    info: jest.Mock;
    warn: jest.Mock;
    error: jest.Mock;
    debug: jest.Mock;
    child: () => Logger;
  };
  const childLogger: Logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: () => childLogger,
  };
  return { logger: childLogger };
});

import {
  getChatbotSettings,
  updateChatbotSettings,
  invalidateChatbotSettingsCache,
  _setCacheForTesting,
} from '@/modules/chatbot-settings/service';

const SAMPLE_ROW = {
  id: 1,
  qwen_runpod_model: 'insighta-chatbot-v2',
  openrouter_model: null,
  updated_at: new Date('2026-05-20T10:00:00Z'),
  updated_by: 'admin-uuid-1',
};

beforeEach(() => {
  jest.clearAllMocks();
  _setCacheForTesting(null);
});

describe('getChatbotSettings', () => {
  it('returns row fields mapped to camelCase on cache miss', async () => {
    mockFindUnique.mockResolvedValueOnce(SAMPLE_ROW);
    const result = await getChatbotSettings();
    expect(result.qwenRunpodModel).toBe('insighta-chatbot-v2');
    expect(result.openrouterModel).toBeNull();
    expect(result.updatedBy).toBe('admin-uuid-1');
    expect(mockFindUnique).toHaveBeenCalledWith({ where: { id: 1 } });
  });

  it('returns safe empty settings when DB row is missing', async () => {
    mockFindUnique.mockResolvedValueOnce(null);
    const result = await getChatbotSettings();
    expect(result.qwenRunpodModel).toBeNull();
    expect(result.openrouterModel).toBeNull();
  });

  it('caches the result — second call within TTL does not re-query DB', async () => {
    mockFindUnique.mockResolvedValueOnce(SAMPLE_ROW);
    await getChatbotSettings();
    await getChatbotSettings();
    expect(mockFindUnique).toHaveBeenCalledTimes(1);
  });

  it('returns safe empty settings on DB error (no throw)', async () => {
    mockFindUnique.mockRejectedValueOnce(new Error('connection refused'));
    const result = await getChatbotSettings();
    expect(result.qwenRunpodModel).toBeNull();
    expect(result.openrouterModel).toBeNull();
  });

  it('invalidateChatbotSettingsCache forces next call to hit DB', async () => {
    mockFindUnique.mockResolvedValue(SAMPLE_ROW);
    await getChatbotSettings();
    invalidateChatbotSettingsCache();
    await getChatbotSettings();
    expect(mockFindUnique).toHaveBeenCalledTimes(2);
  });
});

describe('updateChatbotSettings', () => {
  it('upserts the singleton row and returns the new settings', async () => {
    const updatedRow = {
      ...SAMPLE_ROW,
      qwen_runpod_model: 'new-model',
      updated_by: 'admin-uuid-2',
    };
    mockUpsert.mockResolvedValueOnce(updatedRow);

    const result = await updateChatbotSettings({
      qwenRunpodModel: 'new-model',
      updatedBy: 'admin-uuid-2',
    });

    expect(result.qwenRunpodModel).toBe('new-model');
    expect(result.updatedBy).toBe('admin-uuid-2');
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const callArgs = mockUpsert.mock.calls[0]![0];
    expect(callArgs.where).toEqual({ id: 1 });
    expect(callArgs.update.qwen_runpod_model).toBe('new-model');
    // openrouter_model was undefined in input — must NOT appear in update
    expect(callArgs.update.openrouter_model).toBeUndefined();
  });

  it('undefined field is omitted from update (preserve existing value)', async () => {
    mockUpsert.mockResolvedValueOnce(SAMPLE_ROW);
    await updateChatbotSettings({ updatedBy: 'admin-x' });
    const callArgs = mockUpsert.mock.calls[0]![0];
    expect(callArgs.update.qwen_runpod_model).toBeUndefined();
    expect(callArgs.update.openrouter_model).toBeUndefined();
  });

  it('null field explicitly clears the override', async () => {
    mockUpsert.mockResolvedValueOnce({ ...SAMPLE_ROW, qwen_runpod_model: null });
    await updateChatbotSettings({ qwenRunpodModel: null, updatedBy: 'admin-x' });
    const callArgs = mockUpsert.mock.calls[0]![0];
    expect(callArgs.update.qwen_runpod_model).toBeNull();
  });

  it('writes fresh cache so the next get reuses it (no extra DB query)', async () => {
    mockUpsert.mockResolvedValueOnce({
      ...SAMPLE_ROW,
      qwen_runpod_model: 'after-write',
    });
    await updateChatbotSettings({
      qwenRunpodModel: 'after-write',
      updatedBy: 'admin-x',
    });
    // Second get should NOT hit findUnique — cache was repopulated by upsert.
    const result = await getChatbotSettings();
    expect(result.qwenRunpodModel).toBe('after-write');
    expect(mockFindUnique).not.toHaveBeenCalled();
  });
});
