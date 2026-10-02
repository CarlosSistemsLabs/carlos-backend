import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { env } from '@config/environment';
import { validateParams, validateQuery } from '@presentation/validators/index.js';
import type { AddressProvider } from '../application/address.types.js';
import { buildAddressProvider } from '../infrastructure/address-provider.factory.js';
import { addressIdParamSchema, autocompleteQuerySchema } from './address.schemas.js';

/** Minimum characters before the autocomplete calls the provider. */
const MIN_QUERY_LENGTH = 3;

export interface AddressRoutesOptions {
  /** Allows tests to inject a provider; defaults to the env-selected one. */
  provider?: AddressProvider;
}

/**
 * Fastify plugin exposing the address lookup endpoints under `/api/v1/addresses`.
 *
 * Both routes require only authentication (`app.authenticate`) — address lookup
 * is a cross-cutting helper, so it is not behind a feature/RBAC gate. Inputs are
 * validated with Zod via the shared validators (400 on failure); Fastify's own
 * validation is disabled inside this encapsulated plugin.
 *
 * - GET `/autocomplete?q=<text>` → suggestions (empty until `q` has
 *   {@link MIN_QUERY_LENGTH} characters).
 * - GET `/:id/location` → the geocoded address(es) for the chosen suggestion.
 */
export const addressRoutesPlugin: FastifyPluginAsync<AddressRoutesOptions> = (app, opts) => {
  const provider = opts.provider ?? buildAddressProvider(env);

  app.setValidatorCompiler(() => (data) => ({ value: data }));

  app.get(
    '/autocomplete',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { q } = validateQuery(request, autocompleteQuerySchema);
      if (q.trim().length < MIN_QUERY_LENGTH) {
        return reply.status(200).send([]);
      }
      const suggestions = await provider.autocomplete(q.trim());
      return reply.status(200).send(suggestions);
    },
  );

  app.get(
    '/:id/location',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id } = validateParams(request, addressIdParamSchema);
      const location = await provider.locate(id);
      return reply.status(200).send(location);
    },
  );

  return Promise.resolve();
};

/** Registers the address routes under the `/api/v1/addresses` prefix. */
export async function registerAddressRoutes(
  app: FastifyInstance,
  options: AddressRoutesOptions = {},
): Promise<void> {
  await app.register(addressRoutesPlugin, { prefix: '/api/v1/addresses', ...options });
}
