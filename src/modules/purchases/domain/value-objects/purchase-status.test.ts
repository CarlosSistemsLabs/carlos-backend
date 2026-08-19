import { describe, it, expect } from 'vitest';
import {
  PURCHASE_STATUSES,
  DEFAULT_PURCHASE_STATUS,
  isPurchaseStatus,
  assertPurchaseStatus,
  canTransition,
  assertTransition,
  type PurchaseStatus,
} from './purchase-status.js';
import { InvalidPurchaseStatusTransitionError } from '../errors/purchase-errors.js';
import { ValidationError } from '@domain/errors/index.js';

describe('PurchaseStatus', () => {
  it('exposes the three lifecycle statuses and defaults to completed', () => {
    expect(PURCHASE_STATUSES).toEqual(['draft', 'completed', 'cancelled']);
    expect(DEFAULT_PURCHASE_STATUS).toBe('completed');
  });

  describe('isPurchaseStatus', () => {
    it('recognises valid statuses', () => {
      expect(isPurchaseStatus('draft')).toBe(true);
      expect(isPurchaseStatus('completed')).toBe(true);
      expect(isPurchaseStatus('cancelled')).toBe(true);
    });

    it('rejects unknown values', () => {
      expect(isPurchaseStatus('received')).toBe(false);
      expect(isPurchaseStatus(42)).toBe(false);
      expect(isPurchaseStatus(null)).toBe(false);
    });
  });

  describe('assertPurchaseStatus', () => {
    it('returns the status when valid', () => {
      expect(assertPurchaseStatus('draft')).toBe('draft');
    });

    it('throws ValidationError for an invalid status', () => {
      expect(() => assertPurchaseStatus('nope')).toThrow(ValidationError);
    });
  });

  describe('transitions', () => {
    const valid: Array<[PurchaseStatus, PurchaseStatus]> = [
      ['draft', 'completed'],
      ['draft', 'cancelled'],
      ['completed', 'cancelled'],
    ];
    const invalid: Array<[PurchaseStatus, PurchaseStatus]> = [
      ['completed', 'draft'],
      ['cancelled', 'completed'],
      ['cancelled', 'draft'],
      ['cancelled', 'cancelled'],
      ['draft', 'draft'],
      ['completed', 'completed'],
    ];

    it.each(valid)('allows %s -> %s', (from, to) => {
      expect(canTransition(from, to)).toBe(true);
      expect(() => assertTransition(from, to)).not.toThrow();
    });

    it.each(invalid)('forbids %s -> %s', (from, to) => {
      expect(canTransition(from, to)).toBe(false);
      expect(() => assertTransition(from, to)).toThrow(InvalidPurchaseStatusTransitionError);
    });
  });
});
