import { describe, it, expect } from 'vitest';
import { Customer } from './customer.js';
import { Email } from '../value-objects/email.js';
import { Phone } from '../value-objects/phone.js';
import { ValidationError } from '@domain/errors/index.js';

describe('Customer', () => {
  const base = { tenantId: 'tenant-1', name: 'Acme Corp' };

  it('creates an active customer with all optional fields null by default', () => {
    const customer = Customer.create(base);
    expect(customer.name).toBe('Acme Corp');
    expect(customer.email).toBeNull();
    expect(customer.phone).toBeNull();
    expect(customer.taxId).toBeNull();
    expect(customer.address).toBeNull();
    expect(customer.notes).toBeNull();
    expect(customer.isActive).toBe(true);
  });

  it('parses and normalises contact value objects from raw strings', () => {
    const customer = Customer.create({
      ...base,
      email: 'Contact@Acme.COM',
      phone: '+54 11 1234-5678',
      taxId: '20-12345678-9',
    });
    expect(customer.email?.value).toBe('contact@acme.com');
    expect(customer.phone?.value).toBe('+541112345678');
    expect(customer.taxId?.value).toBe('20-12345678-9');
  });

  it('trims and requires a non-empty name', () => {
    expect(Customer.create({ ...base, name: '  Acme  ' }).name).toBe('Acme');
    expect(() => Customer.create({ ...base, name: '   ' })).toThrow(ValidationError);
  });

  it('activates and deactivates', () => {
    const customer = Customer.create({ ...base, isActive: false });
    expect(customer.isActive).toBe(false);
    customer.activate();
    expect(customer.isActive).toBe(true);
    customer.deactivate();
    expect(customer.isActive).toBe(false);
  });

  it('renames, rejecting an empty name', () => {
    const customer = Customer.create(base);
    customer.rename('New Name');
    expect(customer.name).toBe('New Name');
    expect(() => customer.rename('')).toThrow(ValidationError);
  });

  it('updates only the provided contact fields and clears with null', () => {
    const customer = Customer.create({
      ...base,
      email: 'a@b.com',
      phone: '1234567',
      address: 'Old St 1',
    });

    customer.updateContact({ email: 'c@d.com', address: null });

    expect(customer.email?.value).toBe('c@d.com');
    // phone was not part of the update payload -> unchanged.
    expect(customer.phone?.value).toBe('1234567');
    // address explicitly cleared.
    expect(customer.address).toBeNull();
  });

  it('accepts pre-built value objects on updateContact', () => {
    const customer = Customer.create(base);
    customer.updateContact({ email: Email.create('vo@x.com'), phone: Phone.create('7654321') });
    expect(customer.email?.value).toBe('vo@x.com');
    expect(customer.phone?.value).toBe('7654321');
  });

  it('rejects a malformed contact on updateContact', () => {
    const customer = Customer.create(base);
    expect(() => customer.updateContact({ email: 'not-an-email' })).toThrow(ValidationError);
  });

  it('reconstitutes without re-validation', () => {
    const customer = Customer.reconstitute('cust-1', {
      tenantId: 'tenant-1',
      name: 'Rehydrated',
      email: null,
      phone: null,
      taxId: null,
      address: null,
      notes: null,
      isActive: true,
    });
    expect(customer.id).toBe('cust-1');
    expect(customer.name).toBe('Rehydrated');
  });
});
