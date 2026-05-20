/**
 * Unit tests for `resolveChatbotModel` (CP475+2 regression).
 *
 * Pre-fix: the route used `config.chatbot.model` directly, which had a
 * hard-coded `google/gemini-2.5-flash` default. When `CHATBOT_PROVIDER`
 * was `qwen-runpod` and `CHATBOT_MODEL` was unset (the prod default),
 * the route force-injected `google/gemini-2.5-flash` into the
 * QwenRunpodAdapter, which forwarded it to vLLM → 404.
 *
 * The resolver's contract:
 *   - explicit override always wins (matches existing /config behaviour)
 *   - explicit empty string falls back (defensive against `''` env value)
 *   - per-provider native default otherwise
 */

import { resolveChatbotModel, type ProviderDefaults } from '@/api/routes/copilotkit-model-resolver';

const DEFAULTS: ProviderDefaults = {
  openrouter: 'google/gemini-2.5-flash',
  local: 'qwen3:14b',
  qwenRunpod: 'insighta-chatbot',
};

describe('resolveChatbotModel', () => {
  describe('explicit override (CHATBOT_MODEL env set)', () => {
    it('returns explicit model verbatim for qwen-runpod', () => {
      expect(resolveChatbotModel('qwen-runpod', 'custom-model-v2', DEFAULTS)).toBe(
        'custom-model-v2'
      );
    });

    it('returns explicit model verbatim for openrouter', () => {
      expect(resolveChatbotModel('openrouter', 'anthropic/claude-3.5-sonnet', DEFAULTS)).toBe(
        'anthropic/claude-3.5-sonnet'
      );
    });

    it('returns explicit model verbatim for local', () => {
      expect(resolveChatbotModel('local', 'llama3:8b', DEFAULTS)).toBe('llama3:8b');
    });
  });

  describe('CHATBOT_MODEL unset — provider-native default (CP475+2 primary regression case)', () => {
    it('qwen-runpod → insighta-chatbot (NOT gemini-flash)', () => {
      // This is the exact case that 404'd in prod: explicit=undefined +
      // provider='qwen-runpod' previously resolved to gemini-flash.
      expect(resolveChatbotModel('qwen-runpod', undefined, DEFAULTS)).toBe('insighta-chatbot');
    });

    it('openrouter → openrouter default', () => {
      expect(resolveChatbotModel('openrouter', undefined, DEFAULTS)).toBe(
        'google/gemini-2.5-flash'
      );
    });

    it('gemini → openrouter default (same OpenAIAdapter path)', () => {
      expect(resolveChatbotModel('gemini', undefined, DEFAULTS)).toBe('google/gemini-2.5-flash');
    });

    it('local → ollama default', () => {
      expect(resolveChatbotModel('local', undefined, DEFAULTS)).toBe('qwen3:14b');
    });
  });

  describe('defensive — explicit empty string falls back to default', () => {
    // zod env config now uses `.optional()` so this should normally arrive
    // as undefined, but if a process.env CHATBOT_MODEL='' somehow leaks
    // through, the resolver must not return '' to the adapter (vLLM 400).
    it('empty string for qwen-runpod → insighta-chatbot', () => {
      expect(resolveChatbotModel('qwen-runpod', '', DEFAULTS)).toBe('insighta-chatbot');
    });
  });
});
