/**
 * [HOTFIX 2026-07-03] Cross-mandala round leak guard.
 *
 * The append-on-success effect re-fires when `mandalaId` changes while a
 * PREVIOUS mandala's mutation result is still held (the panel component
 * stays mounted across mandala switches). Without this guard, mandala A's
 * search results were appended — and persisted — as a round of mandala B
 * (user incident: ML videos saved into the 영문법 mandala's rounds).
 */
export function shouldAppendRound(
  resultMandalaId: string | undefined,
  currentMandalaId: string | null,
  existingRoundIds: ReadonlyArray<string>,
  roundId: string
): boolean {
  // Result must have been requested FOR the currently open mandala.
  if (!currentMandalaId || resultMandalaId !== currentMandalaId) return false;
  // Idempotency — never append the same round twice.
  return !existingRoundIds.includes(roundId);
}
