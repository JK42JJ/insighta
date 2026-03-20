/**
 * Child process worker for batch enrichment.
 * Runs in a separate Node.js process to avoid blocking the API server's event loop.
 *
 * Communication: parent sends { limit, delayMs } via IPC, worker sends back { type: 'result', data } on completion.
 */

import { systemBatchEnrich } from './enrichment';

process.on('message', async (msg: { limit: number; delayMs: number }) => {
  try {
    const result = await systemBatchEnrich({
      limit: msg.limit,
      delayMs: msg.delayMs,
    });
    process.send!({ type: 'result', data: result });
    process.exit(0);
  } catch (err) {
    process.send!({
      type: 'result',
      data: {
        total: 0,
        enriched: 0,
        skipped: 0,
        errors: [{ videoId: 'worker', error: err instanceof Error ? err.message : String(err) }],
      },
    });
    process.exit(1);
  }
});
