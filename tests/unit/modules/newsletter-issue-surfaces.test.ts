/**
 * The three things the list page got wrong on the first two issues, pinned
 * at the helper each surface now goes through:
 *
 *   the label comes from the stored number, not the editor's string
 *   a card summary is prose, not markup
 *   a card always has a cover
 *
 * Plus the mail links: the CTA reaches the issue, the unsubscribe URL is the
 * token route, and the list headers are the two Gmail and Yahoo require.
 */

import { issueLabelOf } from '@/modules/newsletter/issue-label';
import { plainText } from '@/modules/newsletter/plain-text';
import { coverUrlOf, BRIEF_COVER_PATH } from '@/modules/newsletter/cover';
import {
  briefMailHeaders,
  issueCampaign,
  readUrlOf,
  unsubscribeUrlOf,
} from '@/modules/newsletter/mail-links';

describe('issueLabelOf', () => {
  it('prints the stored number, so two rows cannot both say 제1호', () => {
    expect(issueLabelOf(1)).toBe('제1호');
    expect(issueLabelOf(2)).toBe('제2호');
    expect(issueLabelOf(0)).toBe('제0호');
  });

  it('prints an English edition its own way', () => {
    expect(issueLabelOf(3, 'en')).toBe('No. 3');
  });
});

describe('plainText', () => {
  it('drops the emphasis the page renders', () => {
    expect(plainText('요금이 <strong>3.96달러</strong>로 올랐다.')).toBe('요금이 3.96달러로 올랐다.');
  });

  it('decodes the entities the markup left behind', () => {
    expect(plainText('A &amp; B &lt;C&gt; &quot;D&quot; &#39;E&#39;&nbsp;F')).toBe(
      'A & B <C> "D" \'E\' F'
    );
  });

  it('collapses whitespace and trims', () => {
    expect(plainText('  a\n\n  <em>b</em>   c  ')).toBe('a b c');
  });

  it('leaves prose alone', () => {
    expect(plainText('그대로')).toBe('그대로');
  });
});

describe('coverUrlOf', () => {
  it('uses the lead pick when there is one', () => {
    expect(coverUrlOf('1IbrFrdll4U', 'ai-tech')).toBe(
      'https://i.ytimg.com/vi/1IbrFrdll4U/hqdefault.jpg'
    );
  });

  it('falls back to the category cover, never to nothing', () => {
    expect(coverUrlOf(null, 'ai-tech')).toBe(`${BRIEF_COVER_PATH}/ai-tech.svg`);
    expect(coverUrlOf(undefined, 'dev')).toBe(`${BRIEF_COVER_PATH}/dev.svg`);
    expect(coverUrlOf('', 'dev')).toBe(`${BRIEF_COVER_PATH}/dev.svg`);
  });
});

describe('mail links', () => {
  it('sends the CTA to the issue page, not the category', () => {
    expect(readUrlOf('2026-09-02-ai-tech')).toBe('https://insighta.one/brief/2026-09-02-ai-tech');
  });

  it('points unsubscribe at the token route, which needs no login', () => {
    expect(unsubscribeUrlOf('abc')).toBe('https://insighta.one/api/v1/u/abc');
  });

  it('carries both list headers, with the URL in angle brackets', () => {
    const h = briefMailHeaders('https://insighta.one/api/v1/u/abc');
    expect(h['List-Unsubscribe']).toBe('<https://insighta.one/api/v1/u/abc>');
    expect(h['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });

  it('keys the ledger per issue', () => {
    expect(issueCampaign('2026-09-02-ai-tech')).toBe('brief:2026-09-02-ai-tech');
  });
});
