import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { users, type User } from '../db/schema.js';
import { NotFoundError } from '../core/errors.js';

export const userUpdateSchema = z.object({
  full_name: z.string().min(1).max(255).optional(),
  phone: z.string().max(32).optional().nullable(),
  profile_image_url: z.string().max(1024).optional().nullable(),
});

export async function getUserById(id: number): Promise<User> {
  const db = getDb();
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  const u = rows[0];
  if (!u) throw new NotFoundError('User not found');
  return u;
}

export async function updateMe(
  user: User,
  data: z.infer<typeof userUpdateSchema>
): Promise<User> {
  const db = getDb();
  const patch: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };
  if (data.full_name !== undefined) patch.fullName = data.full_name;
  if (data.phone !== undefined) patch.phone = data.phone;
  if (data.profile_image_url !== undefined) patch.profileImageUrl = data.profile_image_url;
  const updated = await db.update(users).set(patch).where(eq(users.id, user.id)).returning();
  return updated[0]!;
}
