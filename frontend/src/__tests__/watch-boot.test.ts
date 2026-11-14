import { describe, expect, it } from 'vitest';

import {
  BOOT_LINE_MS,
  BOOT_SKELETON_MS,
  bootStage,
} from '@/features/morning-feed/watch-boot-stage';

describe('watch first-open stages (README 수정 4 §8)', () => {
  it('logo, then the running line, then the skeleton', () => {
    expect(bootStage(0)).toBe('logo');
    expect(bootStage(BOOT_LINE_MS - 1)).toBe('logo');
    expect(bootStage(BOOT_LINE_MS)).toBe('line');
    expect(bootStage(BOOT_SKELETON_MS - 1)).toBe('line');
    expect(bootStage(BOOT_SKELETON_MS)).toBe('skeleton');
    expect(bootStage(60_000)).toBe('skeleton');
  });
});
