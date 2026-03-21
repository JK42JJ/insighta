/**
 * GraphRAG Chat Service — vector search + graph traversal + LLM answering
 *
 * Pipeline: query → embed → searchByVector → getNeighbors → ContextBuilder → LLM → response
 * Issue: #253 (MA-2: GraphDB Service Layer)
 */

import { generateEmbedding } from './embedding';
import { searchByVector } from './search';
import { getNeighbors } from './graph';
import { buildContext } from './context-builder';
import { createGenerationProvider } from '../llm';
import type { GenerationProvider } from '../llm';
import { logger } from '../../utils/logger';

// ============================================================================
// Types
// ============================================================================

export interface ChatRequest {
  query: string;
  conversationId?: string;
}

export interface ChatSource {
  nodeId: string;
  title: string;
  similarity: number;
}

export interface ChatResponse {
  answer: string;
  sources: ChatSource[];
  conversationId: string;
}

interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

// ============================================================================
// Constants
// ============================================================================

const MAX_SEARCH_RESULTS = 5;
const NEIGHBOR_DEPTH = 1;
const MAX_CONVERSATION_TURNS = 5;
const MAX_CONTEXT_TOKENS = 2000;
const CONVERSATION_TTL_MS = 30 * 60 * 1000; // 30 minutes

// ============================================================================
// In-memory conversation store (MVP — no DB persistence)
// ============================================================================

interface ConversationEntry {
  turns: ConversationTurn[];
  lastAccess: number;
}

const conversations = new Map<string, ConversationEntry>();

function getConversation(id: string): ConversationTurn[] {
  const entry = conversations.get(id);
  if (!entry) return [];
  if (Date.now() - entry.lastAccess > CONVERSATION_TTL_MS) {
    conversations.delete(id);
    return [];
  }
  entry.lastAccess = Date.now();
  return entry.turns;
}

function addTurn(id: string, role: 'user' | 'assistant', content: string): void {
  let entry = conversations.get(id);
  if (!entry) {
    entry = { turns: [], lastAccess: Date.now() };
    conversations.set(id, entry);
  }
  entry.turns.push({ role, content });
  // Keep only last N turns
  if (entry.turns.length > MAX_CONVERSATION_TURNS * 2) {
    entry.turns = entry.turns.slice(-MAX_CONVERSATION_TURNS * 2);
  }
  entry.lastAccess = Date.now();
}

/** Periodic cleanup of expired conversations */
function cleanupExpired(): void {
  const now = Date.now();
  for (const [id, entry] of conversations) {
    if (now - entry.lastAccess > CONVERSATION_TTL_MS) {
      conversations.delete(id);
    }
  }
}

// Run cleanup every 10 minutes
setInterval(cleanupExpired, 10 * 60 * 1000).unref();

// ============================================================================
// Chat Pipeline
// ============================================================================

let generationProvider: GenerationProvider | null = null;

async function getProvider(): Promise<GenerationProvider> {
  if (!generationProvider) {
    generationProvider = await createGenerationProvider();
  }
  return generationProvider;
}

function buildChatPrompt(
  query: string,
  graphContext: string,
  history: ConversationTurn[],
): string {
  const historyBlock =
    history.length > 0
      ? history.map((t) => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.content}`).join('\n')
      : '';

  return `You are a knowledge assistant. Answer the user's question based on their personal knowledge graph.

${graphContext ? `## Knowledge Graph Context\n${graphContext}\n` : '## No relevant knowledge found in the graph.\n'}
${historyBlock ? `## Conversation History\n${historyBlock}\n` : ''}
## Current Question
${query}

## Instructions
- Answer based on the knowledge graph context above. If the context contains relevant information, synthesize it into a clear answer.
- If the context is insufficient, say so honestly rather than making up information.
- Respond in the same language as the question (Korean for Korean, English for English).
- Be concise but thorough. Include specific details from the knowledge graph when relevant.
- Do NOT mention "knowledge graph" or "context" explicitly — answer naturally as if you know this information.`;
}

export async function chat(
  userId: string,
  request: ChatRequest,
): Promise<ChatResponse> {
  const { query } = request;
  const conversationId = request.conversationId || crypto.randomUUID();

  logger.info('Chat query', { userId, conversationId, queryLength: query.length });

  // 1. Embed the query
  let queryEmbedding: number[];
  try {
    queryEmbedding = await generateEmbedding(query);
  } catch (err) {
    logger.warn('Embedding failed, returning no-context answer', {
      error: err instanceof Error ? err.message : String(err),
    });
    // Fallback: answer without graph context
    const provider = await getProvider();
    const history = getConversation(conversationId);
    const prompt = buildChatPrompt(query, '', history);
    const answer = await provider.generate(prompt);
    addTurn(conversationId, 'user', query);
    addTurn(conversationId, 'assistant', answer);
    return { answer, sources: [], conversationId };
  }

  // 2. Vector search — top N similar nodes
  const searchResults = await searchByVector(userId, queryEmbedding, {
    limit: MAX_SEARCH_RESULTS,
    domain: 'service',
  });

  const sources: ChatSource[] = searchResults.map((r) => ({
    nodeId: r.id,
    title: r.title,
    similarity: r.similarity,
  }));

  logger.info('Search results', {
    conversationId,
    found: searchResults.length,
    topSimilarity: searchResults[0]?.similarity,
  });

  // 3. Expand context via graph neighbors
  const allNodeIds = new Set<string>();
  for (const result of searchResults) {
    allNodeIds.add(result.id);
    try {
      const neighbors = await getNeighbors(result.id, userId, undefined, NEIGHBOR_DEPTH);
      for (const n of neighbors) {
        allNodeIds.add(n.node_id);
      }
    } catch {
      // Non-fatal: just use the search result without neighbors
    }
  }

  // 4. Build context text
  let contextText = '';
  if (allNodeIds.size > 0) {
    try {
      const contextResult = await buildContext(
        Array.from(allNodeIds),
        userId,
        { maxTokens: MAX_CONTEXT_TOKENS, includeEdges: true, includeProperties: true },
      );
      contextText = contextResult.text;
      logger.info('Context built', {
        conversationId,
        nodes: contextResult.nodeCount,
        edges: contextResult.edgeCount,
        tokens: contextResult.estimatedTokens,
        truncated: contextResult.truncated,
      });
    } catch (err) {
      logger.warn('Context build failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 5. Generate answer via LLM
  const provider = await getProvider();
  const history = getConversation(conversationId);
  const prompt = buildChatPrompt(query, contextText, history);

  const answer = await provider.generate(prompt, { temperature: 0.7 });

  // 6. Store conversation turn
  addTurn(conversationId, 'user', query);
  addTurn(conversationId, 'assistant', answer);

  logger.info('Chat response generated', {
    conversationId,
    answerLength: answer.length,
    sourceCount: sources.length,
  });

  return { answer, sources, conversationId };
}
