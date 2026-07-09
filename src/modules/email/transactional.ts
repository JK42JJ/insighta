/**
 * Transactional user emails (CP516) — welcome+onboarding and note-ready.
 *
 * Email-safe HTML: inline styles + table layout + a hosted PNG mascot (Gmail
 * strips inline <svg> and CSS @keyframes, so the cute mascot is a static image
 * served from the FE public dir). No emoji (brand rule). Design mirrors the
 * approved simple-cute mascot templates.
 *
 * Sending reuses the shared Gmail-SMTP transporter; failures are non-fatal to
 * the caller (an invite/book-fill must not fail because email is down).
 */

import { transporter } from '@/modules/skills/mailer';
import { config } from '@/config/index';
import { logger } from '@/utils/logger';

const log = logger.child({ module: 'email/transactional' });

/** Public site origin — non-secret prod domain (assets + deep links). */
const SITE_ORIGIN = 'https://insighta.one';

const INK = '#232320';
const MUTED = '#7c7a72';
const INDIGO = '#5B4FE0';
const GREEN = '#31C88A';
const CREAM = '#FBF8EF';

function shell(inner: string, previewText: string): string {
  return `<!-- preview --><div style="display:none;max-height:0;overflow:hidden">${previewText}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#efece0;margin:0;padding:24px 0">
  <tr><td align="center">
    <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="width:480px;max-width:92%;background:${CREAM};border:2px solid ${INK};border-radius:18px;overflow:hidden;font-family:'SF Pro Rounded','Segoe UI',system-ui,-apple-system,Helvetica,Arial,sans-serif">
      <tr><td style="padding:22px 26px 4px">
        <table role="presentation" width="100%"><tr>
          <td style="font-weight:800;font-size:17px;color:${INK}">Insighta</td>
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

function ctaButton(label: string, url: string, bg: string): string {
  return `<a href="${url}" style="display:inline-block;text-decoration:none;padding:14px 30px;border-radius:13px;background:${bg};color:#fff;font-weight:800;font-size:15px;border:2px solid ${INK}">${label}</a>`;
}

function mascot(file: string, alt: string): string {
  return `<img src="${SITE_ORIGIN}/emails/${file}" width="150" height="150" alt="${alt}" style="display:block;margin:0 auto;border:0" />`;
}

function esc(s: string): string {
  return String(s).replace(
    /[<>&"]/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c] as string
  );
}

export interface WelcomeEmailParams {
  name?: string | null;
  ctaUrl?: string;
}

export function buildWelcomeEmail(params: WelcomeEmailParams): { subject: string; html: string } {
  const name = params.name ? esc(params.name) : '';
  const greet = name ? `환영해요, <span style="color:${INDIGO}">${name}</span>님` : `환영해요`;
  const cta = params.ctaUrl ?? `${SITE_ORIGIN}/mandalas/new`;
  const steps = [
    ['목표 하나를 정하기', '키우고 싶은 지식의 씨앗을 적어요.'],
    ['추천 영상 담기', '목표에 맞춰 골라낸 영상을 만다라에 끌어다 놓아요.'],
    ['노트가 저절로', '담은 영상의 핵심을 엮어 ‘10분만에 보는 책’ 노트를 만들어 드려요.'],
  ]
    .map(
      ([t, d], i) =>
        `<tr><td style="padding:12px 2px;border-top:1px dashed #d7d3c6">
          <table role="presentation"><tr>
            <td style="width:26px;height:26px;border:2px solid ${INK};border-radius:9px;color:${INDIGO};font-weight:800;font-size:13px;text-align:center;background:#fff">${i + 1}</td>
            <td style="padding-left:13px">
              <div style="font-size:14px;font-weight:800;color:${INK}">${t}</div>
              <div style="font-size:12.5px;color:${MUTED};margin-top:2px">${d}</div>
            </td>
          </tr></table>
        </td></tr>`
    )
    .join('');
  const inner = `
    <tr><td style="padding:14px 26px 2px;text-align:center">${mascot('mascot-welcome.png', 'Insighta 마스코트')}</td></tr>
    <tr><td style="padding:8px 30px 2px;text-align:center">
      <div style="font-size:24px;font-weight:800;color:${INK};letter-spacing:-.02em">${greet}</div>
      <div style="font-size:14px;color:${MUTED};margin:8px auto 0;max-width:320px">보고 흘려보내던 영상이, 목표를 키우는 지식이 되는 곳. 딱 세 걸음이면 첫 만다라가 완성돼요.</div>
    </td></tr>
    <tr><td style="padding:14px 30px 30px">
      <table role="presentation" width="100%">${steps}</table>
      <div style="text-align:center;margin-top:22px">${ctaButton('첫 만다라 시작하기', cta, INDIGO)}</div>
    </td></tr>`;
  return {
    subject: 'Insighta 클로즈드 베타에 초대합니다 — 3분이면 첫 만다라',
    html: shell(inner, '목표만 정하세요, 영상은 저희가 채울게요.'),
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
  const count =
    params.videoCount && params.videoCount > 0 ? `${params.videoCount}개 영상의 핵심을 엮어, ` : '';
  const inner = `
    <tr><td style="padding:14px 26px 2px;text-align:center">${mascot('mascot-note.png', 'Insighta 마스코트')}</td></tr>
    <tr><td style="padding:8px 30px 2px;text-align:center">
      <div style="font-size:24px;font-weight:800;color:${INK};letter-spacing:-.02em">노트가 <span style="color:${INDIGO}">완성됐어요</span></div>
      <div style="font-size:14px;color:${MUTED};margin:8px auto 0;max-width:320px">담아둔 ${count}한 편의 노트로 정리했어요.</div>
    </td></tr>
    <tr><td style="padding:14px 30px 30px">
      <table role="presentation" width="100%" style="border:2px solid ${INK};border-radius:14px;background:#fff"><tr>
        <td style="padding:14px 16px">
          <div style="font-size:14px;font-weight:800;color:${INK}">${mandala} · 10분만에 보는 책</div>
          <div style="font-size:12px;color:${MUTED};margin-top:3px">방금 완성</div>
        </td>
      </tr></table>
      <div style="text-align:center;margin-top:22px">${ctaButton('노트 읽어보기', params.ctaUrl, GREEN)}</div>
      <div style="text-align:center;font-size:12px;color:${MUTED};margin-top:14px">새 영상을 5개 이상 더 담으면, 노트도 한 번 더 새로워져요.</div>
    </td></tr>`;
  return {
    subject: `‘${params.mandalaName}’ 노트가 완성됐어요`,
    html: shell(inner, '담은 영상의 요약이 모두 끝나 노트를 완성했어요.'),
  };
}

/** Master gate for user-facing transactional email. Default OFF — James flips on
 *  for the beta once the send path is verified. Unset ⇒ no email sent. */
function isTransactionalEmailEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env['TRANSACTIONAL_EMAIL_ENABLED'] ?? '')
    .trim()
    .toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
}

async function send(to: string, subject: string, html: string, tag: string): Promise<void> {
  if (!isTransactionalEmailEnabled()) {
    log.info(`${tag}: transactional email disabled (TRANSACTIONAL_EMAIL_ENABLED unset) — skipped`);
    return;
  }
  if (!to) {
    log.warn(`${tag}: recipient empty — skipped`);
    return;
  }
  try {
    await transporter.sendMail({ from: config.gmail.smtpFrom, to, subject, html });
    log.info(`${tag}: sent to ${to}`);
  } catch (err) {
    log.warn(
      `${tag}: send failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

export async function sendWelcomeEmail(to: string, params: WelcomeEmailParams): Promise<void> {
  const { subject, html } = buildWelcomeEmail(params);
  await send(to, subject, html, 'welcome-email');
}

export async function sendNoteReadyEmail(to: string, params: NoteReadyEmailParams): Promise<void> {
  const { subject, html } = buildNoteReadyEmail(params);
  await send(to, subject, html, 'note-ready-email');
}
