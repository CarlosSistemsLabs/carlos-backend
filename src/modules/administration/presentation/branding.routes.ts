import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import { UnauthorizedError } from '@domain/errors/index.js';
import type { Container } from '@infrastructure/di/index.js';
import { ADMINISTRATION_TOKENS } from '@infrastructure/di/index.js';
import { validateBody } from '@presentation/validators/index.js';
import type { GetBrandingUseCase } from '../application/use-cases/get-branding.use-case.js';
import type { UpdateBrandingUseCase } from '../application/use-cases/update-branding.use-case.js';
import type {
  GetBrandingInputDto,
  UpdateBrandingInputDto,
} from '../application/dto/administration-dtos.js';
import { updateBrandingBodySchema, getBrandingRouteSchema, updateBrandingRouteSchema } from './branding.schemas.js';

/**
 * RBAC module + screen/action gating the branding WRITE endpoint.
 *
 * **Access-control decision.** Branding customization lives under the
 * `administration` module in the seeded permission matrix — only the Admin
 * system role holds any `administration` grant (via its `*:*:*` wildcard) — so
 * updating branding requires `administration:settings:write`. Reading branding,
 * by contrast, is gated by authentication ALONE: every authenticated user of a
 * tenant needs their brand configuration to render the UI on login
 * (Requirement 11.2), so the GET endpoint deliberately attaches no `authorize`
 * guard. Like the admin routes, branding is core tenant-management and is NOT
 * feature-gated.
 */
const ADMIN_MODULE = 'administration';
const BRANDING_SCREEN = 'settings';

/** Bundle of the branding use cases wired from the DI container. */
interface BrandingUseCases {
  getBranding: GetBrandingUseCase;
  updateBranding: UpdateBrandingUseCase;
}

/** Resolves the branding use cases from the composition container. */
function buildBrandingUseCases(container: Container): BrandingUseCases {
  return {
    getBranding: container.resolve(ADMINISTRATION_TOKENS.GetBrandingUseCase),
    updateBranding: container.resolve(ADMINISTRATION_TOKENS.UpdateBrandingUseCase),
  };
}

/**
 * Returns the authenticated tenant id from the request, refusing with a 401
 * when the token/`request.auth` is absent (defence in depth — Requirement 1.5).
 * The tenant is ALWAYS taken from the token, never the client body, so a caller
 * can never read or update branding across tenant boundaries.
 */
function requireTenantId(request: FastifyRequest): string {
  const auth = request.auth;
  if (auth === undefined) {
    throw new UnauthorizedError('Authentication required');
  }
  return auth.tenantId;
}

/** Options accepted by the {@link brandingRoutesPlugin}. */
export interface BrandingRoutesOptions {
  /** Composition container with the administration branding use cases registered. */
  container: Container;
}

/**
 * Fastify plugin exposing the tenant Branding endpoints under `/api/v1/branding`.
 *
 * - `GET /api/v1/branding` → the caller's tenant branding (authenticated; any
 *   tenant user). Backed by {@link GetBrandingUseCase}'s cache-aside read so the
 *   web/mobile clients get it fast on login (Requirement 11.2).
 * - `PUT /api/v1/branding` → updates branding (admin only). Backed by
 *   {@link UpdateBrandingUseCase}, which uploads any provided logo asset via the
 *   storage port (Requirement 11.3) and invalidates the branding cache so the
 *   change propagates immediately (Requirement 11.4).
 *
 * **Applying branding to responses (Requirement 11.3/11.4).** The canonical
 * mechanism for propagating branding to clients is this GET endpoint: clients
 * call it on login and whenever they need to re-render the brand, and the cache
 * (invalidated on every write) guarantees a fresh read within the propagation
 * budget. A response `Cache-Control` header on the GET keeps that lightweight —
 * no per-response server-side rewriting is needed, avoiding an always-on hook on
 * the hot path.
 *
 * Inputs are validated with Zod via the shared validators; a malformed colour,
 * theme or logo surfaces as the consistent 400 envelope, a missing tenant as
 * 404. Fastify's own validation is disabled inside this encapsulated plugin so
 * it never short-circuits the Zod checks, mirroring the admin routes plugin.
 */
export const brandingRoutesPlugin: FastifyPluginAsync<BrandingRoutesOptions> = (app, opts) => {
  const useCases = buildBrandingUseCases(opts.container);

  // Documentation-only schemas: skip Fastify validation so Zod owns input
  // validation and produces the consistent error envelope.
  app.setValidatorCompiler(() => (data) => ({ value: data }));

  // GET /api/v1/branding — read the caller tenant's branding (any authed user)
  app.get(
    '/',
    {
      schema: getBrandingRouteSchema,
      preHandler: [app.authenticate],
    },
    async (request, reply) => {
      const tenantId = requireTenantId(request);
      const input: GetBrandingInputDto = { tenantId };
      const branding = await useCases.getBranding.execute(input);
      return reply.header('cache-control', 'private, max-age=30').status(200).send(branding);
    },
  );

  // PUT /api/v1/branding — update the caller tenant's branding (admin only)
  app.put(
    '/',
    {
      schema: updateBrandingRouteSchema,
      preHandler: [app.authenticate, app.authorize(ADMIN_MODULE, BRANDING_SCREEN, 'write')],
    },
    async (request, reply) => {
      const tenantId = requireTenantId(request);
      const body = validateBody(request, updateBrandingBodySchema);

      const input: UpdateBrandingInputDto = { id: tenantId };
      if (body.name !== undefined) {
        input.name = body.name;
      }
      // Base64 upload wins over any `logo` URL; only include `logo` when the
      // client explicitly sent it (present, possibly `null` to clear).
      if (body.logoFile !== undefined) {
        input.logoFile = {
          content: Buffer.from(body.logoFile.data, 'base64'),
          contentType: body.logoFile.contentType,
          ...(body.logoFile.filename !== undefined ? { filename: body.logoFile.filename } : {}),
        };
      } else if ('logo' in body) {
        input.logo = body.logo ?? null;
      }
      if ('primaryColor' in body) {
        input.primaryColor = body.primaryColor ?? null;
      }
      if ('secondaryColor' in body) {
        input.secondaryColor = body.secondaryColor ?? null;
      }
      if (body.theme !== undefined) {
        input.theme = body.theme;
      }
      if (body.language !== undefined) {
        input.language = body.language;
      }
      if (body.timezone !== undefined) {
        input.timezone = body.timezone;
      }
      if (body.currency !== undefined) {
        input.currency = body.currency;
      }
      if (body.dateFormat !== undefined) {
        input.dateFormat = body.dateFormat;
      }
      if ('taxId' in body) {
        input.taxId = body.taxId ?? null;
      }

      const branding = await useCases.updateBranding.execute(input);
      return reply.status(200).send(branding);
    },
  );

  return Promise.resolve();
};

/**
 * Registers the branding routes under the `/api/v1/branding` prefix.
 *
 * Wraps {@link brandingRoutesPlugin} in its own encapsulated context so the
 * relaxed validator compiler does not leak to other routes.
 */
export async function registerBrandingRoutes(
  app: FastifyInstance,
  container: Container,
): Promise<void> {
  await app.register(brandingRoutesPlugin, { prefix: '/api/v1/branding', container });
}
