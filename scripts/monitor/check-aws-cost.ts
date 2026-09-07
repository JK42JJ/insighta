/**
 * AWS spend, read from the Cost and Usage Report rather than queried.
 *
 * The Cost Explorer API answers the same question and bills $0.01 per request.
 * Checking hourly would cost $7/month to find out whether we are spending
 * money. `AWS Cost Explorer  0.09` was already a line item on this account
 * when that was noticed, which is what prompted the switch.
 *
 * A CUR is pushed to S3 on a schedule at no charge, so this reads a file
 * instead of calling a billing API. Nothing here costs anything to run beyond
 * the S3 GET.
 *
 * The AWS CLI does the S3 work rather than the SDK: the runner already has the
 * CLI and the credentials wired, and adding @aws-sdk/client-s3 to the
 * application's dependencies to support a monitoring script would put a
 * megabyte into the API image for the sake of a file download.
 */

import { execFileSync } from 'child_process';
import { gunzipSync } from 'zlib';
import { readFileSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import type { CheckResult } from './lib';

const BUCKET = process.env['AWS_COST_REPORT_BUCKET'] ?? 'insighta-cost-reports';
const PREFIX = process.env['AWS_COST_REPORT_PREFIX'] ?? 'cur';
const MONTHLY_BUDGET = Number(process.env['AWS_MONTHLY_BUDGET_USD'] ?? 40);
const WARN_RATIO = Number(process.env['MONITOR_SPEND_WARN_RATIO'] ?? 0.7);

function aws(args: string[]): string {
  return execFileSync('aws', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

/** A row of the aggregate this check produces. */
export interface ServiceCost {
  service: string;
  cost: number;
}

/**
 * Split one CUR CSV line.
 *
 * Written out rather than pulled from a library because the CUR dialect is
 * narrow -- comma separated, double quotes, doubled quotes to escape -- and a
 * dependency for twelve lines is a dependency to keep updated forever.
 */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/**
 * Sum unblended cost per service from a CUR CSV.
 *
 * Column positions are read from the header rather than hardcoded: the CUR
 * schema gains columns over time and the order is not a contract.
 */
export function aggregateCur(csv: string): { total: number; byService: ServiceCost[] } {
  const lines = csv.split('\n').filter((l) => l.length > 0);
  if (lines.length < 2) return { total: 0, byService: [] };

  const header = parseCsvLine(lines[0]!);
  const costIdx = header.indexOf('lineItem/UnblendedCost');
  // ProductName is the readable one ("Amazon Elastic Compute Cloud"); the code
  // ("AmazonEC2") is the fallback when a row has no product name, which
  // happens for taxes and refunds.
  const nameIdx = header.indexOf('product/ProductName');
  const codeIdx = header.indexOf('lineItem/ProductCode');
  if (costIdx < 0) return { total: 0, byService: [] };

  const sums = new Map<string, number>();
  let total = 0;
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]!);
    const cost = Number(cols[costIdx] ?? 0);
    if (!Number.isFinite(cost) || cost === 0) continue;
    const service =
      (nameIdx >= 0 ? cols[nameIdx] : '') || (codeIdx >= 0 ? cols[codeIdx] : '') || 'unattributed';
    sums.set(service, (sums.get(service) ?? 0) + cost);
    total += cost;
  }

  const byService = [...sums.entries()]
    .map(([service, cost]) => ({ service, cost }))
    .sort((a, b) => b.cost - a.cost);
  return { total, byService };
}

/** The newest manifest key under the prefix, or null when nothing has been delivered. */
function newestManifestKey(): string | null {
  let listing: string;
  try {
    listing = aws(['s3', 'ls', `s3://${BUCKET}/${PREFIX}/`, '--recursive']);
  } catch {
    return null;
  }
  const keys = listing
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.endsWith('-Manifest.json'))
    .map((l) => l.split(/\s+/).slice(3).join(' '))
    // The billing period directory sorts lexicographically in date order, so
    // the last one is the current month.
    .sort();
  return keys.length > 0 ? keys[keys.length - 1]! : null;
}

export async function checkAwsCost(): Promise<CheckResult> {
  const check = 'aws-cost';

  const manifestKey = newestManifestKey();
  if (!manifestKey) {
    // AWS takes up to 24 hours to deliver the first report. An empty bucket on
    // the day the report is created is expected, and alerting on it would mean
    // the monitor's first act is to cry wolf.
    return {
      check,
      ok: true,
      detail: 'no cost report delivered yet (AWS takes up to 24h after the definition is created)',
      context: { bucket: BUCKET },
    };
  }

  const dir = mkdtempSync(join(tmpdir(), 'cur-'));
  try {
    aws(['s3', 'cp', `s3://${BUCKET}/${manifestKey}`, join(dir, 'manifest.json'), '--quiet']);
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as {
      reportKeys?: string[];
      billingPeriod?: { start?: string };
    };
    const reportKeys = manifest.reportKeys ?? [];
    if (reportKeys.length === 0) {
      return { check, ok: true, detail: 'manifest present but names no data files yet' };
    }

    let csv = '';
    for (const key of reportKeys) {
      const local = join(dir, 'part.csv.gz');
      aws(['s3', 'cp', `s3://${BUCKET}/${key}`, local, '--quiet']);
      const text = gunzipSync(readFileSync(local)).toString('utf8');
      // Only the first part carries the header; the rest continue the rows.
      csv += csv.length === 0 ? text : text.split('\n').slice(1).join('\n');
    }

    const { total, byService } = aggregateCur(csv);
    const top = byService
      .slice(0, 4)
      .map((s) => `${s.service} $${s.cost.toFixed(2)}`)
      .join(' · ');
    const ctx = {
      total: Number(total.toFixed(4)),
      budget: MONTHLY_BUDGET,
      billingPeriod: manifest.billingPeriod?.start,
      byService: byService.slice(0, 10),
    };

    if (total >= MONTHLY_BUDGET * WARN_RATIO) {
      return {
        check,
        ok: false,
        detail: `AWS month-to-date $${total.toFixed(2)} of $${MONTHLY_BUDGET.toFixed(2)} (${Math.round(
          (total / MONTHLY_BUDGET) * 100
        )}%) — ${top}`,
        context: ctx,
      };
    }
    return {
      check,
      ok: true,
      detail: `AWS month-to-date $${total.toFixed(2)} / $${MONTHLY_BUDGET.toFixed(2)} — ${top}`,
      context: ctx,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
