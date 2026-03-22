import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import { getPrismaClient } from '../database/client';
import { config } from '../../config';
import { logger } from '../../utils/logger';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 32;

const VALID_PROVIDERS = ['gemini', 'openrouter', 'anthropic', 'openai'] as const;
type LlmProvider = (typeof VALID_PROVIDERS)[number];

function deriveKey(salt: Buffer): Buffer {
  return scryptSync(config.encryption.secret, salt, 32);
}

function encrypt(plaintext: string): string {
  const salt = randomBytes(SALT_LENGTH);
  const key = deriveKey(salt);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Format: salt:iv:tag:encrypted (all hex)
  return [salt, iv, tag, encrypted].map((b) => b.toString('hex')).join(':');
}

function decrypt(ciphertext: string): string {
  const [saltHex, ivHex, tagHex, encryptedHex] = ciphertext.split(':') as [
    string,
    string,
    string,
    string,
  ];
  const salt = Buffer.from(saltHex, 'hex');
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const encrypted = Buffer.from(encryptedHex, 'hex');

  const key = deriveKey(salt);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

function maskKey(key: string): string {
  if (key.length <= 8) return '****';
  return key.slice(0, 4) + '****' + key.slice(-4);
}

function isValidProvider(provider: string): provider is LlmProvider {
  return VALID_PROVIDERS.includes(provider as LlmProvider);
}

export async function saveKey(
  userId: string,
  provider: string,
  apiKey: string
): Promise<{ provider: string; status: string; maskedKey: string }> {
  if (!isValidProvider(provider)) {
    throw new Error(`Invalid provider: ${provider}. Valid: ${VALID_PROVIDERS.join(', ')}`);
  }

  const prisma = getPrismaClient();
  const encryptedKey = encrypt(apiKey);

  const result = await prisma.user_llm_keys.upsert({
    where: { user_id_provider: { user_id: userId, provider } },
    update: { encrypted_key: encryptedKey, status: 'active', updated_at: new Date() },
    create: { user_id: userId, provider, encrypted_key: encryptedKey, status: 'active' },
  });

  logger.info('LLM key saved', { userId, provider });

  return { provider: result.provider, status: result.status, maskedKey: maskKey(apiKey) };
}

export async function listKeys(
  userId: string
): Promise<{ provider: string; status: string; maskedKey: string; updatedAt: string }[]> {
  const prisma = getPrismaClient();

  const keys = await prisma.user_llm_keys.findMany({
    where: { user_id: userId },
    orderBy: { provider: 'asc' },
  });

  return keys.map(
    (k: { provider: string; status: string; encrypted_key: string; updated_at: Date }) => ({
      provider: k.provider,
      status: k.status,
      maskedKey: maskKey(decrypt(k.encrypted_key)),
      updatedAt: k.updated_at.toISOString(),
    })
  );
}

export async function deleteKey(userId: string, provider: string): Promise<void> {
  if (!isValidProvider(provider)) {
    throw new Error(`Invalid provider: ${provider}. Valid: ${VALID_PROVIDERS.join(', ')}`);
  }

  const prisma = getPrismaClient();

  await prisma.user_llm_keys.deleteMany({
    where: { user_id: userId, provider },
  });

  logger.info('LLM key deleted', { userId, provider });
}

export async function getDecryptedKey(userId: string, provider: string): Promise<string | null> {
  const prisma = getPrismaClient();

  const key = await prisma.user_llm_keys.findFirst({
    where: { user_id: userId, provider, status: 'active' },
  });

  if (!key) return null;

  return decrypt(key.encrypted_key);
}
