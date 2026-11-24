import { z } from 'zod';

export const MAX_API_PAGE_SIZE = 100;

export const ApiPageSchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_API_PAGE_SIZE).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

export type ApiPage = z.infer<typeof ApiPageSchema>;

export function toPage<T>(rows: T[], page: ApiPage) {
  const hasMore = rows.length > page.limit;
  return {
    data: hasMore ? rows.slice(0, page.limit) : rows,
    pagination: { limit: page.limit, offset: page.offset, hasMore },
  };
}
