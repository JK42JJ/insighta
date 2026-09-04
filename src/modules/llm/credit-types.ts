/**
 * The breaker's answer, in its own file.
 *
 * Call sites import this type to decide what to do when a provider is out of
 * credits; keeping it out of `cost-gate` means a module can type its handling
 * without pulling Prisma in through the import graph, which is what broke the
 * unit tests the first time round.
 */
export interface CreditGateDecision {
  /**
   * False means: do not make this call.
   *
   * Two different facts can set it. `credit_exhausted` means the call would
   * certainly fail. `daily_budget` means it would probably succeed, and that
   * is the problem — the account has spent its allowance for the day. The
   * call sites treat both the same way, which is why they share a type: at
   * the moment of calling, "will fail" and "must not" are one instruction.
   */
  allowed: boolean;
  /** `openrouter`, `anthropic` — the prefix of the model id. */
  provider: string;
  reason?: 'credit_exhausted' | 'daily_budget';
  /** When the provider first refused in the current spell. */
  since?: Date | null;
  /** Refusals seen during the current spell. */
  hits?: number;
  /** True when this call is the ten-minute probe testing for recovery. */
  isProbe?: boolean;
  /** `daily_budget` only — what has been spent today, and the ceiling. */
  dailySpendUsd?: number;
  dailyLimitUsd?: number;
}
