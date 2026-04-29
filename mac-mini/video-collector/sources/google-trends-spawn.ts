/**
 * Source 2b spawn helper — calls google-trends.py and parses stdout.
 *
 * Used by the orchestrator only when Naver DataLab returns insufficient
 * keywords (fallback path, per CP438 spec §B-extra). The Python helper
 * lives next to this file and reads via pytrends, which is installed in
 * the Mac Mini's video-dictionary uv environment.
 */

import { spawn } from 'node:child_process';
import { resolve as resolvePath, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

interface GoogleTrendsOptions {
  /** uv binary path (e.g. /opt/homebrew/bin/uv). */
  uvBin: string;
  /** Mac Mini path to the video-dictionary directory (uv project). */
  uvProjectDir: string;
  countries: string[];
  timeoutMs: number;
}

export async function collectGoogleTrends(
  opts: GoogleTrendsOptions,
): Promise<{ keywords: string[]; diagnostics: Record<string, unknown> }> {
  const here = dirname(fileURLToPath(import.meta.url));
  const script = resolvePath(here, 'google-trends.py');
  return new Promise((resolve) => {
    const child = spawn(
      opts.uvBin,
      ['run', '--with', 'pytrends', '--project', opts.uvProjectDir, 'python', script, ...opts.countries],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    const t = setTimeout(() => child.kill('SIGKILL'), opts.timeoutMs);
    child.on('close', (code) => {
      clearTimeout(t);
      const keywords = stdout
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      resolve({
        keywords,
        diagnostics: {
          exit_code: code,
          stderr_excerpt: stderr.slice(0, 200),
          keyword_count: keywords.length,
        },
      });
    });
    child.on('error', (err) => {
      clearTimeout(t);
      resolve({ keywords: [], diagnostics: { error: err.message } });
    });
  });
}
