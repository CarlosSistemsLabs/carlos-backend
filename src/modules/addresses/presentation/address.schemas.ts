import { z } from 'zod';

/** Query for `GET /api/v1/addresses/autocomplete`. */
export const autocompleteQuerySchema = z.object({
  q: z.string().min(1),
});

/**
 * Query for `GET /api/v1/addresses/location?id=`.
 *
 * The place id travels as a query param (not a path segment) because Google's
 * place ids are opaque, variable-length tokens that can break path routing.
 */
export const addressLocationQuerySchema = z.object({
  id: z.string().min(1),
});
