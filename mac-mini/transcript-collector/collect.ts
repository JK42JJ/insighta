/**
 * Mac Mini transcript collector (CP437, 2026-04-29).
 *
 * Runs ON the Mac Mini (NOT on EC2). Fetches candidate video IDs from EC2,
 * pulls Korean (or English) auto-captions via yt-dlp, strips VTT timing,
 * and writes the cleaned transcript text to a local staging directory for
 * later CC-direct review.
 *
 *   1. GET  /api/v1/internal/transcript/candidates?limit=N
 *      → list of (youtube_video_id, default_language, has_caption)
 *   2. yt-dlp into a per-run tmp dir (the `-o -` stdout pattern does NOT
 *      work for VTT subs — yt-dlp writes nothing to stdout in that mode,
 *      so we write to disk and read back).
 *   3. Strip VTT timing → plain text.
 *   4. Write the cleaned transcript to `${OUTPUT_DIR}/<video_id>.txt`
 *      and a one-line metadata row to `${OUTPUT_DIR}/_index.csv`.
 *   5. NO POST to EC2 — CC reads transcripts manually, authors v2 layered
 *      JSON, and POSTs to `/v2-summary/upsert-direct` (Hard Rule: no LLM
 *      API call from Mac Mini, server, or any auto path).
 *
 * Lifetime: transcripts are written to disk on Mac Mini only and live
 * until CC consumes them; the operator (or a separate cleanup cron) is
 * responsible for `rm -rf` after CC has authored the v2 JSON. The original
 * "NEVER touches disk" directive is relaxed because authoring v2 from
 * transcripts requires CC to read full text — which means the file must
 * persist long enough to be read.
 *
 * Bot 절대 규칙: this script never opens a Postgres connection. It only
 * speaks HTTP to the EC2 candidates endpoint, then operates locally.
 */

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, appendFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

interface Candidate {
  youtube_video_id: string;
  default_language: string | null;
  has_caption: boolean | null;
}

interface CandidatesResponse {
  videos: Candidate[];
}

const env = process.env;

const API_URL = (env['INSIGHTA_API_URL'] ?? '').trim();
const INTERNAL_TOKEN = (env['INTERNAL_BATCH_TOKEN'] ?? '').trim();
const BATCH_SIZE = Math.max(
  1,
  Math.min(200, Number(env['TRANSCRIPT_BATCH_SIZE'] ?? '50') || 50)
);
const PER_VIDEO_TIMEOUT_MS = Math.max(
  10_000,
  Number(env['TRANSCRIPT_YTDLP_TIMEOUT_MS'] ?? '60000') || 60_000
);
const YTDLP_BIN = (env['YTDLP_BIN'] ?? 'yt-dlp').trim();
const OUTPUT_DIR = (env['TRANSCRIPT_OUTPUT_DIR'] ?? '/tmp/insighta-transcripts').trim();

if (!API_URL) {
  console.error('INSIGHTA_API_URL env required');
  process.exit(1);
}
if (!INTERNAL_TOKEN) {
  console.error('INTERNAL_BATCH_TOKEN env required');
  process.exit(1);
}

async function fetchCandidates(): Promise<Candidate[]> {
  const url = `${API_URL.replace(/\/$/, '')}/api/v1/internal/transcript/candidates?limit=${BATCH_SIZE}`;
  const res = await fetch(url, {
    headers: { 'x-internal-token': INTERNAL_TOKEN },
  });
  if (!res.ok) {
    throw new Error(`candidates HTTP ${res.status}: ${await res.text()}`);
  }
  const body = (await res.json()) as CandidatesResponse;
  return body.videos ?? [];
}

/**
 * Run yt-dlp into a fresh tmp dir, return the cleaned transcript text.
 * yt-dlp does NOT pipe VTT subs to stdout when `-o -` is used (it writes
 * nothing in that mode), so we route output through disk and read back.
 * The tmp dir is removed before this function returns.
 */
async function fetchTranscript(videoId: string, language: 'ko' | 'en'): Promise<string | null> {
  const sessionDir = join(tmpdir(), `insighta-yt-${process.pid}-${Date.now()}`);
  mkdirSync(sessionDir, { recursive: true });

  const args = [
    '--skip-download',
    '--write-auto-sub',
    '--sub-lang',
    language,
    '--sub-format',
    'vtt',
    '--quiet',
    '--no-warnings',
    '-o',
    `${sessionDir}/%(id)s`,
    `https://www.youtube.com/watch?v=${videoId}`,
  ];

  return new Promise((resolve, reject) => {
    const child = spawn(YTDLP_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try {
        child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
      try {
        rmSync(sessionDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
      reject(new Error(`yt-dlp timeout after ${PER_VIDEO_TIMEOUT_MS}ms for ${videoId}`));
    }, PER_VIDEO_TIMEOUT_MS);

    child.stderr.on('data', (b: Buffer) => {
      stderr += b.toString('utf-8');
    });
    child.on('error', (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        rmSync(sessionDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
      reject(err);
    });
    child.on('close', (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (code !== 0) {
        try {
          rmSync(sessionDir, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
        reject(new Error(`yt-dlp exit ${code} for ${videoId}: ${stderr.slice(0, 200)}`));
        return;
      }
      // yt-dlp writes `<sessionDir>/<videoId>.<lang>.vtt`. Read it, strip,
      // then delete the tmp dir. We do not keep the raw VTT file.
      const vttPath = join(sessionDir, `${videoId}.${language}.vtt`);
      let raw = '';
      try {
        raw = readFileSync(vttPath, 'utf-8');
      } catch {
        // No VTT → no captions. Empty result.
      }
      try {
        rmSync(sessionDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
      const text = stripVtt(raw);
      resolve(text.length > 0 ? text : null);
    });
  });
}

/**
 * Strip VTT timing lines + cue identifiers, keep only spoken text.
 * Best-effort: handles the standard YouTube auto-subtitle format with
 * `WEBVTT` header, blank-line separators, and `00:00:00.000 --> 00:00:00.000`
 * timing lines.
 */
export function stripVtt(vtt: string): string {
  const lines = vtt.split(/\r?\n/);
  const out: string[] = [];
  let prev = '';
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (t === 'WEBVTT') continue;
    if (/^\d+$/.test(t)) continue; // cue id
    if (/-->/u.test(t)) continue; // timing
    if (/^Kind:|^Language:/i.test(t)) continue;
    // Strip inline tags like <00:00:01.000><c> ... </c>
    const stripped = t.replace(/<[^>]+>/g, '').trim();
    if (stripped.length === 0) continue;
    if (stripped === prev) continue;
    out.push(stripped);
    prev = stripped;
  }
  return out.join(' ');
}

async function pickLanguage(c: Candidate): Promise<'ko' | 'en'> {
  if (c.default_language && c.default_language.startsWith('en')) return 'en';
  return 'ko';
}

/** Append a one-line metadata row so an operator can see what was fetched. */
function indexAppend(line: string): void {
  appendFileSync(join(OUTPUT_DIR, '_index.csv'), line + '\n', 'utf-8');
}

async function main(): Promise<void> {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  console.log(
    `[transcript-collector] start — API=${API_URL} batch=${BATCH_SIZE} ytdlp=${YTDLP_BIN} out=${OUTPUT_DIR}`
  );

  let candidates: Candidate[];
  try {
    candidates = await fetchCandidates();
  } catch (err) {
    console.error(
      `candidate fetch failed: ${err instanceof Error ? err.message : String(err)}`
    );
    process.exit(1);
  }
  console.log(`[transcript-collector] picked ${candidates.length} candidates`);

  let saved = 0;
  let skip = 0;
  let errors = 0;
  for (const c of candidates) {
    const lang = await pickLanguage(c);
    let transcript: string | null = null;
    try {
      transcript = await fetchTranscript(c.youtube_video_id, lang);
    } catch (err) {
      errors += 1;
      console.warn(
        `[${c.youtube_video_id}] yt-dlp failed: ${err instanceof Error ? err.message : String(err)}`
      );
      indexAppend(`${new Date().toISOString()},${c.youtube_video_id},${lang},error`);
      continue;
    }
    if (!transcript) {
      skip += 1;
      console.log(`[${c.youtube_video_id}] no captions — skipping`);
      indexAppend(`${new Date().toISOString()},${c.youtube_video_id},${lang},no_captions`);
      continue;
    }
    const txtPath = join(OUTPUT_DIR, `${c.youtube_video_id}.txt`);
    writeFileSync(txtPath, transcript, 'utf-8');
    saved += 1;
    console.log(`[${c.youtube_video_id}] saved ${transcript.length} chars → ${txtPath}`);
    indexAppend(`${new Date().toISOString()},${c.youtube_video_id},${lang},saved,${transcript.length}`);
  }
  console.log(
    `[transcript-collector] done — saved=${saved} skip=${skip} errors=${errors}. Awaiting CC review (no auto POST).`
  );
  process.exit(errors > 0 && saved === 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(`fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
