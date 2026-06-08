import { describe, expect, it } from 'vitest';
import { buildMyWindowsConstraints } from './observationWindowQuery';
import { buildStaffDirectoryConstraints } from '@/routes/staffDirectoryQuery';

// `where`/`orderBy` are pure descriptor factories — their `.type` is stable
// and inspectable without a live Firestore, which is all we need to confirm
// that the server-side filter is (or isn't) applied.

describe('buildMyWindowsConstraints', () => {
  it('filters by observerEmail server-side for non-admins', () => {
    const cs = buildMyWindowsConstraints({ isAdmin: false, email: 'pe@orono.k12.mn.us' });
    expect(cs.map((c) => c.type)).toEqual(['where', 'orderBy']);
  });

  it('does not add the observerEmail filter for admins (they see all)', () => {
    const cs = buildMyWindowsConstraints({ isAdmin: true, email: 'admin@orono.k12.mn.us' });
    expect(cs.map((c) => c.type)).toEqual(['orderBy']);
  });

  it('still filters (to nothing) when a non-admin email is not yet resolved', () => {
    const cs = buildMyWindowsConstraints({ isAdmin: false, email: '' });
    expect(cs.map((c) => c.type)).toEqual(['where', 'orderBy']);
  });
});

describe('buildStaffDirectoryConstraints', () => {
  it('filters to active staff server-side by default (no orderBy → no composite index)', () => {
    const cs = buildStaffDirectoryConstraints(false);
    expect(cs.map((c) => c.type)).toEqual(['where']);
  });

  it('fetches everyone when showing inactive', () => {
    expect(buildStaffDirectoryConstraints(true)).toEqual([]);
  });
});
