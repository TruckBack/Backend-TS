/**
 * Programmatic schema bootstrap. Plain SQL statements compatible with both
 * production PostgreSQL and pg-mem (used in tests). Each statement runs
 * individually; "already exists" errors are tolerated for idempotency.
 */
export const SCHEMA_STATEMENTS: string[] = [
  `CREATE TYPE user_role AS ENUM ('customer', 'driver', 'admin')`,
  `CREATE TYPE driver_status AS ENUM ('offline', 'available', 'busy')`,
  `CREATE TYPE order_status AS ENUM ('pending','accepted','in_progress','picked_up','completed','cancelled')`,
  `CREATE TABLE users (
    id BIGSERIAL PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    hashed_password VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    phone VARCHAR(32),
    role user_role NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    profile_image_url VARCHAR(1024),
    google_id VARCHAR(128) UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE drivers (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    license_number VARCHAR(64) NOT NULL UNIQUE,
    vehicle_type VARCHAR(64) NOT NULL,
    vehicle_plate VARCHAR(32) NOT NULL,
    vehicle_capacity_kg DOUBLE PRECISION,
    status driver_status NOT NULL DEFAULT 'offline',
    current_lat DOUBLE PRECISION,
    current_lng DOUBLE PRECISION,
    last_location_at TIMESTAMPTZ,
    rating DOUBLE PRECISION NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE orders (
    id BIGSERIAL PRIMARY KEY,
    customer_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    driver_id BIGINT REFERENCES drivers(id) ON DELETE SET NULL,
    status order_status NOT NULL DEFAULT 'pending',
    pickup_address VARCHAR(512) NOT NULL,
    pickup_lat DOUBLE PRECISION NOT NULL,
    pickup_lng DOUBLE PRECISION NOT NULL,
    dropoff_address VARCHAR(512) NOT NULL,
    dropoff_lat DOUBLE PRECISION NOT NULL,
    dropoff_lng DOUBLE PRECISION NOT NULL,
    notes TEXT,
    cargo_description VARCHAR(512),
    cargo_weight_kg DOUBLE PRECISION,
    price_cents INTEGER NOT NULL,
    currency VARCHAR(8) NOT NULL DEFAULT 'USD',
    accepted_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    picked_up_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    cancellation_reason VARCHAR(512),
    cargo_image_url VARCHAR(1024),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE driver_ratings (
    id BIGSERIAL PRIMARY KEY,
    order_id BIGINT NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
    driver_id BIGINT NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
    customer_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    score INTEGER NOT NULL CHECK (score >= 1 AND score <= 5),
    comment VARCHAR(1000),
    driver_response VARCHAR(2000),
    driver_responded_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE chat_conversations (
    id BIGSERIAL PRIMARY KEY,
    order_id BIGINT NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE chat_messages (
    id BIGSERIAL PRIMARY KEY,
    conversation_id BIGINT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
    sender_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE message_read_statuses (
    id BIGSERIAL PRIMARY KEY,
    message_id BIGINT NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX message_read_statuses_message_user_uniq ON message_read_statuses(message_id, user_id)`,
];

export async function applySchema(execute: (sql: string) => Promise<unknown>): Promise<void> {
  for (const stmt of SCHEMA_STATEMENTS) {
    try {
      await execute(stmt);
    } catch (e) {
      const msg = (e as Error).message ?? '';
      if (/already exists|duplicate/i.test(msg)) continue;
      throw e;
    }
  }
}
