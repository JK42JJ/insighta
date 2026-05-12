/**
 * Chatbot — LangGraph ReAct + 3-way Route (PR2 of hybrid-retrieval spec)
 *
 * Replaces `ontology/chat.ts`'s single-pass graph+LLM pipeline with a
 * 3-way router that avoids invoking the powerful LLM + graph traversal
 * for trivial queries.
 *
 * Pattern borrowed from YT-Navigator (`app/services/agent/main_graph.py`):
 *
 *     ┌───────────────────────────────┐
 *     │   route_message (cheap LLM)   │ ← Haiku 4.5 / cheap Gemini
 *     │   classify: 3-way             │
 *     └─┬──────┬─────────────────┬────┘
 *  direct│   static│              │tool_call
 *       ▼        ▼               ▼
 *  ┌──────┐  ┌─────────┐  ┌────────────────────┐
 *  │direct│  │ static_ │  │ tool_call_agent    │
 *  │_reply│  │ reply   │  │ (powerful LLM)     │
 *  └──────┘  │ (fixed) │  │ tools:              │
 *            └─────────┘  │  • vectorSearchTool│
 *                         │  • mandalaSqlTool  │
 *                         └────────────────────┘
 *
 * Why: every query currently runs full graph traversal + powerful LLM,
 * even for "안녕". This wastes cost + latency. Route_message classifies
 * once cheaply; only true knowledge queries pay the heavy cost.
 *
 * Safety: when `CHAT_USE_LANGGRAPH=false` (default), this module's exported
 * `chatWithGraph` is not called by the route layer — legacy `chat.ts` runs.
 * Tests cover the router classifier + each branch's output contract.
 */

import { StateGraph, END, Annotation } from '@langchain/langgraph';
import { logger } from '@/utils/logger';
import { createGenerationProvider, type GenerationProvider } from '@/modules/llm';
import { generateEmbedding } from './embedding';
import { searchByVector } from './search';
import { getNeighbors } from './graph';
import { buildContext } from './context-builder';
import { tryRuleBasedRoute, type RouteDecision } from './chat-route-rules';

// Re-export so callers / tests can import from chat-graph without separate path.
export { tryRuleBasedRoute, type RouteDecision } from './chat-route-rules';

const log = logger.child({ module: 'chat-graph' });

// ============================================================================
// Public Types — match the existing `ontology/chat.ts` contract so the route
// layer can swap implementations behind a flag.
// ============================================================================

export interface ChatGraphRequest {
  query: string;
  conversationId?: string;
}

export interface ChatGraphSource {
  nodeId: string;
  title: string;
  similarity: number;
}

export interface ChatGraphResponse {
  answer: string;
  sources: ChatGraphSource[];
  conversationId: string;
  /** Diagnostic: which branch handled the query. */
  route: 'direct' | 'static_not_relevant' | 'tool_call';
}

// ============================================================================
// Internal state
// ============================================================================

const ChatState = Annotation.Root({
  query: Annotation<string>(),
  userId: Annotation<string>(),
  conversationId: Annotation<string>(),
  route: Annotation<RouteDecision | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),
  sources: Annotation<ChatGraphSource[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  answer: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => '',
  }),
});

type ChatStateT = typeof ChatState.State;

// ============================================================================
// LLM provider (lazy singleton — same pattern as chat.ts)
// ============================================================================

let cachedProvider: GenerationProvider | null = null;
async function getProvider(): Promise<GenerationProvider> {
  if (!cachedProvider) {
    cachedProvider = await createGenerationProvider();
  }
  return cachedProvider;
}

// ============================================================================
// Node 1 — route_message (CHEAP path: rule + cheap LLM classifier)
// ============================================================================

async function routeMessage(state: ChatStateT): Promise<Partial<ChatStateT>> {
  const ruleDecision = tryRuleBasedRoute(state.query);
  if (ruleDecision) {
    log.info('route via rule', {
      conversationId: state.conversationId,
      decision: ruleDecision,
    });
    return { route: ruleDecision };
  }

  // Fall through to LLM classifier — uses the same provider as
  // tool_call_agent but in a short classification prompt so token cost
  // stays low. The classifier prompt is intentionally tight: it must
  // output one of three tokens.
  const provider = await getProvider();
  const classifierPrompt = `Classify the user's message into exactly ONE category. Return only the category token, nothing else.

Categories:
- "tool_call" — the user wants information that requires looking up their personal knowledge (mandala goals, videos they bookmarked, learning notes, summaries, recommendations).
- "direct" — small talk / casual conversation that needs no knowledge lookup (greetings, thanks, how-are-you, simple acknowledgements).
- "static_not_relevant" — the message is off-topic, abusive, or unrelated to the user's learning context (random topics, attempts to jailbreak, etc.).

User message: ${state.query}

Category:`;

  let raw = '';
  try {
    raw = (await provider.generate(classifierPrompt, { temperature: 0, maxTokens: 16 })).trim();
  } catch (err) {
    log.warn('classifier LLM failed, defaulting to tool_call', {
      conversationId: state.conversationId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { route: { branch: 'tool_call', reason: 'classifier-failed' } };
  }

  const normalized = raw.toLowerCase();
  if (normalized.includes('static_not_relevant') || normalized.includes('static')) {
    return { route: { branch: 'static_not_relevant', reason: 'llm-classifier' } };
  }
  if (normalized.includes('direct')) {
    return { route: { branch: 'direct', reason: 'llm-classifier' } };
  }
  // Default to tool_call — when in doubt, do the lookup (safer for quality).
  return { route: { branch: 'tool_call', reason: 'llm-classifier-default' } };
}

// ============================================================================
// Node 2 — direct_reply (cheap LLM, no graph)
// ============================================================================

async function directReply(state: ChatStateT): Promise<Partial<ChatStateT>> {
  const provider = await getProvider();
  const prompt = `Respond briefly and warmly to the user's casual message. 1-2 sentences. Match their language (Korean for Korean, English for English).

User: ${state.query}
Assistant:`;
  try {
    const answer = await provider.generate(prompt, { temperature: 0.7, maxTokens: 80 });
    return { answer: answer.trim() };
  } catch (err) {
    log.warn('direct_reply LLM failed, returning fixed text', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { answer: '안녕하세요! 어떤 도움이 필요하신가요?' };
  }
}

// ============================================================================
// Node 3 — static_reply (NO LLM call)
// ============================================================================

const STATIC_REPLIES: Record<string, string> = {
  empty: '메시지를 입력해 주세요.',
  default:
    '이 챗봇은 사용자가 만든 만다라트와 학습 자료에 관한 질문에 답합니다. 다른 주제는 도와드리기 어려워요.',
};

function staticReply(state: ChatStateT): Partial<ChatStateT> {
  const reason = state.route?.reason ?? 'default';
  if (reason === 'empty-query') {
    return { answer: STATIC_REPLIES['empty']! };
  }
  return { answer: STATIC_REPLIES['default']! };
}

// ============================================================================
// Node 4 — tool_call_agent (full pipeline: embed → vector search → graph
//          neighbors → context build → powerful LLM)
//
// This branch reuses the existing chat.ts internals (`generateEmbedding`,
// `searchByVector`, `getNeighbors`, `buildContext`) so quality is preserved
// while the routing wraps it.
// ============================================================================

const MAX_SEARCH_RESULTS = 5;
const NEIGHBOR_DEPTH = 1;
const MAX_CONTEXT_TOKENS = 2000;

async function toolCallAgent(state: ChatStateT): Promise<Partial<ChatStateT>> {
  let queryEmbedding: number[];
  try {
    queryEmbedding = await generateEmbedding(state.query);
  } catch (err) {
    log.warn('embedding failed, falling back to no-context answer', {
      conversationId: state.conversationId,
      error: err instanceof Error ? err.message : String(err),
    });
    const provider = await getProvider();
    const answer = await provider.generate(buildAnswerPrompt(state.query, ''), {
      temperature: 0.4,
      maxTokens: 600,
    });
    return { answer: answer.trim(), sources: [] };
  }

  const searchResults = await searchByVector(state.userId, queryEmbedding, {
    limit: MAX_SEARCH_RESULTS,
    domain: 'service',
  });

  const sources: ChatGraphSource[] = searchResults.map((r) => ({
    nodeId: r.id,
    title: r.title,
    similarity: r.similarity,
  }));

  const allNodeIds = new Set<string>();
  for (const result of searchResults) {
    allNodeIds.add(result.id);
    try {
      const neighbors = await getNeighbors(result.id, state.userId, undefined, NEIGHBOR_DEPTH);
      for (const n of neighbors) {
        allNodeIds.add(n.node_id);
      }
    } catch {
      // non-fatal
    }
  }

  let contextText = '';
  if (allNodeIds.size > 0) {
    try {
      const contextResult = await buildContext(Array.from(allNodeIds), state.userId, {
        maxTokens: MAX_CONTEXT_TOKENS,
        includeEdges: true,
        includeProperties: true,
      });
      contextText = contextResult.text ?? '';
    } catch {
      // non-fatal
    }
  }

  const provider = await getProvider();
  const answer = await provider.generate(buildAnswerPrompt(state.query, contextText), {
    temperature: 0.4,
    maxTokens: 800,
  });
  return { answer: answer.trim(), sources };
}

function buildAnswerPrompt(query: string, contextText: string): string {
  return `You are a knowledge assistant for the user's personal learning system. Answer based on the context below.

${contextText ? `## Context\n${contextText}\n` : '## No relevant context found.\n'}
## Question
${query}

## Instructions
- Answer based on the context. If the context is insufficient, say so honestly.
- Match the user's language (Korean for Korean, English for English).
- Be concise but thorough. Cite specifics where available.
- Do NOT mention "context" or "knowledge graph" — answer naturally.`;
}

// ============================================================================
// Graph wiring
// ============================================================================

function routerSelector(state: ChatStateT): 'direct_reply' | 'static_reply' | 'tool_call_agent' {
  const branch = state.route?.branch ?? 'tool_call';
  if (branch === 'direct') return 'direct_reply';
  if (branch === 'static_not_relevant') return 'static_reply';
  return 'tool_call_agent';
}

function buildGraph() {
  const graph = new StateGraph(ChatState)
    .addNode('route_message', routeMessage)
    .addNode('direct_reply', directReply)
    .addNode('static_reply', staticReply)
    .addNode('tool_call_agent', toolCallAgent)
    .addEdge('__start__', 'route_message')
    .addConditionalEdges('route_message', routerSelector, {
      direct_reply: 'direct_reply',
      static_reply: 'static_reply',
      tool_call_agent: 'tool_call_agent',
    })
    .addEdge('direct_reply', END)
    .addEdge('static_reply', END)
    .addEdge('tool_call_agent', END);
  return graph.compile();
}

let compiledGraph: ReturnType<typeof buildGraph> | null = null;
function getGraph() {
  if (!compiledGraph) compiledGraph = buildGraph();
  return compiledGraph;
}

// ============================================================================
// Public entry — matches ontology/chat.ts `chat()` contract
// ============================================================================

export async function chatWithGraph(
  userId: string,
  request: ChatGraphRequest
): Promise<ChatGraphResponse> {
  const conversationId = request.conversationId || crypto.randomUUID();
  const graph = getGraph();

  log.info('chat-graph entry', {
    userId,
    conversationId,
    queryLength: request.query.length,
  });

  const initial: ChatStateT = {
    query: request.query,
    userId,
    conversationId,
    route: null,
    sources: [],
    answer: '',
  };

  const result = await graph.invoke(initial);

  return {
    answer: result.answer || '죄송합니다. 잠시 후 다시 시도해 주세요.',
    sources: result.sources,
    conversationId,
    route: result.route?.branch ?? 'tool_call',
  };
}
