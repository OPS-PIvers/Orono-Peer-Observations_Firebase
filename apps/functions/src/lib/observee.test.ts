import { describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { isStaffBackedEmail } from './observee.js';

function fakeDb(existing: string[]) {
  const get = vi.fn();
  const db = {
    doc: (path: string) => ({
      get: () => {
        get(path);
        return Promise.resolve({ exists: existing.includes(path) });
      },
    }),
  } as unknown as Firestore;
  return { db, get };
}

describe('isStaffBackedEmail', () => {
  it('accepts a canonical address with a staff doc', async () => {
    const { db } = fakeDb(['staff/jane@orono.k12.mn.us']);
    await expect(isStaffBackedEmail(db, 'jane@orono.k12.mn.us')).resolves.toBe(true);
  });

  it('refuses a canonical address with no staff doc', async () => {
    const { db } = fakeDb([]);
    await expect(isStaffBackedEmail(db, 'ghost@orono.k12.mn.us')).resolves.toBe(false);
  });

  it('refuses outside and case-variant addresses without reading Firestore', async () => {
    const { db, get } = fakeDb(['staff/jane@orono.k12.mn.us']);
    await expect(isStaffBackedEmail(db, 'someone@gmail.com')).resolves.toBe(false);
    await expect(isStaffBackedEmail(db, 'Jane@orono.k12.mn.us')).resolves.toBe(false);
    await expect(isStaffBackedEmail(db, undefined)).resolves.toBe(false);
    expect(get).not.toHaveBeenCalled();
  });

  it('reads each address once when given a cache', async () => {
    const { db, get } = fakeDb(['staff/jane@orono.k12.mn.us']);
    const cache = new Map<string, boolean>();
    await isStaffBackedEmail(db, 'jane@orono.k12.mn.us', cache);
    await isStaffBackedEmail(db, 'jane@orono.k12.mn.us', cache);
    expect(get).toHaveBeenCalledTimes(1);
  });
});
