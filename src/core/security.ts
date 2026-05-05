import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { UnauthorizedError } from './errors.js';

const SALT_ROUNDS = process.env.BCRYPT_SALT_ROUNDS ? Number(process.env.BCRYPT_SALT_ROUNDS) : 12;

export type TokenType = 'access' | 'refresh';

export interface JwtPayload {
  sub: string;
  iat: number;
  exp: number;
  type: TokenType;
  role?: string;
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export async function verifyPassword(plain: string, hashed: string): Promise<boolean> {
  return bcrypt.compare(plain, hashed);
}

export function createAccessToken(userId: string | number, role: string): string {
  const expiresIn = config.ACCESS_TOKEN_EXPIRE_MINUTES * 60;
  return jwt.sign(
    { type: 'access', role },
    config.SECRET_KEY,
    { algorithm: 'HS256', expiresIn, subject: String(userId) }
  );
}

export function createRefreshToken(userId: string | number): string {
  const expiresIn = config.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60;
  return jwt.sign(
    { type: 'refresh' },
    config.SECRET_KEY,
    { algorithm: 'HS256', expiresIn, subject: String(userId) }
  );
}

export function decodeToken(token: string, expectedType: TokenType): JwtPayload {
  let payload: jwt.JwtPayload | string;
  try {
    payload = jwt.verify(token, config.SECRET_KEY, { algorithms: ['HS256'] });
  } catch {
    throw new UnauthorizedError('Invalid or expired token');
  }
  if (typeof payload === 'string' || !payload || typeof payload !== 'object') {
    throw new UnauthorizedError('Invalid token payload');
  }
  const p = payload as jwt.JwtPayload;
  if (p.type !== expectedType) {
    throw new UnauthorizedError('Invalid token type');
  }
  if (!p.sub || typeof p.sub !== 'string') {
    throw new UnauthorizedError('Invalid token subject');
  }
  return {
    sub: p.sub,
    iat: p.iat ?? 0,
    exp: p.exp ?? 0,
    type: p.type as TokenType,
    role: typeof p.role === 'string' ? p.role : undefined,
  };
}
