import { describe, it, expect } from 'vitest';
import { Purchase } from './purchase.js';
import { PurchaseDetail } from './purchase-detail.js';
import { EmptyPurchaseError, InvalidPurchaseStatusTransitionError } from '../errors/purchase-errors.js';
import { BusinessRuleError, ValidationError } from '@domain/errors/index.js';
import { PurchaseCompletedEvent } from '@domain/events/index.js';
import { Money } from '@shared/value-objects/money.js';

const cost = (v: string): Money => Money.fromDecimal(v, 'ARS');

function line(productId: string, quantity: number, unit: string, taxRate = 0): PurchaseDetail {
  return PurchaseDetail.create({ productId, quantity, unitCost: cost(unit), taxRate });
}

function draftPurchase(items: PurchaseDetail[] = []): Purchase {
  return Purchase.create({
    tenantId: 't1',
    supplierId: 's1',
    userId: 'u1',
    purchaseNumber: 'PUR-000001',
    currency: 'ARS',
    items,
  });
}

describe('Purchase', () => {
  describe('create', () => {
    it('opens a draft purchase with defaults', () => {
      const purchase = draftPurchase();
      expect(purchase.status).toBe('draft');
      expect(purchase.supplierId).toBe('s1');
      expect(purchase.notes).toBeNull();
      expect(purchase.items).toHaveLength(0);
      expect(purchase.purchaseDate).toBeInstanceOf(Date);
    });

    it('requires a non-empty purchase number', () => {
      expect(() =>
        Purchase.create({
          tenantId: 't1',
          supplierId: 's1',
          userId: 'u1',
          purchaseNumber: '  ',
          currency: 'ARS',
        }),
      ).toThrow(ValidationError);
    });
  });

  describe('recalculateTotals', () => {
    it('sums line subtotals and taxes across multiple lines', () => {
      const purchase = draftPurchase([
        line('p1', 2, '100.00', 21), // sub 200, tax 42
        line('p2', 3, '10.00', 10), // sub 30, tax 3
        line('p3', 1, '5.55', 0), // sub 5.55, tax 0
      ]);
      const totals = purchase.recalculateTotals();
      expect(totals.subtotal.toDecimalString()).toBe('235.55');
      expect(totals.taxAmount.toDecimalString()).toBe('45.00');
      expect(totals.total.toDecimalString()).toBe('280.55');
      // Getters agree with recalculateTotals.
      expect(purchase.subtotal.toDecimalString()).toBe('235.55');
      expect(purchase.taxAmount.toDecimalString()).toBe('45.00');
      expect(purchase.total.toDecimalString()).toBe('280.55');
    });

    it('returns zero totals for an empty purchase', () => {
      const totals = draftPurchase().recalculateTotals();
      expect(totals.subtotal.toDecimalString()).toBe('0.00');
      expect(totals.total.toDecimalString()).toBe('0.00');
    });
  });

  describe('addLineItem', () => {
    it('rejects a line whose currency differs from the purchase', () => {
      const purchase = draftPurchase();
      const usdLine = PurchaseDetail.create({
        productId: 'p1',
        quantity: 1,
        unitCost: Money.fromDecimal('1.00', 'USD'),
      });
      expect(() => purchase.addLineItem(usdLine)).toThrow(ValidationError);
    });

    it('rejects modifying a non-draft purchase', () => {
      const purchase = draftPurchase([line('p1', 1, '10.00')]);
      purchase.complete();
      expect(() => purchase.addLineItem(line('p2', 1, '5.00'))).toThrow(BusinessRuleError);
    });
  });

  describe('complete', () => {
    it('transitions draft -> completed and buffers a PurchaseCompleted event with branchId null', () => {
      const purchase = draftPurchase([line('p1', 2, '10.00'), line('p2', 3, '4.00')]);
      purchase.complete();

      expect(purchase.status).toBe('completed');
      const events = purchase.pullDomainEvents();
      expect(events).toHaveLength(1);
      const [event] = events;
      expect(event).toBeInstanceOf(PurchaseCompletedEvent);
      const completed = event as PurchaseCompletedEvent;
      expect(completed.purchaseId).toBe(purchase.id);
      expect(completed.tenantId).toBe('t1');
      // A purchase has no branch dimension: every stock item targets the
      // tenant-wide balance (branchId null). Stock will INCREMENT on these.
      expect(completed.items).toEqual([
        { productId: 'p1', quantity: 2, branchId: null },
        { productId: 'p2', quantity: 3, branchId: null },
      ]);
    });

    it('refuses to complete an empty purchase', () => {
      const purchase = draftPurchase();
      expect(() => purchase.complete()).toThrow(EmptyPurchaseError);
    });

    it('refuses to complete a purchase that is not a draft', () => {
      const purchase = draftPurchase([line('p1', 1, '10.00')]);
      purchase.complete();
      purchase.clearDomainEvents();
      expect(() => purchase.complete()).toThrow(InvalidPurchaseStatusTransitionError);
    });
  });

  describe('cancel', () => {
    it('cancels a draft purchase', () => {
      const purchase = draftPurchase([line('p1', 1, '10.00')]);
      purchase.cancel();
      expect(purchase.status).toBe('cancelled');
    });

    it('cancels a completed purchase', () => {
      const purchase = draftPurchase([line('p1', 1, '10.00')]);
      purchase.complete();
      purchase.cancel();
      expect(purchase.status).toBe('cancelled');
    });

    it('refuses to cancel an already cancelled purchase', () => {
      const purchase = draftPurchase([line('p1', 1, '10.00')]);
      purchase.cancel();
      expect(() => purchase.cancel()).toThrow(InvalidPurchaseStatusTransitionError);
    });
  });
});
