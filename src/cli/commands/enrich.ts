/**
 * CLI command: enrich
 *
 * Phase 1: Backfill — create ontology resource nodes for YouTube cards missing them
 * Phase 2: Enrich  — generate LLM summaries and write back to user_note
 *
 * Shows real-time progress bar in console.
 */

import type { Command } from 'commander';
import {
  backfillResourceNodes,
  batchEnrichResources,
  type EnrichProgressEvent,
} from '../../modules/ontology/enrichment';

const PROGRESS_BAR_WIDTH = 30;

function renderProgressBar(current: number, total: number): string {
  const pct = total > 0 ? current / total : 0;
  const filled = Math.round(pct * PROGRESS_BAR_WIDTH);
  const empty = PROGRESS_BAR_WIDTH - filled;
  const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(empty);
  return `[${bar}] ${current}/${total} (${Math.round(pct * 100)}%)`;
}

function truncate(str: string, maxLen: number): string {
  return str.length > maxLen ? str.slice(0, maxLen - 1) + '\u2026' : str;
}

export function registerEnrichCommands(program: Command): void {
  program
    .command('enrich')
    .description('Backfill resource nodes + batch-enrich with AI summaries')
    .requiredOption('--user-id <id>', 'User UUID')
    .option('--limit <n>', 'Max nodes to enrich (0 = all)', '0')
    .option('--delay <ms>', 'Delay between nodes in ms', '1000')
    .option('--skip-backfill', 'Skip backfill phase (only enrich existing nodes)')
    .action(async (opts: { userId: string; limit: string; delay: string; skipBackfill?: boolean }) => {
      const userId = opts.userId;
      const limit = parseInt(opts.limit, 10);
      const delayMs = parseInt(opts.delay, 10);
      const startTime = Date.now();

      console.log('');
      console.log('  \u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557');
      console.log('  \u2551   Insighta \u2014 Batch Enrich (Ollama)   \u2551');
      console.log('  \u2560\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2563');
      console.log(`  \u2551  User:  ${truncate(userId, 28).padEnd(28)} \u2551`);
      console.log(`  \u2551  Limit: ${String(limit || 'all').padEnd(28)} \u2551`);
      console.log(`  \u2551  Delay: ${String(delayMs + 'ms').padEnd(28)} \u2551`);
      console.log('  \u255a\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255d');

      try {
        // ── Phase 1: Backfill ──
        if (!opts.skipBackfill) {
          console.log('');
          console.log('  Phase 1: Backfill (cards \u2192 resource nodes)');
          console.log('  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');

          const backfillResult = await backfillResourceNodes(userId, {
            onProgress: (event) => {
              const bar = renderProgressBar(event.current, event.total);
              const icon = event.status === 'created' ? '\u2705' : event.status === 'error' ? '\u274c' : '\u23ed';
              process.stdout.write(`\r  ${bar}  ${icon} ${truncate(event.title, 40)}`);
              if (event.status !== 'created' || event.current === event.total) {
                console.log('');
              }
            },
          });

          console.log(`  \u2192 Created: ${backfillResult.created} / ${backfillResult.total} (skipped: ${backfillResult.skipped}, errors: ${backfillResult.errors.length})`);
        }

        // ── Phase 2: Enrich ──
        console.log('');
        console.log('  Phase 2: Enrich (LLM summary \u2192 user_note)');
        console.log('  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');

        let lastTitle = '';
        const onProgress = (event: EnrichProgressEvent) => {
          const bar = renderProgressBar(event.current, event.total);

          if (event.status === 'start') {
            lastTitle = truncate(event.title, 40);
            process.stdout.write(`\r  ${bar}  \u23f3 ${lastTitle}...`);
          } else if (event.status === 'success') {
            process.stdout.write(`\r  ${bar}  \u2705 ${lastTitle}`);
            console.log('');
            if (event.summary) {
              console.log(`     \ud83d\udcdd ${truncate(event.summary, 70)}`);
            }
          } else if (event.status === 'error') {
            process.stdout.write(`\r  ${bar}  \u274c ${lastTitle}`);
            console.log('');
            console.log(`     \u26a0  ${truncate(event.error || 'unknown', 70)}`);
          }
        };

        const result = await batchEnrichResources(userId, {
          limit,
          delayMs,
          onProgress,
        });

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log('');
        console.log('  \u250c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 Result \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510');
        console.log(`  \u2502  Total:    ${String(result.total).padEnd(20)} \u2502`);
        console.log(`  \u2502  Enriched: ${String(result.enriched).padEnd(20)} \u2502`);
        console.log(`  \u2502  Errors:   ${String(result.errors.length).padEnd(20)} \u2502`);
        console.log(`  \u2502  Time:     ${(elapsed + 's').padEnd(20)} \u2502`);
        console.log('  \u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518');
        console.log('');
      } catch (err) {
        console.error('');
        console.error('  Fatal error:', err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
