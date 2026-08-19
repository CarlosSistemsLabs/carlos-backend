import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { Container, PRODUCT_TOKENS } from '@infrastructure/di/index.js';
import { registerErrorHandler } from '@presentation/middlewares/error-handler.js';
import { registerAuthentication } from '@presentation/middlewares/authentication.js';
import { registerAuthorization } from '@presentation/middlewares/authorization.js';
import { registerFeatureFlagAuthorization } from '@presentation/middlewares/feature-flag.js';
import { JwtTokenService } from '../../auth/infrastructure/jwt-token-service.js';
import { AuthUser } from '../../auth/domain/entities/auth-user.js';
import { Role } from '../../authorization/domain/entities/role.js';
import { Permission } from '../../authorization/domain/value-objects/permission.js';
import type { IRoleRepository } from '../../authorization/domain/repositories/role-repository.js';
import type {
  FeatureAccessDecision,
  IFeatureAccessService,
} from '../../subscriptions/domain/services/feature-access-service.js';
import { Product } from '../domain/entities/product.js';
import { Sku } from '../domain/value-objects/sku.js';
import { Money } from '../domain/value-objects/money.js';
import type {
  IProductRepository,
  ProductQuery,
} from '../domain/repositories/product-repository.js';
import type { ICategoryRepository } from '../domain/repositories/category-repository.js';
import { Category } from '../domain/entities/category.js';
import { CreateProductUseCase } from '../application/use-cases/create-product.use-case.js';
import { UpdateProductUseCase } from '../application/use-cases/update-product.use-case.js';
import { DeleteProductUseCase } from '../application/use-cases/delete-product.use-case.js';
import { GetProductUseCase } from '../application/use-cases/get-product.use-case.js';
import { ListProductsUseCase } from '../application/use-cases/list-products.use-case.js';
import { SearchProductsUseCase } from '../application/use-cases/search-products.use-case.js';
import { registerProductRoutes } from './product.routes.js';
import type { PaginatedResult, UUID } from '@shared/types/index.js';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_TENANT_ID = '99999999-9999-9999-9999-999999999999';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const ADMIN_ROLE_ID = '33333333-3333-3333-3333-333333333333';
const READER_ROLE_ID = '44444444-4444-4444-4444-444444444444';
const CATEGORY_ID = '55555555-5555-5555-5555-555555555555';
const MISSING_ID = '66666666-6666-6666-6666-666666666666';

// ---------------------------------------------------------------------------
// In-memory fakes (no live database / no mocks of business logic)
// ---------------------------------------------------------------------------

class InMemoryProductRepository implements IProductRepository {
  private readonly byId = new Map<UUID, Product>();
  private readonly deleted = new Set<UUID>();
  private readonly order: UUID[] = [];

  seed(product: Product): void {
    this.byId.set(product.id, product);
    this.order.push(product.id);
  }

  async findById(id: UUID): Promise<Product | null> {
    if (this.deleted.has(id)) {
      return null;
    }
    return this.byId.get(id) ?? null;
  }

  async findBySku(tenantId: UUID, sku: string): Promise<Product | null> {
    for (const id of this.order) {
      if (this.deleted.has(id)) continue;
      const product = this.byId.get(id);
      if (product !== undefined && product.tenantId === tenantId && product.sku.value === sku) {
        return product;
      }
    }
    return null;
  }

  async findMany(tenantId: UUID, query: ProductQuery): Promise<PaginatedResult<Product>> {
    let items = this.order
      .filter((id) => !this.deleted.has(id))
      .map((id) => this.byId.get(id))
      .filter((p): p is Product => p !== undefined && p.tenantId === tenantId);

    const filters = query.filters ?? {};
    if (filters.categoryId !== undefined) {
      items = items.filter((p) => p.categoryId === filters.categoryId);
    }
    if (filters.isActive !== undefined) {
      items = items.filter((p) => p.isActive === filters.isActive);
    }
    if (filters.search !== undefined) {
      const term = filters.search.toLowerCase();
      items = items.filter(
        (p) =>
          p.name.toLowerCase().includes(term) || p.sku.value.toLowerCase().includes(term),
      );
    }

    if (query.sort !== undefined) {
      const dir = query.sort.direction === 'desc' ? -1 : 1;
      const field = query.sort.field;
      items = [...items].sort((a, b) => {
        let cmp = 0;
        if (field === 'name') cmp = a.name.localeCompare(b.name);
        else if (field === 'sku') cmp = a.sku.value.localeCompare(b.sku.value);
        else if (field === 'price') cmp = a.price.compare(b.price);
        return cmp * dir;
      });
    }

    const total = items.length;
    const totalPages = total === 0 ? 0 : Math.ceil(total / query.pageSize);
    const start = (query.page - 1) * query.pageSize;
    const paged = items.slice(start, start + query.pageSize);

    return { items: paged, total, page: query.page, pageSize: query.pageSize, totalPages };
  }

  async create(product: Product): Promise<Product> {
    this.seed(product);
    return product;
  }

  async update(product: Product): Promise<Product> {
    this.byId.set(product.id, product);
    return product;
  }

  async softDelete(id: UUID): Promise<void> {
    this.deleted.add(id);
  }

  async existsBySku(tenantId: UUID, sku: string, excludeId?: UUID): Promise<boolean> {
    for (const id of this.order) {
      if (this.deleted.has(id)) continue;
      if (excludeId !== undefined && id === excludeId) continue;
      const product = this.byId.get(id);
      if (product !== undefined && product.tenantId === tenantId && product.sku.value === sku) {
        return true;
      }
    }
    return false;
  }
}

class InMemoryCategoryRepository implements ICategoryRepository {
  private readonly byId = new Map<UUID, Category>();

  seed(category: Category): void {
    this.byId.set(category.id, category);
  }

  async findById(id: UUID): Promise<Category | null> {
    return this.byId.get(id) ?? null;
  }

  async findByTenant(tenantId: UUID): Promise<Category[]> {
    return [...this.byId.values()].filter((c) => c.tenantId === tenantId);
  }

  async findChildren(tenantId: UUID, parentId: UUID | null): Promise<Category[]> {
    return [...this.byId.values()].filter(
      (c) => c.tenantId === tenantId && c.parentId === parentId,
    );
  }

  async create(category: Category): Promise<Category> {
    this.byId.set(category.id, category);
    return category;
  }

  async update(category: Category): Promise<Category> {
    this.byId.set(category.id, category);
    return category;
  }

  async softDelete(id: UUID): Promise<void> {
    this.byId.delete(id);
  }
}

class InMemoryRoleRepository implements IRoleRepository {
  private readonly byId = new Map<UUID, Role>();

  seed(role: Role): void {
    this.byId.set(role.id, role);
  }

  async findById(id: UUID): Promise<Role | null> {
    return this.byId.get(id) ?? null;
  }

  async findByTenant(tenantId: UUID): Promise<Role[]> {
    return [...this.byId.values()].filter((r) => r.tenantId === tenantId);
  }

  async findByName(tenantId: UUID, name: string): Promise<Role | null> {
    for (const role of this.byId.values()) {
      if (role.tenantId === tenantId && role.name === name) {
        return role;
      }
    }
    return null;
  }

  async create(role: Role): Promise<Role> {
    this.byId.set(role.id, role);
    return role;
  }

  async update(role: Role): Promise<Role> {
    this.byId.set(role.id, role);
    return role;
  }

  async addPermissions(role: Role): Promise<Role> {
    this.byId.set(role.id, role);
    return role;
  }

  async replacePermissions(role: Role): Promise<Role> {
    this.byId.set(role.id, role);
    return role;
  }
}

/** Feature access service that always grants access. */
class AllowAllFeatureAccessService implements IFeatureAccessService {
  async checkFeatureAccess(): Promise<FeatureAccessDecision> {
    return { allowed: true };
  }

  async isFeatureEnabled(): Promise<boolean> {
    return true;
  }
}

/** Feature access service that always denies (no active subscription). */
class DenyAllFeatureAccessService implements IFeatureAccessService {
  async checkFeatureAccess(): Promise<FeatureAccessDecision> {
    return { allowed: false, reason: 'no_active_subscription' };
  }

  async isFeatureEnabled(): Promise<boolean> {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function seededProduct(
  overrides: { sku?: string; name?: string; tenantId?: UUID; id?: UUID } = {},
): Product {
  return Product.create(
    {
      tenantId: overrides.tenantId ?? TENANT_ID,
      categoryId: CATEGORY_ID,
      sku: Sku.create(overrides.sku ?? 'SKU-001'),
      name: overrides.name ?? 'Wireless Mouse',
      price: Money.fromDecimal('19.90', 'ARS'),
    },
    overrides.id ?? 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  );
}

interface TestAppOptions {
  /** When false, the user's role grants read-only access (for 403 tests). */
  fullAccess?: boolean;
  /** When false, the feature guard denies access (for feature 403 tests). */
  featureAllowed?: boolean;
}

interface TestApp {
  app: FastifyInstance;
  token: string;
  products: InMemoryProductRepository;
}

async function buildTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  const fullAccess = options.fullAccess ?? true;
  const featureAllowed = options.featureAllowed ?? true;

  const tokenService = await JwtTokenService.withEphemeralKeys({ issuer: 'carlos-erp' });

  const roles = new InMemoryRoleRepository();
  roles.seed(
    Role.create(
      {
        tenantId: TENANT_ID,
        name: 'Admin',
        permissions: [Permission.create('*', '*', '*')],
      },
      ADMIN_ROLE_ID,
    ),
  );
  roles.seed(
    Role.create(
      {
        tenantId: TENANT_ID,
        name: 'Reader',
        permissions: [Permission.create('products', '*', 'read')],
      },
      READER_ROLE_ID,
    ),
  );

  const roleId = fullAccess ? ADMIN_ROLE_ID : READER_ROLE_ID;
  const user = AuthUser.reconstitute(USER_ID, {
    tenantId: TENANT_ID,
    email: 'ada@example.com',
    passwordHash: 'hash',
    firstName: 'Ada',
    lastName: 'Lovelace',
    roleId,
    phone: null,
    avatar: null,
    isActive: true,
    lastLoginAt: null,
    failedLoginCount: 0,
    lockedUntil: null,
  });
  const token = await tokenService.issueAccessToken(user);

  const products = new InMemoryProductRepository();
  products.seed(seededProduct());

  const categories = new InMemoryCategoryRepository();
  categories.seed(
    Category.create({ tenantId: TENANT_ID, name: 'Peripherals' }, CATEGORY_ID),
  );

  const container = new Container();
  container.registerValue(
    PRODUCT_TOKENS.CreateProductUseCase,
    new CreateProductUseCase(products, categories),
  );
  container.registerValue(
    PRODUCT_TOKENS.UpdateProductUseCase,
    new UpdateProductUseCase(products, categories),
  );
  container.registerValue(PRODUCT_TOKENS.DeleteProductUseCase, new DeleteProductUseCase(products));
  container.registerValue(PRODUCT_TOKENS.GetProductUseCase, new GetProductUseCase(products));
  container.registerValue(PRODUCT_TOKENS.ListProductsUseCase, new ListProductsUseCase(products));
  container.registerValue(
    PRODUCT_TOKENS.SearchProductsUseCase,
    new SearchProductsUseCase(products),
  );

  const app = Fastify();
  registerErrorHandler(app);
  registerAuthentication(app, tokenService);
  registerAuthorization(app, roles);
  registerFeatureFlagAuthorization(
    app,
    featureAllowed ? new AllowAllFeatureAccessService() : new DenyAllFeatureAccessService(),
  );
  await registerProductRoutes(app, container);
  await app.ready();

  return { app, token, products };
}

function authHeader(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('product routes', () => {
  let ctx: TestApp;

  afterEach(async () => {
    await ctx.app.close();
  });

  describe('authentication & authorization', () => {
    it('returns 401 when unauthenticated', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({ method: 'GET', url: '/api/v1/products' });
      expect(response.statusCode).toBe(401);
      expect(response.json().error_code).toBe('UNAUTHORIZED');
    });

    it('returns 403 when the role lacks the permission (create as reader)', async () => {
      ctx = await buildTestApp({ fullAccess: false });
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/products',
        headers: authHeader(ctx.token),
        payload: {
          categoryId: CATEGORY_ID,
          sku: 'SKU-NEW',
          name: 'Keyboard',
          price: '49.99',
        },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().error_code).toBe('FORBIDDEN');
    });

    it('returns 403 when the tenant subscription does not grant the feature', async () => {
      ctx = await buildTestApp({ featureAllowed: false });
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/products',
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(403);
    });
  });

  describe('POST /api/v1/products', () => {
    it('creates a product and returns 201', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/products',
        headers: authHeader(ctx.token),
        payload: {
          categoryId: CATEGORY_ID,
          sku: 'SKU-NEW',
          name: 'Keyboard',
          price: '49.99',
          taxRate: 21,
        },
      });
      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body).toMatchObject({
        tenantId: TENANT_ID,
        categoryId: CATEGORY_ID,
        sku: 'SKU-NEW',
        name: 'Keyboard',
        price: '49.99',
        taxRate: 21,
      });
      expect(body.id).toBeTypeOf('string');
    });

    it('returns 400 when the body is invalid', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/products',
        headers: authHeader(ctx.token),
        payload: { categoryId: 'not-a-uuid', sku: '', name: '', price: 'abc' },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error_code).toBe('VALIDATION_ERROR');
    });

    it('returns 409 on a duplicate SKU', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/products',
        headers: authHeader(ctx.token),
        payload: { categoryId: CATEGORY_ID, sku: 'SKU-001', name: 'Dup', price: '5.00' },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json().error_code).toBe('CONFLICT');
    });
  });

  describe('GET /api/v1/products', () => {
    it('returns a paginated page of products', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/products?page=1&pageSize=10',
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.meta).toMatchObject({ total: 1, page: 1, pageSize: 10, totalPages: 1 });
      expect(body.items).toHaveLength(1);
      expect(body.items[0].sku).toBe('SKU-001');
    });

    it('returns 400 on an invalid query parameter', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/products?sort=bogusfield',
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error_code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/v1/products/search', () => {
    it('is not shadowed by /:id and searches by term', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/products/search?q=mouse',
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.items).toHaveLength(1);
      expect(body.items[0].name).toBe('Wireless Mouse');
    });

    it('returns 400 when the search term is missing', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/products/search',
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error_code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/v1/products/:id', () => {
    it('returns the product details', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/products/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa`,
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().sku).toBe('SKU-001');
    });

    it('returns 404 for a missing product', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/products/${MISSING_ID}`,
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(404);
      expect(response.json().error_code).toBe('NOT_FOUND');
    });
  });

  describe('PUT /api/v1/products/:id', () => {
    it('updates a product and returns 200', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'PUT',
        url: `/api/v1/products/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa`,
        headers: authHeader(ctx.token),
        payload: { name: 'Wireless Mouse Pro', price: '24.50' },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.name).toBe('Wireless Mouse Pro');
      expect(body.price).toBe('24.50');
    });

    it('returns 404 when updating a missing product', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'PUT',
        url: `/api/v1/products/${MISSING_ID}`,
        headers: authHeader(ctx.token),
        payload: { name: 'Nope' },
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('DELETE /api/v1/products/:id', () => {
    it('soft-deletes a product and returns 204', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'DELETE',
        url: `/api/v1/products/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa`,
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(204);
      expect(response.body).toBe('');

      // The deleted product can no longer be read.
      const get = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/products/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa`,
        headers: authHeader(ctx.token),
      });
      expect(get.statusCode).toBe(404);
    });

    it('returns 404 when deleting a missing product', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'DELETE',
        url: `/api/v1/products/${MISSING_ID}`,
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('tenant isolation', () => {
    it('does not return another tenant product by id (404)', async () => {
      ctx = await buildTestApp();
      const foreignId = '77777777-7777-7777-7777-777777777777';
      ctx.products.seed(
        seededProduct({
          id: foreignId,
          sku: 'SKU-OTHER',
          name: 'Foreign',
          tenantId: OTHER_TENANT_ID,
        }),
      );
      // The product exists in the store but belongs to another tenant, so the
      // caller (TENANT_ID) must not be able to read it.
      const response = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/products/${foreignId}`,
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(404);
    });
  });
});
