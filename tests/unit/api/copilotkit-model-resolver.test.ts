/**
 * Unit tests for `resolveChatbotModel`.
 *
 * Pre-fix (CP475+2): the route used `config.chatbot.model` directly, which had
 * a hard-coded `google/gemini-2.5-flash` default. When `CHATBOT_PROVIDER`
 * was `qwen-runpod` and `CHATBOT_MODEL` was unset (the prod default),
 * the route force-injected `google/gemini-2.5-flash` into the
 * QwenRunpodAdapter, which forwarded it to vLLM → 404.
 *
 * CP475+3: extended with admin DB overrides (per-provider). Priority:
 *   explicit env CHATBOT_MODEL > admin DB override > hardcoded default.
 */

import {
  resolveChatbotModel,
  type ProviderDefaults,
  type AdminOverrides,
} from '@/api/routes/copilotkit-model-resolver';

const DEFAULTS: ProviderDefaults = {
  openrouter: 'google/gemini-2.5-flash',
  local: 'qwen3:14b',
  qwenRunpod: 'insighta-chatbot',
};

const NO_OVERRIDES: AdminOverrides = {
  qwenRunpodModel: null,
  openrouterModel: null,
};

describe('resolveChatbotModel', () => {
  describe('explicit env (CHATBOT_MODEL) wins over everything', () => {
    it('beats admin override + default for qwen-runpod', () => {
      expect(
        resolveChatbotModel('qwen-runpod', 'env-explicit', DEFAULTS, {
          qwenRunpodModel: 'admin-override',
          openrouterModel: null,
        })
      ).toBe('env-explicit');
    });

    it('beats admin override + default for openrouter', () => {
      expect(
        resolveChatbotModel('openrouter', 'anthropic/claude-3.5-sonnet', DEFAULTS, {
          qwenRunpodModel: null,
          openrouterModel: 'admin-override',
        })
      ).toBe('anthropic/claude-3.5-sonnet');
    });

    it('returns explicit verbatim for local', () => {
      expect(resolveChatbotModel('local', 'llama3:8b', DEFAULTS)).toBe('llama3:8b');
    });
  });

  describe('CP475+2 primary regression — env unset, no admin override', () => {
    it('qwen-runpod → insighta-chatbot (NOT gemini-flash)', () => {
      expect(resolveChatbotModel('qwen-runpod', undefined, DEFAULTS, NO_OVERRIDES)).toBe(
        'insighta-chatbot'
      );
    });

    it('openrouter → openrouter default', () => {
      expect(resolveChatbotModel('openrouter', undefined, DEFAULTS, NO_OVERRIDES)).toBe(
        'google/gemini-2.5-flash'
      );
    });

    it('gemini → openrouter default (same OpenAIAdapter path)', () => {
      expect(resolveChatbotModel('gemini', undefined, DEFAULTS, NO_OVERRIDES)).toBe(
        'google/gemini-2.5-flash'
      );
    });

    it('local → ollama default', () => {
      expect(resolveChatbotModel('local', undefined, DEFAULTS, NO_OVERRIDES)).toBe('qwen3:14b');
    });
  });

  describe('CP475+3 — admin DB override applied when env unset', () => {
    it('qwen-runpod admin override beats hardcoded default', () => {
      expect(
        resolveChatbotModel('qwen-runpod', undefined, DEFAULTS, {
          qwenRunpodModel: 'insighta-chatbot-v2',
          openrouterModel: null,
        })
      ).toBe('insighta-chatbot-v2');
    });

    it('openrouter admin override beats hardcoded default', () => {
      expect(
        resolveChatbotModel('openrouter', undefined, DEFAULTS, {
          qwenRunpodModel: null,
          openrouterModel: 'anthropic/claude-3.5-sonnet',
        })
      ).toBe('anthropic/claude-3.5-sonnet');
    });

    it('gemini provider reuses openrouter admin override slot', () => {
      // Both gemini and openrouter go through OpenAIAdapter against the same
      // base URL, so they share a single admin override.
      expect(
        resolveChatbotModel('gemini', undefined, DEFAULTS, {
          qwenRunpodModel: null,
          openrouterModel: 'openai/gpt-4o-mini',
        })
      ).toBe('openai/gpt-4o-mini');
    });

    it('null admin override falls through to default', () => {
      expect(
        resolveChatbotModel('qwen-runpod', undefined, DEFAULTS, {
          qwenRunpodModel: null,
          openrouterModel: 'admin-other',
        })
      ).toBe('insighta-chatbot');
    });

    it('empty-string admin override falls through to default', () => {
      expect(
        resolveChatbotModel('qwen-runpod', undefined, DEFAULTS, {
          qwenRunpodModel: '',
          openrouterModel: null,
        })
      ).toBe('insighta-chatbot');
    });
  });

  describe('overrides arg omitted (CP475+2 callers, backward-compat)', () => {
    it('qwen-runpod still resolves correctly', () => {
      expect(resolveChatbotModel('qwen-runpod', undefined, DEFAULTS)).toBe('insighta-chatbot');
    });

    it('openrouter still resolves correctly', () => {
      expect(resolveChatbotModel('openrouter', undefined, DEFAULTS)).toBe(
        'google/gemini-2.5-flash'
      );
    });
  });

  describe('defensive — explicit empty string env falls back', () => {
    it('empty string for qwen-runpod → insighta-chatbot', () => {
      expect(resolveChatbotModel('qwen-runpod', '', DEFAULTS, NO_OVERRIDES)).toBe(
        'insighta-chatbot'
      );
    });
  });
});
