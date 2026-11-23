import crypto from 'crypto';
import { sha256 } from '@/lib/crypto/hash';

const TOKEN_PATTERN = /^pf_[a-f0-9]{8}_[A-Za-z0-9_-]{43}$/;

export interface GeneratedApiKey {
  token: string;
  prefix: string;
  keyHash: string;
}

export function generateApiKey(): GeneratedApiKey {
  const prefix = crypto.randomBytes(4).toString('hex');
  const secret = crypto.randomBytes(32).toString('base64url');
  const token = `pf_${prefix}_${secret}`;
  return { token, prefix, keyHash: sha256(token) };
}

export function parseBearerToken(authorization: string | null): string | null {
  if (!authorization) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  if (!match || !TOKEN_PATTERN.test(match[1])) return null;
  return match[1];
}
