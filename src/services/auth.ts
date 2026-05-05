import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { users, drivers, type User, type UserRole } from '../db/schema.js';
import { hashPassword, verifyPassword, createAccessToken, createRefreshToken, decodeToken } from '../core/security.js';
import { ConflictError, UnauthorizedError } from '../core/errors.js';
import { config } from '../config.js';

export const customerRegisterSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(128),
  full_name: z.string().min(1).max(255),
  phone: z.string().max(32).optional().nullable(),
});

export const driverRegisterSchema = customerRegisterSchema.extend({
  license_number: z.string().min(3).max(64),
  vehicle_type: z.string().min(1).max(64),
  vehicle_plate: z.string().min(1).max(32),
  vehicle_capacity_kg: z.number().positive().optional().nullable(),
});

export const loginJsonSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  role: z.enum(['customer', 'driver', 'admin']).optional(),
});

export const refreshTokenSchema = z.object({
  refresh_token: z.string().min(1),
});

export type CustomerRegister = z.infer<typeof customerRegisterSchema>;
export type DriverRegister = z.infer<typeof driverRegisterSchema>;

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: 'bearer';
  expires_in: number;
}

export function userMe(u: User) {
  return {
    id: u.id,
    email: u.email,
    full_name: u.fullName,
    phone: u.phone,
    role: u.role,
    is_active: u.isActive,
    profile_image_url: u.profileImageUrl,
    created_at: u.createdAt,
  };
}

export function userPublic(u: User) {
  return {
    id: u.id,
    full_name: u.fullName,
    role: u.role,
    profile_image_url: u.profileImageUrl,
    created_at: u.createdAt,
  };
}

function makeTokenResponse(userId: number, role: string): TokenResponse {
  return {
    access_token: createAccessToken(userId, role),
    refresh_token: createRefreshToken(userId),
    token_type: 'bearer',
    expires_in: config.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
  };
}

export async function registerCustomer(data: CustomerRegister): Promise<User> {
  const db = getDb();
  const email = data.email.toLowerCase();
  const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing.length > 0) throw new ConflictError('Email already registered');
  const hashed = await hashPassword(data.password);
  const inserted = await db
    .insert(users)
    .values({
      email,
      hashedPassword: hashed,
      fullName: data.full_name,
      phone: data.phone ?? null,
      role: 'customer',
    })
    .returning();
  return inserted[0]!;
}

export async function registerDriver(data: DriverRegister): Promise<User> {
  const db = getDb();
  const email = data.email.toLowerCase();
  const existingEmail = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existingEmail.length > 0) throw new ConflictError('Email already registered');
  const existingLicense = await db
    .select()
    .from(drivers)
    .where(eq(drivers.licenseNumber, data.license_number))
    .limit(1);
  if (existingLicense.length > 0) throw new ConflictError('License already registered');

  const hashed = await hashPassword(data.password);

  return await db.transaction(async (tx) => {
    const u = (await tx
      .insert(users)
      .values({
        email,
        hashedPassword: hashed,
        fullName: data.full_name,
        phone: data.phone ?? null,
        role: 'driver',
      })
      .returning())[0]!;

    await tx.insert(drivers).values({
      userId: u.id,
      licenseNumber: data.license_number,
      vehicleType: data.vehicle_type,
      vehiclePlate: data.vehicle_plate,
      vehicleCapacityKg: data.vehicle_capacity_kg ?? null,
      status: 'offline',
    });

    return u;
  });
}

export async function loginByEmail(
  email: string,
  password: string,
  expectedRole?: UserRole
): Promise<TokenResponse> {
  const db = getDb();
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .limit(1);
  const user = rows[0];
  if (!user || !user.isActive) throw new UnauthorizedError('Invalid credentials');
  const ok = await verifyPassword(password, user.hashedPassword);
  if (!ok) throw new UnauthorizedError('Invalid credentials');
  if (expectedRole && user.role !== expectedRole) {
    throw new UnauthorizedError('Invalid credentials for role');
  }
  return makeTokenResponse(user.id, user.role);
}

export async function refresh(refreshToken: string): Promise<TokenResponse> {
  const payload = decodeToken(refreshToken, 'refresh');
  const userId = Number(payload.sub);
  const db = getDb();
  const u = (await db.select().from(users).where(eq(users.id, userId)).limit(1))[0];
  if (!u || !u.isActive) throw new UnauthorizedError('Invalid refresh token');
  return makeTokenResponse(u.id, u.role);
}

export { makeTokenResponse };
