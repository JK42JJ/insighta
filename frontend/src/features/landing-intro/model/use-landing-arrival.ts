import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { postUsageEvent } from '@/features/morning-cards/api';
import { writeOnboardingSeen } from '@/features/morning-feed/watch-design';

import { peekLandingArrival, takeLandingArrival, type LandingArrival } from './landing-events';

/** ADD (decision 2026-11-24): shown on the brief screen after sign-in, with the global toast. */
export const ADD_SOON_TEXT = '곧 출시 예정이에요.';
export const ADD_SOON_MS = 2000;

type Send = typeof postUsageEvent;

/** The kept landing events in their order, then login_done (each send never throws). */
export async function sendLandingArrival(
  a: LandingArrival,
  send: Send = postUsageEvent
): Promise<void> {
  for (const e of a.events) {
    await send(e.value === undefined ? { kind: e.kind } : { kind: e.kind, value: e.value });
  }
  await send({ kind: 'login_done' });
}

/**
 * The brief screen after sign-in from the landing. Before anything is drawn: the watch onboarding
 * is marked seen ("로그인하면 오늘의 영상을 바로", decision 2026-11-24; other visitors unchanged).
 * Once `shown`: the kept events go out with login_done, and ADD shows its notice. Only the first
 * call in the tab gets the arrival, so a remount does not send or show anything twice.
 */
export function useLandingArrival(shown: boolean): void {
  // before the screens read the onboarding flag in their first render; idempotent
  useState(() => {
    if (peekLandingArrival()) writeOnboardingSeen();
    return null;
  });
  useEffect(() => {
    if (!shown) return;
    const a = takeLandingArrival();
    if (!a) return;
    void sendLandingArrival(a);
    if (a.entry === 'add') toast(ADD_SOON_TEXT, { duration: ADD_SOON_MS });
  }, [shown]);
}
