import { describe, it, expect } from 'vitest';
import { ValidationError } from '@domain/errors/index.js';
import { Money } from '@shared/value-objects/money.js';
import { Plan } from './plan.js';
import { FEATURES } from '../constants/plan-features.js';

const price = (value: string): Money => Money.fromDecimal(value, 'USD');

function makePlan(overrides: Partial<Parameters<typeof Plan.create>[0]> = {}): Plan {
  return Plan.create({
    name: 'business',
    displayName: 'Business',
    price: price('79.00'),
    billingCycle: 'monthly',
    features: [FEATURES.SALES, FEATURES.CUSTOMERS, FEATURES.STOCK],
    ...overrides,
  });
}

describe('Plan', () => {
  describe('create', () => {
    it('creates a valid plan with defaults', () => {
      const plan = makePlan();
      expect(plan.name).toBe('business');
      expect(plan.displayName).toBe('Business');
      expect(plan.description).toBeNull();
      expect(plan.price.toDecimalString()).toBe('79.00');
      expect(plan.billingCycle).toBe('monthly');
      expect(plan.isActive).toBe(true);
      expect(plan.features).toEqual(['sales', 'customers', 'stock']);
    });

    it('trims name and displayName', () => {
      const plan = makePlan({ name: '  starter ', displayName: '  Starter  ' });
      expect(plan.name).toBe('starter');
      expect(plan.displayName).toBe('Starter');
    });

    it('collapses duplicate feature keys preserving order', () => {
      const plan = makePlan({ features: [FEATURES.SALES, FEATURES.SALES, FEATURES.CUSTOMERS] });
      expect(plan.features).toEqual(['sales', 'customers']);
    });

    it('accepts a yearly billing cycle', () => {
      expect(makePlan({ billingCycle: 'yearly' }).billingCycle).toBe('yearly');
    });

    it('rejects a blank name', () => {
      expect(() => makePlan({ name: '   ' })).toThrow(ValidationError);
    });

    it('rejects a blank displayName', () => {
      expect(() => makePlan({ displayName: '' })).toThrow(ValidationError);
    });

    it('rejects an unknown billing cycle', () => {
      expect(() => makePlan({ billingCycle: 'weekly' })).toThrow(ValidationError);
    });

    it('rejects a negative price', () => {
      expect(() => makePlan({ price: price('-1.00') })).toThrow(ValidationError);
    });

    it('accepts a zero price (free tier)', () => {
      expect(makePlan({ price: price('0.00') }).price.isZero()).toBe(true);
    });

    it('rejects unknown feature keys', () => {
      expect(() => makePlan({ features: ['sales', 'teleport'] })).toThrow(ValidationError);
    });
  });

  describe('hasFeature', () => {
    it('returns true for granted features and false otherwise', () => {
      const plan = makePlan();
      expect(plan.hasFeature('stock')).toBe(true);
      expect(plan.hasFeature('reports')).toBe(false);
    });
  });

  describe('activate / deactivate', () => {
    it('toggles the active flag', () => {
      const plan = makePlan();
      plan.deactivate();
      expect(plan.isActive).toBe(false);
      plan.activate();
      expect(plan.isActive).toBe(true);
    });
  });

  describe('reconstitute', () => {
    it('rehydrates without re-validation and defensively copies features', () => {
      const features = ['sales'];
      const plan = Plan.reconstitute('plan-1', {
        name: 'starter',
        displayName: 'Starter',
        description: null,
        price: price('29.00'),
        billingCycle: 'monthly',
        features,
        isActive: true,
      });
      features.push('mutated');
      expect(plan.id).toBe('plan-1');
      expect(plan.features).toEqual(['sales']);
    });
  });

  it('getters return defensive copies of features', () => {
    const plan = makePlan();
    plan.features.push('reports');
    expect(plan.features).toEqual(['sales', 'customers', 'stock']);
  });
});
