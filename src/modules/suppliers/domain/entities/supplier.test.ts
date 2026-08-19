import { describe, it, expect } from 'vitest';
import { Supplier } from './supplier.js';
import { Email } from '../value-objects/email.js';
import { Phone } from '../value-objects/phone.js';
import { ValidationError } from '@domain/errors/index.js';

describe('Supplier', () => {
  const base = { tenantId: 'tenant-1', name: 'Acme Supplies' };

  it('creates an active supplier with all optional fields null by default', () => {
    const supplier = Supplier.create(base);
    expect(supplier.name).toBe('Acme Supplies');
    expect(supplier.email).toBeNull();
    expect(supplier.phone).toBeNull();
    expect(supplier.taxId).toBeNull();
    expect(supplier.address).toBeNull();
    expect(supplier.notes).toBeNull();
    expect(supplier.isActive).toBe(true);
  });

  it('parses and normalises contact value objects from raw strings', () => {
    const supplier = Supplier.create({
      ...base,
      email: 'Contact@Acme.COM',
      phone: '+54 11 1234-5678',
      taxId: '20-12345678-9',
    });
    expect(supplier.email?.value).toBe('contact@acme.com');
    expect(supplier.phone?.value).toBe('+541112345678');
    expect(supplier.taxId?.value).toBe('20-12345678-9');
  });

  it('trims and requires a non-empty name', () => {
    expect(Supplier.create({ ...base, name: '  Acme  ' }).name).toBe('Acme');
    expect(() => Supplier.create({ ...base, name: '   ' })).toThrow(ValidationError);
  });

  it('activates and deactivates', () => {
    const supplier = Supplier.create({ ...base, isActive: false });
    expect(supplier.isActive).toBe(false);
    supplier.activate();
    expect(supplier.isActive).toBe(true);
    supplier.deactivate();
    expect(supplier.isActive).toBe(false);
  });

  it('renames, rejecting an empty name', () => {
    const supplier = Supplier.create(base);
    supplier.rename('New Name');
    expect(supplier.name).toBe('New Name');
    expect(() => supplier.rename('')).toThrow(ValidationError);
  });

  it('updates only the provided contact fields and clears with null', () => {
    const supplier = Supplier.create({
      ...base,
      email: 'a@b.com',
      phone: '1234567',
      address: 'Old St 1',
    });

    supplier.updateContact({ email: 'c@d.com', address: null });

    expect(supplier.email?.value).toBe('c@d.com');
    // phone was not part of the update payload -> unchanged.
    expect(supplier.phone?.value).toBe('1234567');
    // address explicitly cleared.
    expect(supplier.address).toBeNull();
  });

  it('accepts pre-built value objects on updateContact', () => {
    const supplier = Supplier.create(base);
    supplier.updateContact({ email: Email.create('vo@x.com'), phone: Phone.create('7654321') });
    expect(supplier.email?.value).toBe('vo@x.com');
    expect(supplier.phone?.value).toBe('7654321');
  });

  it('rejects a malformed contact on updateContact', () => {
    const supplier = Supplier.create(base);
    expect(() => supplier.updateContact({ email: 'not-an-email' })).toThrow(ValidationError);
  });

  it('reconstitutes without re-validation', () => {
    const supplier = Supplier.reconstitute('sup-1', {
      tenantId: 'tenant-1',
      name: 'Rehydrated',
      email: null,
      phone: null,
      taxId: null,
      address: null,
      notes: null,
      isActive: true,
    });
    expect(supplier.id).toBe('sup-1');
    expect(supplier.name).toBe('Rehydrated');
  });
});
