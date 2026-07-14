/**
 * Transactional email HTML builders (CP516) — pure, dependency-free so the same
 * markup renders in prod (transactional.ts) and the sample tool. Faithful to the
 * approved simple-cute mockup: cream card + bold outline + pill + PNG mascot,
 * on a clean white outer background (no beige backdrop). Email-safe: inline CSS,
 * table layout, hosted PNG mascot (Gmail strips inline SVG), no emoji.
 */

const SITE_ORIGIN = 'https://insighta.one';
const INK = '#232320';
const MUTED = '#7c7a72';
const INDIGO = '#5B4FE0';
const PERI = '#8f86f2';
const GREEN = '#31C88A';
const GOLD = '#F5B932';
const CREAM = '#FBF8EF';
const FONT = `'SF Pro Rounded','Segoe UI',system-ui,-apple-system,Helvetica,Arial,sans-serif`;

function esc(s: string): string {
  return String(s).replace(
    /[<>&"]/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c] as string
  );
}

/** Clean white outer + polished cream card (matches the mockup). */
function shell(pill: { label: string; color: string }, inner: string, preview: string): string {
  return `<div style="display:none;max-height:0;overflow:hidden">${preview}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;margin:0;padding:22px 0">
  <tr><td align="center">
    <table role="presentation" width="464" cellpadding="0" cellspacing="0" style="width:464px;max-width:94%;background:${CREAM};border:2px solid ${INK};border-radius:18px;overflow:hidden;font-family:${FONT}">
      <tr><td style="padding:22px 26px 2px">
        <table role="presentation" width="100%"><tr>
          <td style="vertical-align:middle">
            <span style="display:inline-block;width:20px;height:20px;border-radius:50%;background:${INK};vertical-align:middle"></span>
            <span style="font-weight:800;font-size:17px;color:${INK};vertical-align:middle;padding-left:8px">Insighta</span>
          </td>
          <td align="right" style="vertical-align:middle">
            <span style="font-size:11px;font-weight:800;letter-spacing:.1em;padding:6px 12px;border-radius:999px;border:2px solid ${INK};color:${pill.color};background:#fff">${pill.label}</span>
          </td>
        </tr></table>
      </td></tr>
      ${inner}
      <tr><td style="padding:20px 30px 26px;border-top:2px solid ${INK};background:#fff;text-align:center">
        <p style="margin:0;font-size:11.5px;color:${MUTED};line-height:1.6">Insighta · <a href="${SITE_ORIGIN}" style="color:${INDIGO};text-decoration:none;font-weight:700">insighta.one</a></p>
      </td></tr>
    </table>
  </td></tr>
</table>`;
}

function mascot(file: string): string {
  // Animated GIF (Gmail plays GIFs; CSS anim is stripped). Cream-backed so it
  // blends into the card.
  return `<img src="${SITE_ORIGIN}/emails/${file}" width="150" height="150" alt="Insighta" style="display:block;margin:0 auto;border:0" />`;
}

function heading(plain: string, hl: string): string {
  return `<div style="font-size:25px;font-weight:800;color:${INK};letter-spacing:-.02em;line-height:1.25">${plain} <span style="color:${INDIGO};border-bottom:5px solid ${PERI}">${hl}</span></div>`;
}

function cta(label: string, url: string, bg: string): string {
  return `<a href="${url}" style="display:inline-block;text-decoration:none;padding:15px 32px;border-radius:14px;background:${bg};color:#fff;font-weight:800;font-size:15.5px;border:2px solid ${INK}">${label} ›</a>`;
}

export interface WelcomeEmailParams {
  name?: string | null;
  ctaUrl?: string;
}

export function buildWelcomeEmail(params: WelcomeEmailParams): { subject: string; html: string } {
  const name = params.name ? esc(params.name) : '';
  const head = name ? heading('환영해요,', `${name}님`) : heading('환영해요', '');
  const url = params.ctaUrl ?? `${SITE_ORIGIN}/mandalas/new`;
  const rows = [
    ['목표 하나를 정하기', '“지정학 정세 분석”처럼 키우고 싶은 지식의 씨앗을 적어요.'],
    ['추천 영상 담기', '목표에 맞춰 골라낸 영상을 만다라에 끌어다 놓아요.'],
    ['노트가 저절로', '담은 영상의 핵심을 엮어 ‘10분만에 보는 책’ 노트를 만들어 드려요.'],
  ]
    .map(
      ([t, d], i) =>
        `<tr><td style="padding:13px 2px;border-top:1px dashed #d7d3c6">
          <table role="presentation"><tr>
            <td style="width:28px;height:28px;border:2px solid ${INK};border-radius:9px;color:${INDIGO};font-weight:800;font-size:13px;text-align:center;background:#fff">${i + 1}</td>
            <td style="padding-left:14px">
              <div style="font-size:14.5px;font-weight:800;color:${INK}">${t}</div>
              <div style="font-size:12.5px;color:${MUTED};margin-top:2px">${d}</div>
            </td>
          </tr></table>
        </td></tr>`
    )
    .join('');
  const inner = `
    <tr><td style="padding:14px 26px 2px;text-align:center">${mascot('mascot-welcome.gif')}</td></tr>
    <tr><td style="padding:8px 30px 2px;text-align:center">
      ${head}
      <div style="font-size:14px;color:${MUTED};margin:10px auto 0;max-width:330px;line-height:1.5">보고 흘려보내던 영상이, 목표를 키우는 지식이 되는 곳. 딱 세 걸음이면 첫 만다라가 완성돼요.</div>
    </td></tr>
    <tr><td style="padding:16px 30px 30px">
      <table role="presentation" width="100%">${rows}</table>
      <div style="text-align:center;margin-top:24px">${cta('첫 만다라 시작하기', url, INDIGO)}</div>
      <div style="text-align:center;font-size:12px;color:${MUTED};margin-top:16px">3분이면 충분해요 · 언제든 이어서 할 수 있어요</div>
    </td></tr>`;
  return {
    // Post-signup welcome tone — the pre-signup moment is buildBetaInviteEmail.
    subject: '환영해요 — 3분이면 첫 만다라',
    html: shell(
      { label: 'WELCOME', color: GOLD },
      inner,
      '목표만 정하세요, 영상은 저희가 채울게요.'
    ),
  };
}

export interface BetaInviteEmailParams {
  /** Learning-goal sentence from the beta application form (optional). */
  goal?: string | null;
  ctaUrl?: string;
}

/**
 * Beta invite — sent when admin marks an application invited. The recipient is
 * NOT a member yet: the email must announce the invitation, drive signup with
 * the applied email (the invite gate matches on it), and carry the onboarding
 * guide in one message.
 */
export function buildBetaInviteEmail(params: BetaInviteEmailParams): {
  subject: string;
  html: string;
} {
  const url = params.ctaUrl ?? `${SITE_ORIGIN}/login`;
  const goal = params.goal?.trim() ? esc(params.goal.trim()) : '';
  const goalCard = goal
    ? `<table role="presentation" width="100%" style="border:2px solid ${INK};border-radius:14px;background:#fff;margin-top:16px"><tr>
        <td style="padding:13px 16px">
          <div style="font-size:11px;font-weight:800;letter-spacing:.08em;color:${MUTED}">남겨주신 학습 목표</div>
          <div style="font-size:14px;font-weight:800;color:${INK};margin-top:4px">“${goal}”</div>
        </td>
      </tr></table>`
    : '';
  const rows = [
    ['신청하신 이메일로 로그인', '이 이메일의 구글 계정으로 로그인하면 초대가 바로 적용돼요.'],
    ['목표 하나를 정하기', '남겨주신 목표를 만다라로 펼쳐, 딱 맞는 영상을 채워 드려요.'],
    ['노트가 저절로', '담은 영상의 핵심을 엮어 ‘10분만에 보는 책’ 노트를 만들어 드려요.'],
  ]
    .map(
      ([t, d], i) =>
        `<tr><td style="padding:13px 2px;border-top:1px dashed #d7d3c6">
          <table role="presentation"><tr>
            <td style="width:28px;height:28px;border:2px solid ${INK};border-radius:9px;color:${INDIGO};font-weight:800;font-size:13px;text-align:center;background:#fff">${i + 1}</td>
            <td style="padding-left:14px">
              <div style="font-size:14.5px;font-weight:800;color:${INK}">${t}</div>
              <div style="font-size:12.5px;color:${MUTED};margin-top:2px">${d}</div>
            </td>
          </tr></table>
        </td></tr>`
    )
    .join('');
  const inner = `
    <tr><td style="padding:14px 26px 2px;text-align:center">${mascot('mascot-welcome.gif')}</td></tr>
    <tr><td style="padding:8px 30px 2px;text-align:center">
      ${heading('베타테스트에', '초대합니다')}
      <div style="font-size:14px;color:${MUTED};margin:10px auto 0;max-width:330px;line-height:1.5">신청해 주셔서 감사해요. 자리가 준비됐어요 — 이 이메일로 로그인하면 바로 시작돼요.</div>
    </td></tr>
    <tr><td style="padding:4px 30px 30px">
      ${goalCard}
      <table role="presentation" width="100%" style="margin-top:14px">${rows}</table>
      <div style="text-align:center;margin-top:24px">${cta('베타 참여 시작하기', url, INDIGO)}</div>
      <div style="text-align:center;font-size:12px;color:${MUTED};margin-top:16px">베타 기간 2026. 7. 13 – 8. 24 · 베타 기간에는 모든 기능이 무료예요</div>
    </td></tr>`;
  return {
    subject: 'Insighta 클로즈드 베타에 초대합니다 — 자리가 준비됐어요',
    html: shell(
      { label: 'INVITED', color: INDIGO },
      inner,
      '클로즈드 베타 자리가 준비됐어요 — 이 이메일로 로그인하면 시작돼요.'
    ),
  };
}

export interface NoteReadyEmailParams {
  name?: string | null;
  mandalaName: string;
  videoCount?: number;
  ctaUrl: string;
}

export function buildNoteReadyEmail(params: NoteReadyEmailParams): {
  subject: string;
  html: string;
} {
  const mandala = esc(params.mandalaName);
  const count = params.videoCount && params.videoCount > 0 ? `${params.videoCount}개 ` : '';
  const inner = `
    <tr><td style="padding:14px 26px 2px;text-align:center">${mascot('mascot-note.gif')}</td></tr>
    <tr><td style="padding:8px 30px 2px;text-align:center">
      ${heading('노트가', '완성됐어요')}
      <div style="font-size:14px;color:${MUTED};margin:10px auto 0;max-width:330px;line-height:1.5">담아둔 ${count}영상의 핵심을 엮어, 한 편의 노트로 정리했어요.</div>
    </td></tr>
    <tr><td style="padding:16px 30px 30px">
      <table role="presentation" width="100%" style="border:2px solid ${INK};border-radius:14px;background:#fff"><tr>
        <td style="padding:14px 16px">
          <table role="presentation"><tr>
            <td style="width:52px;height:52px;border:2px solid ${INK};border-radius:11px;background:${PERI}"></td>
            <td style="padding-left:13px">
              <div style="font-size:14px;font-weight:800;color:${INK}">${mandala} · 10분만에 보는 책</div>
              <div style="font-size:12px;color:${MUTED};margin-top:3px">방금 완성</div>
            </td>
          </tr></table>
        </td>
      </tr></table>
      <div style="text-align:center;margin-top:24px">${cta('노트 읽어보기', params.ctaUrl, GREEN)}</div>
      <div style="text-align:center;font-size:12px;color:${MUTED};margin-top:16px">새 영상을 5개 이상 더 담으면, 노트도 한 번 더 새로워져요.</div>
    </td></tr>`;
  return {
    subject: `‘${params.mandalaName}’ 노트가 완성됐어요`,
    html: shell(
      { label: '완성', color: GREEN },
      inner,
      '담은 영상의 요약이 모두 끝나 노트를 완성했어요.'
    ),
  };
}
