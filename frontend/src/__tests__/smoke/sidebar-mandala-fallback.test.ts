import { describe, expect, test } from 'vitest';
import type { PendingMandalaInputs } from '@/stores/mandalaStore';

// Mirror of SidebarMandalaSection's fallback chain — keep in sync.
function derivePendingTitle(inputs: PendingMandalaInputs | undefined): string | null {
  if (!inputs) return null;
  return inputs.centerLabel?.trim() || inputs.title?.trim() || inputs.centerGoal?.trim() || null;
}

describe('sidebar pendingMandala title fallback', () => {
  test('centerLabel is preferred when present', () => {
    expect(
      derivePendingTitle({
        title: 'Long form title that would get truncated',
        centerGoal: '턱걸이 20개 달성하기 마스터 플랜',
        subjects: [],
        centerLabel: '턱걸이 20',
      })
    ).toBe('턱걸이 20');
  });

  test('falls back to title when centerLabel is missing', () => {
    expect(
      derivePendingTitle({
        title: '턱걸이 20개',
        centerGoal: '턱걸이 20개 달성 플랜',
        subjects: [],
      })
    ).toBe('턱걸이 20개');
  });

  test('falls back to centerGoal when title is missing or blank', () => {
    expect(
      derivePendingTitle({
        title: '   ',
        centerGoal: '턱걸이 20개 달성',
        subjects: [],
      })
    ).toBe('턱걸이 20개 달성');
  });

  test('returns null for undefined pending state (caller shows loading copy)', () => {
    expect(derivePendingTitle(undefined)).toBeNull();
  });

  test('returns null when every candidate is blank', () => {
    expect(
      derivePendingTitle({
        title: '',
        centerGoal: '',
        centerLabel: '   ',
        subjects: [],
      })
    ).toBeNull();
  });
});
