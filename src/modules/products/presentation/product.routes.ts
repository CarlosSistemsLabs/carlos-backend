import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import { UnauthorizedError } from '@domain/errors/index.js';
import type { Container } from '@infrastructure/di/index.js';
import { PRODUCT_TOKENS } from '@infrastructure/di/index.js';
import { FEATURES } from '@modules/subscriptions/index.js';
import {
  validateBody,
  validateParams,
  validateQuery,
} from '@presentation/validators/index.js';
import type { CreateProductUseCase } from '../application/use-cases/create-product.use-case.js';
import type { UpdateProductUseCase } from '../application/use-cases/update-product.use-case.js';
import type { DeleteProductUseCase } from '../application/use-cases/delete-product.use-case.js';
import type { GetProductUseCase } from '../application/use-cases/get-product.use-case.js';
import type { ListProductsUseCase } from '../application/use-cases/list-products.use-case.js';
import type { SearchProductsUseCase } from '../application/use-cases/search-products.use-case.js';
import type {
  CreateProductInputDto,
  ListProductsInputDto,
  SearchProductsInputDto,
  UpdateProductInputDto,
} from '../application/dto/product-dtos.js';
import {
  createProductBodySchema,
  updateProductBodySchema,
  listProductsQuerySchema,
  searchProductsQuerySchema,
  productIdParamSchema,
  createProductRouteSchema,
  listProductsRouteSchema,
  searchProductsRouteSchema,
  getProductRouteSchema,
  updateProductRouteSchema,
  deleteProductRouteSchema,
} from './product.schemas.js';

/**
 * The feature key gating the Products module.
 *
 * **Feature-key reconciliation (Requirement 10.3):** the canonical plan →
 * feature matrix does NOT contain a `products` feature — it lists
 * `sales`, `customers`, `stock`, `cash`, `reports`, `purchases`, `api`,
 * `branches`, `dashboard` and `integrations`. The product catalogue is a
 * foundational resource that the Sales feature depends on (you cannot record a
 * sale without products), and every plan tier — including Starter — includes
 * `sales`. Gating products behind {@link FEATURES.SALES} therefore makes the
 * catalogue available to every tenant with an active subscription while still
 * enforcing the subscription/feature guard (no active or expired subscription →
 * 403). This is preferred over leaving the routes ungated so that tenants
 * without a valid subscription cannot reach the catalogue.
 */
const PRODUCTS_FEATURE = FEATURES.SALES;

/** Bundle of the product use cases wired from the DI container. */
interface ProductUseCases {
  create: CreateProductUseCase;
  update: UpdateProductUseCase;
  remove: DeleteProductUseCase;
  get: GetProductUseCase;
  list: ListProductsUseCase;
  search: SearchProductsUseCase;
}

/** Resolves the product use cases from the composition container. */
export function buildProductUseCases(container: Container): ProductUseCases {
  return {
    create: container.resolve(PRODUCT_TOKENS.CreateProductUseCase),
    update: container.resolve(PRODUCT_TOKENS.UpdateProductUseCase),
    remove: container.resolve(PRODUCT_TOKENS.DeleteProductUseCase),
    get: container.resolve(PRODUCT_TOKENS.GetProductUseCase),
    list: container.resolve(PRODUCT_TOKENS.ListProductsUseCase),
    search: container.resolve(PRODUCT_TOKENS.SearchProductsUseCase),
  };
}

/**
 * Returns the authenticated tenant id from the request.
 *
 * Defence in depth: every product route attaches `app.authenticate`, which
 * populates `request.auth`; should that be bypassed the handler still refuses
 * with a 401 rather than operating without a tenant scope (Requirement 1.5).
 */
function requireTenantId(request: FastifyRequest): string {
  const auth = request.auth;
  if (auth === undefined) {
    throw new UnauthorizedError('Authentication required');
  }
  return auth.tenantId;
}

/** Options accepted by the {@link productRoutesPlugin}. */
export interface ProductRoutesOptions {
  /** Composition container with the product infrastructure registered. */
  container: Container;
}

/**
 * Fastify plugin exposing the product catalogue endpoints under
 * `/api/v1/products`.
 *
 * Every route is protected: `app.authenticate` verifies the bearer token
 * (401 on failure), `app.authorize(module, screen, action)` enforces RBAC
 * (403 when the role lacks the permission) and `app.requireFeature` enforces
 * the subscription/feature guard (403 when the tenant's plan does not grant the
 * feature). Inputs are validated with Zod via the shared validators; validation
 * failures map to the consistent 400 envelope through the central error handler
 * (Requirements 25.5–25.7). The attached `schema` objects document the routes
 * for OpenAPI (Requirement 3.7); Fastify's own validation is disabled inside
 * this encapsulated plugin so it never short-circuits the Zod checks.
 *
 * Route ordering: the static `/search` route is registered BEFORE the
 * parametric `/:id` route so "search" is never captured as a product id.
 */
export const productRoutesPlugin: FastifyPluginAsync<ProductRoutesOptions> = (app, opts) => {
  const useCases = buildProductUseCases(opts.container);

  // Documentation-only schemas: skip Fastify validation so Zod owns input
  // validation and produces the consistent error envelope.
  app.setValidatorCompiler(() => (data) => ({ value: data }));

  // POST /api/v1/products — create
  app.post(
    '/',
    {
      schema: createProductRouteSchema,
      preHandler: [
        app.authenticate,
        app.requireFeature(PRODUCTS_FEATURE),
        app.authorize('products', 'list', 'write'),
      ],
    },
    async (request, reply) => {
      const tenantId = requireTenantId(request);
      const body = validateBody(request, createProductBodySchema);
      const input: CreateProductInputDto = {
        tenantId,
        categoryId: body.categoryId,
        sku: body.sku,
        name: body.name,
        price: body.price,
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.cost !== undefined ? { cost: body.cost } : {}),
        ...(body.taxRate !== undefined ? { taxRate: body.taxRate } : {}),
        ...(body.unit !== undefined ? { unit: body.unit } : {}),
        ...(body.minStock !== undefined ? { minStock: body.minStock } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        ...(body.imageUrl !== undefined ? { imageUrl: body.imageUrl } : {}),
        ...(body.currency !== undefined ? { currency: body.currency } : {}),
      };
      const product = await useCases.create.execute(input);
      return reply.status(201).send(product);
    },
  );

  // GET /api/v1/products — list
  app.get(
    '/',
    {
      schema: listProductsRouteSchema,
      preHandler: [
        app.authenticate,
        app.requireFeature(PRODUCTS_FEATURE),
        app.authorize('products', 'list', 'read'),
      ],
    },
    async (request, reply) => {
      const tenantId = requireTenantId(request);
      const query = validateQuery(request, listProductsQuerySchema);
      const input: ListProductsInputDto = {
        tenantId,
        ...(query.page !== undefined ? { page: query.page } : {}),
        ...(query.pageSize !== undefined ? { pageSize: query.pageSize } : {}),
        ...(query.categoryId !== undefined ? { categoryId: query.categoryId } : {}),
        ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
        ...(query.sort !== undefined
          ? { sortBy: query.sort.sortBy, sortDirection: query.sort.sortDirection }
          : {}),
      };
      const result = await useCases.list.execute(input);
      return reply.status(200).send(result);
    },
  );

  // GET /api/v1/products/search — search (registered BEFORE /:id)
  app.get(
    '/search',
    {
      schema: searchProductsRouteSchema,
      preHandler: [
        app.authenticate,
        app.requireFeature(PRODUCTS_FEATURE),
        app.authorize('products', 'list', 'read'),
      ],
    },
    async (request, reply) => {
      const tenantId = requireTenantId(request);
      const query = validateQuery(request, searchProductsQuerySchema);
      const input: SearchProductsInputDto = {
        tenantId,
        term: query.q,
        ...(query.page !== undefined ? { page: query.page } : {}),
        ...(query.pageSize !== undefined ? { pageSize: query.pageSize } : {}),
        ...(query.categoryId !== undefined ? { categoryId: query.categoryId } : {}),
        ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      };
      const result = await useCases.search.execute(input);
      return reply.status(200).send(result);
    },
  );

  // GET /api/v1/products/:id — details
  app.get(
    '/:id',
    {
      schema: getProductRouteSchema,
      preHandler: [
        app.authenticate,
        app.requireFeature(PRODUCTS_FEATURE),
        app.authorize('products', 'detail', 'read'),
      ],
    },
    async (request, reply) => {
      const tenantId = requireTenantId(request);
      const { id } = validateParams(request, productIdParamSchema);
      const product = await useCases.get.execute({ id, tenantId });
      return reply.status(200).send(product);
    },
  );

  // PUT /api/v1/products/:id — update
  app.put(
    '/:id',
    {
      schema: updateProductRouteSchema,
      preHandler: [
        app.authenticate,
        app.requireFeature(PRODUCTS_FEATURE),
        app.authorize('products', 'detail', 'write'),
      ],
    },
    async (request, reply) => {
      const tenantId = requireTenantId(request);
      const { id } = validateParams(request, productIdParamSchema);
      const body = validateBody(request, updateProductBodySchema);
      const input: UpdateProductInputDto = {
        id,
        tenantId,
        ...(body.categoryId !== undefined ? { categoryId: body.categoryId } : {}),
        ...(body.sku !== undefined ? { sku: body.sku } : {}),
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.price !== undefined ? { price: body.price } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.cost !== undefined ? { cost: body.cost } : {}),
        ...(body.taxRate !== undefined ? { taxRate: body.taxRate } : {}),
        ...(body.unit !== undefined ? { unit: body.unit } : {}),
        ...(body.minStock !== undefined ? { minStock: body.minStock } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        ...(body.imageUrl !== undefined ? { imageUrl: body.imageUrl } : {}),
        ...(body.currency !== undefined ? { currency: body.currency } : {}),
      };
      const product = await useCases.update.execute(input);
      return reply.status(200).send(product);
    },
  );

  // DELETE /api/v1/products/:id — soft delete
  app.delete(
    '/:id',
    {
      schema: deleteProductRouteSchema,
      preHandler: [
        app.authenticate,
        app.requireFeature(PRODUCTS_FEATURE),
        app.authorize('products', 'detail', 'delete'),
      ],
    },
    async (request, reply) => {
      const tenantId = requireTenantId(request);
      const { id } = validateParams(request, productIdParamSchema);
      await useCases.remove.execute({ id, tenantId });
      return reply.status(204).send();
    },
  );

  return Promise.resolve();
};

/**
 * Registers the product routes under the `/api/v1/products` prefix.
 *
 * Wraps {@link productRoutesPlugin} in its own encapsulated context so the
 * relaxed validator compiler does not leak to other routes.
 */
export async function registerProductRoutes(
  app: FastifyInstance,
  container: Container,
): Promise<void> {
  await app.register(productRoutesPlugin, { prefix: '/api/v1/products', container });
}
