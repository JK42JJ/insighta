/**
 * Rich Summary feature flags (CP422 P1).
 *
 * Phase 1 constraint (user directive 2026-04-24): prod 서버에서 YouTube caption API 를 직접 호출 금지.
 * `captionExtractor.extractCaptions()` 경로는 `CAPTION_SOURCE='prod_direct'` 일 때만 작동.
 * 기본값은 `disabled` — chapters/quotes 생성은 skip, tl_dr 만 description 기반 생성.
 * Mac Mini 경유 경로(`mac_mini`)는 후속 Phase 에서 bridge 구현 후 활성화 (현재 미구현 → throw).
 */

import { z } from 'zod';

const boolFlag = z.preprocess((v) => {
  if (v == null || v === '') return false;
  const s = String(v).trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
}, z.boolean());

export const RICH_SUMMARY_CAPTION_SOURCES = ['disabled', 'mac_mini', 'prod_direct'] as const;
export type RichSummaryCaptionSource = (typeof RICH_SUMMARY_CAPTION_SOURCES)[number];

const captionSourceSchema = z.preprocess(
  (v) => (v == null || v === '' ? 'disabled' : String(v).trim().toLowerCase()),
  z.enum(RICH_SUMMARY_CAPTION_SOURCES)
);

export const richSummaryEnvSchema = z.object({
  RICH_SUMMARY_ENABLED: boolFlag.default(false as unknown as string),
  RICH_SUMMARY_CAPTION_SOURCE: captionSourceSchema.default('disabled'),
});

export interface RichSummaryConfig {
  enabled: boolean;
  captionSource: RichSummaryCaptionSource;
}

export function loadRichSummaryConfig(env: NodeJS.ProcessEnv = process.env): RichSummaryConfig {
  const parsed = richSummaryEnvSchema.safeParse({
    RICH_SUMMARY_ENABLED: env['RICH_SUMMARY_ENABLED'],
    RICH_SUMMARY_CAPTION_SOURCE: env['RICH_SUMMARY_CAPTION_SOURCE'],
  });
  if (!parsed.success) {
    return { enabled: false, captionSource: 'disabled' };
  }
  return {
    enabled: parsed.data.RICH_SUMMARY_ENABLED,
    captionSource: parsed.data.RICH_SUMMARY_CAPTION_SOURCE,
  };
}
