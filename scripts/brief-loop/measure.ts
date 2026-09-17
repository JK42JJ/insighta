/**
 * 브리프 자립 루프 — 점수판 측정기.
 *
 * 측정만 한다. 아무것도 고치지 않는다. 이 파일과 tests/brief/ 의 고정 입력은
 * 루프의 빌더가 수정할 수 없다 — 시험을 고쳐 점수를 올리는 것이 유일한 실격 사유다.
 *
 * 재지 못하는 축은 0 이 아니라 not-measurable 로 적는다. 0 으로 적으면 "고쳤다"가
 * 측정 가능해졌다는 뜻인지 실제로 나아졌다는 뜻인지 구분되지 않는다.
 *
 * 사용: npx tsx scripts/brief-loop/measure.ts [--out tests/brief/state/scoreboard.json]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { IssueDocumentSchema, findUngroundedClaims } from '@/modules/newsletter/issue-schema';
import type { IssueDocument } from '@/modules/newsletter/issue-schema';
import { runPublishGates } from '@/modules/newsletter/publish-gates';
import { missingNavLabel } from '@/modules/newsletter/publish-gate';
import { runDocumentChecks } from '@/modules/newsletter/v2/doc-checks';

const ROOT = resolve(__dirname, '../..');
const IN = (f: string): string => resolve(ROOT, 'tests/brief/input', f);
/** Derived numbers the issue declares. Absent until an issue ships one. */
const CALC_PATH = resolve(ROOT, 'tests/brief/input/calculations.json');

type Axis = {
  value: number | string | null;
  pass: boolean;
  status: 'measured' | 'not-measurable';
  note: string;
};

const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o)) as T;

/** tests/brief/contamination.jsonl 의 경로 표기를 따라가 값을 바꾼다. */
interface Poison {
  id: string;
  kind: string;
  why: string;
  path: string;
  op: 'replace' | 'set' | 'delete' | 'append';
  from?: string;
  to?: string | number;
  expect: string;
}

function applyPoison(doc: IssueDocument, p: Poison): IssueDocument {
  const next = clone(doc);
  const parts = p.path.split('.');
  const last = parts.pop() as string;
  let cur: Record<string, unknown> = next as unknown as Record<string, unknown>;
  for (const seg of parts) cur = cur[seg] as Record<string, unknown>;
  if (p.op === 'delete') delete cur[last];
  else if (p.op === 'set') cur[last] = p.to;
  else if (p.op === 'append') cur[last] = String(cur[last]) + String(p.to);
  else cur[last] = String(cur[last]).replace(String(p.from), String(p.to));
  return next;
}

/** 지금 동원할 수 있는 모든 검사를 한 문서에 돌리고 잡힌 사유를 모은다. */
async function detect(doc: unknown): Promise<string[]> {
  const found: string[] = [];
  const parsed = IssueDocumentSchema.safeParse(doc);
  if (!parsed.success) {
    found.push(`schema: ${parsed.error.issues[0]?.path.join('.')}`);
    return found;
  }
  const d = parsed.data;
  for (const u of findUngroundedClaims(d)) found.push(`ungrounded: ${u}`);
  const nav = missingNavLabel(d);
  if (nav) found.push(`navLabel: ${nav}`);
  const gates = await runPublishGates(d);
  for (const f of gates.failures) found.push(`${f.gate}: ${f.where}`);

  // 깔때기 — 고정 입력의 실측과 대조
  const truth = JSON.parse(readFileSync(IN('funnel.json'), 'utf8')) as {
    funnel: { buckets: Array<{ key: string; count: number }> };
  };
  for (const b of d.interest.funnel?.buckets ?? []) {
    const real = truth.funnel.buckets.find((x) => x.key === b.key);
    if (real && real.count !== b.count) found.push(`funnel: ${b.key} ${b.count} ≠ ${real.count}`);
  }

  // 문서 대 재료 — src/modules/newsletter/v2/doc-checks.ts 가 판정한다.
  // 검출 로직을 이 하네스에 두지 않는 이유: 하네스는 재기만 하고, 잡는 것은
  // 제품 코드가 해야 매 초안에서도 같은 판정이 나온다.
  const calcs = existsSync(CALC_PATH)
    ? (JSON.parse(readFileSync(CALC_PATH, 'utf8')) as Parameters<typeof runDocumentChecks>[2])
    : [];
  for (const f of runDocumentChecks(d, { factsText: readFileSync(IN('facts.md'), 'utf8'), funnelBuckets: truth.funnel.buckets }, calcs))
    found.push(`${f.check}: ${f.where} — ${f.detail}`);

  return found;
}

async function main(): Promise<void> {
  const base = JSON.parse(readFileSync(IN('issue2-handmade.json'), 'utf8')) as IssueDocument;
  const poisons = readFileSync(resolve(ROOT, 'tests/brief/contamination.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as Poison);

  // T5 — 오염 차단
  const cleanFindings = await detect(base);
  const caught: string[] = [];
  const missed: Array<{ id: string; kind: string; expect: string }> = [];
  // A poison that does not change the document is a broken fixture, not a
  // missed detection. Counting it as missed hides the breakage and makes the
  // score look worse for the wrong reason; counting it as caught would hide it
  // and make the score look better. It gets its own bucket.
  const invalid: Array<{ id: string; path: string }> = [];
  for (const p of poisons) {
    const mutated = applyPoison(base, p);
    if (JSON.stringify(mutated) === JSON.stringify(base)) {
      invalid.push({ id: p.id, path: p.path });
      continue;
    }
    const findings = await detect(mutated);
    const isNew = findings.some((f) => !cleanFindings.includes(f));
    if (isNew) caught.push(p.id);
    else missed.push({ id: p.id, kind: p.kind, expect: p.expect });
  }

  // T1 — 자립: 파이프라인 산출물과 발행본의 거리.
  // 지금 S7 은 본문 자리를 [[EDITOR]] 로 낸다. 사람 문장이 100% 다.
  const draftLite = resolve(ROOT, 'tests/brief/input/draft-lite.json');
  const t1Note = existsSync(draftLite)
    ? 'S7 산출물과 대조 가능'
    : 'S7 이 본문을 [[EDITOR]] 자리표시자로 낸다 — 발행본의 본문 전량이 사람/에이전트 문장';

  const axes: Record<string, Axis> = {
    T1_자립: { value: 0, pass: false, status: 'measured', note: t1Note },
    T2_멱등: {
      value: null, pass: false, status: 'not-measurable',
      note: '파이프라인 2회 실행 대조 하네스 없음. S0~S2 는 쿼터를 쓰므로 고정 입력에서 S3+ 만 재실행하는 경로가 필요',
    },
    T3_재진입: {
      value: null, pass: false, status: 'not-measurable',
      note: '중단·재개 시험 하네스 없음. newsletter_pipeline_steps 의 unique(run_id,stage) 가 토대',
    },
    T4_근거: {
      value: null, pass: false, status: 'not-measurable',
      note: 'Claim 레코드가 DB 에 없음 — nl_claim / nl_evidence 테이블 미존재. v2/grade.ts 로직은 있으나 저장소가 없다',
    },
    T5_오염차단: {
      value: `${caught.length}/${poisons.length}`,
      pass: caught.length === poisons.length,
      status: 'measured',
      note:
        (missed.length ? `놓친 것: ${missed.map((m) => `${m.id}(${m.kind})`).join(', ')}` : '전건 검출') +
        (invalid.length ? ` | 문서를 바꾸지 못한 오염(픽스처 결함): ${invalid.map((i) => i.id).join(', ')}` : ''),
    },
    T6_가독성: {
      value: null, pass: false, status: 'not-measurable',
      note: '읽기 검수 에이전트를 루프가 호출하는 경로 없음. 루브릭은 고정됨',
    },
    T7_사람시간: {
      value: null, pass: false, status: 'not-measurable',
      note: '주장 심사 화면 없음 — 잴 대상이 없다',
    },
    T8_발행: {
      value: null, pass: false, status: 'not-measurable',
      note: '드래프트 등록은 관리자 계정 권한이 필요. 현재 로그인 계정은 is_super_admin 아님',
    },
  };

  const board = {
    measuredAt: new Date().toISOString(),
    round: 0,
    inputSha: readFileSync(resolve(ROOT, 'tests/brief/input.sha256'), 'utf8').trim().split('\n').length,
    axes,
    detail: { t5: { caught, missed, invalid, cleanFindings } },
  };

  const outArg = process.argv.indexOf('--out');
  const out = outArg > -1 ? process.argv[outArg + 1]! : 'tests/brief/state/scoreboard.json';
  writeFileSync(resolve(ROOT, out), JSON.stringify(board, null, 2));

  console.log(`측정 시각 ${board.measuredAt}`);
  for (const [k, a] of Object.entries(axes)) {
    const mark = a.pass ? 'PASS' : a.status === 'measured' ? 'FAIL' : '미측정';
    console.log(`${k.padEnd(14)} ${String(a.value ?? '-').padEnd(8)} ${mark.padEnd(6)} ${a.note}`);
  }
  console.log(`\n깨끗한 문서에서 이미 잡히는 것 ${cleanFindings.length}건`);
  if (missed.length) {
    console.log('\n놓친 오염:');
    for (const m of missed) console.log(`  ${m.id} ${m.kind} — 기대한 게이트: ${m.expect}`);
  }
}

void main();
