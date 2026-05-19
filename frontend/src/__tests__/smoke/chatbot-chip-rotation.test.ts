// Regression tests for CP474 chatbot chip rotation fix.
//
// Before the fix `buildSuggestions` always returned the same 3 chips
// (key_points[0] / core_argument / actionables[0]) regardless of which chips
// the user had already clicked — so once a chip was used, the next render
// surfaced the identical chip again. Now the pool spans every key_point and
// actionable plus the 3 generic defaults, and `excludeMessages` filters out
// chips whose `message` is already in the user's chat history.

import { describe, it, expect } from 'vitest';
import { buildSuggestions } from '../../pages/learning/ui/ChatAssistant';

const t = (key: string) => key;

const structured = {
  key_points: ['point A', 'point B', 'point C'],
  core_argument: 'core argument X',
  actionables: ['action one', 'action two'],
};

describe('buildSuggestions — chip rotation (CP474)', () => {
  it('returns 3 chips from an empty exclude set', () => {
    const chips = buildSuggestions(t, structured, new Set());
    expect(chips).toHaveLength(3);
  });

  it('drops a chip whose message was already sent by the user', () => {
    const firstPass = buildSuggestions(t, structured, new Set());
    const usedMessage = firstPass[0].message;

    const secondPass = buildSuggestions(t, structured, new Set([usedMessage]));

    expect(secondPass.map((s) => s.message)).not.toContain(usedMessage);
    expect(secondPass).toHaveLength(3);
  });

  it('expands the contextual pool across all key_points and actionables', () => {
    // 3 key_points + 1 core_argument + 2 actionables = 6 contextual + 3 default
    // fallback. After excluding the first 6 contextual messages, the 3
    // generic defaults remain.
    const allContextualMessages = new Set<string>([
      ...structured.key_points.map((p) => `${p}을 실제로 적용하면 어떻게 해야 하나요?`),
      `"${structured.core_argument}"에서 가장 중요한 핵심은 무엇인가요?`,
      ...structured.actionables.map((a) => `${a}의 한계나 주의할 점은 무엇인가요?`),
    ]);

    const chips = buildSuggestions(t, structured, allContextualMessages);

    expect(chips).toHaveLength(3);
    chips.forEach((c) => {
      expect(allContextualMessages.has(c.message)).toBe(false);
      // Defaults use the i18n keys directly through the stub `t`.
      expect(c.message.startsWith('learning.suggest')).toBe(true);
    });
  });

  it('returns fewer than 3 chips when the pool is fully exhausted', () => {
    const allMessages = new Set<string>([
      ...structured.key_points.map((p) => `${p}을 실제로 적용하면 어떻게 해야 하나요?`),
      `"${structured.core_argument}"에서 가장 중요한 핵심은 무엇인가요?`,
      ...structured.actionables.map((a) => `${a}의 한계나 주의할 점은 무엇인가요?`),
      'learning.suggestSummarizeMsg',
      'learning.suggestRelatedMsg',
      'learning.suggestQuizMsg',
    ]);

    const chips = buildSuggestions(t, structured, allMessages);

    expect(chips).toHaveLength(0);
  });

  it('falls back to defaults (filtered) when structured is null', () => {
    const chips = buildSuggestions(t, null, new Set(['learning.suggestSummarizeMsg']));
    expect(chips).toHaveLength(2);
    expect(chips.map((s) => s.message)).not.toContain('learning.suggestSummarizeMsg');
  });
});
