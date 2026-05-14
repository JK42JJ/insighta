/**
 * youtube/api.ts — getAccessToken unit tests
 *
 * Covers:
 *   (a) valid (non-expired) token returned as-is, no refresh triggered
 *   (b) expired token + refresh_token present → refresh called, new token
 *       persisted to DB, new token returned
 *   (c) expired token + no refresh_token → null returned
 *   (d) expired token + refresh_token present, but refresh throws → null returned
 */

// ── Mock: Prisma ──────────────────────────────────────────────────────────────
const mockFindUnique = jest.fn();
const mockUpdate = jest.fn();

jest.mock('@/modules/database', () => ({
  getPrismaClient: () => ({
    youtube_sync_settings: {
      findUnique: mockFindUnique,
      update: mockUpdate,
    },
  }),
}));

// ── Mock: googleapis ─────────────────────────────────────────────────────────
const mockSetCredentials = jest.fn();
const mockRefreshAccessToken = jest.fn();
const MockOAuth2 = jest.fn().mockImplementation(() => ({
  setCredentials: mockSetCredentials,
  refreshAccessToken: mockRefreshAccessToken,
}));

jest.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: MockOAuth2,
    },
  },
}));

// ── Mock: config ──────────────────────────────────────────────────────────────
jest.mock('@/config/index', () => ({
  config: {
    youtube: {
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      redirectUri: 'http://localhost/callback',
    },
  },
}));

// ── Mock: logger ──────────────────────────────────────────────────────────────
const mockLoggerWarn = jest.fn();
jest.mock('@/utils/logger', () => ({
  logger: {
    warn: mockLoggerWarn,
    info: jest.fn(),
    error: jest.fn(),
  },
}));

// ── Import after mocks ────────────────────────────────────────────────────────
import { getAccessToken } from '../../../src/modules/youtube/api';

const USER_ID = 'user-uuid-001';
const VALID_TOKEN = 'ya29.valid-access-token';
const REFRESH_TOKEN = 'refresh-token-abc';
const NEW_ACCESS_TOKEN = 'ya29.new-access-token';
const FUTURE_DATE = new Date(Date.now() + 3_600_000); // 1 h from now
const PAST_DATE = new Date(Date.now() - 3_600_000); // 1 h ago

beforeEach(() => {
  jest.clearAllMocks();
});

// ── (a) Valid token — no refresh ──────────────────────────────────────────────
describe('getAccessToken — valid token (not expired)', () => {
  it('returns the stored token without calling refresh', async () => {
    mockFindUnique.mockResolvedValue({
      youtube_access_token: VALID_TOKEN,
      youtube_token_expires_at: FUTURE_DATE,
      youtube_refresh_token: REFRESH_TOKEN,
    });

    const result = await getAccessToken(USER_ID);

    expect(result).toBe(VALID_TOKEN);
    expect(MockOAuth2).not.toHaveBeenCalled();
    expect(mockRefreshAccessToken).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('returns the stored token when expires_at is null (no expiry set)', async () => {
    mockFindUnique.mockResolvedValue({
      youtube_access_token: VALID_TOKEN,
      youtube_token_expires_at: null,
      youtube_refresh_token: null,
    });

    const result = await getAccessToken(USER_ID);

    expect(result).toBe(VALID_TOKEN);
    expect(mockRefreshAccessToken).not.toHaveBeenCalled();
  });
});

// ── (b) Expired token + refresh_token → refresh succeeds ─────────────────────
describe('getAccessToken — expired token with refresh_token', () => {
  it('calls OAuth2 refresh, persists new token, returns new token', async () => {
    const newExpiry = Date.now() + 3_600_000;

    mockFindUnique.mockResolvedValue({
      youtube_access_token: 'ya29.old-expired',
      youtube_token_expires_at: PAST_DATE,
      youtube_refresh_token: REFRESH_TOKEN,
    });
    mockRefreshAccessToken.mockResolvedValue({
      credentials: {
        access_token: NEW_ACCESS_TOKEN,
        expiry_date: newExpiry,
      },
    });
    mockUpdate.mockResolvedValue({});

    const result = await getAccessToken(USER_ID);

    // OAuth2 client constructed with correct config values
    expect(MockOAuth2).toHaveBeenCalledWith(
      'test-client-id',
      'test-client-secret',
      'http://localhost/callback'
    );
    // Credentials set with stored refresh token
    expect(mockSetCredentials).toHaveBeenCalledWith({ refresh_token: REFRESH_TOKEN });
    // Refresh was performed
    expect(mockRefreshAccessToken).toHaveBeenCalledTimes(1);
    // New token persisted to DB
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { user_id: USER_ID },
      data: {
        youtube_access_token: NEW_ACCESS_TOKEN,
        youtube_token_expires_at: new Date(newExpiry),
      },
    });
    // New token returned to caller
    expect(result).toBe(NEW_ACCESS_TOKEN);
    expect(mockLoggerWarn).not.toHaveBeenCalled();
  });
});

// ── (c) Expired token + no refresh_token → null ───────────────────────────────
describe('getAccessToken — expired token without refresh_token', () => {
  it('returns null without attempting refresh', async () => {
    mockFindUnique.mockResolvedValue({
      youtube_access_token: 'ya29.old-expired',
      youtube_token_expires_at: PAST_DATE,
      youtube_refresh_token: null,
    });

    const result = await getAccessToken(USER_ID);

    expect(result).toBeNull();
    expect(mockRefreshAccessToken).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

// ── (d) Refresh throws → null (caller not crashed) ───────────────────────────
describe('getAccessToken — refresh throws', () => {
  it('logs a warning and returns null when refreshAccessToken rejects', async () => {
    mockFindUnique.mockResolvedValue({
      youtube_access_token: 'ya29.old-expired',
      youtube_token_expires_at: PAST_DATE,
      youtube_refresh_token: REFRESH_TOKEN,
    });
    mockRefreshAccessToken.mockRejectedValue(new Error('invalid_grant'));

    const result = await getAccessToken(USER_ID);

    expect(result).toBeNull();
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      'YouTube OAuth token refresh failed',
      expect.objectContaining({ userId: USER_ID })
    );
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('returns null when no access_token in refresh response', async () => {
    mockFindUnique.mockResolvedValue({
      youtube_access_token: 'ya29.old-expired',
      youtube_token_expires_at: PAST_DATE,
      youtube_refresh_token: REFRESH_TOKEN,
    });
    mockRefreshAccessToken.mockResolvedValue({
      credentials: { access_token: null, expiry_date: null },
    });

    const result = await getAccessToken(USER_ID);

    expect(result).toBeNull();
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      'YouTube token refresh returned no access_token',
      expect.objectContaining({ userId: USER_ID })
    );
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

// ── No settings row → null ────────────────────────────────────────────────────
describe('getAccessToken — no settings row', () => {
  it('returns null when settings row does not exist', async () => {
    mockFindUnique.mockResolvedValue(null);

    const result = await getAccessToken(USER_ID);

    expect(result).toBeNull();
    expect(mockRefreshAccessToken).not.toHaveBeenCalled();
  });
});
