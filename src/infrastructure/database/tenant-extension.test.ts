import { describe, expect, it, vi } from 'vitest';
import {
  applyTenantScope,
  applyTenantToOperation,
  isTenantScopedModel,
  TENANT_SCOPED_MODELS,
} from './tenant-extension';

const TENANT = 'tenant-123';

describe('TENANT_SCOPED_MODELS', () => {
  it('includes every model that carries a tenantId column', () => {
    for (const model of [
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
    ]) {
      expect(TENANT_SCOPED_MODELS.has(model)).toBe(true);
    }
  });

  it('excludes models that have no tenantId column', () => {
    for (const model of ['Tenant', 'RefreshToken', 'Permission', 'SaleDetail', 'PurchaseDetail', 'Plan']) {
      expect(TENANT_SCOPED_MODELS.has(model)).toBe(false);
    }
  });
});

describe('isTenantScopedModel', () => {
  it('returns true for tenant-scoped models', () => {
    expect(isTenantScopedModel('Product')).toBe(true);
  });

  it('returns false for non-tenant-scoped models and undefined', () => {
    expect(isTenantScopedModel('Tenant')).toBe(false);
    expect(isTenantScopedModel(undefined)).toBe(false);
  });
});

describe('applyTenantScope - read operations (Requirement 1.2)', () => {
  it('injects the tenant filter into findMany where', () => {
    const result = applyTenantScope('Product', 'findMany', { where: { isActive: true } }, TENANT);
    expect(result).toEqual({ where: { isActive: true, tenantId: TENANT } });
  });

  it('adds a where clause when none is provided', () => {
    const result = applyTenantScope('Sale', 'findFirst', undefined, TENANT);
    expect(result).toEqual({ where: { tenantId: TENANT } });
  });

  it('constrains findUnique by tenant', () => {
    const result = applyTenantScope('User', 'findUnique', { where: { id: 'u1' } }, TENANT);
    expect(result).toEqual({ where: { id: 'u1', tenantId: TENANT } });
  });

  it.each(['count', 'aggregate', 'groupBy', 'findFirstOrThrow', 'findUniqueOrThrow'])(
    'injects the tenant filter into %s',
    (operation) => {
      const result = applyTenantScope('Customer', operation, { where: { name: 'x' } }, TENANT) as {
        where: Record<string, unknown>;
      };
      expect(result.where).toMatchObject({ name: 'x', tenantId: TENANT });
    },
  );
});

describe('applyTenantScope - create operations (Requirement 1.5)', () => {
  it('stamps the tenant onto create data', () => {
    const result = applyTenantScope('Product', 'create', { data: { sku: 'ABC' } }, TENANT);
    expect(result).toEqual({ data: { sku: 'ABC', tenantId: TENANT } });
  });

  it('stamps the tenant onto every record in createMany', () => {
    const result = applyTenantScope(
      'Product',
      'createMany',
      { data: [{ sku: 'A' }, { sku: 'B' }] },
      TENANT,
    );
    expect(result).toEqual({
      data: [
        { sku: 'A', tenantId: TENANT },
        { sku: 'B', tenantId: TENANT },
      ],
    });
  });

  it('stamps the tenant onto createManyAndReturn data', () => {
    const result = applyTenantScope('Stock', 'createManyAndReturn', { data: [{ quantity: 1 }] }, TENANT);
    expect(result).toEqual({ data: [{ quantity: 1, tenantId: TENANT }] });
  });
});

describe('applyTenantScope - update/delete operations (Requirement 1.5)', () => {
  it.each(['update', 'updateMany', 'delete', 'deleteMany'])(
    'augments the where clause for %s',
    (operation) => {
      const result = applyTenantScope('Product', operation, { where: { id: 'p1' } }, TENANT) as {
        where: Record<string, unknown>;
      };
      expect(result.where).toEqual({ id: 'p1', tenantId: TENANT });
    },
  );

  it('augments both where and create payload for upsert', () => {
    const result = applyTenantScope(
      'Configuration',
      'upsert',
      { where: { key: 'theme' }, create: { key: 'theme', value: 'dark' }, update: { value: 'dark' } },
      TENANT,
    );
    expect(result).toEqual({
      where: { key: 'theme', tenantId: TENANT },
      create: { key: 'theme', value: 'dark', tenantId: TENANT },
      update: { value: 'dark' },
    });
  });
});

describe('applyTenantScope - non-tenant-scoped models', () => {
  it('leaves Tenant queries untouched', () => {
    const args = { where: { slug: 'acme' } };
    expect(applyTenantScope('Tenant', 'findUnique', args, TENANT)).toBe(args);
  });

  it('leaves RefreshToken queries untouched', () => {
    const args = { where: { token: 'abc' } };
    expect(applyTenantScope('RefreshToken', 'findUnique', args, TENANT)).toBe(args);
  });
});

describe('applyTenantScope - system-level bypass (no tenant in context)', () => {
  it('returns args unchanged for tenant-scoped reads when there is no tenant', () => {
    const args = { where: { email: 'login@example.com' } };
    expect(applyTenantScope('User', 'findFirst', args, undefined)).toBe(args);
  });

  it('returns args unchanged for tenant-scoped creates when there is no tenant', () => {
    const args = { data: { name: 'Provisioned' } };
    expect(applyTenantScope('User', 'create', args, undefined)).toBe(args);
  });
});

describe('applyTenantToOperation', () => {
  it('passes scoped args to the query function when a tenant is present', async () => {
    const query = vi.fn().mockResolvedValue('ok');
    const resolveTenantId = vi.fn().mockReturnValue(TENANT);

    const result = await applyTenantToOperation(
      { model: 'Product', operation: 'findMany', args: { where: { isActive: true } }, query },
      resolveTenantId,
    );

    expect(result).toBe('ok');
    expect(query).toHaveBeenCalledWith({ where: { isActive: true, tenantId: TENANT } });
  });

  it('passes the original args through when there is no tenant (system bypass)', async () => {
    const args = { where: { email: 'login@example.com' } };
    const query = vi.fn().mockResolvedValue(null);
    const resolveTenantId = vi.fn().mockReturnValue(undefined);

    await applyTenantToOperation({ model: 'User', operation: 'findFirst', args, query }, resolveTenantId);

    expect(query).toHaveBeenCalledWith(args);
  });

  it('does not scope non-tenant models even when a tenant is present', async () => {
    const args = { where: { slug: 'acme' } };
    const query = vi.fn().mockResolvedValue(null);
    const resolveTenantId = vi.fn().mockReturnValue(TENANT);

    await applyTenantToOperation({ model: 'Tenant', operation: 'findUnique', args, query }, resolveTenantId);

    expect(query).toHaveBeenCalledWith(args);
  });
});
