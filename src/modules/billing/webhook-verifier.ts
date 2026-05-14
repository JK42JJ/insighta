/**
 * Lemon Squeezy webhook signature verifier.
 *
 * LS signs webhook payloads with HMAC-SHA256 using the webhook secret.
 * Header: `X-Signature` (hex digest). We compute HMAC over the raw body
 * (NOT the JSON-parsed body — byte equality required) and timing-safe
 * compare to the header value.
 *
 * Reject when:
 * - X-Signature header missing or empty
 * - hex length mismatch (avoids timingSafeEqual throw)
 * - HMAC mismatch
 *
 * Caller must hold the raw body Buffer. Fastify default JSON parser
 * discards it — register a route-scoped `application/json` parser with
 * `parseAs: 'buffer'` for the webhook route.
 */

import crypto from 'node:crypto';

const HEX_DIGEST_LENGTH = 64; // sha256 hex = 32 bytes × 2

export interface VerifyResult {
  ok: boolean;
  reason?: 'missing_signature' | 'malformed_signature' | 'mismatch';
}

export function verifyLemonSqueezySignature(
  rawBody: Buffer,
  signatureHeader: string | string[] | undefined,
  secret: string
): VerifyResult {
  if (!signatureHeader) {
    return { ok: false, reason: 'missing_signature' };
  }
  const sig = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
  if (!sig || sig.length !== HEX_DIGEST_LENGTH) {
    return { ok: false, reason: 'malformed_signature' };
  }
  let expected: string;
  try {
    expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  } catch {
    return { ok: false, reason: 'mismatch' };
  }
  const sigBuf = Buffer.from(sig, 'hex');
  const expBuf = Buffer.from(expected, 'hex');
  if (sigBuf.length !== expBuf.length) {
    return { ok: false, reason: 'malformed_signature' };
  }
  const equal = crypto.timingSafeEqual(sigBuf, expBuf);
  return equal ? { ok: true } : { ok: false, reason: 'mismatch' };
}
