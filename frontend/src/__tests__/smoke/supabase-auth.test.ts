/**
 * Supabase Auth Helpers Tests
 *
 * Tests for:
 * - getEdgeFunctionUrl — URL construction (pure function)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Supabase client before importing module
vi.mock('@shared/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: 'mock-token-123' } },
        error: null,
      }),
      refreshSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: 'refreshed-token-456' } },
        error: null,
      }),
      onAuthStateChange: vi
        .fn()
        .mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
  },
}));

vi.mock('@shared/lib/auth-event-bus', () => ({
  subscribeAuth: vi.fn(),
}));

import { getEdgeFunctionUrl } from '@shared/lib/supabase-auth';

describe('supabase-auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getEdgeFunctionUrl', () => {
    it('constructs URL with function name and action parameter', () => {
      const url = getEdgeFunctionUrl('local-cards', 'list');
      expect(url).toMatch(/\/functions\/v1\/local-cards\?action=list$/);
    });

    it('includes the Supabase URL as base', () => {
      const url = getEdgeFunctionUrl('local-cards', 'list');
      // Should start with a valid URL (from env)
      expect(url).toMatch(/^https?:\/\/.+\/functions\/v1\//);
    });

    it('handles add action', () => {
      const url = getEdgeFunctionUrl('local-cards', 'add');
      expect(url).toContain('/functions/v1/local-cards?action=add');
    });

    it('handles batch-move action', () => {
      const url = getEdgeFunctionUrl('local-cards', 'batch-move');
      expect(url).toContain('/functions/v1/local-cards?action=batch-move');
    });

    it('handles different function names', () => {
      expect(getEdgeFunctionUrl('youtube-sync', 'status')).toContain(
        '/functions/v1/youtube-sync?action=status'
      );
      expect(getEdgeFunctionUrl('fetch-url-metadata', 'fetch')).toContain(
        '/functions/v1/fetch-url-metadata?action=fetch'
      );
      expect(getEdgeFunctionUrl('fetch-transcript', 'extract')).toContain(
        '/functions/v1/fetch-transcript?action=extract'
      );
    });
  });
});
