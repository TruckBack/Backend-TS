import { OAuth2Client } from 'google-auth-library';
import { eq } from 'drizzle-orm';
import { config } from '../config.js';
import { getDb } from '../db/index.js';
import { users, drivers, type UserRole } from '../db/schema.js';
import { BadRequestError, UnauthorizedError } from '../core/errors.js';
import { makeTokenResponse, type TokenResponse } from './auth.js';
import { hashPassword } from '../core/security.js';

export interface GoogleProfile {
  sub: string;
  email: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
}

type Verifier = (idToken: string) => Promise<GoogleProfile>;

let _verifier: Verifier | null = null;

export function setGoogleVerifier(v: Verifier | null): void {
  _verifier = v;
}

async function defaultVerifier(idToken: string): Promise<GoogleProfile> {
  if (!config.GOOGLE_CLIENT_ID) {
    throw new BadRequestError('Google OAuth not configured');
  }
  const client = new OAuth2Client(config.GOOGLE_CLIENT_ID);
  const ticket = await client.verifyIdToken({
    idToken,
    audience: config.GOOGLE_CLIENT_ID,
  });
  const payload = ticket.getPayload();
  if (!payload?.sub || !payload.email) throw new UnauthorizedError('Invalid Google token');
  return {
    sub: payload.sub,
    email: payload.email,
    email_verified: payload.email_verified,
    name: payload.name,
    picture: payload.picture,
  };
}

export async function verifyIdToken(idToken: string): Promise<GoogleProfile> {
  return (_verifier ?? defaultVerifier)(idToken);
}

export function buildAuthUrl(role?: string): string {
  if (!config.GOOGLE_CLIENT_ID) throw new BadRequestError('Google OAuth not configured');
  const params = new URLSearchParams({
    client_id: config.GOOGLE_CLIENT_ID,
    redirect_uri: config.GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    prompt: 'consent',
  });
  if (role) params.set('state', role);
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

type ExchangeFn = (code: string) => Promise<GoogleProfile>;
let _exchanger: ExchangeFn | null = null;
export function setGoogleCodeExchanger(fn: ExchangeFn | null): void {
  _exchanger = fn;
}

export async function exchangeCodeForProfile(code: string): Promise<GoogleProfile> {
  if (_exchanger) return _exchanger(code);
  if (!config.GOOGLE_CLIENT_ID || !config.GOOGLE_CLIENT_SECRET) {
    throw new BadRequestError('Google OAuth not configured');
  }
  const client = new OAuth2Client({
    clientId: config.GOOGLE_CLIENT_ID,
    clientSecret: config.GOOGLE_CLIENT_SECRET,
    redirectUri: config.GOOGLE_REDIRECT_URI,
  });
  const { tokens } = await client.getToken(code);
  if (!tokens.id_token) throw new UnauthorizedError('No id_token from Google');
  return verifyIdToken(tokens.id_token);
}

export async function loginOrRegisterFromProfile(
  profile: GoogleProfile,
  role?: UserRole
): Promise<TokenResponse> {
  const db = getDb();
  const email = profile.email.toLowerCase();
  const byEmail = (await db.select().from(users).where(eq(users.email, email)).limit(1))[0];
  if (byEmail) {
    if (!byEmail.googleId) {
      await db.update(users).set({ googleId: profile.sub, updatedAt: new Date() }).where(eq(users.id, byEmail.id));
    }
    return makeTokenResponse(byEmail.id, byEmail.role);
  }

  // Need to create user. Role is required for driver creation; default 'customer'.
  const userRole: UserRole = role ?? 'customer';
  if (userRole === 'driver') {
    throw new BadRequestError('Drivers must register through driver registration first');
  }
  const dummyPassword = await hashPassword(`google:${profile.sub}:${Date.now()}`);
  const newUser = (
    await db
      .insert(users)
      .values({
        email,
        hashedPassword: dummyPassword,
        fullName: profile.name ?? email.split('@')[0]!,
        role: userRole,
        googleId: profile.sub,
        profileImageUrl: profile.picture ?? null,
      })
      .returning()
  )[0]!;
  return makeTokenResponse(newUser.id, newUser.role);
}

// Re-export for type-only usage
export type { TokenResponse };
// To silence unused import warnings for `drivers` (driver auto-create disallowed via Google).
void drivers;
