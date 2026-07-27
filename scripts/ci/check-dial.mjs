/**
 * The dial's only CI gate.
 *
 * frontend/public/mobile/index.html is a single 320KB page with its logic in
 * inline <script> blocks. Nothing else in CI reads it: tsc and vitest look at
 * src/, and vite copies public/ verbatim into the image. So until this file
 * existed, a syntax error in the dial was shippable — it would deploy green and
 * fail in the browser.
 *
 * It also pins the two things the fast deploy path depends on: APP_BUILD and
 * version.json must agree, or the update toast fires forever (it compares the
 * two) and the deploy's own verification has nothing trustworthy to check.
 */

import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const HTML = 'frontend/public/mobile/index.html';
const VERSION = 'frontend/public/mobile/version.json';

const html = readFileSync(HTML, 'utf8');
const fail = (msg) => {
  console.error(`::error file=${HTML}::${msg}`);
  process.exitCode = 1;
};

// 1. every inline script must parse
const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
if (blocks.length === 0) fail('no inline <script> found — did the file structure change?');

let parsed = 0;
for (const [, code] of blocks) {
  if (!code.trim()) continue;
  try {
    new vm.Script(code); // parses without executing
    parsed++;
  } catch (err) {
    const line = (err.stack?.match(/evalmachine[^:]*:(\d+)/) ?? [])[1];
    fail(`inline script #${parsed + 1} does not parse${line ? ` (line ${line} of the block)` : ''}: ${err.message}`);
  }
}

// 2. build stamp agreement
const stamp = html.match(/APP_BUILD\s*=\s*['"]([^'"]+)['"]/)?.[1];
if (!stamp) {
  fail('APP_BUILD not found');
} else {
  let json;
  try {
    json = JSON.parse(readFileSync(VERSION, 'utf8'));
  } catch (err) {
    fail(`${VERSION} is unreadable: ${err.message}`);
  }
  if (json && json.build !== stamp) {
    console.error(
      `::error file=${VERSION}::version.json build "${json.build}" != APP_BUILD "${stamp}". ` +
        'The dial compares the two to decide whether to show the update toast, so a mismatch ' +
        'makes it prompt every user forever.'
    );
    process.exitCode = 1;
  }
}

if (process.exitCode) process.exit(process.exitCode);
console.log(`dial OK — ${parsed} inline script(s) parse, build ${stamp}`);
