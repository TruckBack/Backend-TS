import { z } from 'zod';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import {
  drivers,
  orders,
  driverRatings,
  type Driver,
  type Order,
  type OrderStatus,
  type User,
} from '../db/schema.js';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  InvalidStateError,
  NotFoundError,
} from '../core/errors.js';
import { orderTrackManager } from './wsManager.js';

export const orderCreateSchema = z.object({
  pickup_address: z.string().min(1).max(512),
  pickup_lat: z.number().min(-90).max(90),
  pickup_lng: z.number().min(-180).max(180),
  dropoff_address: z.string().min(1).max(512),
  dropoff_lat: z.number().min(-90).max(90),
  dropoff_lng: z.number().min(-180).max(180),
  cargo_description: z.string().max(512).optional().nullable(),
  cargo_weight_kg: z.number().positive().optional().nullable(),
  notes: z.string().optional().nullable(),
  price_cents: z.number().int().positive(),
  currency: z.string().min(3).max(8).default('USD'),
});

export const orderUpdateSchema = z.object({
  pickup_address: z.string().min(1).max(512).optional(),
  pickup_lat: z.number().min(-90).max(90).optional(),
  pickup_lng: z.number().min(-180).max(180).optional(),
  dropoff_address: z.string().min(1).max(512).optional(),
  dropoff_lat: z.number().min(-90).max(90).optional(),
  dropoff_lng: z.number().min(-180).max(180).optional(),
  cargo_description: z.string().max(512).optional().nullable(),
  cargo_weight_kg: z.number().positive().optional().nullable(),
  notes: z.string().optional().nullable(),
  price_cents: z.number().int().positive().optional(),
  currency: z.string().min(3).max(8).optional(),
});

export const ratingCreateSchema = z.object({
  score: z.number().int().min(1).max(5),
  comment: z.string().max(1000).optional().nullable(),
});

export const driverResponseSchema = z.object({
  response: z.string().min(1).max(2000),
});

export type OrderCreate = z.infer<typeof orderCreateSchema>;
export type OrderUpdate = z.infer<typeof orderUpdateSchema>;

export const ACTIVE_DRIVER_STATUSES: OrderStatus[] = ['accepted', 'in_progress', 'picked_up'];
export const ACTIVE_CUSTOMER_STATUSES: OrderStatus[] = ['pending', 'accepted', 'in_progress', 'picked_up'];

const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ['accepted', 'cancelled'],
  accepted: ['in_progress', 'cancelled'],
  in_progress: ['picked_up', 'cancelled'],
  picked_up: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new InvalidStateError(`Cannot transition order from ${from} to ${to}`);
  }
}

export function orderRead(o: Order) {
  return {
    id: o.id,
    customer_id: o.customerId,
    driver_id: o.driverId,
    status: o.status,
    pickup_address: o.pickupAddress,
    pickup_lat: o.pickupLat,
    pickup_lng: o.pickupLng,
    dropoff_address: o.dropoffAddress,
    dropoff_lat: o.dropoffLat,
    dropoff_lng: o.dropoffLng,
    notes: o.notes,
    cargo_description: o.cargoDescription,
    cargo_weight_kg: o.cargoWeightKg,
    price_cents: o.priceCents,
    currency: o.currency,
    accepted_at: o.acceptedAt,
    started_at: o.startedAt,
    picked_up_at: o.pickedUpAt,
    completed_at: o.completedAt,
    cancelled_at: o.cancelledAt,
    cancellation_reason: o.cancellationReason,
    cargo_image_url: o.cargoImageUrl,
    created_at: o.createdAt,
    updated_at: o.updatedAt,
  };
}

export async function getOrderById(id: number): Promise<Order> {
  const db = getDb();
  const rows = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
  const o = rows[0];
  if (!o) throw new NotFoundError('Order not found');
  return o;
}

export async function getDriverByUserId(userId: number): Promise<Driver> {
  const db = getDb();
  const rows = await db.select().from(drivers).where(eq(drivers.userId, userId)).limit(1);
  const d = rows[0];
  if (!d) throw new NotFoundError('Driver not found');
  return d;
}

export async function broadcastStatus(orderId: number, status: OrderStatus): Promise<void> {
  await orderTrackManager.publish(String(orderId), {
    type: 'status',
    order_id: orderId,
    status,
    at: new Date().toISOString(),
  });
}

export async function createOrder(customer: User, data: OrderCreate): Promise<Order> {
  const db = getDb();
  const inserted = await db
    .insert(orders)
    .values({
      customerId: customer.id,
      pickupAddress: data.pickup_address,
      pickupLat: data.pickup_lat,
      pickupLng: data.pickup_lng,
      dropoffAddress: data.dropoff_address,
      dropoffLat: data.dropoff_lat,
      dropoffLng: data.dropoff_lng,
      cargoDescription: data.cargo_description ?? null,
      cargoWeightKg: data.cargo_weight_kg ?? null,
      notes: data.notes ?? null,
      priceCents: data.price_cents,
      currency: data.currency ?? 'USD',
      status: 'pending',
    })
    .returning();
  return inserted[0]!;
}

export async function listAvailable(limit: number, offset: number): Promise<{ items: Order[]; total: number }> {
  const db = getDb();
  const items = await db
    .select()
    .from(orders)
    .where(eq(orders.status, 'pending'))
    .orderBy(desc(orders.createdAt))
    .limit(limit)
    .offset(offset);
  const totalRows = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(orders)
    .where(eq(orders.status, 'pending'));
  return { items, total: Number(totalRows[0]?.c ?? 0) };
}

export async function listHistory(user: User, limit: number, offset: number) {
  const db = getDb();
  if (user.role === 'driver') {
    const driver = await getDriverByUserId(user.id);
    const items = await db
      .select()
      .from(orders)
      .where(eq(orders.driverId, driver.id))
      .orderBy(desc(orders.createdAt))
      .limit(limit)
      .offset(offset);
    const tot = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(orders)
      .where(eq(orders.driverId, driver.id));
    return { items, total: Number(tot[0]?.c ?? 0) };
  } else {
    const items = await db
      .select()
      .from(orders)
      .where(eq(orders.customerId, user.id))
      .orderBy(desc(orders.createdAt))
      .limit(limit)
      .offset(offset);
    const tot = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(orders)
      .where(eq(orders.customerId, user.id));
    return { items, total: Number(tot[0]?.c ?? 0) };
  }
}

export async function listActive(user: User): Promise<Order[]> {
  const db = getDb();
  if (user.role === 'driver') {
    const driver = await getDriverByUserId(user.id);
    return db
      .select()
      .from(orders)
      .where(and(eq(orders.driverId, driver.id), inArray(orders.status, ACTIVE_DRIVER_STATUSES)))
      .orderBy(desc(orders.createdAt));
  } else {
    return db
      .select()
      .from(orders)
      .where(and(eq(orders.customerId, user.id), inArray(orders.status, ACTIVE_CUSTOMER_STATUSES)))
      .orderBy(desc(orders.createdAt));
  }
}

export async function canViewOrder(user: User, order: Order): Promise<boolean> {
  if (user.role === 'admin') return true;
  if (user.role === 'customer') return order.customerId === user.id;
  if (user.role === 'driver') {
    if (order.status === 'pending') return true;
    const driver = await getDriverByUserId(user.id).catch(() => null);
    return !!driver && order.driverId === driver.id;
  }
  return false;
}

export async function updateOrder(user: User, orderId: number, data: OrderUpdate): Promise<Order> {
  const db = getDb();
  const o = await getOrderById(orderId);
  if (user.role !== 'admin' && o.customerId !== user.id) throw new ForbiddenError('Not your order');
  if (o.status !== 'pending') throw new InvalidStateError('Order can only be edited while pending');
  const patch: Partial<typeof orders.$inferInsert> = { updatedAt: new Date() };
  if (data.pickup_address !== undefined) patch.pickupAddress = data.pickup_address;
  if (data.pickup_lat !== undefined) patch.pickupLat = data.pickup_lat;
  if (data.pickup_lng !== undefined) patch.pickupLng = data.pickup_lng;
  if (data.dropoff_address !== undefined) patch.dropoffAddress = data.dropoff_address;
  if (data.dropoff_lat !== undefined) patch.dropoffLat = data.dropoff_lat;
  if (data.dropoff_lng !== undefined) patch.dropoffLng = data.dropoff_lng;
  if (data.cargo_description !== undefined) patch.cargoDescription = data.cargo_description;
  if (data.cargo_weight_kg !== undefined) patch.cargoWeightKg = data.cargo_weight_kg;
  if (data.notes !== undefined) patch.notes = data.notes;
  if (data.price_cents !== undefined) patch.priceCents = data.price_cents;
  if (data.currency !== undefined) patch.currency = data.currency;
  const updated = await db.update(orders).set(patch).where(eq(orders.id, orderId)).returning();
  return updated[0]!;
}

export async function deleteOrder(user: User, orderId: number): Promise<void> {
  const db = getDb();
  const o = await getOrderById(orderId);
  if (user.role !== 'admin' && o.customerId !== user.id) throw new ForbiddenError('Not your order');
  if (o.status !== 'pending') throw new InvalidStateError('Order can only be deleted while pending');
  await db.delete(orders).where(eq(orders.id, orderId));
}

export async function acceptOrder(user: User, orderId: number): Promise<Order> {
  const db = getDb();
  const driver = await getDriverByUserId(user.id);
  if (driver.status !== 'available') throw new BadRequestError('Driver is not available');
  // Check active order
  const active = await db
    .select()
    .from(orders)
    .where(and(eq(orders.driverId, driver.id), inArray(orders.status, ACTIVE_DRIVER_STATUSES)))
    .limit(1);
  if (active.length > 0) throw new BadRequestError('Driver already has an active order');

  const result = await db.transaction(async (tx) => {
    // Atomic guard: update only if currently pending and unassigned. PG row update
    // is atomic; combined with a re-fetch this prevents two drivers from accepting.
    const updated = await tx
      .update(orders)
      .set({
        status: 'accepted',
        driverId: driver.id,
        acceptedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(orders.id, orderId), eq(orders.status, 'pending')))
      .returning();
    if (updated.length === 0) {
      // Distinguish "not found" vs "no longer pending"
      const exists = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1);
      if (exists.length === 0) throw new NotFoundError('Order not found');
      throw new ConflictError('Order is no longer pending');
    }
    await tx
      .update(drivers)
      .set({ status: 'busy', updatedAt: new Date() })
      .where(eq(drivers.id, driver.id));
    return updated[0]!;
  });
  await broadcastStatus(result.id, result.status);
  return result;
}

async function transitionByDriver(
  user: User,
  orderId: number,
  to: OrderStatus,
  patch: Partial<typeof orders.$inferInsert>
): Promise<Order> {
  const db = getDb();
  const driver = await getDriverByUserId(user.id);
  const o = await getOrderById(orderId);
  if (o.driverId !== driver.id) throw new ForbiddenError('Not your assigned order');
  assertTransition(o.status, to);
  const updated = await db
    .update(orders)
    .set({ status: to, ...patch, updatedAt: new Date() })
    .where(eq(orders.id, orderId))
    .returning();
  await broadcastStatus(orderId, to);
  return updated[0]!;
}

export async function startOrder(user: User, orderId: number): Promise<Order> {
  return transitionByDriver(user, orderId, 'in_progress', { startedAt: new Date() });
}

export async function pickupOrder(user: User, orderId: number): Promise<Order> {
  return transitionByDriver(user, orderId, 'picked_up', { pickedUpAt: new Date() });
}

export async function completeOrder(user: User, orderId: number): Promise<Order> {
  const db = getDb();
  const result = await transitionByDriver(user, orderId, 'completed', { completedAt: new Date() });
  if (result.driverId) {
    await db
      .update(drivers)
      .set({ status: 'available', updatedAt: new Date() })
      .where(eq(drivers.id, result.driverId));
  }
  return result;
}

export async function cancelOrder(
  user: User,
  orderId: number,
  reason?: string | null
): Promise<Order> {
  const db = getDb();
  const o = await getOrderById(orderId);

  let allowed = false;
  if (user.role === 'admin') allowed = true;
  else if (user.role === 'customer' && o.customerId === user.id) allowed = true;
  else if (user.role === 'driver') {
    const driver = await getDriverByUserId(user.id).catch(() => null);
    if (driver && o.driverId === driver.id) allowed = true;
  }
  if (!allowed) throw new ForbiddenError('Cannot cancel this order');

  assertTransition(o.status, 'cancelled');
  const updated = await db
    .update(orders)
    .set({
      status: 'cancelled',
      cancelledAt: new Date(),
      cancellationReason: reason ?? null,
      updatedAt: new Date(),
    })
    .where(eq(orders.id, orderId))
    .returning();
  if (o.driverId) {
    await db
      .update(drivers)
      .set({ status: 'available', updatedAt: new Date() })
      .where(eq(drivers.id, o.driverId));
  }
  await broadcastStatus(orderId, 'cancelled');
  return updated[0]!;
}

// ----- Ratings -----
export function ratingRead(r: typeof driverRatings.$inferSelect) {
  return {
    id: r.id,
    order_id: r.orderId,
    driver_id: r.driverId,
    customer_id: r.customerId,
    score: r.score,
    comment: r.comment,
    driver_response: r.driverResponse,
    driver_responded_at: r.driverRespondedAt,
    created_at: r.createdAt,
  };
}

export async function submitRating(
  user: User,
  orderId: number,
  data: { score: number; comment?: string | null }
) {
  const db = getDb();
  const o = await getOrderById(orderId);
  if (o.customerId !== user.id) throw new ForbiddenError('Not your order');
  if (o.status !== 'completed') throw new BadRequestError('Order is not completed');
  if (!o.driverId) throw new BadRequestError('Order has no assigned driver');

  const existing = await db
    .select()
    .from(driverRatings)
    .where(eq(driverRatings.orderId, orderId))
    .limit(1);
  if (existing.length > 0) throw new ConflictError('Rating already exists');

  const inserted = await db
    .insert(driverRatings)
    .values({
      orderId,
      driverId: o.driverId,
      customerId: user.id,
      score: data.score,
      comment: data.comment ?? null,
    })
    .returning();

  // Recalculate avg
  const avgRows = await db
    .select({ avg: sql<number>`COALESCE(AVG(score), 0)` })
    .from(driverRatings)
    .where(eq(driverRatings.driverId, o.driverId));
  const avg = Number(avgRows[0]?.avg ?? 0);
  await db
    .update(drivers)
    .set({ rating: avg, updatedAt: new Date() })
    .where(eq(drivers.id, o.driverId));

  return inserted[0]!;
}

export async function getRating(user: User, orderId: number) {
  const db = getDb();
  const o = await getOrderById(orderId);
  let allowed = false;
  if (user.role === 'admin') allowed = true;
  else if (user.role === 'customer' && o.customerId === user.id) allowed = true;
  else if (user.role === 'driver') {
    const driver = await getDriverByUserId(user.id).catch(() => null);
    if (driver && o.driverId === driver.id) allowed = true;
  }
  if (!allowed) throw new ForbiddenError('Cannot view this rating');
  const rows = await db
    .select()
    .from(driverRatings)
    .where(eq(driverRatings.orderId, orderId))
    .limit(1);
  const r = rows[0];
  if (!r) throw new NotFoundError('Rating not found');
  return r;
}

export async function setDriverResponse(user: User, orderId: number, response: string) {
  const db = getDb();
  const o = await getOrderById(orderId);
  const driver = await getDriverByUserId(user.id);
  if (o.driverId !== driver.id) throw new ForbiddenError('Not your order');
  const existing = (
    await db.select().from(driverRatings).where(eq(driverRatings.orderId, orderId)).limit(1)
  )[0];
  if (!existing) throw new NotFoundError('Rating not found');
  const updated = await db
    .update(driverRatings)
    .set({ driverResponse: response, driverRespondedAt: new Date(), updatedAt: new Date() })
    .where(eq(driverRatings.id, existing.id))
    .returning();
  return updated[0]!;
}

export async function deleteDriverResponse(user: User, orderId: number) {
  const db = getDb();
  const o = await getOrderById(orderId);
  const driver = await getDriverByUserId(user.id);
  if (o.driverId !== driver.id) throw new ForbiddenError('Not your order');
  const existing = (
    await db.select().from(driverRatings).where(eq(driverRatings.orderId, orderId)).limit(1)
  )[0];
  if (!existing) throw new NotFoundError('Rating not found');
  if (!existing.driverResponse) throw new NotFoundError('Response not found');
  const updated = await db
    .update(driverRatings)
    .set({ driverResponse: null, driverRespondedAt: null, updatedAt: new Date() })
    .where(eq(driverRatings.id, existing.id))
    .returning();
  return updated[0]!;
}

export async function listDriverRatings(driverId: number, limit: number, offset: number) {
  const db = getDb();
  const items = await db
    .select()
    .from(driverRatings)
    .where(eq(driverRatings.driverId, driverId))
    .orderBy(desc(driverRatings.createdAt))
    .limit(limit)
    .offset(offset);
  const tot = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(driverRatings)
    .where(eq(driverRatings.driverId, driverId));
  return { items, total: Number(tot[0]?.c ?? 0) };
}
