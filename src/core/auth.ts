import type { FastifyReply, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { decodeToken } from './security.js';
import { ForbiddenError, UnauthorizedError } from './errors.js';
import { getDb } from '../db/index.js';
import { users, type User, type UserRole } from '../db/schema.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: User;
  }
}

function extractToken(req: FastifyRequest): string {
  const auth = req.headers['authorization'];
  if (!auth || typeof auth !== 'string') throw new UnauthorizedError('Missing Authorization header');
  const [scheme, token] = auth.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    throw new UnauthorizedError('Invalid Authorization header');
  }
  return token;
}

export async function requireAuth(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const token = extractToken(req);
  const payload = decodeToken(token, 'access');
  const userId = Number(payload.sub);
  if (!Number.isFinite(userId)) throw new UnauthorizedError('Invalid token subject');
  const db = getDb();
  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const user = rows[0];
  if (!user || !user.isActive) throw new UnauthorizedError('User not found or inactive');
  req.user = user;
}

export function requireRole(...roles: UserRole[]) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    await requireAuth(req, reply);
    if (!req.user || !roles.includes(req.user.role as UserRole)) {
      throw new ForbiddenError('Insufficient role');
    }
  };
}

// Used by WS routes — extracts token from query and resolves user.
export async function authenticateWsToken(token: string | undefined): Promise<User> {
  if (!token) throw new UnauthorizedError('Missing token');
  const payload = decodeToken(token, 'access');
  const userId = Number(payload.sub);
  if (!Number.isFinite(userId)) throw new UnauthorizedError('Invalid token subject');
  const db = getDb();
  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const user = rows[0];
  if (!user || !user.isActive) throw new UnauthorizedError('User not found or inactive');
  return user;
}
