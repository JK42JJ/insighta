// Unit tests for Lemon Squeezy webhook signature verifier (pure, no env).
import crypto from 'node:crypto';
import { verifyLemonSqueezySignature } from '../../../src/modules/billing/webhook-verifier';

export {};

const SECRET = 'test_webhook_secret_unit';

function sign(body: Buffer | string, secret = SECRET): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

describe('verifyLemonSqueezySignature', () => {
  test('valid signature passes', () => {
    const body = Buffer.from('{"meta":{"event_name":"subscription_created"},"data":{}}');
    const sig = sign(body);
    expect(verifyLemonSqueezySignature(body, sig, SECRET)).toEqual({ ok: true });
  });

  test('tampered body fails with mismatch', () => {
    const body = Buffer.from('{"a":1}');
    const sig = sign(body);
    const tampered = Buffer.from('{"a":2}');
    expect(verifyLemonSqueezySignature(tampered, sig, SECRET).ok).toBe(false);
  });

  test('wrong secret fails with mismatch', () => {
    const body = Buffer.from('{"a":1}');
    const sig = sign(body, 'wrong_secret');
    expect(verifyLemonSqueezySignature(body, sig, SECRET).ok).toBe(false);
  });

  test('missing signature header → missing_signature', () => {
    const body = Buffer.from('{}');
    expect(verifyLemonSqueezySignature(body, undefined, SECRET)).toEqual({
      ok: false,
      reason: 'missing_signature',
    });
  });

  test('empty signature → malformed_signature', () => {
    const body = Buffer.from('{}');
    expect(verifyLemonSqueezySignature(body, '', SECRET)).toEqual({
      ok: false,
      reason: 'missing_signature',
    });
  });

  test('short hex signature → malformed_signature (avoids timingSafeEqual throw)', () => {
    const body = Buffer.from('{}');
    expect(verifyLemonSqueezySignature(body, 'abc123', SECRET)).toEqual({
      ok: false,
      reason: 'malformed_signature',
    });
  });

  test('array header (multiple X-Signature) — first wins', () => {
    const body = Buffer.from('{}');
    const sig = sign(body);
    expect(verifyLemonSqueezySignature(body, [sig, 'garbage'], SECRET).ok).toBe(true);
  });
});
