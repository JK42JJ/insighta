import type { Prisma } from '@prisma/client';

/**
 * Widen a structured value to Prisma's JSON input type without an `as` cast.
 *
 * `Prisma.InputJsonValue` accepts `object`, but not an interface or a typed
 * array (`InterestProfile`, `AuditViolation[]`) directly, because those carry
 * no implicit index signature. Call sites used `value as object` for that.
 * With @typescript-eslint v8 the cast is reported as unnecessary -- the rule's
 * receiver-assignability check is looser than the compiler's -- and its autofix
 * removes it, which breaks the build. A parameter typed `object` widens the
 * same way and leaves nothing for the rule to remove.
 */
export function toJsonInput(value: object): Prisma.InputJsonValue {
  return value;
}
