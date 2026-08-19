import { describe, it, expect } from 'vitest';
import { Tenant, TENANT_DEFAULTS } from './tenant.js';
import { BrandColor } from '../value-objects/brand-color.js';
import { ValidationError } from '@domain/errors/index.js';

describe('Tenant', () => {
  describe('create', () => {
    it('applies schema defaults for omitted branding/localization fields', () => {
      const tenant = Tenant.create({ name: 'Acme Inc', slug: 'acme' });

      expect(tenant.name).toBe('Acme Inc');
      expect(tenant.slug).toBe('acme');
      expect(tenant.logo).toBeNull();
      expect(tenant.primaryColor).toBeNull();
      expect(tenant.secondaryColor).toBeNull();
      expect(tenant.theme.value).toBe(TENANT_DEFAULTS.THEME);
      expect(tenant.language).toBe(TENANT_DEFAULTS.LANGUAGE);
      expect(tenant.timezone).toBe(TENANT_DEFAULTS.TIMEZONE);
      expect(tenant.currency).toBe(TENANT_DEFAULTS.CURRENCY);
      expect(tenant.dateFormat).toBe(TENANT_DEFAULTS.DATE_FORMAT);
      expect(tenant.taxId).toBeNull();
    });

    it('normalises the slug to lower-case and parses colours/theme', () => {
      const tenant = Tenant.create({
        name: '  Acme  ',
        slug: 'ACME-Corp',
        primaryColor: '#FFF',
        secondaryColor: '#123456',
        theme: 'dark',
        taxId: '  20-1234-9  ',
      });

      expect(tenant.name).toBe('Acme');
      expect(tenant.slug).toBe('acme-corp');
      expect(tenant.primaryColor?.value).toBe('#ffffff');
      expect(tenant.secondaryColor?.value).toBe('#123456');
      expect(tenant.theme.value).toBe('dark');
      expect(tenant.taxId).toBe('20-1234-9');
    });

    it.each(['', '   '])('rejects an empty name %j', (name) => {
      expect(() => Tenant.create({ name, slug: 'acme' })).toThrow(ValidationError);
    });

    it.each(['', 'a', 'Has Space', 'UPPER_ok?', '-lead', 'trail-', 'inv@lid'])(
      'rejects the malformed slug %j',
      (slug) => {
        expect(() => Tenant.create({ name: 'Acme', slug })).toThrow(ValidationError);
      },
    );

    it('rejects an invalid colour', () => {
      expect(() => Tenant.create({ name: 'Acme', slug: 'acme', primaryColor: 'nope' })).toThrow(
        ValidationError,
      );
    });

    it('rejects an invalid theme', () => {
      expect(() => Tenant.create({ name: 'Acme', slug: 'acme', theme: 'purple' })).toThrow(
        ValidationError,
      );
    });

    it('rejects an empty localization override', () => {
      expect(() => Tenant.create({ name: 'Acme', slug: 'acme', currency: '  ' })).toThrow(
        ValidationError,
      );
    });
  });

  describe('updateBranding', () => {
    it('changes only the provided fields and leaves the slug immutable', () => {
      const tenant = Tenant.create({ name: 'Acme', slug: 'acme', theme: 'light' });

      tenant.updateBranding({ name: 'Acme LLC', theme: 'dark', currency: 'USD' });

      expect(tenant.name).toBe('Acme LLC');
      expect(tenant.theme.value).toBe('dark');
      expect(tenant.currency).toBe('USD');
      expect(tenant.slug).toBe('acme');
      // Untouched field retains its default.
      expect(tenant.language).toBe(TENANT_DEFAULTS.LANGUAGE);
    });

    it('clears optional fields when passed null', () => {
      const tenant = Tenant.create({
        name: 'Acme',
        slug: 'acme',
        logo: 'https://cdn/logo.png',
        primaryColor: '#123456',
        taxId: '20-1',
      });

      tenant.updateBranding({ logo: null, primaryColor: null, taxId: null });

      expect(tenant.logo).toBeNull();
      expect(tenant.primaryColor).toBeNull();
      expect(tenant.taxId).toBeNull();
    });

    it('accepts a BrandColor instance as well as a string', () => {
      const tenant = Tenant.create({ name: 'Acme', slug: 'acme' });
      tenant.updateBranding({ primaryColor: BrandColor.create('#abc') });
      expect(tenant.primaryColor?.value).toBe('#aabbcc');
    });

    it('re-validates a provided branding field', () => {
      const tenant = Tenant.create({ name: 'Acme', slug: 'acme' });
      expect(() => tenant.updateBranding({ primaryColor: 'bad' })).toThrow(ValidationError);
      expect(() => tenant.updateBranding({ theme: 'neon' })).toThrow(ValidationError);
      expect(() => tenant.updateBranding({ name: '  ' })).toThrow(ValidationError);
    });
  });
});
