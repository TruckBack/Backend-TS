import { z } from 'zod';
import { eq, and, inArray } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { drivers, orders, type Driver, type DriverStatus, type User } from '../db/schema.js';
import { BadRequestError, ForbiddenError, NotFoundError } from '../core/errors.js';
import { ACTIVE_DRIVER_STATUSES } from './order.js';

export const driverProfileUpdateSchema = z.object({
  vehicle_type: z.string().min(1).max(64).optional(),
  vehicle_plate: z.string().min(1).max(32).optional(),
  vehicle_capacity_kg: z.number().positive().optional().nullable(),
});

export const driverStatusUpdateSchema = z.object({
  status: z.enum(['offline', 'available', 'busy']),
});

export const driverLocationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export function driverProfile(d: Driver) {
  return {
    id: d.id,
    user_id: d.userId,
    license_number: d.licenseNumber,
    vehicle_type: d.vehicleType,
    vehicle_plate: d.vehiclePlate,
    vehicle_capacity_kg: d.vehicleCapacityKg,
    status: d.status,
    current_lat: d.currentLat,
    current_lng: d.currentLng,
    last_location_at: d.lastLocationAt,
    rating: d.rating,
  };
}

export async function getMyDriver(user: User): Promise<Driver> {
  const db = getDb();
  const rows = await db.select().from(drivers).where(eq(drivers.userId, user.id)).limit(1);
  const d = rows[0];
  if (!d) throw new NotFoundError('Driver profile not found');
  return d;
}

export async function getDriverById(driverId: number): Promise<Driver> {
  const db = getDb();
  const rows = await db.select().from(drivers).where(eq(drivers.id, driverId)).limit(1);
  const d = rows[0];
  if (!d) throw new NotFoundError('Driver not found');
  return d;
}

export async function updateProfile(
  user: User,
  data: z.infer<typeof driverProfileUpdateSchema>
): Promise<Driver> {
  const db = getDb();
  const driver = await getMyDriver(user);
  const patch: Partial<typeof drivers.$inferInsert> = { updatedAt: new Date() };
  if (data.vehicle_type !== undefined) patch.vehicleType = data.vehicle_type;
  if (data.vehicle_plate !== undefined) patch.vehiclePlate = data.vehicle_plate;
  if (data.vehicle_capacity_kg !== undefined) patch.vehicleCapacityKg = data.vehicle_capacity_kg;
  const updated = await db.update(drivers).set(patch).where(eq(drivers.id, driver.id)).returning();
  return updated[0]!;
}

export async function updateStatus(user: User, status: DriverStatus): Promise<Driver> {
  if (status === 'busy') {
    throw new BadRequestError('Cannot manually set status to busy');
  }
  const db = getDb();
  const driver = await getMyDriver(user);
  if (status === 'available') {
    const active = await db
      .select()
      .from(orders)
      .where(and(eq(orders.driverId, driver.id), inArray(orders.status, ACTIVE_DRIVER_STATUSES)))
      .limit(1);
    if (active.length > 0) {
      throw new BadRequestError('Driver has an active order');
    }
  }
  const updated = await db
    .update(drivers)
    .set({ status, updatedAt: new Date() })
    .where(eq(drivers.id, driver.id))
    .returning();
  return updated[0]!;
}

export async function updateLocation(user: User, lat: number, lng: number): Promise<Driver> {
  const db = getDb();
  const driver = await getMyDriver(user);
  const updated = await db
    .update(drivers)
    .set({ currentLat: lat, currentLng: lng, lastLocationAt: new Date(), updatedAt: new Date() })
    .where(eq(drivers.id, driver.id))
    .returning();
  return updated[0]!;
}

export function ensureRole(user: User, role: 'driver' | 'customer' | 'admin'): void {
  if (user.role !== role) throw new ForbiddenError('Forbidden role');
}
