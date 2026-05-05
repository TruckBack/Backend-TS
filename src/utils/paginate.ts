export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export function paginate<T>(items: T[], total: number, limit: number, offset: number): Page<T> {
  return { items, total, limit, offset };
}

import { z } from 'zod';
export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;
