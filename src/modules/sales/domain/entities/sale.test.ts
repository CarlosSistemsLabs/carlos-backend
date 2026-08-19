import { describe, it, expect } from 'vitest';
import { Sale } from './sale.js';
import { SaleDetail } from './sale-detail.js';
import { EmptySaleError, InvalidSaleStatusTransitionError } from '../errors/sale-errors.js';
import { BusinessRuleError, ValidationError } from '@domain/errors/index.js';
import { SaleCompletedEvent } from '@domain/events/index.js';
import { Money } from '@shared/value-objects/money.js';

const price = (v: string): Money => Money.fromDecimal(v, 'ARS');

function line(productId: string, quantity: number, unit: string, taxRate = 0): SaleDetail {
  return SaleDetail.create({ productId, quantity, unitPrice: price(unit), taxRate });
}

function draftSale(items: SaleDetail[] = []): Sale {
  return Sale.create({
    tenantId: 't1',
    customerId: 'c1',
    userId: 'u1',
    saleNumber: 'SALE-000001',
    currency: 'ARS',
    items,
  });
}

describe('Sale', () => {
  describe('create', () => {
    it('opens a draft sale with defaults', () => {
      const sale = draftSale();
      expect(sale.status).toBe('draft');
      expect(sale.branchId).toBeNull();
      expect(sale.notes).toBeNull();
      expect(sale.items).toHaveLength(0);
      expect(sale.saleDate).toBeInstanceOf(Date);
    });

    it('requires a non-empty sale number', () => {
      expect(() =>
        Sale.create({ tenantId: 't1', customerId: 'c1', userId: 'u1', saleNumber: '  ', currency: 'ARS' }),
      ).toThrow(ValidationError);
    });
  });

  describe('recalculateTotals', () => {
    it('sums line subtotals and taxes across multiple lines', () => {
      const sale = draftSale([
        line('p1', 2, '100.00', 21), // sub 200, tax 42
        line('p2', 3, '10.00', 10), // sub 30, tax 3
        line('p3', 1, '5.55', 0), // sub 5.55, tax 0
      ]);
      const totals = sale.recalculateTotals();
      expect(totals.subtotal.toDecimalString()).toBe('235.55');
      expect(totals.taxAmount.toDecimalString()).toBe('45.00');
      expect(totals.total.toDecimalString()).toBe('280.55');
      // Getters agree with recalculateTotals.
      expect(sale.subtotal.toDecimalString()).toBe('235.55');
      expect(sale.taxAmount.toDecimalString()).toBe('45.00');
      expect(sale.total.toDecimalString()).toBe('280.55');
    });

    it('returns zero totals for an empty sale', () => {
      const totals = draftSale().recalculateTotals();
      expect(totals.subtotal.toDecimalString()).toBe('0.00');
      expect(totals.total.toDecimalString()).toBe('0.00');
    });
  });

  describe('addLineItem', () => {
    it('rejects a line whose currency differs from the sale', () => {
      const sale = draftSale();
      const usdLine = SaleDetail.create({
        productId: 'p1',
        quantity: 1,
        unitPrice: Money.fromDecimal('1.00', 'USD'),
      });
      expect(() => sale.addLineItem(usdLine)).toThrow(ValidationError);
    });

    it('rejects modifying a non-draft sale', () => {
      const sale = draftSale([line('p1', 1, '10.00')]);
      sale.complete();
      expect(() => sale.addLineItem(line('p2', 1, '5.00'))).toThrow(BusinessRuleError);
    });
  });

  describe('complete', () => {
    it('transitions draft -> completed and buffers a SaleCompleted event', () => {
      const sale = draftSale([line('p1', 2, '10.00'), line('p2', 3, '4.00')]);
      sale.complete();

      expect(sale.status).toBe('completed');
      const events = sale.pullDomainEvents();
      expect(events).toHaveLength(1);
      const [event] = events;
      expect(event).toBeInstanceOf(SaleCompletedEvent);
      const completed = event as SaleCompletedEvent;
      expect(completed.saleId).toBe(sale.id);
      expect(completed.tenantId).toBe('t1');
      expect(completed.items).toEqual([
        { productId: 'p1', quantity: 2, branchId: null },
        { productId: 'p2', quantity: 3, branchId: null },
      ]);
    });

    it('refuses to complete an empty sale', () => {
      const sale = draftSale();
      expect(() => sale.complete()).toThrow(EmptySaleError);
    });

    it('refuses to complete a sale that is not a draft', () => {
      const sale = draftSale([line('p1', 1, '10.00')]);
      sale.complete();
      sale.clearDomainEvents();
      expect(() => sale.complete()).toThrow(InvalidSaleStatusTransitionError);
    });
  });

  describe('cancel', () => {
    it('cancels a draft sale', () => {
      const sale = draftSale([line('p1', 1, '10.00')]);
      sale.cancel();
      expect(sale.status).toBe('cancelled');
    });

    it('cancels a completed sale', () => {
      const sale = draftSale([line('p1', 1, '10.00')]);
      sale.complete();
      sale.cancel();
      expect(sale.status).toBe('cancelled');
    });

    it('refuses to cancel an already cancelled sale', () => {
      const sale = draftSale([line('p1', 1, '10.00')]);
      sale.cancel();
      expect(() => sale.cancel()).toThrow(InvalidSaleStatusTransitionError);
    });
  });
});
