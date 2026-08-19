import { getTenantId } from '@common/context/request-context';
import { prisma } from './prisma-client';

/**
 * Models that carry a `tenantId` column and therefore participate in row-level
 * multi-tenant isolation (Requirement 1.2: automatic tenant filtering;
 * Requirement 1.5: prevent cross-tenant data access).
 *
 * This list is verified against `prisma/schema.prisma`. Models intentionally
 * EXCLUDED because they have no `tenantId` column:
 * - `Tenant`           — it *is* the tenant; it is not scoped *by* a tenant.
 * - `RefreshToken`     — scoped to a `userId`, used during login before a
 *                        tenant context exists.
 * - `Permission`       — scoped to a `roleId` (the parent `Role` is scoped).
 * - `SaleDetail` /
 *   `PurchaseDetail`   — scoped to their parent `Sale` / `Purchase`.
 * - `Plan`             — a platform-level (global) catalog entity.
 *
 * Keep this set in sync with the schema. Adding a `tenantId` column to a model
 * WITHOUT adding it here would silently leak that model across tenants.
 */
export const TENANT_SCOPED_MODELS: ReadonlySet<string> = new Set<string>([
  'User',
  'Role',
  'Category',
  'Product',
  'Stock',
  'StockMovement',
  'Sale',
  'Purchase',
  'Customer',
  'Supplier',
  'Branch',
  'Cash',
  'CashMovement',
  'Payment',
  'Subscription',
  'FeatureFlag',
  'Configuration',
  'AuditLog',
]);

/** Read operations whose `where` clause must be constrained to the tenant. */
const READ_OPERATIONS: ReadonlySet<string> = new Set<string>([
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'findUnique',
  'findUniqueOrThrow',
  'count',
  'aggregate',
  'groupBy',
]);

/** Create operations whose `data` payload must be stamped with the tenant. */
const CREATE_OPERATIONS: ReadonlySet<string> = new Set<string>([
  'create',
  'createMany',
  'createManyAndReturn',
]);

/** Mutating operations whose `where` clause must be constrained to the tenant. */
const WHERE_MUTATION_OPERATIONS: ReadonlySet<string> = new Set<string>([
  'update',
  'updateMany',
  'delete',
  'deleteMany',
]);

/** Returns `true` when the model participates in tenant isolation. */
export function isTenantScopedModel(model: string | undefined): boolean {
  return model !== undefined && TENANT_SCOPED_MODELS.has(model);
}

type UnknownRecord = Record<string, unknown>;

/** Returns a shallow copy of `where` with the tenant filter applied. */
function withTenantWhere(where: unknown, tenantId: string): UnknownRecord {
  return { ...((where as UnknownRecord | undefined) ?? {}), tenantId };
}

/**
 * Returns a copy of the create `data` payload (single record or batch array)
 * with the tenant id stamped onto every record.
 */
function withTenantData(data: unknown, tenantId: string): unknown {
  if (Array.isArray(data)) {
    return data.map((entry) => ({ ...((entry as UnknownRecord | undefined) ?? {}), tenantId }));
  }
  return { ...((data as UnknownRecord | undefined) ?? {}), tenantId };
}

/**
 * Core, side-effect-free tenant-scoping logic.
 *
 * Given a Prisma model/operation and its `args`, returns a new `args` object
 * with the tenant constraint applied. Behaviour:
 *
 * - Non-tenant-scoped models are returned unchanged.
 * - When `tenantId` is `undefined` (no request/tenant context — e.g. login
 *   lookups, tenant provisioning, plan seeding) the args are returned
 *   UNCHANGED so the query runs unscoped. See {@link systemPrisma} for the
 *   security trade-off this implies.
 * - Reads inject the tenant into `where`.
 * - Creates stamp the tenant onto `data`.
 * - `upsert` stamps both `where` and the `create` payload.
 * - Updates/deletes inject the tenant into `where`.
 */
export function applyTenantScope(
  model: string | undefined,
  operation: string,
  args: unknown,
  tenantId: string | undefined,
): unknown {
  // Non-tenant-scoped models (Tenant, RefreshToken, Permission, Plan, ...) and
  // system-level calls without a tenant context are passed through untouched.
  if (!isTenantScopedModel(model) || tenantId === undefined) {
    return args;
  }

  const nextArgs: UnknownRecord = { ...((args as UnknownRecord | undefined) ?? {}) };

  if (READ_OPERATIONS.has(operation)) {
    nextArgs.where = withTenantWhere(nextArgs.where, tenantId);
  } else if (CREATE_OPERATIONS.has(operation)) {
    nextArgs.data = withTenantData(nextArgs.data, tenantId);
  } else if (operation === 'upsert') {
    nextArgs.where = withTenantWhere(nextArgs.where, tenantId);
    nextArgs.create = withTenantData(nextArgs.create, tenantId);
  } else if (WHERE_MUTATION_OPERATIONS.has(operation)) {
    nextArgs.where = withTenantWhere(nextArgs.where, tenantId);
  }

  return nextArgs;
}

/**
 * Adapter that bridges {@link applyTenantScope} to Prisma's
 * `$allOperations` extension hook. Extracted so it can be unit-tested with a
 * fake `query` function and an injectable tenant resolver, independent of a
 * live database or the generated client.
 */
export async function applyTenantToOperation<TArgs, TResult>(
  params: {
    model?: string;
    operation: string;
    args: TArgs;
    query: (args: TArgs) => Promise<TResult>;
  },
  resolveTenantId: () => string | undefined,
): Promise<TResult> {
  const scopedArgs = applyTenantScope(
    params.model,
    params.operation,
    params.args,
    resolveTenantId(),
  ) as TArgs;
  return params.query(scopedArgs);
}

/**
 * Tenant-aware Prisma client. This is the client application code should use
 * for all tenant-owned data.
 *
 * It transparently injects the active tenant (resolved from the request
 * context via {@link getTenantId}) into every query, create, update, and
 * delete against a tenant-scoped model. Implemented as a Prisma Client
 * extension (the legacy `prisma.$use` middleware API was removed in Prisma v6).
 */
export const tenantPrisma = prisma.$extends({
  name: 'tenant-isolation',
  query: {
    $allModels: {
      $allOperations: (params) => applyTenantToOperation(params, getTenantId),
    },
  },
});

export type TenantPrismaClient = typeof tenantPrisma;

/**
 * The base, UNEXTENDED Prisma client — an explicit escape hatch for legitimately
 * tenant-agnostic operations, such as:
 * - Authentication lookups before a tenant is known (find user by email).
 * - Tenant provisioning / onboarding (creating the `Tenant` row + its first user).
 * - Platform-level seeding and catalog reads (`Plan`).
 * - Cross-tenant administrative/reporting jobs run by platform operators.
 *
 * SECURITY TRADE-OFF: queries issued through `systemPrisma` against
 * tenant-scoped models receive NO automatic tenant filter. Using it on a
 * tenant-owned model without an explicit, hand-written `tenantId` constraint
 * will read or mutate data across ALL tenants. Reach for it only when the
 * operation is genuinely tenant-agnostic, and always scope the query manually
 * when touching tenant-scoped tables. Prefer {@link tenantPrisma} everywhere
 * else.
 */
export const systemPrisma = prisma;
