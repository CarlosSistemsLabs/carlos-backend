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
import { CreateCategoryUseCase } from '../application/use-cases/create-category.use-case.js';
import { UpdateCategoryUseCase } from '../application/use-cases/update-category.use-case.js';
import { DeleteCategoryUseCase } from '../application/use-cases/delete-category.use-case.js';
import { GetCategoryUseCase } from '../application/use-cases/get-category.use-case.js';
import { ListCategoriesUseCase } from '../application/use-cases/list-categories.use-case.js';
import { GetCategoryTreeUseCase } from '../application/use-cases/get-category-tree.use-case.js';
import { registerCategoryRoutes } from './category.routes.js';
import type { PaginatedResult, UUID } from '@shared/types/index.js';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_TENANT_ID = '99999999-9999-9999-9999-999999999999';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const ADMIN_ROLE_ID = '33333333-3333-3333-3333-333333333333';
const READER_ROLE_ID = '44444444-4444-4444-4444-444444444444';
const ROOT_ID = '55555555-5555-5555-5555-555555555555';
const CHILD_ID = '66666666-6666-6666-6666-666666666666';
const MISSING_ID = '77777777-7777-7777-7777-777777777777';

// ---------------------------------------------------------------------------
// In-memory fakes (no live database / no mocks of business logic)
// ---------------------------------------------------------------------------

class InMemoryCategoryRepository implements ICategoryRepository {
  private readonly byId = new Map<UUID, Category>();
  private readonly deleted = new Set<UUID>();

  seed(category: Category): void {
    this.byId.set(category.id, category);
  }

  private active(): Category[] {
    return [...this.byId.values()].filter((c) => !this.deleted.has(c.id));
  }

  async findById(id: UUID): Promise<Category | null> {
    if (this.deleted.has(id)) return null;
    return this.byId.get(id) ?? null;
  }

  async findByTenant(tenantId: UUID): Promise<Category[]> {
    return this.active()
      .filter((c) => c.tenantId === tenantId)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async findChildren(tenantId: UUID, parentId: UUID | null): Promise<Category[]> {
    return this.active().filter((c) => c.tenantId === tenantId && c.parentId === parentId);
  }

  async create(category: Category): Promise<Category> {
    this.seed(category);
    return category;
  }

  async update(category: Category): Promise<Category> {
    this.seed(category);
    return category;
  }

  async softDelete(id: UUID): Promise<void> {
    this.deleted.add(id);
  }
}

class InMemoryProductRepository implements IProductRepository {
  private readonly byId = new Map<UUID, Product>();

  seed(product: Product): void {
    this.byId.set(product.id, product);
  }

  async findById(id: UUID): Promise<Product | null> {
    return this.byId.get(id) ?? null;
  }

  async findBySku(): Promise<Product | null> {
    return null;
  }

  async findMany(tenantId: UUID, query: ProductQuery): Promise<PaginatedResult<Product>> {
    const categoryId = query.filters?.categoryId;
    const items = [...this.byId.values()].filter(
      (p) => p.tenantId === tenantId && (categoryId === undefined || p.categoryId === categoryId),
    );
    return {
      items: items.slice(0, query.pageSize),
      total: items.length,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: items.length === 0 ? 0 : Math.ceil(items.length / query.pageSize),
    };
  }

  async create(product: Product): Promise<Product> {
    this.seed(product);
    return product;
  }

  async update(product: Product): Promise<Product> {
    this.seed(product);
    return product;
  }

  async softDelete(): Promise<void> {
    // not used in these tests
  }

  async existsBySku(): Promise<boolean> {
    return false;
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
      if (role.tenantId === tenantId && role.name === name) return role;
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

class AllowAllFeatureAccessService implements IFeatureAccessService {
  async checkFeatureAccess(): Promise<FeatureAccessDecision> {
    return { allowed: true };
  }
  async isFeatureEnabled(): Promise<boolean> {
    return true;
  }
}

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

interface TestAppOptions {
  fullAccess?: boolean;
  featureAllowed?: boolean;
}

interface TestApp {
  app: FastifyInstance;
  token: string;
  categories: InMemoryCategoryRepository;
  products: InMemoryProductRepository;
}

async function buildTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  const fullAccess = options.fullAccess ?? true;
  const featureAllowed = options.featureAllowed ?? true;

  const tokenService = await JwtTokenService.withEphemeralKeys({ issuer: 'carlos-erp' });

  const roles = new InMemoryRoleRepository();
  roles.seed(
    Role.create(
      { tenantId: TENANT_ID, name: 'Admin', permissions: [Permission.create('*', '*', '*')] },
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

  const categories = new InMemoryCategoryRepository();
  categories.seed(
    Category.reconstitute(ROOT_ID, {
      tenantId: TENANT_ID,
      name: 'Beverages',
      description: null,
      parentId: null,
    }),
  );
  categories.seed(
    Category.reconstitute(CHILD_ID, {
      tenantId: TENANT_ID,
      name: 'Soft Drinks',
      description: null,
      parentId: ROOT_ID,
    }),
  );

  const products = new InMemoryProductRepository();

  const container = new Container();
  container.registerValue(
    PRODUCT_TOKENS.CreateCategoryUseCase,
    new CreateCategoryUseCase(categories),
  );
  container.registerValue(
    PRODUCT_TOKENS.UpdateCategoryUseCase,
    new UpdateCategoryUseCase(categories),
  );
  container.registerValue(
    PRODUCT_TOKENS.DeleteCategoryUseCase,
    new DeleteCategoryUseCase(categories, products),
  );
  container.registerValue(PRODUCT_TOKENS.GetCategoryUseCase, new GetCategoryUseCase(categories));
  container.registerValue(
    PRODUCT_TOKENS.ListCategoriesUseCase,
    new ListCategoriesUseCase(categories),
  );
  container.registerValue(
    PRODUCT_TOKENS.GetCategoryTreeUseCase,
    new GetCategoryTreeUseCase(categories),
  );

  const app = Fastify();
  registerErrorHandler(app);
  registerAuthentication(app, tokenService);
  registerAuthorization(app, roles);
  registerFeatureFlagAuthorization(
    app,
    featureAllowed ? new AllowAllFeatureAccessService() : new DenyAllFeatureAccessService(),
  );
  await registerCategoryRoutes(app, container);
  await app.ready();

  return { app, token, categories, products };
}

function authHeader(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function seededProduct(categoryId: UUID): Product {
  return Product.create(
    {
      tenantId: TENANT_ID,
      categoryId,
      sku: Sku.create('SKU-001'),
      name: 'Cola 1L',
      price: Money.fromDecimal('19.90', 'ARS'),
    },
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('category routes', () => {
  let ctx: TestApp;

  afterEach(async () => {
    await ctx.app.close();
  });

  describe('authentication & authorization', () => {
    it('returns 401 when unauthenticated', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({ method: 'GET', url: '/api/v1/categories' });
      expect(response.statusCode).toBe(401);
      expect(response.json().error_code).toBe('UNAUTHORIZED');
    });

    it('returns 403 when the role lacks the permission (create as reader)', async () => {
      ctx = await buildTestApp({ fullAccess: false });
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/categories',
        headers: authHeader(ctx.token),
        payload: { name: 'Snacks' },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().error_code).toBe('FORBIDDEN');
    });

    it('returns 403 when the tenant subscription does not grant the feature', async () => {
      ctx = await buildTestApp({ featureAllowed: false });
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/categories',
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(403);
    });
  });

  describe('POST /api/v1/categories', () => {
    it('creates a root category and returns 201', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/categories',
        headers: authHeader(ctx.token),
        payload: { name: 'Snacks' },
      });
      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body).toMatchObject({ tenantId: TENANT_ID, name: 'Snacks', parentId: null });
      expect(body.id).toBeTypeOf('string');
    });

    it('creates a child category under an existing parent', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/categories',
        headers: authHeader(ctx.token),
        payload: { name: 'Juices', parentId: ROOT_ID },
      });
      expect(response.statusCode).toBe(201);
      expect(response.json().parentId).toBe(ROOT_ID);
    });

    it('returns 404 when the parent does not exist', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/categories',
        headers: authHeader(ctx.token),
        payload: { name: 'Orphan', parentId: MISSING_ID },
      });
      expect(response.statusCode).toBe(404);
      expect(response.json().error_code).toBe('NOT_FOUND');
    });

    it('returns 400 when the body is invalid', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/categories',
        headers: authHeader(ctx.token),
        payload: { name: '', parentId: 'not-a-uuid' },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error_code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/v1/categories', () => {
    it('lists categories (flat)', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/categories',
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toHaveLength(2);
      expect(body.map((c: { name: string }) => c.name)).toEqual(['Beverages', 'Soft Drinks']);
    });
  });

  describe('GET /api/v1/categories/tree', () => {
    it('returns the hierarchical tree and is not shadowed by /:id', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/categories/tree',
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(200);
      const tree = response.json();
      expect(tree).toHaveLength(1);
      expect(tree[0].id).toBe(ROOT_ID);
      expect(tree[0].children).toHaveLength(1);
      expect(tree[0].children[0].id).toBe(CHILD_ID);
      expect(tree[0].children[0].children).toEqual([]);
    });
  });

  describe('GET /api/v1/categories/:id', () => {
    it('returns the category details', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/categories/${ROOT_ID}`,
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().name).toBe('Beverages');
    });

    it('returns 404 for a missing category', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/categories/${MISSING_ID}`,
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(404);
      expect(response.json().error_code).toBe('NOT_FOUND');
    });

    it('does not return another tenant category by id (404)', async () => {
      ctx = await buildTestApp();
      const foreignId = '88888888-8888-8888-8888-888888888888';
      ctx.categories.seed(
        Category.reconstitute(foreignId, {
          tenantId: OTHER_TENANT_ID,
          name: 'Foreign',
          description: null,
          parentId: null,
        }),
      );
      const response = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/categories/${foreignId}`,
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('PUT /api/v1/categories/:id', () => {
    it('renames a category and returns 200', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'PUT',
        url: `/api/v1/categories/${ROOT_ID}`,
        headers: authHeader(ctx.token),
        payload: { name: 'Drinks' },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().name).toBe('Drinks');
    });

    it('rejects a reparent that would create a cycle (422)', async () => {
      ctx = await buildTestApp();
      // Moving the root under its own child forms a cycle.
      const response = await ctx.app.inject({
        method: 'PUT',
        url: `/api/v1/categories/${ROOT_ID}`,
        headers: authHeader(ctx.token),
        payload: { parentId: CHILD_ID },
      });
      expect(response.statusCode).toBe(422);
      expect(response.json().error_code).toBe('BUSINESS_RULE_VIOLATION');
    });

    it('returns 404 when updating a missing category', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'PUT',
        url: `/api/v1/categories/${MISSING_ID}`,
        headers: authHeader(ctx.token),
        payload: { name: 'Nope' },
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('DELETE /api/v1/categories/:id', () => {
    it('soft-deletes an empty (leaf) category and returns 204', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'DELETE',
        url: `/api/v1/categories/${CHILD_ID}`,
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(204);
      expect(response.body).toBe('');

      const get = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/categories/${CHILD_ID}`,
        headers: authHeader(ctx.token),
      });
      expect(get.statusCode).toBe(404);
    });

    it('rejects deleting a category that has children (409)', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'DELETE',
        url: `/api/v1/categories/${ROOT_ID}`,
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(409);
      expect(response.json().error_code).toBe('CONFLICT');
    });

    it('rejects deleting a category that has assigned products (409)', async () => {
      ctx = await buildTestApp();
      ctx.products.seed(seededProduct(CHILD_ID));
      const response = await ctx.app.inject({
        method: 'DELETE',
        url: `/api/v1/categories/${CHILD_ID}`,
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(409);
      expect(response.json().error_code).toBe('CONFLICT');
    });

    it('returns 404 when deleting a missing category', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'DELETE',
        url: `/api/v1/categories/${MISSING_ID}`,
        headers: authHeader(ctx.token),
      });
      expect(response.statusCode).toBe(404);
    });
  });
});
