/* First-open stages of the watch screen (design 수정 4 §8), pure and unit tested. */

/** README §8 (prototype timing): the logo alone, then the line, then the skeleton. */
export const BOOT_LINE_MS = 700;
export const BOOT_SKELETON_MS = 1700;
export type BootStage = 'logo' | 'line' | 'skeleton';

export function bootStage(elapsedMs: number): BootStage {
  if (elapsedMs < BOOT_LINE_MS) return 'logo';
  if (elapsedMs < BOOT_SKELETON_MS) return 'line';
  return 'skeleton';
}
