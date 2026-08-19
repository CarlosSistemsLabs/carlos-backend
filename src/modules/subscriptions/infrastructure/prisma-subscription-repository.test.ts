import { describe, it, expect, vi } from 'vitest';
import {
  PrismaSubscriptionRepository,
  type SubscriptionPrismaClient,
  type SubscriptionRow,
} from './prisma-subscription-repository.js';
import { Subscription } from '../domain/entities/subscription.js';

const TENANT = 'tenant-1';

function makeRow(overrides: Partial<SubscriptionRow> = {}): SubscriptionRow {
  return {
    id: 'sub-1',
    tenantId: TENANT,
    planId: 'plan-1',
    status: 'active',
    startDate: new Date('2025-01-01T00:00:00.000Z'),
    endDate: new Date('2025-02-01T00:00:00.000Z'),
    autoRenew: true,
    ...overrides,
  };
}

function makeClient(): {
  client: SubscriptionPrismaClient;
  findFirst: ReturnType<typeof vi.fn>;
  findMany: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
} {
  const findFirst = vi.fn();
  const findMany = vi.fn();
  const create = vi.fn();
  const update = vi.fn();
  const client: SubscriptionPrismaClient = {
    subscription: { findFirst, findMany, create, update },
  };
  return { client, findFirst, findMany, create, update };
}

describe('PrismaSubscriptionRepository', () => {
  it('maps a row to a domain Subscription', async () => {
    const { client, findFirst } = makeClient();
    findFirst.mockResolvedValue(makeRow());
    const repo = new PrismaSubscriptionRepository(client);

    const sub = await repo.findById(TENANT, 'sub-1');

    expect(findFirst).toHaveBeenCalledWith({ where: { id: 'sub-1', tenantId: TENANT } });
    expect(sub).not.toBeNull();
    expect(sub!.tenantId).toBe(TENANT);
    expect(sub!.status).toBe('active');
    expect(sub!.endDate).toEqual(new Date('2025-02-01T00:00:00.000Z'));
  });

  it('maps a null endDate (open-ended subscription)', async () => {
    const { client, findFirst } = makeClient();
    findFirst.mockResolvedValue(makeRow({ endDate: null }));
    const repo = new PrismaSubscriptionRepository(client);

    const sub = await repo.findById(TENANT, 'sub-1');

    expect(sub!.endDate).toBeNull();
  });

  it('findActiveByTenant scopes by tenant + active status, newest first', async () => {
    const { client, findFirst } = makeClient();
    findFirst.mockResolvedValue(makeRow());
    const repo = new PrismaSubscriptionRepository(client);

    await repo.findActiveByTenant(TENANT);

    expect(findFirst).toHaveBeenCalledWith({
      where: { tenantId: TENANT, status: 'active' },
      orderBy: { startDate: 'desc' },
    });
  });

  it('findActiveByTenant returns null when the tenant has no active subscription', async () => {
    const { client, findFirst } = makeClient();
    findFirst.mockResolvedValue(null);
    const repo = new PrismaSubscriptionRepository(client);

    expect(await repo.findActiveByTenant(TENANT)).toBeNull();
  });

  it('findByTenant lists subscriptions newest first', async () => {
    const { client, findMany } = makeClient();
    findMany.mockResolvedValue([makeRow(), makeRow({ id: 'sub-2' })]);
    const repo = new PrismaSubscriptionRepository(client);

    const subs = await repo.findByTenant(TENANT);

    expect(findMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT },
      orderBy: { startDate: 'desc' },
    });
    expect(subs).toHaveLength(2);
  });

  it('create persists all columns and maps the returned row', async () => {
    const { client, create } = makeClient();
    create.mockImplementation((args: { data: SubscriptionRow }) => Promise.resolve(args.data));
    const repo = new PrismaSubscriptionRepository(client);
    const sub = Subscription.create(
      {
        tenantId: TENANT,
        planId: 'plan-1',
        startDate: new Date('2025-01-01T00:00:00.000Z'),
        endDate: new Date('2025-02-01T00:00:00.000Z'),
      },
      'sub-new',
    );

    const saved = await repo.create(sub);

    const data = create.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data.id).toBe('sub-new');
    expect(data.tenantId).toBe(TENANT);
    expect(data.planId).toBe('plan-1');
    expect(data.status).toBe('active');
    expect(data.autoRenew).toBe(true);
    expect(saved.id).toBe('sub-new');
  });

  it('update writes mutable columns by id (planId, status, term, autoRenew)', async () => {
    const { client, update } = makeClient();
    update.mockResolvedValue(makeRow({ status: 'cancelled', autoRenew: false }));
    const repo = new PrismaSubscriptionRepository(client);
    const sub = Subscription.reconstitute('sub-1', {
      tenantId: TENANT,
      planId: 'plan-1',
      status: 'active',
      startDate: new Date('2025-01-01T00:00:00.000Z'),
      endDate: new Date('2025-02-01T00:00:00.000Z'),
      autoRenew: true,
    });
    sub.cancel();

    const result = await repo.update(sub);

    const call = update.mock.calls[0]![0] as { where: unknown; data: Record<string, unknown> };
    expect(call.where).toEqual({ id: 'sub-1' });
    expect(call.data.status).toBe('cancelled');
    expect(call.data.autoRenew).toBe(false);
    expect(result.status).toBe('cancelled');
  });
});
