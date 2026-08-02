import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

/** 从任意密钥材料派生 32 字节 AES-256 密钥（SHA-256）。 */
function deriveKey(secretKey: string): Buffer {
  return createHash('sha256').update(secretKey, 'utf8').digest();
}

/**
 * AES-256-GCM 加密。输出格式：base64( iv(12) | tag(16) | ciphertext )。
 * 密文带完整性校验，密钥错误时解密会抛异常。
 */
export function encryptSecret(plain: string, secretKey: string): string {
  const key = deriveKey(secretKey);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

/** 解密 AES-256-GCM 密文。密钥错误/数据被篡改时抛出 Error。 */
export function decryptSecret(payload: string, secretKey: string): string {
  const key = deriveKey(secretKey);
  const raw = Buffer.from(payload, 'base64');
  if (raw.length < IV_LENGTH + TAG_LENGTH + 1) {
    throw new Error('invalid encrypted payload');
  }
  const iv = raw.subarray(0, IV_LENGTH);
  const tag = raw.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const data = raw.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
