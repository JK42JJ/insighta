/**
 * The console judge.
 *
 * It exists so S3 can run without a provider, which means it is the component
 * standing between a corpus and a page when nobody is paying an API. Its whole
 * value is that it refuses to guess, so that is what these pin.
 */

import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

jest.mock('@/utils/logger', () => ({
  logger: { child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }) },
}));

import { createConsoleJudge } from '@/modules/newsletter/pipeline/judge/console-judge';
import { JudgeError, type JudgeCandidate } from '@/modules/newsletter/pipeline/judge/types';

const dir = mkdtempSync(join(tmpdir(), 'judge-'));
let n = 0;
function file(lines: string): string {
  const p = join(dir, `v${n++}.jsonl`);
  writeFileSync(p, lines);
  return p;
}

function candidate(videoId: string, title = 'a title'): JudgeCandidate {
  return {
    videoId,
    title,
    channelTitle: 'a channel',
    source: 'search',
    publishedAt: new Date(),
    durationSeconds: 900,
    viewCount: 100,
  };
}

const good = (id: string) =>
  JSON.stringify({ videoId: id, safe: true, learnable: true, inScope: true, why: 'reads well' });

test('returns the verdicts in the order the candidates were given', async () => {
  const j = createConsoleJudge(file([good('aaa'), good('bbb')].join('\n')));
  const out = await j.judge([candidate('bbb'), candidate('aaa')]);
  expect(out.map((v) => v.videoId)).toEqual(['bbb', 'aaa']);
  expect(out.every((v) => v.safe && v.learnable && v.inScope)).toBe(true);
});

test('names itself and its file, so a page can say who judged', () => {
  const p = file(good('aaa'));
  const j = createConsoleJudge(p);
  expect(j.name).toBe('console');
  expect(j.provenance).toBe(p);
});

test('an unjudged candidate is an error, not a pass and not a rejection', async () => {
  const j = createConsoleJudge(file(good('aaa')));
  await expect(j.judge([candidate('aaa'), candidate('zzz', 'never judged')])).rejects.toThrow(
    /no verdict/
  );
});

test('a string where a boolean belongs is refused rather than coerced', async () => {
  // '"safe": "false"' is truthy in JavaScript. A verdict file that says the
  // opposite of what it means is worse than a missing one.
  const j = createConsoleJudge(
    file('{"videoId":"aaa","safe":"false","learnable":true,"inScope":true,"why":"x"}')
  );
  await expect(j.judge([candidate('aaa')])).rejects.toThrow(/safe must be true or false/);
});

test('a verdict with no reason is refused', async () => {
  const j = createConsoleJudge(
    file('{"videoId":"aaa","safe":true,"learnable":true,"inScope":true,"why":"  "}')
  );
  await expect(j.judge([candidate('aaa')])).rejects.toThrow(/needs a reason/);
});

test('the same video judged twice is refused', async () => {
  const j = createConsoleJudge(file([good('aaa'), good('aaa')].join('\n')));
  await expect(j.judge([candidate('aaa')])).rejects.toThrow(/judged twice/);
});

test('blank lines and // comments are allowed, so a file can be annotated', async () => {
  const j = createConsoleJudge(file(['// week 1', '', good('aaa'), ''].join('\n')));
  await expect(j.judge([candidate('aaa')])).resolves.toHaveLength(1);
});

test('a JudgeError is what callers see, not a parse error', async () => {
  const j = createConsoleJudge(file('not json at all'));
  await expect(j.judge([candidate('aaa')])).rejects.toBeInstanceOf(JudgeError);
});
