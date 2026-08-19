import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Category } from './category.js';
import { SelfParentCategoryError } from '../errors/product-errors.js';
import { ValidationError } from '@domain/errors/index.js';

describe('Category', () => {
  describe('create', () => {
    it('creates a root category by default', () => {
      const category = Category.create({ tenantId: randomUUID(), name: 'Electronics' });
      expect(category.name).toBe('Electronics');
      expect(category.parentId).toBeNull();
      expect(category.isRoot()).toBe(true);
      expect(category.description).toBeNull();
    });

    it('creates a nested category with a parent', () => {
      const parentId = randomUUID();
      const category = Category.create({
        tenantId: randomUUID(),
        name: 'Phones',
        parentId,
        description: 'Mobile phones',
      });
      expect(category.parentId).toBe(parentId);
      expect(category.isRoot()).toBe(false);
      expect(category.description).toBe('Mobile phones');
    });

    it('trims the name', () => {
      const category = Category.create({ tenantId: randomUUID(), name: '  Books  ' });
      expect(category.name).toBe('Books');
    });

    it.each(['', '   '])('rejects an empty name "%s"', (name) => {
      expect(() => Category.create({ tenantId: randomUUID(), name })).toThrow(ValidationError);
    });

    it('rejects a category that is created as its own parent', () => {
      const id = randomUUID();
      expect(() =>
        Category.create({ tenantId: randomUUID(), name: 'Loop', parentId: id }, id),
      ).toThrow(SelfParentCategoryError);
    });
  });

  describe('rename', () => {
    it('renames and updates the description', () => {
      const category = Category.create({ tenantId: randomUUID(), name: 'Old' });
      category.rename('New', 'A description');
      expect(category.name).toBe('New');
      expect(category.description).toBe('A description');
    });

    it('keeps the description when not provided', () => {
      const category = Category.create({
        tenantId: randomUUID(),
        name: 'Old',
        description: 'keep',
      });
      category.rename('New');
      expect(category.description).toBe('keep');
    });

    it('rejects an empty new name', () => {
      const category = Category.create({ tenantId: randomUUID(), name: 'Old' });
      expect(() => category.rename('  ')).toThrow(ValidationError);
    });
  });

  describe('setParent', () => {
    it('sets and clears the parent', () => {
      const category = Category.create({ tenantId: randomUUID(), name: 'Cat' });
      const parentId = randomUUID();
      category.setParent(parentId);
      expect(category.parentId).toBe(parentId);
      category.setParent(null);
      expect(category.parentId).toBeNull();
      expect(category.isRoot()).toBe(true);
    });

    it('guards against self-parenting', () => {
      const category = Category.create({ tenantId: randomUUID(), name: 'Cat' });
      expect(() => category.setParent(category.id)).toThrow(SelfParentCategoryError);
    });
  });

  describe('reconstitute', () => {
    it('rehydrates from persisted state preserving id', () => {
      const id = randomUUID();
      const category = Category.reconstitute(id, {
        tenantId: randomUUID(),
        name: 'Persisted',
        description: null,
        parentId: null,
      });
      expect(category.id).toBe(id);
      expect(category.name).toBe('Persisted');
    });
  });
});
