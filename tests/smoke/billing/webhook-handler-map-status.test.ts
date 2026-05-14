// Unit tests for mapStatus pure function (no DB).
import { mapStatus } from '../../../src/modules/billing/webhook-handler';

export {};

describe('webhook-handler.mapStatus', () => {
  test.each<[string, string | undefined, string]>([
    ['subscription_expired', undefined, 'EXPIRED'],
    ['subscription_paused', 'paused', 'PAUSED'],
    ['subscription_unpaused', 'active', 'ACTIVE'],
    ['subscription_resumed', 'active', 'ACTIVE'],
    ['subscription_cancelled', 'cancelled', 'CANCELLED'],
    ['subscription_payment_failed', 'past_due', 'PAST_DUE'],
    // event_name without explicit override → status string drives mapping
    ['subscription_created', 'active', 'ACTIVE'],
    ['subscription_created', 'on_trial', 'ACTIVE'],
    ['subscription_updated', 'past_due', 'PAST_DUE'],
    ['subscription_updated', 'unpaid', 'PAST_DUE'],
    ['subscription_payment_success', 'active', 'ACTIVE'],
    // unknown / missing status → PENDING (safe default — no premature grant)
    ['subscription_created', undefined, 'PENDING'],
    ['subscription_created', 'mystery_state', 'PENDING'],
  ])('mapStatus(%s, %s) = %s', (eventName, lsStatus, expected) => {
    expect(mapStatus(eventName, lsStatus)).toBe(expected);
  });
});
