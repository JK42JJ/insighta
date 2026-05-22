/**
 * src/api/routes/chatbot-context-storage.ts
 *
 * Per-request `AsyncLocalStorage` for the CopilotKit chatbot pipeline (CP477+15).
 *
 * Problem this solves:
 *   - The chatbot route mounts on the raw HTTP `server.on('request')` listener
 *     (PR #732 CP477+7) to bypass Fastify body parsing. That bypass also skips
 *     Fastify's `fastify.authenticate` decorator, so the deep code path inside
 *     CopilotKit's `getLanguageModel()` → `qwen-prompt-middleware` has no access
 *     to `request.user.userId`.
 *   - CP474 designed `loadUserContext({ userId, email, ... })` for Block U
 *     (mandala_count, mandala_titles, ...) but the middleware was marked
 *     "Out of scope — deferred to Stage 7b+ (plumbing change)".
 *
 * Why AsyncLocalStorage (not CopilotRuntime properties, not env, not header pass-through):
 *   - We need request-scoped data accessible from inside a Vercel AI SDK
 *     middleware that has no parameter for it. AsyncLocalStorage is the
 *     Node-native way to thread request context through unrelated async
 *     code without changing every intermediate signature.
 *   - The yoga handler + service adapter live inside the same async context
 *     as the listener that received the request, so `getStore()` resolves
 *     to the right entry without explicit propagation.
 *
 * Lifecycle:
 *   - Set by `runWithChatbotContext(ctx, fn)` in `copilotkit.ts` immediately
 *     after JWT verify (inside the `req.pause()` paused window).
 *   - Read by `getChatbotContext()` from inside
 *     `qwen-prompt-middleware.rewriteSystemContent`.
 *   - Cleared automatically when the outer async function unwinds (Node's
 *     AsyncLocalStorage handles this via the async resource lifetime).
 *
 * Safety:
 *   - `userId`/`email` are optional — JWT verify failure leaves the store
 *     unpopulated. Middleware code MUST treat `getChatbotContext()` as
 *     possibly `undefined` and fall back to the pre-CP477+15 behaviour (no
 *     Block U).
 *   - No secrets land here. `email` is non-sensitive (UI displays it) but
 *     never logged.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

export interface ChatbotRequestContext {
  /** Supabase auth user id (`sub` claim from JWT). */
  userId?: string;
  /** Decoded JWT email. */
  email?: string;
  /** Display name from `user_metadata.name` / `full_name`. */
  displayName?: string;
}

const chatbotContextStorage = new AsyncLocalStorage<ChatbotRequestContext>();

/**
 * Run `fn` with the given chatbot context bound to AsyncLocalStorage.
 *
 * Use this in the chatbot route's request handler:
 *
 *     await runWithChatbotContext({ userId, email }, async () => {
 *       await yogaHandler(req, res);
 *     });
 *
 * Nested calls overwrite — the innermost `run` wins for the nested async
 * region, then the outer one is restored when the nested promise resolves.
 */
export function runWithChatbotContext<T>(
  ctx: ChatbotRequestContext,
  fn: () => Promise<T> | T
): Promise<T> | T {
  return chatbotContextStorage.run(ctx, fn);
}

/**
 * Read the current request's chatbot context. Returns `undefined` outside
 * of a `runWithChatbotContext` call — callers MUST handle that case.
 */
export function getChatbotContext(): ChatbotRequestContext | undefined {
  return chatbotContextStorage.getStore();
}
