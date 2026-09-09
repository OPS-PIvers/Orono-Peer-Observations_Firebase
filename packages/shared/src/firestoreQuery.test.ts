import { describe, expect, it } from 'vitest';
import { FIRESTORE_IN_LIMIT, chunkForInQuery } from './firestoreQuery.js';

describe('chunkForInQuery', () => {
  it('returns no batches for an empty list', () => {
    expect(chunkForInQuery([])).toEqual([]);
  });

  it('keeps a list at the limit in a single batch', () => {
    const ids = Array.from({ length: FIRESTORE_IN_LIMIT }, (_, i) => `m${String(i)}`);
    expect(chunkForInQuery(ids)).toEqual([ids]);
  });

  it('splits one past the limit into two batches without dropping a value', () => {
    const ids = Array.from({ length: FIRESTORE_IN_LIMIT + 1 }, (_, i) => `m${String(i)}`);
    const batches = chunkForInQuery(ids);
    expect(batches).toHaveLength(2);
    expect(batches[0]).toHaveLength(FIRESTORE_IN_LIMIT);
    expect(batches[1]).toEqual([`m${String(FIRESTORE_IN_LIMIT)}`]);
    expect(batches.flat()).toEqual(ids);
  });

  it('splits a long list into ceil(n / limit) batches', () => {
    const ids = Array.from({ length: 95 }, (_, i) => `m${String(i)}`);
    const batches = chunkForInQuery(ids);
    expect(batches.map((b) => b.length)).toEqual([30, 30, 30, 5]);
    expect(batches.flat()).toEqual(ids);
  });

  it('honors an explicit batch size', () => {
    expect(chunkForInQuery([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('rejects a batch size below 1 rather than looping forever', () => {
    expect(() => chunkForInQuery([1, 2], 0)).toThrow(RangeError);
  });
});
