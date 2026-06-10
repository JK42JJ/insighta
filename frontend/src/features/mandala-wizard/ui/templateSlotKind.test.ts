/**
 * PR-C (CP499+) — template strip is DECORATION for the generation wait.
 * Invariant under test: a FAILED search renders 'hidden' — byte-identical to
 * "no result" — never an error card or retry affordance. (Prod 2026-06-10:
 * the amber "다시 시도" card surfaced a decoration failure to the user.)
 */
import { describe, it, expect } from 'vitest';
import { templateSlotKind } from './WizardStepGoal';

describe('templateSlotKind (PR-C silent-fail invariant)', () => {
  it('FAILED search → hidden (silent), regardless of pending flag', () => {
    expect(templateSlotKind(false, true, false)).toBe('hidden');
    // failed wins over a stale isSearching=true frame
    expect(templateSlotKind(false, true, true)).toBe('hidden');
  });

  it('result present → result (failure of OTHER slots irrelevant)', () => {
    expect(templateSlotKind(true, false, false)).toBe('result');
    expect(templateSlotKind(true, true, false)).toBe('result');
  });

  it('in flight → loading skeleton; idle empty → hidden', () => {
    expect(templateSlotKind(false, false, true)).toBe('loading');
    expect(templateSlotKind(false, false, false)).toBe('hidden');
  });

  it('there is NO error/retry kind — the type space itself forbids it', () => {
    const kinds: ReturnType<typeof templateSlotKind>[] = [
      templateSlotKind(false, true, false),
      templateSlotKind(false, false, true),
      templateSlotKind(true, false, false),
    ];
    for (const k of kinds) expect(['result', 'loading', 'hidden']).toContain(k);
  });
});
