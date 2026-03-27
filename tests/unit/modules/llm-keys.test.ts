/**
 * LLM Keys Unit Tests
 *
 * Tests for:
 * - encrypt/decrypt roundtrip (AES-256-GCM)
 * - maskKey logic
 * - isValidProvider validation
 * - saveKey provider validation
 * - deleteKey provider validation
 */

// ============================================================================
// Mocks (must be before imports)
// ============================================================================

jest.mock('../../../src/config', () => ({
  config: {
    encryption: {
      secret: 'a'.repeat(64) + 'b'.repeat(64),
    },
  },
}));

jest.mock('../../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const mockPrisma = {
  user_llm_keys: {
    upsert: jest.fn(),
    findMany: jest.fn(),
    deleteMany: jest.fn(),
    findFirst: jest.fn(),
    updateMany: jest.fn(),
  },
  $transaction: jest.fn(),
};

jest.mock('../../../src/modules/database/client', () => ({
  getPrismaClient: () => mockPrisma,
}));

// ============================================================================
// Imports
// ============================================================================

import {
  saveKey,
  deleteKey,
  listKeys,
  getDecryptedKey,
} from '../../../src/modules/settings/llm-keys';

// ============================================================================
// Helpers — access private functions via module internals
// We test them indirectly through the public API
// ============================================================================

describe('LLM Keys', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('encrypt/decrypt roundtrip (via saveKey + getDecryptedKey)', () => {
    it('encrypts and decrypts a key correctly', async () => {
      const testKey = 'sk-test-api-key-12345678';
      const userId = 'test-user-id';

      // Capture the encrypted key from the upsert call
      let encryptedKey = '';
      mockPrisma.user_llm_keys.upsert.mockImplementation(async (args: any) => {
        encryptedKey = args.create.encrypted_key;
        return {
          provider: 'openrouter',
          status: 'active',
          encrypted_key: encryptedKey,
        };
      });

      await saveKey(userId, 'openrouter', testKey);

      // Verify encrypted key is not the plaintext
      expect(encryptedKey).not.toBe(testKey);
      expect(encryptedKey).toContain(':'); // salt:iv:tag:encrypted format

      // Now decrypt it
      mockPrisma.user_llm_keys.findFirst.mockResolvedValue({
        user_id: userId,
        provider: 'openrouter',
        encrypted_key: encryptedKey,
        status: 'active',
      });

      const decrypted = await getDecryptedKey(userId, 'openrouter');
      expect(decrypted).toBe(testKey);
    });

    it('produces different ciphertext for same plaintext (random salt/IV)', async () => {
      const testKey = 'sk-same-key-for-both';
      const encryptedKeys: string[] = [];

      mockPrisma.user_llm_keys.upsert.mockImplementation(async (args: any) => {
        encryptedKeys.push(args.create.encrypted_key);
        return {
          provider: 'openrouter',
          status: 'active',
          encrypted_key: args.create.encrypted_key,
        };
      });

      await saveKey('user1', 'openrouter', testKey);
      await saveKey('user2', 'openrouter', testKey);

      expect(encryptedKeys).toHaveLength(2);
      expect(encryptedKeys[0]).not.toBe(encryptedKeys[1]);
    });

    it('encrypted key has 4 hex segments (salt:iv:tag:encrypted)', async () => {
      mockPrisma.user_llm_keys.upsert.mockImplementation(async (args: any) => ({
        provider: 'gemini',
        status: 'active',
        encrypted_key: args.create.encrypted_key,
      }));

      await saveKey('user-id', 'gemini', 'AIzaSy-test-key');

      const encryptedKey = mockPrisma.user_llm_keys.upsert.mock.calls[0][0].create.encrypted_key;
      const segments = encryptedKey.split(':');
      expect(segments).toHaveLength(4);

      // salt = 32 bytes = 64 hex chars
      expect(segments[0]).toHaveLength(64);
      // iv = 16 bytes = 32 hex chars
      expect(segments[1]).toHaveLength(32);
      // tag = 16 bytes = 32 hex chars
      expect(segments[2]).toHaveLength(32);
      // encrypted data length > 0
      expect(segments[3].length).toBeGreaterThan(0);
    });
  });

  describe('maskKey (via saveKey return value)', () => {
    it('masks long keys showing first 4 and last 4 chars', async () => {
      mockPrisma.user_llm_keys.upsert.mockResolvedValue({
        provider: 'openrouter',
        status: 'active',
      });

      const result = await saveKey('user-id', 'openrouter', 'sk-or-v1-abcdef123456');
      expect(result.maskedKey).toBe('sk-o****3456');
    });

    it('masks short keys (<=8 chars) as ****', async () => {
      mockPrisma.user_llm_keys.upsert.mockResolvedValue({
        provider: 'openai',
        status: 'active',
      });

      const result = await saveKey('user-id', 'openai', '12345678');
      expect(result.maskedKey).toBe('****');
    });

    it('masks 9-char key correctly', async () => {
      mockPrisma.user_llm_keys.upsert.mockResolvedValue({
        provider: 'anthropic',
        status: 'active',
      });

      const result = await saveKey('user-id', 'anthropic', '123456789');
      expect(result.maskedKey).toBe('1234****6789');
    });
  });

  describe('provider validation', () => {
    it('accepts valid providers', async () => {
      const validProviders = ['gemini', 'openrouter', 'anthropic', 'openai', 'perplexity'];

      for (const provider of validProviders) {
        mockPrisma.user_llm_keys.upsert.mockResolvedValue({
          provider,
          status: 'active',
        });

        const result = await saveKey('user-id', provider, 'test-key-long-enough');
        expect(result.provider).toBe(provider);
      }
    });

    it('rejects invalid provider in saveKey', async () => {
      await expect(saveKey('user-id', 'invalid-provider', 'test-key')).rejects.toThrow(
        'Invalid provider: invalid-provider'
      );
    });

    it('rejects invalid provider in deleteKey', async () => {
      await expect(deleteKey('user-id', 'not-a-provider')).rejects.toThrow(
        'Invalid provider: not-a-provider'
      );
    });

    it('rejects empty string provider', async () => {
      await expect(saveKey('user-id', '', 'test-key')).rejects.toThrow('Invalid provider');
    });
  });

  describe('listKeys', () => {
    it('returns masked keys ordered by priority', async () => {
      mockPrisma.user_llm_keys.findMany.mockResolvedValue([
        {
          provider: 'openrouter',
          status: 'active',
          priority: 1,
          encrypted_key: '', // Will be set below
          updated_at: new Date('2026-03-28'),
        },
      ]);

      // First save a key to get a valid encrypted value
      let validEncryptedKey = '';
      mockPrisma.user_llm_keys.upsert.mockImplementation(async (args: any) => {
        validEncryptedKey = args.create.encrypted_key;
        return { provider: 'openrouter', status: 'active' };
      });
      await saveKey('user-id', 'openrouter', 'sk-test-key-12345678');

      // Now mock findMany with the real encrypted key
      mockPrisma.user_llm_keys.findMany.mockResolvedValue([
        {
          provider: 'openrouter',
          status: 'active',
          priority: 1,
          encrypted_key: validEncryptedKey,
          updated_at: new Date('2026-03-28'),
        },
      ]);

      const keys = await listKeys('user-id');
      expect(keys).toHaveLength(1);
      expect(keys[0]!.provider).toBe('openrouter');
      expect(keys[0]!.maskedKey).toBe('sk-t****5678');
      expect(keys[0]!.priority).toBe(1);
    });
  });

  describe('getDecryptedKey', () => {
    it('returns null when no key found', async () => {
      mockPrisma.user_llm_keys.findFirst.mockResolvedValue(null);

      const result = await getDecryptedKey('user-id', 'openrouter');
      expect(result).toBeNull();
    });
  });
});
