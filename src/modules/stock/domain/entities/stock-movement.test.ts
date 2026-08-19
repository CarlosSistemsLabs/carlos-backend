import { describe, it, expect } from 'vitest';
import { StockMovement } from './stock-movement.js';
import { ValidationError } from '@domain/errors/index.js';

describe('StockMovement', () => {
  it('records a movement, defaulting nullable fields and createdAt', () => {
    const before = Date.now();
    const movement = StockMovement.create({
      tenantId: 'tenant-1',
      productId: 'prod-1',
      type: 'IN',
      quantity: 10,
    });

    expect(movement.tenantId).toBe('tenant-1');
    expect(movement.productId).toBe('prod-1');
    expect(movement.branchId).toBeNull();
    expect(movement.type).toBe('IN');
    expect(movement.quantity).toBe(10);
    expect(movement.reference).toBeNull();
    expect(movement.notes).toBeNull();
    expect(movement.createdAt.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('preserves supplied optional fields', () => {
    const createdAt = new Date('2024-01-01T00:00:00.000Z');
    const movement = StockMovement.create({
      tenantId: 't',
      productId: 'p',
      branchId: 'b',
      type: 'OUT',
      quantity: 2,
      reference: 'sale-123',
      notes: 'pos sale',
      createdAt,
    });
    expect(movement.branchId).toBe('b');
    expect(movement.reference).toBe('sale-123');
    expect(movement.notes).toBe('pos sale');
    expect(movement.createdAt).toEqual(createdAt);
  });

  it('rejects an invalid movement type', () => {
    expect(() =>
      StockMovement.create({ tenantId: 't', productId: 'p', type: 'SALE', quantity: 1 }),
    ).toThrow(ValidationError);
  });

  it.each([0, -1, 2.5])('rejects a non-positive/non-integer quantity %p', (q) => {
    expect(() =>
      StockMovement.create({ tenantId: 't', productId: 'p', type: 'IN', quantity: q }),
    ).toThrow(ValidationError);
  });

  it('exposes no mutators (immutable audit record)', () => {
    const movement = StockMovement.create({
      tenantId: 't',
      productId: 'p',
      type: 'IN',
      quantity: 1,
    });
    // The public surface is getters only; there is no setter to change state.
    const descriptors = Object.getOwnPropertyNames(Object.getPrototypeOf(movement));
    expect(descriptors).not.toContain('increase');
    expect(descriptors).not.toContain('decrease');
    expect(descriptors).not.toContain('setQuantity');
  });
});
