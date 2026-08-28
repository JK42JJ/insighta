/**
 * Weekly brief email — content contract.
 *
 * Two failures this guards against, both observed on the launch issue:
 *
 * 1. It shipped wearing the announcement dress (shell(): mascot GIF, pill
 *    badge, rounded cream card). A newsletter has to read as a publication,
 *    so the brief must not carry any of those marks.
 * 2. The digest dropped the noun that carried the meaning — "100만 토큰을
 *    열었습니다" with no object, and "지시문" in place of 시스템 프롬프트.
 *    Copy lives in the caller, so what is asserted here is that the builder
 *    reproduces the item text verbatim rather than reformatting it.
 */

import { buildBriefEmail, BriefEmailParams } from '../../../src/modules/email/templates';

const params = (over: Partial<BriefEmailParams> = {}): BriefEmailParams => ({
  issueLabel: '창간호',
  dateLabel: '2026.08.25',
  category: 'AI & TECHNOLOGY',
  headline: '딥시크 요금이 4.5배 올랐습니다',
  headlineMark: '4.5배',
  deck: '피크 시간대가 한국 근무시간과 겹칩니다.',
  items: [
    {
      title: '출처를 밝히지 않은 모델이 100만 토큰 컨텍스트를 열었습니다',
      deck: '운영 주체가 익명입니다.',
    },
    {
      title: '앤트로픽이 시스템 프롬프트를 5분의 1로 줄였습니다',
      deck: '800토큰에서 164토큰으로.',
    },
  ],
  stats: [
    { value: '2,714', label: '최근 7일 수집 영상' },
    { value: '336', label: '3곳 이상에서 교차 확인' },
  ],
  method: '모든 주장에 확인·관측·미확인 등급을 달았습니다.',
  readUrl: 'https://insighta.one/brief/x.html',
  readMeta: '읽는 데 11분',
  unsubscribeUrl: 'https://insighta.one/u/TOKEN',
  preview: '이번 주 2,714편에서 고른 세 편.',
  ...over,
});

describe('buildBriefEmail', () => {
  it('carries the masthead, the issue meta and the accented headline', () => {
    const { subject, html } = buildBriefEmail(params());
    expect(subject).toContain('창간호');
    expect(html).toContain('INSIGHTA&nbsp;WEEKLY');
    expect(html).toContain('AI &amp; TECHNOLOGY');
    expect(html).toContain('2026.08.25');
    // Wrapped in place: the fragment is decorated where it already sits in the
    // headline, so it must appear exactly once, not be appended a second time.
    expect(html).toContain('4.5배</span>');
    expect(html.match(/4\.5배/g)).toHaveLength(1);
  });

  it('does not wear the announcement dress', () => {
    const { html } = buildBriefEmail(params());
    expect(html).not.toContain('/emails/'); // mascot GIF
    expect(html).not.toContain('999px'); // pill badge
    expect(html).not.toContain('border-radius:18px'); // cream card outline
  });

  it('reproduces item text verbatim, numbered in running order', () => {
    const { html } = buildBriefEmail(params());
    expect(html).toContain('100만 토큰 컨텍스트를 열었습니다');
    expect(html).toContain('시스템 프롬프트를 5분의 1로 줄였습니다');
    expect(html).toContain('>01<');
    expect(html).toContain('>02<');
  });

  it('always carries an unsubscribe route', () => {
    const { html } = buildBriefEmail(params());
    expect(html).toContain('https://insighta.one/u/TOKEN');
    expect(html).toContain('수신거부');
  });

  it('escapes caller-supplied text', () => {
    const { html } = buildBriefEmail(
      params({ items: [{ title: '<script>x</script>', deck: 'a & b' }] })
    );
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('a &amp; b');
  });

  it('divides the stat row evenly however many stats are passed', () => {
    const one = buildBriefEmail(params({ stats: [{ value: '1', label: 'a' }] })).html;
    expect(one).toContain('width="100%"');
    const three = buildBriefEmail(
      params({
        stats: [
          { value: '1', label: 'a' },
          { value: '2', label: 'b' },
          { value: '3', label: 'c' },
        ],
      })
    ).html;
    expect(three).toContain('width="33%"');
  });
});
