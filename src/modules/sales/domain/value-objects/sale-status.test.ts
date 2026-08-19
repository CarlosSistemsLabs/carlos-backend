import { describe, it, expect } from 'vitest';
import {
  SALE_STATUSES,
  DEFAULT_SALE_STATUS,
  isSaleStatus,
  assertSaleStatus,
  canTransition,
  assertTransition,
  type SaleStatus,
} from './sale-status.js';
import { InvalidSaleStatusTransitionError } from '../errors/sale-errors.js';
import { ValidationError } from '@domain/errors/index.js';

describe('SaleStatus', () => {
  it('exposes the three lifecycle statuses and defaults to completed', () => {
    expect(SALE_STATUSES).toEqual(['draft', 'completed', 'cancelled']);
    expect(DEFAULT_SALE_STATUS).toBe('completed');
  });

  describe('isSaleStatus', () => {
    it('recognises valid statuses', () => {
      expect(isSaleStatus('draft')).toBe(true);
      expect(isSaleStatus('completed')).toBe(true);
      expect(isSaleStatus('cancelled')).toBe(true);
    });

    it('rejects unknown values', () => {
      expect(isSaleStatus('refunded')).toBe(false);
      expect(isSaleStatus(42)).toBe(false);
      expect(isSaleStatus(null)).toBe(false);
    });
  });

  describe('assertSaleStatus', () => {
    it('returns the status when valid', () => {
      expect(assertSaleStatus('draft')).toBe('draft');
    });

    it('throws ValidationError for an invalid status', () => {
      expect(() => assertSaleStatus('nope')).toThrow(ValidationError);
    });
  });

  describe('transitions', () => {
    const valid: Array<[SaleStatus, SaleStatus]> = [
      ['draft', 'completed'],
      ['draft', 'cancelled'],
      ['completed', 'cancelled'],
    ];
    const invalid: Array<[SaleStatus, SaleStatus]> = [
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
      expect(() => assertTransition(from, to)).toThrow(InvalidSaleStatusTransitionError);
    });
  });
});
