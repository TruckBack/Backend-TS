import {
  pgTable,
  bigserial,
  varchar,
  text,
  boolean,
  doublePrecision,
  integer,
  timestamp,
  bigint,
  pgEnum,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ----- Enums -----
export const userRoleEnum = pgEnum('user_role', ['customer', 'driver', 'admin']);
export const driverStatusEnum = pgEnum('driver_status', ['offline', 'available', 'busy']);
export const orderStatusEnum = pgEnum('order_status', [
  'pending',
  'accepted',
  'in_progress',
  'picked_up',
  'completed',
  'cancelled',
]);

// ----- Users -----
export const users = pgTable('users', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  hashedPassword: varchar('hashed_password', { length: 255 }).notNull(),
  fullName: varchar('full_name', { length: 255 }).notNull(),
  phone: varchar('phone', { length: 32 }),
  role: userRoleEnum('role').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  profileImageUrl: varchar('profile_image_url', { length: 1024 }),
  googleId: varchar('google_id', { length: 128 }).unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ----- Drivers -----
export const drivers = pgTable('drivers', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  userId: bigint('user_id', { mode: 'number' })
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: 'cascade' }),
  licenseNumber: varchar('license_number', { length: 64 }).notNull().unique(),
  vehicleType: varchar('vehicle_type', { length: 64 }).notNull(),
  vehiclePlate: varchar('vehicle_plate', { length: 32 }).notNull(),
  vehicleCapacityKg: doublePrecision('vehicle_capacity_kg'),
  status: driverStatusEnum('status').notNull().default('offline'),
  currentLat: doublePrecision('current_lat'),
  currentLng: doublePrecision('current_lng'),
  lastLocationAt: timestamp('last_location_at', { withTimezone: true }),
  rating: doublePrecision('rating').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ----- Orders -----
export const orders = pgTable('orders', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  customerId: bigint('customer_id', { mode: 'number' })
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  driverId: bigint('driver_id', { mode: 'number' }).references(() => drivers.id, {
    onDelete: 'set null',
  }),
  status: orderStatusEnum('status').notNull().default('pending'),
  pickupAddress: varchar('pickup_address', { length: 512 }).notNull(),
  pickupLat: doublePrecision('pickup_lat').notNull(),
  pickupLng: doublePrecision('pickup_lng').notNull(),
  dropoffAddress: varchar('dropoff_address', { length: 512 }).notNull(),
  dropoffLat: doublePrecision('dropoff_lat').notNull(),
  dropoffLng: doublePrecision('dropoff_lng').notNull(),
  notes: text('notes'),
  cargoDescription: varchar('cargo_description', { length: 512 }),
  cargoWeightKg: doublePrecision('cargo_weight_kg'),
  priceCents: integer('price_cents').notNull(),
  currency: varchar('currency', { length: 8 }).notNull().default('USD'),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  startedAt: timestamp('started_at', { withTimezone: true }),
  pickedUpAt: timestamp('picked_up_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancellationReason: varchar('cancellation_reason', { length: 512 }),
  cargoImageUrl: varchar('cargo_image_url', { length: 1024 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ----- Driver ratings -----
export const driverRatings = pgTable(
  'driver_ratings',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    orderId: bigint('order_id', { mode: 'number' })
      .notNull()
      .unique()
      .references(() => orders.id, { onDelete: 'cascade' }),
    driverId: bigint('driver_id', { mode: 'number' })
      .notNull()
      .references(() => drivers.id, { onDelete: 'cascade' }),
    customerId: bigint('customer_id', { mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    score: integer('score').notNull(),
    comment: varchar('comment', { length: 1000 }),
    driverResponse: varchar('driver_response', { length: 2000 }),
    driverRespondedAt: timestamp('driver_responded_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    scoreCheck: check('driver_ratings_score_check', sql`${t.score} >= 1 AND ${t.score} <= 5`),
  })
);

// ----- Chat conversations -----
export const chatConversations = pgTable('chat_conversations', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  orderId: bigint('order_id', { mode: 'number' })
    .notNull()
    .unique()
    .references(() => orders.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ----- Chat messages -----
export const chatMessages = pgTable('chat_messages', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  conversationId: bigint('conversation_id', { mode: 'number' })
    .notNull()
    .references(() => chatConversations.id, { onDelete: 'cascade' }),
  senderId: bigint('sender_id', { mode: 'number' })
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  body: text('body').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ----- Message read statuses -----
export const messageReadStatuses = pgTable(
  'message_read_statuses',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    messageId: bigint('message_id', { mode: 'number' })
      .notNull()
      .references(() => chatMessages.id, { onDelete: 'cascade' }),
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqMsgUser: uniqueIndex('message_read_statuses_message_user_uniq').on(t.messageId, t.userId),
  })
);

// ----- Types -----
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Driver = typeof drivers.$inferSelect;
export type NewDriver = typeof drivers.$inferInsert;
export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
export type DriverRating = typeof driverRatings.$inferSelect;
export type NewDriverRating = typeof driverRatings.$inferInsert;
export type ChatConversation = typeof chatConversations.$inferSelect;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type MessageReadStatus = typeof messageReadStatuses.$inferSelect;

export type UserRole = 'customer' | 'driver' | 'admin';
export type DriverStatus = 'offline' | 'available' | 'busy';
export type OrderStatus =
  | 'pending'
  | 'accepted'
  | 'in_progress'
  | 'picked_up'
  | 'completed'
  | 'cancelled';
