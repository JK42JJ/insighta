#!/usr/bin/env npx tsx
/**
 * Convert mandala JSONL to flat CSV for Kaggle export.
 *
 * Produces columns:
 *   id, center_goal, center_label, domain, language, quality_score,
 *   frame_type, trend_keywords, trend_date, tier, version, judge_score,  (V4 fields)
 *   sub_goal_1..8, sub_label_1..8,
 *   action_1_1..action_1_8, ..., action_8_1..action_8_8
 *
 * Usage:
 *   npx tsx scripts/data/jsonl-to-csv.ts <input.jsonl> [output.csv]
 *   If output omitted, replaces .jsonl → .csv
 */

import * as fs from 'fs';
import * as readline from 'readline';

const SUB_GOAL_COUNT = 8;
const ACTION_COUNT = 8;

function escapeCsv(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function buildHeader(): string {
  const cols = [
    'id', 'center_goal', 'center_label', 'domain', 'language', 'quality_score',
    'frame_type', 'trend_keywords', 'trend_date', 'tier', 'version', 'judge_score',
  ];

  for (let i = 1; i <= SUB_GOAL_COUNT; i++) {
    cols.push(`sub_goal_${i}`);
  }
  for (let i = 1; i <= SUB_GOAL_COUNT; i++) {
    cols.push(`sub_label_${i}`);
  }
  for (let sg = 1; sg <= SUB_GOAL_COUNT; sg++) {
    for (let a = 1; a <= ACTION_COUNT; a++) {
      cols.push(`action_${sg}_${a}`);
    }
  }

  return cols.join(',');
}

function entryToRow(entry: Record<string, unknown>, rowIndex: number): string {
  const subGoals = (entry.sub_goals as string[]) || [];
  const subLabels = (entry.sub_labels as string[]) || [];
  const actions = (entry.actions as Record<string, string[]>) || {};
  const id = (entry.id as string) || String(rowIndex);

  const cols: string[] = [
    escapeCsv(id),
    escapeCsv((entry.center_goal as string) || ''),
    escapeCsv((entry.center_label as string) || ''),
    escapeCsv((entry.domain as string) || ''),
    escapeCsv((entry.language as string) || ''),
    String(entry.quality_score ?? ''),
    // V4 fields (empty string for V3 entries without these)
    escapeCsv((entry.frame_type as string) || ''),
    escapeCsv(Array.isArray(entry.trend_keywords) ? (entry.trend_keywords as string[]).join('|') : ''),
    escapeCsv((entry.trend_date as string) || ''),
    escapeCsv((entry.tier as string) || ''),
    escapeCsv((entry.version as string) || ''),
    String(entry.judge_score ?? ''),
  ];

  // Sub-goals (1-indexed columns)
  for (let i = 0; i < SUB_GOAL_COUNT; i++) {
    cols.push(escapeCsv(subGoals[i] || ''));
  }

  // Sub-labels
  for (let i = 0; i < SUB_GOAL_COUNT; i++) {
    cols.push(escapeCsv(subLabels[i] || ''));
  }

  // Actions: for each sub_goal, its 8 actions
  for (let sg = 0; sg < SUB_GOAL_COUNT; sg++) {
    const subGoal = subGoals[sg] || '';
    const acts = actions[subGoal] || [];
    for (let a = 0; a < ACTION_COUNT; a++) {
      const action = (acts[a] || '').replace(/\[HIGH\]\s*/g, '');
      cols.push(escapeCsv(action));
    }
  }

  return cols.join(',');
}

async function convert(inputPath: string, outputPath: string): Promise<void> {
  const fileStream = fs.createReadStream(inputPath);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
  const out = fs.createWriteStream(outputPath);

  out.write(buildHeader() + '\n');

  let count = 0;
  for await (const line of rl) {
    if (!line.trim()) continue;
    const entry = JSON.parse(line);
    count++;
    out.write(entryToRow(entry, count) + '\n');
  }

  out.end();
  console.log(`Converted ${count} entries → ${outputPath}`);
}

async function main() {
  const inputPath = process.argv[2];

  if (!inputPath) {
    console.error('Usage: npx tsx scripts/data/jsonl-to-csv.ts <input.jsonl> [output.csv]');
    process.exit(1);
  }

  if (!fs.existsSync(inputPath)) {
    console.error(`File not found: ${inputPath}`);
    process.exit(1);
  }

  const outputPath = process.argv[3] || inputPath.replace(/\.jsonl$/, '.csv');
  await convert(inputPath, outputPath);
}

main().catch((err) => {
  console.error('Conversion error:', err);
  process.exit(1);
});
