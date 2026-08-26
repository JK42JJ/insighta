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
/* The dial is its own product with its own colour. Reusing the app's indigo
 * made the guide read as more Insighta mail; these are the tokens the dial
 * actually renders with (--acc / --acc-lo in mobile/index.html). */
const DIAL = '#E0703F';
const DIAL_DEEP = '#CE5F30';
const FONT = `'SF Pro Rounded','Segoe UI',system-ui,-apple-system,Helvetica,Arial,sans-serif`;

function esc(s: string): string {
  return String(s).replace(
    /[<>&"]/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c] as string
  );
}

/** Clean white outer + polished cream card (matches the mockup). */
function shell(pill: { label: string; color: string }, inner: string, preview: string): string {
  // nodemailer already sends `Content-Type: text/html; charset=utf-8`, so delivery
  // is fine without this. It matters once the body is rendered on its own -- a
  // "view in browser" link, a forwarded copy, a saved .html -- where the Korean
  // becomes mojibake with no declared charset.
  return `<meta charset="utf-8">
<div style="display:none;max-height:0;overflow:hidden">${preview}</div>
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

function heading(
  plain: string,
  hl: string,
  hlColor: string = INDIGO,
  hlUnder: string = PERI
): string {
  return `<div style="font-size:25px;font-weight:800;color:${INK};letter-spacing:-.02em;line-height:1.25">${plain} <span style="color:${hlColor};border-bottom:5px solid ${hlUnder}">${hl}</span></div>`;
}

/**
 * Numbered step: a fixed square badge and the text beside it.
 *
 * The badge has to be a DIV inside the cell, not the cell itself. A table forces
 * every cell in a row to the height of the tallest, so a badge drawn as a `td`
 * stretches into a rectangle whenever its neighbouring text wraps to a second
 * line — which is what the first send looked like: 1 and 2 square, 3 and 4
 * stretched. A div keeps its own box, and `vertical-align:middle` centres it
 * against however tall the text turns out to be.
 *
 * `line-height` carries the vertical centring because Outlook ignores
 * flexbox and `height` on inline content.
 */
function stepRow(n: number, title: string, desc: string, accent: string): string {
  const SIDE = 28;
  const badge =
    `<div style="width:${SIDE}px;height:${SIDE}px;line-height:${SIDE - 4}px;` +
    `border:2px solid ${INK};border-radius:9px;background:#fff;` +
    `color:${accent};font-weight:800;font-size:13px;text-align:center;` +
    `mso-line-height-rule:exactly">${n}</div>`;
  return `<tr><td style="padding:13px 2px;border-top:1px dashed #d7d3c6">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td width="${SIDE}" style="width:${SIDE}px;vertical-align:middle">${badge}</td>
        <td style="padding-left:14px;vertical-align:middle">
          <div style="font-size:14.5px;font-weight:800;color:${INK}">${title}</div>
          <div style="font-size:12.5px;color:${MUTED};margin-top:2px;line-height:1.5">${desc}</div>
        </td>
      </tr></table>
    </td></tr>`;
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
  /** Invite tickets (2026-07-15): member name shown as the inviter. */
  inviterName?: string | null;
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
      <div style="font-size:14px;color:${MUTED};margin:10px auto 0;max-width:330px;line-height:1.5">${
        params.inviterName?.trim()
          ? `${esc(params.inviterName.trim())}님이 초대권으로 자리를 마련했어요 — 이 이메일로 로그인하면 바로 시작돼요.`
          : '신청해 주셔서 감사해요. 자리가 준비됐어요 — 이 이메일로 로그인하면 바로 시작돼요.'
      }</div>
    </td></tr>
    <tr><td style="padding:4px 30px 30px">
      ${goalCard}
      <table role="presentation" width="100%" style="margin-top:14px">${rows}</table>
      <div style="text-align:center;margin-top:24px">${cta('베타 참여 시작하기', url, INDIGO)}</div>
      <div style="text-align:center;font-size:12px;color:${MUTED};margin-top:16px">베타 기간 2026. 7. 13 – 8. 24 · 베타 기간에는 모든 기능이 무료예요</div>
    </td></tr>`;
  return {
    subject: params.inviterName?.trim()
      ? `${params.inviterName.trim()}님이 Insighta 베타에 초대했어요`
      : 'Insighta 클로즈드 베타에 초대합니다 — 자리가 준비됐어요',
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

export interface ProUpgradeEmailParams {
  name?: string | null;
  ctaUrl?: string;
}

/**
 * Beta-tester benefit email — sent when admin raises a beta tester to an
 * unlimited tier (lifetime, per James 2026-07-15). Benefit lines are FEATURES
 * the product actually ships (unlimited mandalas/cards via lifetime tier, AI
 * summary, auto note, the new mobile app, early access) — NOT unenforced
 * quota counts. No payment is attached to a manual tier change, so the copy
 * states that explicitly.
 */
export function buildProUpgradeEmail(params: ProUpgradeEmailParams): {
  subject: string;
  html: string;
} {
  const url = params.ctaUrl ?? `${SITE_ORIGIN}/`;
  const name = params.name?.trim() ? esc(params.name.trim()) : '';
  const rows = [
    ['만다라 · 카드 무제한', '베타 기간 동안 만다라도 카드도 제한 없이 만들고 담아요.'],
    [
      'AI 요약 · 노트 자동 완성',
      '담은 영상의 핵심을 엮어 ‘10분만에 보는 책’ 노트를 만들어 드려요.',
    ],
    ['모바일 앱 — 다이얼', '새로 나온 다이얼로, 만든 노트를 어디서나 들으며 이어가요.'],
    ['신규 기능 우선 제공', '새 기능이 열리면 베타 테스터가 가장 먼저 써요.'],
  ]
    .map(
      ([t, d]) =>
        `<tr><td style="padding:13px 2px;border-top:1px dashed #d7d3c6">
          <table role="presentation"><tr>
            <td style="width:28px;height:28px;border:2px solid ${INK};border-radius:9px;color:${GREEN};font-weight:800;font-size:14px;text-align:center;background:#fff">✓</td>
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
      ${heading(name ? `${name}님, 이제` : '이제', '제한 없이')}
      <div style="font-size:14px;color:${MUTED};margin:10px auto 0;max-width:330px;line-height:1.5">베타를 함께해 주셔서 감사해요. 베타 테스터 혜택으로 계정을 열어 드렸어요 — 베타 기간 동안 만다라도 카드도 마음껏 쓰세요.</div>
    </td></tr>
    <tr><td style="padding:16px 30px 30px">
      <table role="presentation" width="100%">${rows}</table>
      <div style="text-align:center;margin-top:24px">${cta('내 만다라 열기', url, INDIGO)}</div>
      <div style="text-align:center;font-size:12px;color:${MUTED};margin-top:16px">결제 정보는 받지 않아요 · 베타가 끝나도 자동 결제되지 않아요</div>
    </td></tr>`;
  return {
    subject: '베타 테스터 혜택 — 이제 제한 없이 쓰세요',
    html: shell(
      { label: 'PRO', color: GOLD },
      inner,
      '베타 기간 동안 만다라·카드 무제한 + 새 기능 우선.'
    ),
  };
}

export interface MobileGuideEmailParams {
  ctaUrl?: string;
}

/**
 * Mobile dial-player usage guide — installing to the home screen is the first
 * action, so the per-platform install steps lead, then usage steps + CTA. Copy
 * follows the insighta-copywriter rules (benefit-first; no podcast/by-ear/
 * recitation phrasing; no emoji).
 */
export function buildMobileGuideEmail(params: MobileGuideEmailParams): {
  subject: string;
  html: string;
} {
  // The landing page, not the app. A mail arrives cold: dropping someone
  // straight into a running player with no idea what they opened is the wrong
  // first frame. /dial introduces it and hands off from there.
  const url = params.ctaUrl ?? `${SITE_ORIGIN}/dial/`;
  // Per-platform install block (leads — the critical first action). Email-safe:
  // table layout, worded steps (no icons that clients strip).
  function platform(badge: string, where: string, steps: string[]): string {
    const items = steps
      .map(
        (s, i) =>
          `<tr><td style="padding:3px 0;font-size:13px;color:${MUTED};line-height:1.6"><b style="color:${INK}">${i + 1}.</b> ${s}</td></tr>`
      )
      .join('');
    return `<tr><td style="padding:12px 0;border-top:1px dashed #d7d3c6">
        <div style="font-size:13.5px;font-weight:800;color:${INK}">
          <span style="font-size:10.5px;font-weight:800;color:#fff;background:${INK};border-radius:6px;padding:2px 8px">${badge}</span>
          <span style="padding-left:7px">${where}</span>
        </div>
        <table role="presentation" style="margin-top:6px">${items}</table>
      </td></tr>`;
  }
  const installBox = `<table role="presentation" width="100%" style="border:2px solid ${INK};border-radius:14px;background:#fff">
    <tr><td style="padding:14px 16px 4px">
      <div style="font-size:15px;font-weight:800;color:${INK}">다이얼을 홈 화면에 추가하기</div>
    </td></tr>
    <tr><td style="padding:0 16px 12px">
      <table role="presentation" width="100%">
        ${platform('아이폰 · 아이패드', 'Safari에서', [
          '화면 아래 <b style="color:' + INK + '">공유 버튼</b>(위로 향한 화살표)을 누르세요.',
          '메뉴를 내려 <b style="color:' + INK + '">‘홈 화면에 추가’</b>를 누르세요.',
          '오른쪽 위 <b style="color:' + INK + '">‘추가’</b>를 누르면 끝이에요.',
        ])}
        ${platform('안드로이드', 'Chrome에서', [
          '오른쪽 위 <b style="color:' + INK + '">메뉴</b>(점 세 개)를 누르세요.',
          '<b style="color:' +
            INK +
            '">‘앱 설치’</b> 또는 <b style="color:' +
            INK +
            '">‘홈 화면에 추가’</b>를 누르세요.',
          '<b style="color:' + INK + '">‘설치’</b>를 누르면 끝이에요.',
        ])}
      </table>
      <div style="font-size:12px;color:${MUTED};margin-top:10px;padding-top:10px;border-top:1px dashed #d7d3c6;line-height:1.6">추가한 아이콘으로 열면 주소창 없이 앱처럼 넓게 쓸 수 있어요.</div>
    </td></tr>
  </table>`;
  // Order follows what the app actually shows a new account: the dial opens on
  // the curation tab, which asks to connect YouTube, then proposes topics. A
  // guide that starts with mandala playback describes a screen the user has to
  // go looking for.
  const useRows = [
    ['유튜브 연결', '처음 열면 연결부터 물어봐요. 보시던 채널을 읽어 취향을 잡습니다.'],
    ['주제 고르기', '추천 주제 카드를 옆으로 넘겨 하나 고르세요. 직접 입력해도 됩니다.'],
    [
      '매주 받아보기',
      '고른 주제의 새 영상이 매주 모여요. 휠을 돌려 넘기고 가운데 버튼으로 재생합니다.',
    ],
    [
      '채널로 받기',
      '주제 대신 채널을 고를 수도 있어요. 목록에서 이름 옆 · · · 를 누르면 나옵니다.',
    ],
    ['노트로 읽기', '영상에서 만든 노트는 노트 탭에서 문서로 읽을 수 있어요.'],
  ]
    .map(([t, d], i) => stepRow(i + 1, t as string, d as string, DIAL_DEEP))
    .join('');
  const inner = `
    <tr><td style="padding:0">
      <a href="${url}" style="display:block;text-decoration:none">
        <img src="${SITE_ORIGIN}/dial/og.png" width="464" alt="다이얼 — 유튜브를 나만의 지식노트로"
             style="display:block;width:100%;max-width:464px;height:auto;border:0" />
      </a>
    </td></tr>
    <tr><td style="padding:20px 30px 2px;text-align:center">
      ${heading('찾지 않아도,', '매주 모입니다', DIAL_DEEP, '#F3CDB6')}
      <div style="font-size:14px;color:${MUTED};margin:10px auto 0;max-width:344px;line-height:1.6">주제나 채널을 한 번 정해두면, 그 주에 올라온 영상만 모아 둡니다. 휠을 돌려 넘겨 보세요.</div>
    </td></tr>
    <tr><td style="padding:16px 30px 6px">${installBox}</td></tr>
    <tr><td style="padding:6px 30px 2px">
      <div style="font-size:11px;font-weight:800;letter-spacing:.12em;color:${MUTED};text-transform:uppercase">홈에 추가한 뒤, 순서대로</div>
    </td></tr>
    <tr><td style="padding:2px 30px 30px">
      <table role="presentation" width="100%">${useRows}</table>
      <div style="text-align:center;margin-top:24px">${cta('다이얼 열어보기', url, DIAL)}</div>
      <div style="text-align:center;font-size:12px;color:${MUTED};margin-top:16px">주제를 받으려면 로그인이 필요해요. 샘플은 로그인 없이 들어볼 수 있습니다.</div>
    </td></tr>`;
  return {
    subject: '이번 주 볼 영상만 모아 뒀어요 — 다이얼',
    html: shell(
      { label: 'DIAL', color: DIAL_DEEP },
      inner,
      '주제를 한 번 정해두면, 그 주에 올라온 영상만 모입니다.'
    ),
  };
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Weekly brief. Deliberately does NOT use shell().
 *
 * shell() is the announcement dress: cream card, bold outline, pill, mascot.
 * It says "Insighta has news for you". A newsletter has to say "this is a
 * publication" before a word is read, so the brief gets its own silhouette --
 * a full-bleed ink masthead over paper, a wider measure, no mascot, no pill.
 * Putting the launch issue in the announcement dress is what this replaces.
 *
 * Constraints inherited from the templates above: table layout, inline CSS,
 * no webfonts (clients strip them), no emoji, and a single committed light
 * theme with every background stated -- client dark-mode inversion is not
 * reliable enough to hand it a transparent cell.
 * ────────────────────────────────────────────────────────────────────────── */

const PAPER = '#FBF8EF';
/** Warm hairline biased toward the paper; a mid grey reads as unconsidered here. */
const RULE = '#E3DED0';
/** Letterspaced Latin, not a serif: Korean has no serif that survives mail clients. */
const NAMEPLATE = `font-family:${FONT};font-weight:800;letter-spacing:.34em;`;

export interface BriefStat {
  value: string;
  label: string;
}

export interface BriefItem {
  title: string;
  deck: string;
}

export interface BriefEmailParams {
  issueLabel: string;
  dateLabel: string;
  category: string;
  headline: string;
  /** Fragment inside `headline` to accent. Matched after escaping, so pass it raw. */
  headlineMark?: string;
  deck: string;
  items: BriefItem[];
  stats: BriefStat[];
  method: string;
  readUrl: string;
  readMeta: string;
  unsubscribeUrl: string;
  preview: string;
}

/**
 * Running order in the issue, so the number carries sequence rather than decoration.
 *
 * The title is the whole surface for most readers: the body is one click away
 * and the majority never take it. A line that names a topic ("X was released")
 * tells someone they already know what happened, which is a reason to close
 * the mail. Each title has to state what stopped being true, so the caller
 * writes consequences here, not descriptions -- the builder reproduces them
 * verbatim and never reformats.
 */
function briefItemRow(n: number, item: BriefItem): string {
  const num = String(n).padStart(2, '0');
  return `<tr><td style="padding:15px 0;border-top:1px solid ${RULE};background:${PAPER}">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr>
        <td width="34" style="width:34px;vertical-align:top;padding-top:3px">
          <span style="font-size:12px;font-weight:800;color:${INDIGO};letter-spacing:.06em">${num}</span>
        </td>
        <td style="vertical-align:top">
          <div style="font-size:15px;font-weight:800;color:${INK};line-height:1.45;letter-spacing:-.01em">${esc(item.title)}</div>
          <div style="font-size:13px;color:${MUTED};margin-top:5px;line-height:1.68">${esc(item.deck)}</div>
        </td>
      </tr></table>
    </td></tr>`;
}

export function buildBriefEmail(params: BriefEmailParams): { subject: string; html: string } {
  const {
    issueLabel,
    dateLabel,
    category,
    headline,
    headlineMark,
    deck,
    items,
    stats,
    method,
    readUrl,
    readMeta,
    unsubscribeUrl,
    preview,
  } = params;

  const markedHeadline = headlineMark
    ? esc(headline).replace(
        esc(headlineMark),
        `<span style="color:${INDIGO};border-bottom:4px solid ${PERI}">${esc(headlineMark)}</span>`
      )
    : esc(headline);

  // Equal-width cells rather than a flex row: Outlook ignores flex entirely.
  const width = Math.floor(100 / Math.max(stats.length, 1));
  const statCells = stats
    .map(
      (s) => `<td width="${width}%" style="vertical-align:top;padding:0 4px">
          <div style="font-size:21px;font-weight:800;color:${INK};letter-spacing:-.02em">${esc(s.value)}</div>
          <div style="font-size:11px;color:${MUTED};margin-top:3px;line-height:1.5">${esc(s.label)}</div>
        </td>`
    )
    .join('');

  const html = `<meta charset="utf-8">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preview)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EFEBE0;margin:0;padding:0">
  <tr><td align="center" style="padding:0">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:560px;max-width:100%;background:${PAPER};font-family:${FONT}">

      <tr><td style="background:${INK};padding:26px 34px 22px">
        <div style="${NAMEPLATE}font-size:15px;color:${PAPER};line-height:1">INSIGHTA&nbsp;WEEKLY</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px"><tr>
          <td style="font-size:11px;color:#9C9890;letter-spacing:.13em;font-weight:700">${esc(category)}</td>
          <td align="right" style="font-size:11px;color:#9C9890;letter-spacing:.09em;font-weight:700">${esc(issueLabel)} &middot; ${esc(dateLabel)}</td>
        </tr></table>
      </td></tr>

      <tr><td style="background:${INDIGO};height:3px;line-height:3px;font-size:0">&nbsp;</td></tr>

      <tr><td style="background:${PAPER};padding:34px 34px 0">
        <h1 style="margin:0;font-size:29px;line-height:1.34;font-weight:800;color:${INK};letter-spacing:-.025em">${markedHeadline}</h1>
        <p style="margin:16px 0 0;font-size:14.5px;line-height:1.78;color:#55534C">${esc(deck)}</p>
      </td></tr>

      <tr><td style="background:${PAPER};padding:28px 34px 0">
        <div style="font-size:10.5px;font-weight:800;letter-spacing:.16em;color:${MUTED};padding-bottom:4px">이번 주에 달라진 것</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          ${items.map((it, i) => briefItemRow(i + 1, it)).join('')}
          <tr><td style="border-top:1px solid ${RULE};font-size:0;line-height:0">&nbsp;</td></tr>
        </table>
      </td></tr>

      <tr><td style="background:${PAPER};padding:26px 34px 0" align="center">
        ${cta('전체 브리프 읽기', readUrl, INDIGO)}
        <p style="margin:12px 0 0;font-size:11.5px;color:${MUTED}">${esc(readMeta)}</p>
      </td></tr>

      <tr><td style="background:${PAPER};padding:30px 34px 0">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F0E4;border-left:3px solid ${GREEN}">
          <tr><td style="padding:17px 18px">
            <div style="font-size:10.5px;font-weight:800;letter-spacing:.16em;color:${MUTED}">이번 호를 만든 방법</div>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:13px"><tr>${statCells}</tr></table>
            <p style="margin:14px 0 0;font-size:12.5px;line-height:1.7;color:#55534C">${esc(method)}</p>
          </td></tr>
        </table>
      </td></tr>

      <tr><td style="background:${PAPER};padding:30px 34px 34px">
        <div style="border-top:1px solid ${RULE};padding-top:18px">
          <div style="${NAMEPLATE}font-size:10px;color:${INK}">INSIGHTA</div>
          <p style="margin:9px 0 0;font-size:11.5px;line-height:1.75;color:${MUTED}">
            유튜브를 나만의 지식노트로. <a href="${SITE_ORIGIN}" style="color:${INDIGO};text-decoration:none;font-weight:700">insighta.one</a><br>
            주간 브리프는 매주 한 통 발행됩니다.
            <a href="${esc(unsubscribeUrl)}" style="color:${MUTED};text-decoration:underline">수신거부</a>
          </p>
        </div>
      </td></tr>

    </table>
  </td></tr>
</table>`;

  return { subject: `${category} · ${issueLabel} — ${headline}`, html };
}
