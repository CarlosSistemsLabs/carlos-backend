import { z } from 'zod';

/** Query for `GET /api/v1/addresses/autocomplete`. */
export const autocompleteQuerySchema = z.object({
  q: z.string().min(1),
});

/** Path params for `GET /api/v1/addresses/:id/location`. */
export const addressIdParamSchema = z.object({
  id: z.string().min(1),
});
