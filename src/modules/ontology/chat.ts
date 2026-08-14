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
import { getPrismaClient } from '../database/client';
import { isOntologyChatDbStore } from '../../config/ontology-chat';

const CONVERSATION_TTL_MS = 30 * 60 * 1000; // 30 minutes

// ============================================================================
// Conversation store
// ============================================================================
//
// Two implementations behind one pair of functions. The in-memory Map is the
// default and is what this file has always done; the database store exists
// because the Map is per-process, so with two api replicas the second turn of
// a conversation can land on a replica that has never seen it.
//
// Semantics are identical either way: a 30-minute idle TTL enforced on read,
// and a cap of MAX_CONVERSATION_TURNS exchanges applied on write.

interface ConversationEntry {
  turns: ConversationTurn[];
  lastAccess: number;
}

const conversations = new Map<string, ConversationEntry>();

function trimTurns(turns: ConversationTurn[]): ConversationTurn[] {
  return turns.length > MAX_CONVERSATION_TURNS * 2
    ? turns.slice(-MAX_CONVERSATION_TURNS * 2)
    : turns;
}

// --- in-memory ---

function getConversationMemory(id: string): ConversationTurn[] {
  const entry = conversations.get(id);
  if (!entry) return [];
  if (Date.now() - entry.lastAccess > CONVERSATION_TTL_MS) {
    conversations.delete(id);
    return [];
  }
  entry.lastAccess = Date.now();
  return entry.turns;
}

function addTurnMemory(id: string, role: 'user' | 'assistant', content: string): void {
  let entry = conversations.get(id);
  if (!entry) {
    entry = { turns: [], lastAccess: Date.now() };
    conversations.set(id, entry);
  }
  entry.turns.push({ role, content });
  entry.turns = trimTurns(entry.turns);
  entry.lastAccess = Date.now();
}

/** Periodic cleanup of expired conversations (in-memory path only). */
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

// --- database ---

/**
 * Deleting expired rows is idempotent, so several replicas doing it is
 * harmless. This timestamp is a throttle to keep the DELETE off the hot path,
 * not a correctness mechanism -- unlike the guards this change exists to
 * remove, nothing breaks if two processes sweep at once.
 */
let lastSweepMs = 0;
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;

async function sweepExpired(): Promise<void> {
  const now = Date.now();
  if (now - lastSweepMs < SWEEP_INTERVAL_MS) return;
  lastSweepMs = now;
  try {
    await getPrismaClient().ontology_conversations.deleteMany({
      where: { last_access: { lt: new Date(now - CONVERSATION_TTL_MS) } },
    });
  } catch {
    /* best effort */
  }
}

async function getConversationDb(id: string): Promise<ConversationTurn[]> {
  const db = getPrismaClient();
  const row = await db.ontology_conversations.findUnique({ where: { id } });
  if (!row) return [];

  // Expiry is checked on read, as the in-memory path does, so an idle
  // conversation resumes empty rather than stale.
  if (Date.now() - row.last_access.getTime() > CONVERSATION_TTL_MS) {
    await db.ontology_conversations.delete({ where: { id } }).catch(() => undefined);
    return [];
  }

  await db.ontology_conversations
    .update({ where: { id }, data: { last_access: new Date() } })
    .catch(() => undefined);
  void sweepExpired();
  return (row.turns as unknown as ConversationTurn[]) ?? [];
}

async function addTurnDb(
  id: string,
  role: 'user' | 'assistant',
  content: string,
  userId?: string
): Promise<void> {
  const db = getPrismaClient();
  const row = await db.ontology_conversations.findUnique({ where: { id } });
  const turns = trimTurns([
    ...((row?.turns as unknown as ConversationTurn[]) ?? []),
    { role, content },
  ]);

  await db.ontology_conversations.upsert({
    where: { id },
    create: { id, user_id: userId ?? null, turns: turns as never, last_access: new Date() },
    update: { turns: turns as never, last_access: new Date() },
  });
}

// --- dispatch ---

async function getConversation(id: string): Promise<ConversationTurn[]> {
  if (!isOntologyChatDbStore()) return getConversationMemory(id);
  try {
    return await getConversationDb(id);
  } catch (error) {
    // A missing table or an unreachable database degrades to the previous
    // behaviour rather than failing the chat request.
    logger.warn('ontology chat: db store read failed, using memory', { error });
    return getConversationMemory(id);
  }
}

async function addTurn(
  id: string,
  role: 'user' | 'assistant',
  content: string,
  userId?: string
): Promise<void> {
  if (!isOntologyChatDbStore()) return addTurnMemory(id, role, content);
  try {
    await addTurnDb(id, role, content, userId);
  } catch (error) {
    logger.warn('ontology chat: db store write failed, using memory', { error });
    addTurnMemory(id, role, content);
  }
}

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

function buildChatPrompt(query: string, graphContext: string, history: ConversationTurn[]): string {
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

export async function chat(userId: string, request: ChatRequest): Promise<ChatResponse> {
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
    const history = await getConversation(conversationId);
    const prompt = buildChatPrompt(query, '', history);
    const answer = await provider.generate(prompt);
    await addTurn(conversationId, 'user', query, userId);
    await addTurn(conversationId, 'assistant', answer, userId);
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
      const contextResult = await buildContext(Array.from(allNodeIds), userId, {
        maxTokens: MAX_CONTEXT_TOKENS,
        includeEdges: true,
        includeProperties: true,
      });
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
  const history = await getConversation(conversationId);
  const prompt = buildChatPrompt(query, contextText, history);

  const answer = await provider.generate(prompt, { temperature: 0.7 });

  // 6. Store conversation turn
  await addTurn(conversationId, 'user', query, userId);
  await addTurn(conversationId, 'assistant', answer, userId);

  logger.info('Chat response generated', {
    conversationId,
    answerLength: answer.length,
    sourceCount: sources.length,
  });

  return { answer, sources, conversationId };
}
