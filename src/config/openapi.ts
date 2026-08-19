import type { FastifyInstance } from 'fastify';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';

/** Route prefix at which the interactive API documentation is served. */
export const DOCUMENTATION_ROUTE = '/documentation';

/**
 * Registers OpenAPI generation (`@fastify/swagger`) and the interactive Swagger
 * UI (`@fastify/swagger-ui`) on the Fastify instance (Requirement 3.7).
 *
 * Must be registered BEFORE the feature routes so the generator can introspect
 * their attached `schema` objects. The generated specification is available at
 * `${DOCUMENTATION_ROUTE}/json` and the interactive UI at
 * {@link DOCUMENTATION_ROUTE}.
 */
export async function registerOpenApi(app: FastifyInstance): Promise<void> {
  await app.register(fastifySwagger, {
    openapi: {
      info: {
        title: 'Carlos ERP API',
        description:
          'Multi-tenant ERP platform API. Authentication uses short-lived JWT ' +
          'access tokens with rotating refresh tokens.',
        version: '0.1.0',
      },
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
      tags: [{ name: 'Auth', description: 'Authentication and session management' }],
    },
  });

  await app.register(fastifySwaggerUi, {
    routePrefix: DOCUMENTATION_ROUTE,
  });
}
