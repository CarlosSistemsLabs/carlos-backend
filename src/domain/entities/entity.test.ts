import { describe, it, expect } from 'vitest';
import { Entity } from './entity.js';

interface ThingProps {
  name: string;
}

class Thing extends Entity<ThingProps> {
  static create(name: string, id?: string): Thing {
    return new Thing({ name }, id);
  }

  get name(): string {
    return this.props.name;
  }
}

describe('Entity', () => {
  it('generates a UUID when no id is provided', () => {
    const a = Thing.create('a');
    expect(a.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('generates distinct ids for distinct entities', () => {
    const a = Thing.create('a');
    const b = Thing.create('b');
    expect(a.id).not.toBe(b.id);
  });

  it('uses the provided id when supplied', () => {
    const id = '11111111-1111-1111-1111-111111111111';
    const a = Thing.create('a', id);
    expect(a.id).toBe(id);
  });

  it('is equal to itself', () => {
    const a = Thing.create('a');
    expect(a.equals(a)).toBe(true);
  });

  it('treats entities with the same id as equal regardless of attributes', () => {
    const id = '22222222-2222-2222-2222-222222222222';
    const a = Thing.create('a', id);
    const b = Thing.create('different', id);
    expect(a.equals(b)).toBe(true);
  });

  it('treats entities with different ids as not equal', () => {
    const a = Thing.create('same');
    const b = Thing.create('same');
    expect(a.equals(b)).toBe(false);
  });

  it('is not equal to null or undefined', () => {
    const a = Thing.create('a');
    expect(a.equals(null)).toBe(false);
    expect(a.equals(undefined)).toBe(false);
  });
});
