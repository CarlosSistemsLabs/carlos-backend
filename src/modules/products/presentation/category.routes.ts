import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import { UnauthorizedError } from '@domain/errors/index.js';
import type { Container } from '@infrastructure/di/index.js';
import { PRODUCT_TOKENS } from '@infrastructure/di/index.js';
import { FEATURES } from '@modules/subscriptions/index.js';
import { validateBody, validateParams } from '@presentation/validators/index.js';
import type { CreateCategoryUseCase } from '../application/use-cases/create-category.use-case.js';
import type { UpdateCategoryUseCase } from '../application/use-cases/update-category.use-case.js';
import type { DeleteCategoryUseCase } from '../application/use-cases/delete-category.use-case.js';
import type { GetCategoryUseCase } from '../application/use-cases/get-category.use-case.js';
import type { ListCategoriesUseCase } from '../application/use-cases/list-categories.use-case.js';
import type { GetCategoryTreeUseCase } from '../application/use-cases/get-category-tree.use-case.js';
import type {
  CreateCategoryInputDto,
  UpdateCategoryInputDto,
} from '../application/dto/category-dtos.js';
import {
  createCategoryBodySchema,
  updateCategoryBodySchema,
  categoryIdParamSchema,
  createCategoryRouteSchema,
  listCategoriesRouteSchema,
  getCategoryTreeRouteSchema,
  getCategoryRouteSchema,
  updateCategoryRouteSchema,
  deleteCategoryRouteSchema,
} from './category.schemas.js';

/**
 * The feature key gating the Categories endpoints.
 *
 * **Feature-key reconciliation (Requirement 10.3):** the canonical plan →
 * feature matrix has no dedicated `products`/`categories` feature. Categories
 * are foundational to the product catalogue (a product must belong to a
 * category), and the catalogue underpins the Sales feature, which every plan
 * tier — including Starter — includes. Gating categories behind
 * {@link FEATURES.SALES} therefore mirrors the Products module exactly: the
 * catalogue is available to every tenant with an active subscription while the
 * subscription/feature guard still rejects tenants without one (403).
 */
const CATEGORIES_FEATURE = FEATURES.SALES;

/**
 * RBAC module/screen used by every category route.
 *
 * **Permission triples (module, screen, action):** categories live within the
 * existing `products` RBAC module under a dedicated `categories` screen, so
 * roles can grant catalogue-management without a new module. The wildcard-based
 * system roles (Admin with full wildcard, Manager with read/write on the
 * `products` module) already cover these screens. Actions used:
 * - read   → GET list, GET tree, GET /:id
 * - write  → POST (create), PUT (update)
 * - delete → DELETE
 */
const CATEGORIES_MODULE = 'products';
const CATEGORIES_SCREEN = 'categories';

/** Bundle of the category use cases wired from the DI container. */
interface CategoryUseCases {
  create: CreateCategoryUseCase;
  update: UpdateCategoryUseCase;
  remove: DeleteCategoryUseCase;
  get: GetCategoryUseCase;
  list: ListCategoriesUseCase;
  tree: GetCategoryTreeUseCase;
}

/** Resolves the category use cases from the composition container. */
export function buildCategoryUseCases(container: Container): CategoryUseCases {
  return {
    create: container.resolve(PRODUCT_TOKENS.CreateCategoryUseCase),
    update: container.resolve(PRODUCT_TOKENS.UpdateCategoryUseCase),
    remove: container.resolve(PRODUCT_TOKENS.DeleteCategoryUseCase),
    get: container.resolve(PRODUCT_TOKENS.GetCategoryUseCase),
    list: container.resolve(PRODUCT_TOKENS.ListCategoriesUseCase),
    tree: container.resolve(PRODUCT_TOKENS.GetCategoryTreeUseCase),
  };
}

/**
 * Returns the authenticated tenant id from the request.
 *
 * Defence in depth: every route attaches `app.authenticate`, which populates
 * `request.auth`; should that be bypassed the handler still refuses with a 401
 * rather than operating without a tenant scope (Requirement 1.5).
 */
function requireTenantId(request: FastifyRequest): string {
  const auth = request.auth;
  if (auth === undefined) {
    throw new UnauthorizedError('Authentication required');
  }
  return auth.tenantId;
}

/** Options accepted by the {@link categoryRoutesPlugin}. */
export interface CategoryRoutesOptions {
  /** Composition container with the product infrastructure registered. */
  container: Container;
}

/**
 * Fastify plugin exposing the category endpoints under `/api/v1/categories`.
 *
 * Every route is protected: `app.authenticate` (401), `app.requireFeature`
 * (subscription/feature guard, 403) and `app.authorize(module, screen, action)`
 * (RBAC, 403). Inputs are validated with Zod via the shared validators (400 on
 * failure). The attached `schema` objects document the routes for OpenAPI
 * (Requirement 3.7); Fastify's own validation is disabled inside this
 * encapsulated plugin so it never short-circuits the Zod checks.
 *
 * Route ordering: the static `/tree` route is registered BEFORE the parametric
 * `/:id` route so "tree" is never captured as a category id.
 */
export const categoryRoutesPlugin: FastifyPluginAsync<CategoryRoutesOptions> = (app, opts) => {
  const useCases = buildCategoryUseCases(opts.container);

  // Documentation-only schemas: skip Fastify validation so Zod owns input
  // validation and produces the consistent error envelope.
  app.setValidatorCompiler(() => (data) => ({ value: data }));

  // POST /api/v1/categories — create
  app.post(
    '/',
    {
      schema: createCategoryRouteSchema,
      preHandler: [
        app.authenticate,
        app.requireFeature(CATEGORIES_FEATURE),
        app.authorize(CATEGORIES_MODULE, CATEGORIES_SCREEN, 'write'),
      ],
    },
    async (request, reply) => {
      const tenantId = requireTenantId(request);
      const body = validateBody(request, createCategoryBodySchema);
      const input: CreateCategoryInputDto = {
        tenantId,
        name: body.name,
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.parentId !== undefined ? { parentId: body.parentId } : {}),
      };
      const category = await useCases.create.execute(input);
      return reply.status(201).send(category);
    },
  );

  // GET /api/v1/categories — list (flat)
  app.get(
    '/',
    {
      schema: listCategoriesRouteSchema,
      preHandler: [
        app.authenticate,
        app.requireFeature(CATEGORIES_FEATURE),
        app.authorize(CATEGORIES_MODULE, CATEGORIES_SCREEN, 'read'),
      ],
    },
    async (request, reply) => {
      const tenantId = requireTenantId(request);
      const categories = await useCases.list.execute({ tenantId });
      return reply.status(200).send(categories);
    },
  );

  // GET /api/v1/categories/tree — hierarchical tree (registered BEFORE /:id)
  app.get(
    '/tree',
    {
      schema: getCategoryTreeRouteSchema,
      preHandler: [
        app.authenticate,
        app.requireFeature(CATEGORIES_FEATURE),
        app.authorize(CATEGORIES_MODULE, CATEGORIES_SCREEN, 'read'),
      ],
    },
    async (request, reply) => {
      const tenantId = requireTenantId(request);
      const tree = await useCases.tree.execute({ tenantId });
      return reply.status(200).send(tree);
    },
  );

  // GET /api/v1/categories/:id — details
  app.get(
    '/:id',
    {
      schema: getCategoryRouteSchema,
      preHandler: [
        app.authenticate,
        app.requireFeature(CATEGORIES_FEATURE),
        app.authorize(CATEGORIES_MODULE, CATEGORIES_SCREEN, 'read'),
      ],
    },
    async (request, reply) => {
      const tenantId = requireTenantId(request);
      const { id } = validateParams(request, categoryIdParamSchema);
      const category = await useCases.get.execute({ id, tenantId });
      return reply.status(200).send(category);
    },
  );

  // PUT /api/v1/categories/:id — update (rename / reparent)
  app.put(
    '/:id',
    {
      schema: updateCategoryRouteSchema,
      preHandler: [
        app.authenticate,
        app.requireFeature(CATEGORIES_FEATURE),
        app.authorize(CATEGORIES_MODULE, CATEGORIES_SCREEN, 'write'),
      ],
    },
    async (request, reply) => {
      const tenantId = requireTenantId(request);
      const { id } = validateParams(request, categoryIdParamSchema);
      const body = validateBody(request, updateCategoryBodySchema);
      const input: UpdateCategoryInputDto = {
        id,
        tenantId,
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.parentId !== undefined ? { parentId: body.parentId } : {}),
      };
      const category = await useCases.update.execute(input);
      return reply.status(200).send(category);
    },
  );

  // DELETE /api/v1/categories/:id — soft delete
  app.delete(
    '/:id',
    {
      schema: deleteCategoryRouteSchema,
      preHandler: [
        app.authenticate,
        app.requireFeature(CATEGORIES_FEATURE),
        app.authorize(CATEGORIES_MODULE, CATEGORIES_SCREEN, 'delete'),
      ],
    },
    async (request, reply) => {
      const tenantId = requireTenantId(request);
      const { id } = validateParams(request, categoryIdParamSchema);
      await useCases.remove.execute({ id, tenantId });
      return reply.status(204).send();
    },
  );

  return Promise.resolve();
};

/**
 * Registers the category routes under the `/api/v1/categories` prefix.
 *
 * Wraps {@link categoryRoutesPlugin} in its own encapsulated context so the
 * relaxed validator compiler does not leak to other routes.
 */
export async function registerCategoryRoutes(
  app: FastifyInstance,
  container: Container,
): Promise<void> {
  await app.register(categoryRoutesPlugin, { prefix: '/api/v1/categories', container });
}
