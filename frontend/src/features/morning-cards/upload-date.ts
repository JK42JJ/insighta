const UNKNOWN_DATE_LABEL = '업로드 날짜 미상';

/** Formats an ISO timestamp as YYYY-MM-DD (UTC); null/invalid -> unknown label. */
export function formatUploadDate(publishedAt: string | null): string {
  if (!publishedAt) return UNKNOWN_DATE_LABEL;
  const time = Date.parse(publishedAt);
  if (Number.isNaN(time)) return UNKNOWN_DATE_LABEL;
  return new Date(time).toISOString().slice(0, 10);
}
