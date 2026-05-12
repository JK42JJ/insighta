/**
 * Unit tests for chat-graph.ts router rules.
 *
 * Focused on the rule-based pre-classifier `tryRuleBasedRoute`. The LLM
 * classifier and graph integration are exercised end-to-end via prod smoke
 * after CHAT_USE_LANGGRAPH=true rollout (separate verification).
 */

import { tryRuleBasedRoute } from '@/modules/ontology/chat-route-rules';

describe('tryRuleBasedRoute', () => {
  describe('empty / too-short → static_not_relevant', () => {
    it('empty string', () => {
      const out = tryRuleBasedRoute('');
      expect(out?.branch).toBe('static_not_relevant');
      expect(out?.reason).toBe('empty-query');
    });

    it('whitespace only', () => {
      expect(tryRuleBasedRoute('   ')?.branch).toBe('static_not_relevant');
    });

    it('1 char', () => {
      expect(tryRuleBasedRoute('a')?.reason).toBe('too-short');
    });

    it('2 chars', () => {
      expect(tryRuleBasedRoute('ab')?.reason).toBe('too-short');
    });
  });

  describe('greetings → direct', () => {
    it('Korean 안녕', () => {
      expect(tryRuleBasedRoute('안녕하세요')?.branch).toBe('direct');
    });

    it('English hi', () => {
      expect(tryRuleBasedRoute('hi there')?.branch).toBe('direct');
    });

    it('English Hello (capitalised)', () => {
      expect(tryRuleBasedRoute('Hello')?.branch).toBe('direct');
    });

    it('반가워', () => {
      expect(tryRuleBasedRoute('반가워요')?.branch).toBe('direct');
    });
  });

  describe('off-topic → static_not_relevant', () => {
    it('주식 query', () => {
      expect(tryRuleBasedRoute('주식 어떻게 사요?')?.branch).toBe('static_not_relevant');
    });

    it('비트코인 query', () => {
      expect(tryRuleBasedRoute('비트코인 가격 알려줘')?.branch).toBe('static_not_relevant');
    });
  });

  describe('legitimate knowledge queries → null (defer to LLM classifier)', () => {
    it('"내 만다라에서 영어 학습 영상 추천해줘" passes through', () => {
      expect(tryRuleBasedRoute('내 만다라에서 영어 학습 영상 추천해줘')).toBeNull();
    });

    it('"What videos did I bookmark last week?" passes through', () => {
      expect(tryRuleBasedRoute('What videos did I bookmark last week?')).toBeNull();
    });

    it('multi-word knowledge query', () => {
      expect(tryRuleBasedRoute('투자 공부 어떻게 시작하지')).toBeNull();
    });
  });
});
