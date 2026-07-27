/**
 * Guard on the judging prompt's finance carve-out.
 *
 * The first 300-row backfill on prod marked an entire legitimate domain unsafe:
 * `가치투자101`, `배당 etf 미국`, `부동산 투자 기초` all came back
 * "investment solicitation". Studying how investing works is not soliciting it,
 * and losing personal finance as a curation subject is a large hole.
 *
 * The fix is a paragraph of prompt, which nothing else would notice going
 * missing. This reads the source the same way api-url-contract.test.ts does —
 * it cannot check what the model concludes, only that the instruction is still
 * there to be followed.
 */

import * as fs from 'fs';
import * as path from 'path';

const SRC = path.resolve(__dirname, '../../src/modules/curation/topic-judge.ts');

describe('topic-judge prompt', () => {
  const prompt = fs.readFileSync(SRC, 'utf-8');

  it('says studying a field is not soliciting it', () => {
    expect(prompt).toContain('Studying a field is not soliciting it');
  });

  it.each(['Investing', 'personal finance', 'real estate', 'dividend ETFs'])(
    'names %s as an ordinary subject',
    (term) => {
      expect(prompt).toContain(term);
    }
  );

  it('still restricts unsafe finance to an actual pitch', () => {
    // the narrow definition is what keeps the carve-out from swallowing the rule
    expect(prompt).toMatch(/a particular ticker to buy now|guaranteed return|get-rich scheme/);
  });

  it('keeps the reporting/documentary carve-out for the other categories', () => {
    expect(prompt.replace(/\s+/g, ' ')).toContain(
      'naming a social problem is\nnot promoting it'.replace(/\s+/g, ' ')
    );
  });
});
