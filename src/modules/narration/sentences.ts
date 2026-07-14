/**
 * Sentence splitting — byte-for-byte port of the /mobile player's stripMd() +
 * sentences() (frontend/public/mobile/index.html). The player looks up
 * pre-rendered audio by sha256(joined sentences), so BOTH sides must split
 * identically; tests/smoke/narration.test.ts pins the parity fixtures.
 * Change here ⇒ change the player + fixtures in the same PR.
 */

import { createHash } from 'node:crypto';

export function stripMd(s: unknown): string {
  return String(s ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\|[^\n]*\|/g, ' ')
    .replace(/\[!\w+\]\s*/g, '') // 마크다운 콜아웃([!warning] 등) — 낭독·표시 금지
    .replace(/[#>*_`~]|\[(.*?)\]\(.*?\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

export function sentences(s: unknown): string[] {
  return stripMd(s)
    .split(/(?<=[.!?다요죠음됨함][\s"')\]]?)\s+/)
    .map((x) => x.trim())
    .filter((x) => x.length > 1);
}

/** Beat text key: sha256 hex of the sentence-joined text, first 12 chars. */
export function beatTextHash(sents: string[]): string {
  return createHash('sha256').update(sents.join(' ')).digest('hex').slice(0, 12);
}
