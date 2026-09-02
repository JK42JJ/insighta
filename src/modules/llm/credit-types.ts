/**
 * The breaker's answer, in its own file.
 *
 * Call sites import this type to decide what to do when a provider is out of
 * credits; keeping it out of `cost-gate` means a module can type its handling
 * without pulling Prisma in through the import graph, which is what broke the
 * unit tests the first time round.
 */
export interface CreditGateDecision {
  /** False means this call would certainly fail — do not make it. */
  allowed: boolean;
  /** `openrouter`, `anthropic` — the prefix of the model id. */
  provider: string;
  reason?: 'credit_exhausted';
  /** When the provider first refused in the current spell. */
  since?: Date | null;
  /** Refusals seen during the current spell. */
  hits?: number;
  /** True when this call is the ten-minute probe testing for recovery. */
  isProbe?: boolean;
}
