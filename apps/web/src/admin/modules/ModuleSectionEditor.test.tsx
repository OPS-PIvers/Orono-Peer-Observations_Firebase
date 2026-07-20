import { describe, it, expect } from 'vitest';
import type { ModuleItem } from '@ops/shared';

/**
 * Unit tests for item reordering and normalization logic in ModuleSectionEditor.
 */

/**
 * Helper function to replicate the sort logic used in ModuleSectionEditor.
 * Items are sorted by order, then createdAt, then itemId for determinism.
 */
function sortSectionItems(items: ModuleItem[]): ModuleItem[] {
  return items
    .slice()
    .sort(
      (a, b) =>
        a.order - b.order ||
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() ||
        a.itemId.localeCompare(b.itemId),
    );
}

/**
 * Helper function to renumber items to ensure dense, sequential order values.
 * This mirrors the normalizeItemOrders logic.
 */
function normalizeItemOrders(items: ModuleItem[], excludeItemId?: string): ModuleItem[] {
  const filtered = items.filter((i) => !excludeItemId || i.itemId !== excludeItemId);
  const sorted = sortSectionItems(filtered);
  return sorted.map((item, idx) => ({ ...item, order: idx }));
}

/**
 * Helper function to swap the order of two items by index.
 * This mirrors the moveItem logic.
 */
function swapItemOrder(items: ModuleItem[], fromIdx: number, toIdx: number): ModuleItem[] {
  if (fromIdx < 0 || toIdx < 0 || fromIdx >= items.length || toIdx >= items.length) {
    return items;
  }

  const sorted = sortSectionItems(items);
  const [fromItem, toItem] = [sorted[fromIdx], sorted[toIdx]];
  if (!fromItem || !toItem) return items;

  return items.map((item) => {
    if (item.itemId === fromItem.itemId) return { ...item, order: toItem.order };
    if (item.itemId === toItem.itemId) return { ...item, order: fromItem.order };
    return item;
  });
}

describe('ModuleSectionEditor — item reordering', () => {
  const createItem = (
    itemId: string,
    order: number,
    createdAt = new Date('2026-01-01'),
  ): ModuleItem => ({
    itemId,
    moduleId: 'test-module',
    kind: 'material',
    sectionId: 'test-section',
    order,
    title: `Item ${itemId}`,
    description: '',
    createdAt,
    updatedAt: createdAt,
  });

  describe('sortSectionItems — deterministic ordering', () => {
    it('sorts items by order first', () => {
      const items = [createItem('a', 2), createItem('b', 0), createItem('c', 1)];

      const sorted = sortSectionItems(items);
      expect(sorted.map((i) => i.itemId)).toEqual(['b', 'c', 'a']);
    });

    it('ties are broken by createdAt', () => {
      const earlier = new Date('2026-01-01');
      const later = new Date('2026-01-02');

      const items = [createItem('b', 0, later), createItem('a', 0, earlier)];

      const sorted = sortSectionItems(items);
      expect(sorted.map((i) => i.itemId)).toEqual(['a', 'b']);
    });

    it('final tie-breaker is itemId lexicographic order', () => {
      const sameTime = new Date('2026-01-01');

      const items = [
        createItem('z', 0, sameTime),
        createItem('a', 0, sameTime),
        createItem('m', 0, sameTime),
      ];

      const sorted = sortSectionItems(items);
      expect(sorted.map((i) => i.itemId)).toEqual(['a', 'm', 'z']);
    });

    it('complex multi-level sort: order > createdAt > itemId', () => {
      const t1 = new Date('2026-01-01');
      const t2 = new Date('2026-01-02');
      const t3 = new Date('2026-01-03');

      const items = [
        createItem('z', 0, t3), // order 0, latest created
        createItem('a', 0, t1), // order 0, earliest created
        createItem('m', 0, t2), // order 0, middle created
        createItem('b', 1, t1), // order 1, earliest created
      ];

      const sorted = sortSectionItems(items);
      expect(sorted.map((i) => i.itemId)).toEqual(['a', 'm', 'z', 'b']);
    });
  });

  describe('normalizeItemOrders — density and uniqueness', () => {
    it('fills gaps in order values', () => {
      const items = [
        createItem('a', 0),
        createItem('b', 2), // gap at 1
        createItem('c', 5), // gap at 3, 4
      ];

      const normalized = normalizeItemOrders(items);
      expect(normalized.map((i) => i.order)).toEqual([0, 1, 2]);
    });

    it('respects original sort order when renumbering', () => {
      const items = [createItem('b', 10), createItem('a', 5), createItem('c', 15)];

      const normalized = normalizeItemOrders(items);
      // Should sort by order first: a(5), b(10), c(15), then renumber to 0,1,2
      expect(normalized.map((i) => i.itemId)).toEqual(['a', 'b', 'c']);
      expect(normalized.map((i) => i.order)).toEqual([0, 1, 2]);
    });

    it('can exclude an item (useful for pre-deletion normalization)', () => {
      const items = [createItem('a', 0), createItem('b', 1), createItem('c', 2)];

      const normalized = normalizeItemOrders(items, 'b');
      expect(normalized.map((i) => i.itemId)).toEqual(['a', 'c']);
      expect(normalized.map((i) => i.order)).toEqual([0, 1]);
    });

    it('idempotent when items already have dense orders', () => {
      const items = [createItem('a', 0), createItem('b', 1), createItem('c', 2)];

      const normalized = normalizeItemOrders(items);
      expect(normalized).toEqual(items);
    });

    it('empty list returns empty', () => {
      const normalized = normalizeItemOrders([]);
      expect(normalized).toHaveLength(0);
    });
  });

  describe('swapItemOrder — moving items up and down', () => {
    it('swaps adjacent items', () => {
      const items = [createItem('a', 0), createItem('b', 1), createItem('c', 2)];

      const swapped = swapItemOrder(items, 0, 1);
      const sorted = sortSectionItems(swapped);

      // After swap, 'b' should come before 'a' (b has order 0, a has order 1)
      expect(sorted.map((i) => i.itemId)).toEqual(['b', 'a', 'c']);
    });

    it('swaps non-adjacent items (skipping middle ones)', () => {
      const items = [createItem('a', 0), createItem('b', 1), createItem('c', 2)];

      const swapped = swapItemOrder(items, 0, 2);
      const sorted = sortSectionItems(swapped);

      // After swap, 'c' should come first (c has order 0, a has order 2)
      expect(sorted.map((i) => i.itemId)).toEqual(['c', 'b', 'a']);
    });

    it('guards against out-of-bounds indices', () => {
      const items = [createItem('a', 0), createItem('b', 1)];

      const swappedNegative = swapItemOrder(items, -1, 0);
      expect(swappedNegative).toEqual(items);

      const swappedBeyond = swapItemOrder(items, 0, 10);
      expect(swappedBeyond).toEqual(items);
    });

    it('preserves unaffected items', () => {
      const items = [
        createItem('a', 0),
        createItem('b', 1),
        createItem('c', 2),
        createItem('d', 3),
      ];

      const swapped = swapItemOrder(items, 1, 2); // swap b and c
      const sorted = sortSectionItems(swapped);

      expect(sorted.map((i) => i.itemId)).toEqual(['a', 'c', 'b', 'd']);
    });
  });

  describe('item removal + renormalization', () => {
    it('removing item from middle and renormalizing fills gaps', () => {
      const items = [
        createItem('a', 0),
        createItem('b', 1),
        createItem('c', 2),
        createItem('d', 3),
      ];

      // Simulate: delete item 'b' then renormalize the rest
      const normalized = normalizeItemOrders(items, 'b');

      expect(normalized.map((i) => i.itemId)).toEqual(['a', 'c', 'd']);
      expect(normalized.map((i) => i.order)).toEqual([0, 1, 2]);
    });

    it('removing item from end works correctly', () => {
      const items = [createItem('a', 0), createItem('b', 1), createItem('c', 2)];

      const normalized = normalizeItemOrders(items, 'c');

      expect(normalized.map((i) => i.itemId)).toEqual(['a', 'b']);
      expect(normalized.map((i) => i.order)).toEqual([0, 1]);
    });

    it('removing item from beginning works correctly', () => {
      const items = [createItem('a', 0), createItem('b', 1), createItem('c', 2)];

      const normalized = normalizeItemOrders(items, 'a');

      expect(normalized.map((i) => i.itemId)).toEqual(['b', 'c']);
      expect(normalized.map((i) => i.order)).toEqual([0, 1]);
    });
  });

  describe('collision recovery after deletion', () => {
    it('resolves collisions when items share the same order after deletion', () => {
      // Scenario: admin adds item (gets order 3), then deletes item at order 1
      // If we don't renormalize, we'd have: 0, 2, 3 (gap at 1)
      const items = [
        createItem('a', 0),
        createItem('b', 2), // was at position 1, but order=2
        createItem('c', 3), // was just added
      ];

      const normalized = normalizeItemOrders(items);
      expect(normalized.map((i) => i.order)).toEqual([0, 1, 2]);
    });

    it('handles multiple deletions maintaining determinism', () => {
      const t1 = new Date('2026-01-01');
      const t2 = new Date('2026-01-02');
      const t3 = new Date('2026-01-03');

      const items = [createItem('a', 1, t1), createItem('b', 3, t2), createItem('c', 5, t3)];

      const normalized = normalizeItemOrders(items);
      // Should be renumbered to 0,1,2 in the original sort order
      expect(normalized.map((i) => i.itemId)).toEqual(['a', 'b', 'c']);
      expect(normalized.map((i) => i.order)).toEqual([0, 1, 2]);
    });
  });
});
