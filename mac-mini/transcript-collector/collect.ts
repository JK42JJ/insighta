/**
 * Mac Mini transcript collector (CP437, 2026-04-29).
 *
 * Runs ON the Mac Mini (NOT on EC2). Hits the EC2 internal API to:
 *   1. Pull a batch of candidate video IDs (`has_caption=true,
 *      transcript_fetched_at IS NULL`).
 *   2. Pipe yt-dlp stdout (auto-subs, vtt) into memory.
 *   3. Strip VTT timing → plain text.
 *   4. POST the transcript to /transcript/summarize. EC2 calls
 *      generateRichSummaryV2() with it and stamps transcript_fetched_at.
 *   5. Discard the transcript text immediately.
 *
 * Legal directive: the transcript NEVER touches disk on either side.
 * yt-dlp is invoked with `-o -` (stdout) and the response stream is
 * collected into a buffer in process memory only.
 *
 * Bot 절대 규칙: this script never opens a Postgres connection. It only
 * speaks HTTP to the EC2 API.
 */

import { spawn } from 'node:child_process';

interface Candidate {
  youtube_video_id: string;
  default_language: string | null;
  has_caption: boolean | null;
}

interface CandidatesResponse {
  videos: Candidate[];
}

interface SummarizeOutcomePass {
  kind: 'pass';
  videoId: string;
  completeness: number;
}
interface SummarizeOutcomeOther {
  kind: 'low' | 'skip';
  videoId: string;
  reason?: string;
}
type SummarizeOutcome = SummarizeOutcomePass | SummarizeOutcomeOther;

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
 * Run yt-dlp and capture the auto-generated subtitle to stdout. Saves
 * NOTHING to disk (`-o -` and `--skip-download`).
 *
 * Returns plain text (VTT timing stripped) or null when no captions are
 * actually available (yt-dlp succeeds but produces empty output).
 */
async function fetchTranscript(videoId: string, language: 'ko' | 'en'): Promise<string | null> {
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
    '-',
    `https://www.youtube.com/watch?v=${videoId}`,
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(YTDLP_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
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
      reject(new Error(`yt-dlp timeout after ${PER_VIDEO_TIMEOUT_MS}ms for ${videoId}`));
    }, PER_VIDEO_TIMEOUT_MS);

    child.stdout.on('data', (b: Buffer) => chunks.push(b));
    child.stderr.on('data', (b: Buffer) => {
      stderr += b.toString('utf-8');
    });
    child.on('error', (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`yt-dlp exit ${code} for ${videoId}: ${stderr.slice(0, 200)}`));
        return;
      }
      const raw = Buffer.concat(chunks).toString('utf-8');
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
    out.push(stripped);
  }
  return out.join(' ');
}

async function postSummary(
  videoId: string,
  transcript: string,
  language: 'ko' | 'en'
): Promise<SummarizeOutcome> {
  const url = `${API_URL.replace(/\/$/, '')}/api/v1/internal/transcript/summarize`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-internal-token': INTERNAL_TOKEN,
    },
    body: JSON.stringify({ videoId, transcript, language }),
  });
  if (res.status === 401 || res.status === 503) {
    throw new Error(`summarize HTTP ${res.status}`);
  }
  const data = (await res.json()) as SummarizeOutcome;
  return data;
}

async function pickLanguage(c: Candidate): Promise<'ko' | 'en'> {
  if (c.default_language && c.default_language.startsWith('en')) return 'en';
  return 'ko';
}

async function main(): Promise<void> {
  console.log(
    `[transcript-collector] start — API=${API_URL} batch=${BATCH_SIZE} ytdlp=${YTDLP_BIN}`
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
  let pass = 0;
  let low = 0;
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
      continue;
    }
    if (!transcript) {
      skip += 1;
      console.log(`[${c.youtube_video_id}] no captions (yt-dlp empty) — skipping`);
      continue;
    }
    try {
      const outcome = await postSummary(c.youtube_video_id, transcript, lang);
      if (outcome.kind === 'pass') pass += 1;
      else if (outcome.kind === 'low') low += 1;
      else skip += 1;
      // Discard transcript explicitly: variable goes out of scope here, but
      // mark for clarity that no further use is allowed.
      transcript = null;
    } catch (err) {
      errors += 1;
      console.warn(
        `[${c.youtube_video_id}] summarize failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  console.log(
    `[transcript-collector] done — pass=${pass} low=${low} skip=${skip} errors=${errors}`
  );
  process.exit(errors > 0 && pass === 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(`fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
