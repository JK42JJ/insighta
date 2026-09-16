/**
 * `llm_call_logs.module` labels that more than one module has to agree on.
 *
 * The chat middleware writes the row and the per-user rate limit counts it,
 * and the Keel `llm-spend` check groups spend by this column. One literal in
 * one place keeps the writer, the counter and the monitor on the same key.
 *
 * Dependency-free on purpose: the chat middleware loads the ledger writer
 * lazily and must not pull the database client in at import time.
 */

/** Chat turns served through `/api/v1/chat` (CopilotKit runtime). */
export const CHAT_LEDGER_MODULE = 'copilotkit';
