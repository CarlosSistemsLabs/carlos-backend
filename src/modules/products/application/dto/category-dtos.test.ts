import { describe, it, expect } from 'vitest';
import { buildCategoryTree, toCategoryOutput } from './category-dtos.js';
import { Category } from '../../domain/entities/category.js';

const TENANT = 'tenant-1';

function category(id: string, parentId: string | null): Category {
  return Category.reconstitute(id, {
    tenantId: TENANT,
    name: id,
    description: null,
    parentId,
  });
}

describe('toCategoryOutput', () => {
  it('projects a category to its flat output shape', () => {
    const output = toCategoryOutput(category('a', null));
    expect(output).toEqual({
      id: 'a',
      tenantId: TENANT,
      name: 'a',
      description: null,
      parentId: null,
    });
  });
});

describe('buildCategoryTree', () => {
  it('returns an empty array for no categories', () => {
    expect(buildCategoryTree([])).toEqual([]);
  });

  it('nests children under their parents (roots → children)', () => {
    // a (root) -> b -> c ;  d (root)
    const tree = buildCategoryTree([
      category('a', null),
      category('b', 'a'),
      category('c', 'b'),
      category('d', null),
    ]);

    expect(tree.map((n) => n.id).sort()).toEqual(['a', 'd']);
    const a = tree.find((n) => n.id === 'a')!;
    expect(a.children.map((n) => n.id)).toEqual(['b']);
    expect(a.children[0]!.children.map((n) => n.id)).toEqual(['c']);
    const d = tree.find((n) => n.id === 'd')!;
    expect(d.children).toEqual([]);
  });

  it('treats categories whose parent is absent (orphans) as roots', () => {
    // b references a parent 'missing' that is not in the set.
    const tree = buildCategoryTree([category('b', 'missing')]);
    expect(tree.map((n) => n.id)).toEqual(['b']);
    expect(tree[0]!.children).toEqual([]);
  });

  it('builds the tree from a single fetch without re-querying (no N+1)', () => {
    // The function only receives a flat array — there is no repository to call,
    // proving the tree is assembled in memory.
    const many = Array.from({ length: 50 }, (_, i) =>
      category(`n${i}`, i === 0 ? null : `n${i - 1}`),
    );
    const tree = buildCategoryTree(many);
    expect(tree).toHaveLength(1);
    expect(tree[0]!.id).toBe('n0');
  });
});
