/** Mockup chapter/player time format — unpadded minutes ("0:00", "12:07"). */
export function fmtChapterTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
