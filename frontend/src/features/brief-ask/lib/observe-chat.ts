/**
 * Read the status of the chat runtime's answers.
 *
 * The chat endpoint refuses a turn with a JSON body before any stream starts:
 * 401 when the token is missing or expired, 429 when the caller's hourly
 * ceiling is reached (server: src/api/routes/copilotkit.ts). CopilotKit
 * 1.55 exposes no error hook on its provider or chat component, so the panel
 * cannot learn about either from the library. This observer wraps
 * `window.fetch` for the panel's lifetime, reads the status of responses
 * addressed to the runtime path, and passes every response through
 * untouched. It is installed on mount and removed on unmount.
 */

export const CHAT_RUNTIME_PATH = '/api/v1/chat';

const HTTP_UNAUTHORIZED = 401;
const HTTP_TOO_MANY_REQUESTS = 429;

export type ChatRefusal = 'unauthorized' | 'rate_limited';

export function refusalFromStatus(status: number): ChatRefusal | null {
  if (status === HTTP_UNAUTHORIZED) return 'unauthorized';
  if (status === HTTP_TOO_MANY_REQUESTS) return 'rate_limited';
  return null;
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function retryAfterOf(response: Response): number | undefined {
  const header = response.headers.get('retry-after');
  if (!header) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) ? seconds : undefined;
}

/**
 * Install the observer. Returns the function that removes it. If something
 * else replaced `fetch` in the meantime, the removal leaves that in place.
 */
export function observeChatResponses(
  onRefusal: (refusal: ChatRefusal, retryAfterSec?: number) => void
): () => void {
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') return () => undefined;
  const original = window.fetch;
  const wrapped: typeof window.fetch = async (input, init) => {
    const response = await original(input, init);
    if (urlOf(input).includes(CHAT_RUNTIME_PATH)) {
      const refusal = refusalFromStatus(response.status);
      if (refusal) onRefusal(refusal, retryAfterOf(response));
    }
    return response;
  };
  window.fetch = wrapped;
  return () => {
    if (window.fetch === wrapped) window.fetch = original;
  };
}
