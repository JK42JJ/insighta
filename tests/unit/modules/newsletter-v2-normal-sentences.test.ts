/**
 * The sentences the issue-1 reviewer left as written (verify-log §B) must
 * pass: caption evidence carries them, so the grade is 관측 and no hard gate
 * fires. This is the false-positive side of the §A defect suite -- a rule
 * that blocks these is wrong even if it catches every defect.
 */
import { gradeClaim, type AtomicClaimRow, type EvidenceRow } from '@/modules/newsletter/v2/grade';
import {
  publishAllowed,
  runGates,
  type ClaimRow,
  type IssueSnapshot,
} from '@/modules/newsletter/v2/gates';

const cap = (id: string, videoId: string, quoted: string): EvidenceRow => ({
  id,
  kind: 'caption',
  videoId,
  quoted,
});
// A proper noun needs the description (or a primary source) as well: captions alone never spell a name (§3.4, §D).
const desc = (id: string, videoId: string, quoted: string): EvidenceRow => ({
  id,
  kind: 'description',
  videoId,
  quoted,
});
const atomic = (
  id: string,
  kind: AtomicClaimRow['kind'],
  normalized: string,
  evidence: EvidenceRow[]
): AtomicClaimRow => ({ id, kind, text: normalized, normalized, evidence });
const fact = (id: string, text: string, atomics: AtomicClaimRow[]): ClaimRow => ({
  id,
  section: 'story',
  seq: 1,
  ctype: 'fact',
  text,
  atomics,
});

/** One row of verify-log §B each: the body claim and the caption phrase that carries it. */
const SECTION_B: ClaimRow[] = [
  fact('b1', '요약 요청에서 시작한다', [
    atomic('b1q', 'quote', 'summarize a website', [
      cap('e', 'Dsx4_kCBkbQ', "the task is we're going to summarize a website"),
    ]),
  ]),
  fact('b2', '기존 PayPal 주문은 동기식이었다', [
    atomic('b2q', 'quote', 'PayPal orders have been synchronous', [
      cap('e', 'vGn6N4-bxBY', 'historically, PayPal orders have been synchronous'),
    ]),
  ]),
  fact('b3', '환불 처리 봇은 정책을 따른다', [
    atomic('b3q', 'quote', 'handles refunds, it follows a policy', [
      cap('e', 'QSCIYtTSe6A', 'it handles refunds, it follows a policy'),
    ]),
  ]),
  fact('b4', '웨스트버지니아 주법이 DUNA 를 등록한다', [
    atomic('b4e', 'entity', 'West Virginia', [
      cap('e1', 'tE2z8-hqoLY', 'new law in the state of West Virginia'),
      desc('d1', 'tE2z8-hqoLY', 'West Virginia DUNA law'),
    ]),
    atomic('b4i', 'entity', 'DUNA', [
      cap('e2', 'tE2z8-hqoLY', 'registered your DUNA'),
      desc('d2', 'tE2z8-hqoLY', 'West Virginia DUNA law'),
    ]),
  ]),
  fact('b5', '타임아웃은 실패가 아니라 미지를 뜻한다', [
    atomic('b5q', 'quote', 'the timeout does not actually mean that a failure had occurred', [
      cap(
        'e',
        'hD9-V56FNRI',
        'the timeout does not actually mean that a failure had occurred. It means unknown'
      ),
    ]),
  ]),
  fact('b6', '더 신뢰할 수 있는 코딩 에이전트를 위한 11가지 요령', [
    atomic('b6n', 'number', '11', [
      cap('e', 'UbylWXukvR8', '11 tips and tricks to make your coding agents more reliable'),
    ]),
  ]),
  fact('b7', '전정밀도로는 54GB, VRAM 은 8GB 에서 32GB 까지', [
    atomic('b7n1', 'number', '54 GB', [
      cap('e1', '0xUxO_9zqTU', '54 GB unquantized in full precision'),
    ]),
    atomic('b7n2', 'number', '8 GB', [cap('e2', '0xUxO_9zqTU', '8 GB of VRAM up to 32 GB')]),
    atomic('b7n3', 'number', '32 GB', [cap('e2', '0xUxO_9zqTU', '8 GB of VRAM up to 32 GB')]),
  ]),
  fact('b8', '320B 모델은 16비트로 가중치만 640GB 다', [
    atomic('b8n1', 'number', '320 billion', [
      cap('e', 'JbIGopESlRU', '320 billion parameters … 640 GB for the weights if we use 16 bits'),
    ]),
    atomic('b8n2', 'number', '640 GB', [
      cap('e', 'JbIGopESlRU', '320 billion parameters … 640 GB for the weights if we use 16 bits'),
    ]),
  ]),
  fact('b9', 'Hugging Face 에는 공개 모델이 300만 개 넘게 있다', [
    atomic('b9n', 'number', '3 million', [
      cap(
        'e',
        'zf8jpD77sKY',
        'according to Hugging Face, there are over 3 million publicly available models'
      ),
    ]),
  ]),
  fact('b10', 'Intel Arc Pro B70 세 장을 Vulkan 백엔드로 96GB 안에서 돌렸다', [
    atomic('b10e', 'entity', 'B70', [
      cap('e1', '1UZbjqfdyxw', 'three Intel ArcPro B70'),
      desc('d1', '1UZbjqfdyxw', '3x Intel Arc Pro B70 with the Vulkan backend'),
    ]),
    atomic('b10v', 'entity', 'Vulkan', [
      cap('e2', '1UZbjqfdyxw', 'Vulkan backend'),
      desc('d1', '1UZbjqfdyxw', '3x Intel Arc Pro B70 with the Vulkan backend'),
    ]),
    atomic('b10n', 'number', '96 GB', [cap('e3', '1UZbjqfdyxw', 'within 96GB')]),
  ]),
  fact('b11', '위가 늘 좋은 것은 아니다', [
    atomic('b11q', 'quote', 'higher is not always better', [
      cap('e', 'rPWCYB62wvI', 'higher is not always better'),
    ]),
  ]),
];

const snapshot = (claims: ClaimRow[]): IssueSnapshot => ({
  title: '설정 파일이 먼저 실행됩니다',
  claims,
  captionedVideoIds: new Set(
    claims.flatMap((c) => c.atomics.flatMap((a) => a.evidence.map((e) => e.videoId ?? '')))
  ),
  picks: [],
});

describe('verify-log §B — sentences that were correctly left as written', () => {
  test.each(SECTION_B.map((c) => [c.id, c] as const))('%s grades 관측', (_id, claim) => {
    expect(gradeClaim(claim.atomics)).toBe('관측');
  });

  test('the content hard gates pass on the whole §B set (no false positives)', () => {
    const declared = [
      { name: 'fact-has-evidence', severity: 'block' as const },
      { name: 'grade-rules-pass', severity: 'block' as const },
      { name: 'story-no-captionless-evidence', severity: 'block' as const },
    ];
    const results = runGates(declared, snapshot(SECTION_B));
    const failed = results
      .filter((r) => !r.passed)
      .map((r) => `${r.gate}: ${JSON.stringify(r.detail)}`);
    expect(failed).toEqual([]);
    expect(publishAllowed(declared, results).allowed).toBe(true);
  });
});
