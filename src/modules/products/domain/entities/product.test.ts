import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Product, type CreateProductInput } from './product.js';
import { Money } from '../value-objects/money.js';
import { Sku } from '../value-objects/sku.js';
import { InvalidCostError, InvalidPriceError } from '../errors/product-errors.js';
import { ValidationError } from '@domain/errors/index.js';

function baseInput(overrides: Partial<CreateProductInput> = {}): CreateProductInput {
  return {
    tenantId: randomUUID(),
    categoryId: randomUUID(),
    sku: 'SKU-1',
    name: 'Widget',
    price: Money.fromDecimal('10.00', 'USD'),
    ...overrides,
  };
}

describe('Product', () => {
  describe('create', () => {
    it('creates an active product with defaults and normalised SKU', () => {
      const product = Product.create(baseInput({ sku: ' sku-1 ' }));
      expect(product.sku).toBeInstanceOf(Sku);
      expect(product.sku.value).toBe('SKU-1');
      expect(product.isActive).toBe(true);
      expect(product.unit).toBe('unit');
      expect(product.taxRate).toBe(0);
      expect(product.minStock).toBe(0);
      expect(product.cost).toBeNull();
      expect(product.description).toBeNull();
    });

    it('accepts a pre-built Sku value object', () => {
      const product = Product.create(baseInput({ sku: Sku.create('XYZ-9') }));
      expect(product.sku.value).toBe('XYZ-9');
    });

    it('trims the product name', () => {
      const product = Product.create(baseInput({ name: '  Widget  ' }));
      expect(product.name).toBe('Widget');
    });

    it.each([
      ['0.00', 'zero'],
      ['-1.00', 'negative'],
    ])('rejects a non-positive price (%s, %s)', (amount) => {
      expect(() => Product.create(baseInput({ price: Money.fromDecimal(amount, 'USD') }))).toThrow(
        InvalidPriceError,
      );
    });

    it('rejects a negative cost but allows zero cost', () => {
      expect(() =>
        Product.create(baseInput({ cost: Money.fromDecimal('-0.01', 'USD') })),
      ).toThrow(InvalidCostError);
      expect(Product.create(baseInput({ cost: Money.zero('USD') })).cost?.isZero()).toBe(true);
    });

    it.each(['', '   '])('rejects an empty name "%s"', (name) => {
      expect(() => Product.create(baseInput({ name }))).toThrow(ValidationError);
    });

    it.each([-1, 101, Number.NaN])('rejects an out-of-range tax rate %s', (taxRate) => {
      expect(() => Product.create(baseInput({ taxRate }))).toThrow(ValidationError);
    });

    it.each([0, 50, 100])('accepts an in-range tax rate %s', (taxRate) => {
      expect(Product.create(baseInput({ taxRate })).taxRate).toBe(taxRate);
    });

    it.each([-1, 1.5])('rejects an invalid minimum stock %s', (minStock) => {
      expect(() => Product.create(baseInput({ minStock }))).toThrow(ValidationError);
    });

    it('rejects an empty unit', () => {
      expect(() => Product.create(baseInput({ unit: '  ' }))).toThrow(ValidationError);
    });
  });

  describe('low-stock alerts', () => {
    const product = Product.create(baseInput({ minStock: 5 }));

    it('is low stock at or below the threshold (boundary inclusive)', () => {
      expect(product.isLowStock(4)).toBe(true);
      expect(product.isLowStock(5)).toBe(true);
    });

    it('is not low stock above the threshold', () => {
      expect(product.isLowStock(6)).toBe(false);
    });

    it('flags a zero-stock product when minStock is zero', () => {
      const zeroMin = Product.create(baseInput({ minStock: 0 }));
      expect(zeroMin.isLowStock(0)).toBe(true);
      expect(zeroMin.isLowStock(1)).toBe(false);
    });
  });

  describe('active status', () => {
    it('activates and deactivates', () => {
      const product = Product.create(baseInput({ isActive: false }));
      expect(product.isActive).toBe(false);
      product.activate();
      expect(product.isActive).toBe(true);
      product.deactivate();
      expect(product.isActive).toBe(false);
    });
  });

  describe('mutations', () => {
    it('updates the price when positive and rejects non-positive updates', () => {
      const product = Product.create(baseInput());
      product.updatePrice(Money.fromDecimal('20.00', 'USD'));
      expect(product.price.toDecimalString()).toBe('20.00');
      expect(() => product.updatePrice(Money.zero('USD'))).toThrow(InvalidPriceError);
    });

    it('updates and clears the cost', () => {
      const product = Product.create(baseInput());
      product.updateCost(Money.fromDecimal('4.00', 'USD'));
      expect(product.cost?.toDecimalString()).toBe('4.00');
      product.updateCost(null);
      expect(product.cost).toBeNull();
      expect(() => product.updateCost(Money.fromDecimal('-1.00', 'USD'))).toThrow(InvalidCostError);
    });

    it('renames and rejects empty names', () => {
      const product = Product.create(baseInput());
      product.rename('New Name');
      expect(product.name).toBe('New Name');
      expect(() => product.rename('  ')).toThrow(ValidationError);
    });

    it('changes the category', () => {
      const product = Product.create(baseInput());
      const newCategory = randomUUID();
      product.changeCategory(newCategory);
      expect(product.categoryId).toBe(newCategory);
    });
  });

  describe('computePriceWithTax', () => {
    it('returns the price unchanged when tax rate is zero', () => {
      const product = Product.create(baseInput({ price: Money.fromDecimal('10.00', 'USD') }));
      expect(product.computePriceWithTax().toDecimalString()).toBe('10.00');
    });

    it('applies the tax rate as a percentage', () => {
      const product = Product.create(
        baseInput({ price: Money.fromDecimal('100.00', 'USD'), taxRate: 21 }),
      );
      expect(product.computePriceWithTax().toDecimalString()).toBe('121.00');
    });

    it('rounds tax to the nearest minor unit', () => {
      const product = Product.create(
        baseInput({ price: Money.fromDecimal('9.99', 'USD'), taxRate: 21 }),
      );
      // 9.99 * 0.21 = 2.0979 -> 2.10 ; 9.99 + 2.10 = 12.09
      expect(product.computePriceWithTax().toDecimalString()).toBe('12.09');
    });
  });

  describe('reconstitute', () => {
    it('rehydrates from persisted state preserving id', () => {
      const id = randomUUID();
      const product = Product.reconstitute(id, {
        tenantId: randomUUID(),
        categoryId: randomUUID(),
        sku: Sku.create('SKU-7'),
        name: 'Persisted',
        description: null,
        price: Money.fromDecimal('3.00', 'USD'),
        cost: null,
        taxRate: 0,
        unit: 'unit',
        minStock: 0,
        isActive: true,
        imageUrl: null,
      });
      expect(product.id).toBe(id);
      expect(product.name).toBe('Persisted');
    });
  });
});
