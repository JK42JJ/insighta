/**
 * Issue #389-adjacent — YouTube OAuth re-auth detection.
 *
 * Pins the `isYouTubeReauthError` classifier so the sync-failure toast
 * flow in SourceManagementTab(V2) surfaces the reconnect CTA for the
 * exact error messages the BE emits:
 *
 *   - `src/modules/auth/token-manager.ts:268` → InvalidCredentialsError
 *     with reason "Refresh token expired or revoked"
 *   - `src/api/routes/youtube.ts:50,96` → "YouTube account not connected
 *     or token expired. Please reconnect via Settings."
 *   - Raw `invalid_grant` from Google's OAuth error body
 *
 * Generic sync failures (network, server 500) must NOT classify as
 * re-auth so the reconnect CTA doesn't spam when the fix is a retry.
 */
import { describe, expect, it } from 'vitest';
import { isYouTubeReauthError } from '@/features/youtube-sync/model/useYouTubeSync';

describe('isYouTubeReauthError', () => {
  it('matches the BE InvalidCredentialsError reason string', () => {
    expect(isYouTubeReauthError(new Error('Refresh token expired or revoked'))).toBe(true);
    expect(isYouTubeReauthError(new Error('Token refresh failed'))).toBe(true);
  });

  it('matches raw Google OAuth invalid_grant payload', () => {
    expect(isYouTubeReauthError(new Error('invalid_grant'))).toBe(true);
    expect(isYouTubeReauthError(new Error('OAuth2 request failed: invalid_grant'))).toBe(true);
  });

  it('matches the routes/youtube.ts user-facing copy', () => {
    expect(
      isYouTubeReauthError(
        new Error('YouTube account not connected or token expired. Please reconnect via Settings.')
      )
    ).toBe(true);
  });

  it('is case-insensitive (normalizes to lowercase before matching)', () => {
    expect(isYouTubeReauthError(new Error('INVALID_GRANT'))).toBe(true);
    expect(isYouTubeReauthError(new Error('Refresh Token Expired'))).toBe(true);
  });

  it('does NOT classify generic sync failures as re-auth', () => {
    expect(isYouTubeReauthError(new Error('Network error'))).toBe(false);
    expect(isYouTubeReauthError(new Error('Failed to sync playlist'))).toBe(false);
    expect(isYouTubeReauthError(new Error('Quota exceeded'))).toBe(false);
    expect(isYouTubeReauthError(new Error('Sync failed with status: failed'))).toBe(false);
  });

  it('returns false for non-Error inputs (plain string, null, undefined, object)', () => {
    expect(isYouTubeReauthError('invalid_grant')).toBe(false);
    expect(isYouTubeReauthError(null)).toBe(false);
    expect(isYouTubeReauthError(undefined)).toBe(false);
    expect(isYouTubeReauthError({ message: 'invalid_grant' })).toBe(false);
  });
});
