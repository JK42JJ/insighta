/**
 * The nine factual defects a reviewer found by hand in the first issue
 * (cc-newsletter-handoff 07-issue1-verify-log.md §A, plus §C/§D/§E) must be
 * caught by the grade rules or the hard gates before publication. Each case
 * below is one row of that log, expressed as the claim and evidence the
 * pipeline would have stored.
 */
import {
  gradeClaim,
  normalizeNumber,
  numbersMatch,
  type AtomicClaimRow,
  type EvidenceRow,
} from '@/modules/newsletter/v2/grade';
import {
  HARD_GATES,
  SOFT_GATES,
  publishAllowed,
  runGates,
  type ClaimRow,
  type IssueSnapshot,
} from '@/modules/newsletter/v2/gates';

const cap = (
  id: string,
  videoId: string,
  quoted: string,
  extra: Partial<EvidenceRow> = {}
): EvidenceRow => ({ id, kind: 'caption', videoId, quoted, ...extra });
const desc = (id: string, videoId: string, quoted: string): EvidenceRow => ({
  id,
  kind: 'description',
  videoId,
  quoted,
});
const primary = (id: string, url: string, quoted: string, ok = true): EvidenceRow => ({
  id,
  kind: 'primary',
  url,
  quoted,
  httpStatus: ok ? 200 : 404,
  fetchedAt: ok ? '2026-09-05T00:00:00Z' : null,
});
const atomic = (
  id: string,
  kind: AtomicClaimRow['kind'],
  normalized: string,
  evidence: EvidenceRow[]
): AtomicClaimRow => ({ id, kind, text: normalized, normalized, evidence });
const fact = (
  id: string,
  text: string,
  atomics: AtomicClaimRow[],
  section = 'story'
): ClaimRow => ({ id, section, seq: 1, ctype: 'fact', text, atomics });

const hg = (name: string) => {
  const g = HARD_GATES[name];
  if (!g) throw new Error(`no hard gate ${name}`);
  return g;
};
const sg = (name: string) => {
  const g = SOFT_GATES[name];
  if (!g) throw new Error(`no soft gate ${name}`);
  return g;
};

const snapshot = (claims: ClaimRow[], over: Partial<IssueSnapshot> = {}): IssueSnapshot => ({
  title: '설정 파일이 먼저 실행됩니다',
  claims,
  captionedVideoIds: new Set([
    'QSCIYtTSe6A',
    '32nrHU6zHU8',
    'G7cgLjZtmMU',
    'tE2z8-hqoLY',
    'Dsx4_kCBkbQ',
    '1IbrFrdll4U',
  ]),
  picks: [],
  ...over,
});

describe('number normalization (§3.4, research memo #2)', () => {
  test('separators and units', () => {
    expect(normalizeNumber('62,847')?.value).toBe(62847);
    expect(normalizeNumber('$5.1k')?.value).toBe(5100);
    expect(normalizeNumber('54 GB')?.value).toBe(54);
  });
  test('approximation tolerates 5%, exact does not', () => {
    expect(numbersMatch('5,000달러쯤', '$5,100')).toBe(true);
    expect(numbersMatch('5,000달러', '$5,100')).toBe(false);
    expect(numbersMatch('62847', '628407')).toBe(false);
  });
});

describe('verify-log §A — the nine defects', () => {
  test('A1 LufSec: "다섯 가지" came from the judge note, caption says three', () => {
    // The judge's reason can never be evidence (kind constraint); the only real source disagrees.
    const c = fact('a1', '다섯 가지 방법으로 깨뜨렸다', [
      atomic('a1n', 'number', '5', [
        cap('e', 'QSCIYtTSe6A', 'three different ways, each one worse than the last'),
      ]),
    ]);
    expect(gradeClaim(c.atomics)).toBe('미확인');
    expect(hg('grade-rules-pass')(snapshot([c])).passed).toBe(false);
  });
  test('A2 LufSec: paraphrase that drops the quoted phrase', () => {
    const c = fact('a2', '보호하라고 지시받은 내부 코드 유출', [
      atomic('a2q', 'quote', '보호하라고 지시받은 내부 코드', [
        cap('e', 'QSCIYtTSe6A', 'staff override code … told never to reveal'),
      ]),
    ]);
    expect(gradeClaim(c.atomics)).toBe('미확인');
  });
  test('A3 Navan: "2주 뒤" exists only in the description, not in the caption', () => {
    const c = fact('a3', '지시가 2주 뒤에 실행된다', [
      atomic('a3n', 'number', '2', [
        desc('d', '32nrHU6zHU8', 'the agent books the flight two weeks later'),
        cap(
          'c',
          '32nrHU6zHU8',
          'book me a flight whenever it is cheaper than $200 … is it me making this purchase or is it agent'
        ),
      ]),
    ]);
    expect(gradeClaim(c.atomics)).toBe('미확인');
  });
  test('A4 Best Buy: claim wording not carried by the caption', () => {
    const c = fact('a4', '같은 SKU를 하나 더 담으면', [
      atomic('a4q', 'quote', '같은 SKU', [
        cap(
          'e',
          'G7cgLjZtmMU',
          'adding a second quantity … to us merchants, that is a second line item'
        ),
      ]),
    ]);
    expect(gradeClaim(c.atomics)).toBe('미확인');
  });
  test('A5 Levine: organization number disagrees between caption and description', () => {
    const c = fact('a5', '조직번호 62847로 등록됐다', [
      atomic('a5n', 'number', '62847', [
        desc('d', 'tE2z8-hqoLY', 'registered as organization 62847'),
        cap('c', 'tE2z8-hqoLY', 'organization number 628407'),
      ]),
    ]);
    expect(gradeClaim(c.atomics)).toBe('미확인');
    expect(hg('grade-rules-pass')(snapshot([c])).detail).toMatchObject({
      unverified: [{ id: 'a5' }],
    });
  });
  test('A6 Embrace The Red: caption-backed mechanism is 관측, never 확인 without a primary source', () => {
    const c = fact('a6', '페이지 지시가 WebFetch를 curl로 바꿨다', [
      atomic('a6e', 'event', 'WebFetch curl', [
        cap('e', 'Dsx4_kCBkbQ', 'server returned 415 to WebFetch so Claude used curl'),
      ]),
    ]);
    expect(gradeClaim(c.atomics)).toBe('관측');
    const marked = { ...c, grade: '확인' as const };
    expect(hg('confirmed-primary-2xx')(snapshot([marked])).passed).toBe(false);
  });
  test('A7/A8 Munaf, PayPal: sentences with caption evidence pass as 관측', () => {
    const c7 = fact('a7', '승인은 행위·시각·행위자·만료에 묶인다', [
      atomic('a7q', 'quote', 'tied to action, timestamp, actor and expiration', [
        cap('e', 'hD9-V56FNRI', 'approval … tied to action, timestamp, actor and expiration'),
      ]),
    ]);
    const c8 = fact('a8', 'JSON에 금액·만료·판매자가 들어간다', [
      atomic('a8q', 'quote', 'the amount, the expiry, the merchant', [
        cap('e', 'vGn6N4-bxBY', 'includes the amount, the expiry, the merchant'),
      ]),
    ]);
    expect(gradeClaim(c7.atomics)).toBe('관측');
    expect(gradeClaim(c8.atomics)).toBe('관측');
  });
  test('A9 Check Point: the [영상] marker must not survive into the body', () => {
    const c = fact('a9', 'Anthropic이 두 차례 패치했다 (1IbrFrdll4U) [영상]', [
      atomic('a9e', 'event', 'patch it twice', [
        cap(
          'e',
          '1IbrFrdll4U',
          'they had to patch it twice … the RCE portion was like February of 2026'
        ),
      ]),
    ]);
    expect(hg('no-raw-markers')(snapshot([c])).passed).toBe(false);
  });
});

describe('verify-log §C/§D/§E', () => {
  test('§C: a story sentence citing a video without captions is blocked', () => {
    const c = fact('c1', 'Ask AI 버튼 링크의 사전 채움 프롬프트', [
      atomic('c1e', 'event', 'prefilled prompt', [
        desc('d', 'eJmF3U0XpyI', 'the Ask AI button link carries a prefilled prompt'),
      ]),
    ]);
    expect(hg('story-no-captionless-evidence')(snapshot([c])).passed).toBe(false);
    expect(hg('story-no-captionless-evidence')(snapshot([{ ...c, section: 'picks' }])).passed).toBe(
      true
    );
  });
  test('§D: a proper noun spelled only by the caption cannot be an observation', () => {
    const c = fact('d1', 'Check Point의 Adam Forrester가 발표했다', [
      atomic('d1p', 'entity', 'Adam Forrester', [
        cap('c', '1IbrFrdll4U', 'adam forrester from check point'),
      ]),
    ]);
    expect(gradeClaim(c.atomics)).toBe('미확인');
    const withDesc = fact('d2', 'Check Point의 Adam Forester가 발표했다', [
      atomic('d2p', 'entity', 'Adam Forester', [
        desc('d', '1IbrFrdll4U', 'Speaker: Adam Forester, Check Point Research'),
        cap('c', '1IbrFrdll4U', 'adam forester from check point'),
      ]),
    ]);
    expect(gradeClaim(withDesc.atomics)).toBe('관측');
  });
  test('§E: [확인] without a fetched primary source is blocked; with one it is 확인', () => {
    const unfetched = fact('e1', 'CVE-2025-59536이 패치됐다', [
      atomic('e1n', 'number', '2025-59536', [
        primary('p', 'https://nvd.nist.gov/vuln/detail/CVE-2025-59536', '', false),
      ]),
    ]);
    expect(gradeClaim(unfetched.atomics)).toBe('미확인');
    const fetched = fact('e2', 'CVE-2025-59536이 패치됐다', [
      atomic('e2n', 'number', '2025-59536', [
        primary(
          'p',
          'https://nvd.nist.gov/vuln/detail/CVE-2025-59536',
          'CVE-2025-59536 Detail … fixed in 1.0.90'
        ),
      ]),
    ]);
    expect(gradeClaim(fetched.atomics)).toBe('확인');
    expect(hg('confirmed-primary-2xx')(snapshot([fetched])).passed).toBe(true);
  });
});

describe('gate runner', () => {
  const declared = [
    { name: 'fact-has-evidence', severity: 'block' as const },
    { name: 'grade-rules-pass', severity: 'block' as const },
    { name: 'no-raw-markers', severity: 'block' as const },
    { name: 'footnotes-contiguous', severity: 'block' as const },
    { name: 'picks-match-db', severity: 'block' as const },
    { name: 'judgment-count', severity: 'warn' as const },
    { name: 'a-gate-nobody-wrote', severity: 'block' as const },
  ];
  test('a declared gate without an implementation fails, and an unrun block gate blocks publish', () => {
    const results = runGates(
      declared,
      snapshot([], { renderedBody: 'x[1] y[2]', picks: [], picksInDb: [] })
    );
    expect(results.find((r) => r.gate === 'a-gate-nobody-wrote')?.passed).toBe(false);
    const verdict = publishAllowed(declared, results);
    expect(verdict.allowed).toBe(false);
    expect(verdict.blocking).toEqual(
      expect.arrayContaining(['a-gate-nobody-wrote', 'picks-match-db'])
    );
  });
  test('footnotes must be contiguous; picks must equal the database rows and count five', () => {
    expect(hg('footnotes-contiguous')(snapshot([], { renderedBody: 'a[1] b[3]' })).passed).toBe(
      false
    );
    expect(
      hg('footnotes-contiguous')(snapshot([], { renderedBody: 'a[1] b[2] c[2]' })).passed
    ).toBe(true);
    const pick = (i: number) => ({ videoId: `id${i}`, title: `t${i}`, channel: 'c', views: i });
    const five = [1, 2, 3, 4, 5].map(pick);
    expect(hg('picks-match-db')(snapshot([], { picks: five, picksInDb: five })).passed).toBe(true);
    expect(
      hg('picks-match-db')(
        snapshot([], { picks: five, picksInDb: [...five.slice(0, 4), { ...pick(5), views: 99 }] })
      ).passed
    ).toBe(false);
  });
  test('soft gates warn on banned phrases, dashed titles and more than three judgments', () => {
    const j = (i: number): ClaimRow => ({
      id: `j${i}`,
      section: 'story',
      seq: i,
      ctype: 'judgment',
      text: `판단 ${i}이다.`,
      atomics: [],
    });
    const s = snapshot(
      [j(1), j(2), j(3), j(4), { ...j(5), ctype: 'explain', text: '결국 핵심은 비용이다.' }],
      { title: '사고는 대화창 밖에서 났다 — 신뢰 확인보다 먼저 도는 파일' }
    );
    expect(sg('judgment-count')(s).passed).toBe(false);
    expect(sg('banned-phrases')(s).passed).toBe(false);
    expect(sg('title-shape')(s).passed).toBe(false);
  });
});
