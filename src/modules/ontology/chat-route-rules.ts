/**
 * Pure rule-based pre-classifier for chat-graph.ts router.
 *
 * Kept in a separate file (no `@langchain/langgraph` import) so unit tests
 * can run without pulling in the langgraph CJS build chain.
 */

export interface RouteDecision {
  branch: 'direct' | 'static_not_relevant' | 'tool_call';
  reason: string;
}

/**
 * Catches obvious cases without an LLM call. Returns null when the LLM
 * classifier should take over.
 */
export function tryRuleBasedRoute(query: string): RouteDecision | null {
  const trimmed = query.trim();
  if (!trimmed) {
    return { branch: 'static_not_relevant', reason: 'empty-query' };
  }

  const normalized = trimmed.toLowerCase();

  // Greetings — direct reply, no graph lookup.
  const greetingPatterns = ['안녕', '하이', 'hi', 'hello', '반가워', '반갑'];
  for (const g of greetingPatterns) {
    if (normalized.startsWith(g)) {
      return { branch: 'direct', reason: 'greeting' };
    }
  }

  // Off-topic / abuse — static reply.
  const offTopicPatterns = ['주식', '비트코인', '욕', '바보', '멍청이'];
  for (const o of offTopicPatterns) {
    if (normalized.includes(o)) {
      return { branch: 'static_not_relevant', reason: 'off-topic' };
    }
  }

  // Very short queries (1-2 chars) are almost never knowledge questions.
  if (trimmed.length <= 2) {
    return { branch: 'static_not_relevant', reason: 'too-short' };
  }

  return null;
}
