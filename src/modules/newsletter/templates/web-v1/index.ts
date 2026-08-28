/**
 * web-v1 -- the ledger treatment.
 *
 * Design by Claude Design (2026-08-26). This file only fills the slots the
 * design left; it does not decide how anything looks. When the design is
 * improved, add templates/web-v2/ and change the default. Never edit this.
 *
 * Six components, fixed: masthead, stage header, ledger, funnel, story, rows.
 * `rows` is shared by actions, picks, vocabulary and checkpoints -- one row
 * grammar rather than four. The previous page carried fifteen components and
 * read as a one-off showpiece rather than something printed every week.
 */

import type {
  IssueDocument,
  Block,
  LedgerRow,
  Story,
  Term,
  Pick,
  WhenItem,
  Ref,
  Grade,
} from '../../issue-schema';
import { WEB_V1_CSS } from './styles';

export const TEMPLATE_ID = 'web-v1';

/**
 * The deliverable pulled Pretendard from a third-party CDN. Dropped: it is an
 * external dependency on every page view, and a strict CSP blocks it outright.
 * Pretendard still leads the stack so installed users get it; Noto Sans KR is
 * the loaded fallback because Google Fonts is the one host that survives a CSP.
 * A visible change on machines without Pretendard -- flagged, not disguised.
 */
const FONT_LINKS = [
  '<link rel="preconnect" href="https://fonts.googleapis.com">',
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
  '<link href="https://fonts.googleapis.com/css2?' +
    'family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,560;1,6..72,400' +
    '&family=Spline+Sans+Mono:wght@400;500;600' +
    '&family=Noto+Sans+KR:wght@400;500;600' +
    '&display=swap" rel="stylesheet">',
].join('\n');

const GRADE_LABEL: Record<Grade, string> = {
  verified: '확인',
  observed: '관측',
  unconfirmed: '미확인',
};
const GRADE_CLASS: Record<Grade, string> = {
  verified: 'v',
  observed: 'o',
  unconfirmed: 'u',
};

function esc(s: string): string {
  return String(s).replace(
    /[<>&"]/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c] as string
  );
}

/**
 * Block bodies arrive as HTML because a claim carries inline emphasis and
 * grade chips mid-sentence. Only the tags the design uses survive; anything
 * else is escaped, so an issue author cannot introduce a script or a style
 * through the content path.
 */
const ALLOWED = /<(\/?)(strong|b|em|i|span|sup|br)((?:\s+class="[a-z0-9 _-]*")?)\s*\/?>/gi;
/**
 * Placeholders are NUL-delimited, not space-delimited, and that is load
 * bearing. A space-delimited index collides with the copy: this brief is full
 * of bare numbers between spaces ("8월 16 일", "2월 6 일"), and each one would
 * be read back as a stash index and replaced with nothing -- silently deleting
 * figures from a page whose entire claim is that its figures are checked.
 * NUL cannot appear in issue text and esc() never emits it.
 */
const STASH = '\u0000';

function richText(html: string): string {
  const kept: string[] = [];
  const stashed = html.replace(ALLOWED, (m) => {
    kept.push(m);
    return `${STASH}${kept.length - 1}${STASH}`;
  });
  return esc(stashed).replace(
    new RegExp(`${STASH}(\\d+)${STASH}`, 'g'),
    (_m, i: string) => kept[Number(i)] ?? ''
  );
}

function gradeChip(grade: Grade, ref?: number): string {
  const chip = `<span class="g ${GRADE_CLASS[grade]}">${GRADE_LABEL[grade]}</span>`;
  return ref === undefined ? chip : `${chip}<sup class="ref">${ref}</sup>`;
}

const STAGE_NAMES = [
  '01 Interest',
  '02 Brief',
  '03 Insight',
  '04 Vocabulary',
  '05 Picks',
  '06 Next',
];

function tape(doc: IssueDocument): string {
  return `<nav class="tape" aria-label="이번 호 차례">
  <b>${esc(doc.issueLabel)}</b><span>·</span>
  ${STAGE_NAMES.map((s) => `<span>${s}</span>`).join('')}
</nav>`;
}

function masthead(doc: IssueDocument): string {
  return `<header class="mast">
  <div class="kolophon"><b>INSIGHTA</b><span>주간 브리프 · ${esc(doc.issueLabel)} · ${esc(doc.dateLabel)}</span></div>
  <h1>${doc.headline.map(esc).join('<br>')}</h1>
  <p class="dek">${richText(doc.dek)}</p>
  <p class="runline">${esc(doc.runline)}</p>
</header>`;
}

function stageBar(no: string, name: string, sub: string): string {
  return (
    `<div class="stage-bar"><span class="stage-no">${no}</span>` +
    `<span class="stage-name">${name}</span><span class="stage-sub">${esc(sub)}</span></div>`
  );
}

function ledgerRow(r: LedgerRow): string {
  const cls = r.emphasis === 'none' ? '' : ` class="${r.emphasis}"`;
  const sub = r.sub ? `<i>${esc(r.sub)}</i>` : '';
  return (
    `<div class="led-row"><div><div class="led-name">${esc(r.name)}${gradeChip(r.grade, r.ref)}</div>` +
    `<div class="led-desc">${esc(r.desc)}</div></div>` +
    `<div class="led-val"><b${cls}>${esc(r.value)}</b>${sub}</div></div>`
  );
}

function block(b: Block): string {
  switch (b.type) {
    case 'p':
      return `<p>${richText(b.html)}</p>`;
    case 'lede':
      return `<p class="lede">${richText(b.html)}</p>`;
    case 'h3':
      return `<h3>${esc(b.text)}</h3>`;
    case 'note':
      return (
        `<div class="note${b.variant === 'warn' ? ' warn' : ''}">` +
        `<b>${esc(b.lead)}</b> ${richText(b.html)}</div>`
      );
    case 'table': {
      const fig = b.figref ? `<p class="figref">${esc(b.figref)}</p>` : '';
      const head = b.head.map((h, i) => `<th${i > 0 ? ' class="n"' : ''}>${esc(h)}</th>`).join('');
      const body = b.rows
        .map(
          (row) =>
            `<tr>${row
              .map((cell, i) => `<td${i > 0 ? ' class="n"' : ''}>${esc(cell)}</td>`)
              .join('')}</tr>`
        )
        .join('');
      return `${fig}<table class="tbl"><tr>${head}</tr>${body}</table>`;
    }
  }
}

function story(s: Story, index: number): string {
  const no = String(index + 1).padStart(2, '0');
  return `<article class="story">
    <div class="kicker"><span class="n">${no}</span> ${esc(s.kicker)}</div>
    <h2>${esc(s.title)}</h2>
    ${s.blocks.map(block).join('\n    ')}
  </article>`;
}

/**
 * The funnel is drawn from counts, not from a hand-placed grid: the buckets
 * change size every week and a fixed cell list would silently misreport them.
 */
function funnel(f: NonNullable<IssueDocument['interest']['funnel']>): string {
  const swatch: Record<string, string> = {
    form: '#DCDBD3',
    rule: '#B9B6A9',
    solo: '#8894A6',
    cross: 'var(--verified)',
  };
  const cells = f.buckets
    .map((b) => `<i class="c ${b.key[0]}"></i>`.repeat(Math.round(b.count / f.perCell)))
    .join('');
  const legend = f.buckets
    .map(
      (b) =>
        `<div class="lg"><i class="sw" style="background:${swatch[b.key]}"></i>` +
        `<span><em>${b.count.toLocaleString('en-US')}</em>${esc(b.label)}</span></div>`
    )
    .join('');
  return `<p class="figref">${esc(f.figref)}</p>
  <div class="panel">
    <div class="waffle" aria-hidden="true">${cells}</div>
    <div class="legend">${legend}</div>
    <p class="cap">${esc(f.caption)}</p>
  </div>`;
}

function whenRows(items: WhenItem[]): string {
  if (items.length === 0) return '';
  return `<div class="rows">${items
    .map(
      (i) =>
        `<div class="item"><div class="item-h"><span class="item-when">${esc(i.when)}</span>` +
        `<div class="item-title">${esc(i.title)}</div></div></div>`
    )
    .join('')}</div>`;
}

function termRows(terms: Term[]): string {
  if (terms.length === 0) return '';
  return `<div class="rows">${terms
    .map(
      (t) =>
        `<div class="item"><div class="term-word">${esc(t.word)}` +
        (t.en ? `<span class="en">${esc(t.en)}</span>` : '') +
        `</div><div class="item-body">${esc(t.body)}</div>` +
        `<div class="term-use">${esc(t.use)}</div></div>`
    )
    .join('')}</div>`;
}

function pickRows(picks: Pick[]): string {
  if (picks.length === 0) return '';
  return `<div class="rows">${picks
    .map(
      (p) =>
        `<div class="item"><div class="item-title">` +
        (p.latin ? `<span class="en">${esc(p.title)}</span>` : esc(p.title)) +
        `</div><div class="item-meta">${esc(p.meta)}</div>` +
        `<div class="item-body">${esc(p.body)}</div></div>`
    )
    .join('')}</div>`;
}

function refList(refs: Ref[]): string {
  if (refs.length === 0) return '';
  const items = refs
    .map((r) => {
      const srcs = r.sources
        .map((s) => (s.url ? `<a href="${esc(s.url)}">${esc(s.name)}</a>` : esc(s.name)))
        .join(', ');
      return `<li><b>${esc(r.label)}</b> — ${srcs}</li>`;
    })
    .join('');
  return `<p class="figref" style="margin-top:24px">이번 호 1차 출처</p>
  <ol class="srclist">${items}</ol>`;
}

export function render(doc: IssueDocument): string {
  const title = `${doc.category} 주간 브리프 · ${doc.issueLabel}`;
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(doc.preview)}">
<meta property="og:title" content="${esc(doc.headline.join(' '))}">
<meta property="og:description" content="${esc(doc.preview)}">
<meta property="og:type" content="article">
${FONT_LINKS}
<style>${WEB_V1_CSS}</style>
</head>
<body>

${tape(doc)}

<div class="wrap">

${masthead(doc)}

<section class="stage">
  ${stageBar('01', 'Interest', '이번 주 확인한 수치와 근거')}
  <p style="margin-top:22px">${richText(doc.interest.intro)}</p>
  <p class="led-cap">${esc(doc.interest.ledgerCaption)}</p>
  <div class="ledger">${doc.interest.ledger.map(ledgerRow).join('')}</div>
  ${doc.interest.funnel ? funnel(doc.interest.funnel) : ''}
</section>

<section class="stage">
  ${stageBar('02', 'Brief', '이번 주 있었던 일')}
  ${doc.stories.map(story).join('\n  ')}
</section>

<section class="stage">
  ${stageBar('03', 'Insight', '종합하면')}
  ${doc.insight.blocks.map(block).join('\n  ')}
  ${whenRows(doc.insight.actions)}
</section>

<section class="stage">
  ${stageBar('04', 'Vocabulary', '회의·면접에서 그대로 쓸 설명')}
  ${termRows(doc.vocabulary)}
</section>

<section class="stage">
  ${stageBar('05', 'Picks', '이번 주 고른 영상')}
  ${pickRows(doc.picks)}
</section>

<section class="stage">
  ${stageBar('06', 'Next', '다음 호에서 답을 적습니다')}
  <p style="margin-top:20px">${esc(doc.next.intro)}</p>
  ${whenRows(doc.next.checkpoints)}
</section>

<div class="foot">
  ${richText(doc.gradeNote)}
  ${refList(doc.refs)}
  <p class="editnote">${richText(doc.editNote)}</p>
  <p class="sign">${esc(doc.sign)}</p>
</div>

</div>
</body>
</html>`;
}
