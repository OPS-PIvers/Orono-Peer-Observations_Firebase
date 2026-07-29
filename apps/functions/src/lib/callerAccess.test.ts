import { describe, expect, it } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { callerMeetsAccessLevel } from './callerAccess.js';

/**
 * Unit tests for the shared caller-authorization helper that resendStaffInvite.ts,
 * sendManualEmail.ts, and sendBulkManualEmail.ts all delegate to (see INTEG-AUTHZ:
 * these three callables live on the same Staff admin page and must not disagree on
 * what "admin" or "PE-or-admin" access means).
 *
 * A minimal fake Firestore is used instead of a full Admin SDK mock — only
 * `db.doc(path).get()` is exercised.
 */
function fakeDb(docs: Record<string, Record<string, unknown> | undefined>): Firestore {
  return {
    doc: (path: string) => ({
      get: () =>
        Promise.resolve({
          exists: docs[path] !== undefined,
          data: () => docs[path],
        }),
    }),
  } as unknown as Firestore;
}

describe('callerMeetsAccessLevel — admin level', () => {
  it('allows a caller whose token role is an admin role, without reading the staff doc', async () => {
    const db = fakeDb({});
    await expect(
      callerMeetsAccessLevel(db, {
        email: 'admin@orono.k12.mn.us',
        tokenRole: 'administrator',
        level: 'admin',
      }),
    ).resolves.toBe(true);
  });

  it('allows a hasAdminAccess-only caller (non-admin role) via the live staff doc', async () => {
    const db = fakeDb({
      'staff/pe-admin@orono.k12.mn.us': {
        role: 'peer-evaluator',
        hasAdminAccess: true,
      },
    });
    await expect(
      callerMeetsAccessLevel(db, {
        email: 'pe-admin@orono.k12.mn.us',
        tokenRole: 'peer-evaluator',
        level: 'admin',
      }),
    ).resolves.toBe(true);
  });

  it('rejects a hasAdminAccess-only caller whose live staff doc has since been revoked', async () => {
    const db = fakeDb({
      'staff/revoked@orono.k12.mn.us': {
        role: 'peer-evaluator',
        hasAdminAccess: false,
      },
    });
    await expect(
      callerMeetsAccessLevel(db, {
        // Stale token still claims the old role, but not admin — the live
        // doc is what matters, and it now says no.
        email: 'revoked@orono.k12.mn.us',
        tokenRole: 'peer-evaluator',
        level: 'admin',
      }),
    ).resolves.toBe(false);
  });

  it('rejects a plain non-admin, non-PE caller with no admin grant', async () => {
    const db = fakeDb({
      'staff/teacher@orono.k12.mn.us': {
        role: 'teacher',
        hasAdminAccess: false,
      },
    });
    await expect(
      callerMeetsAccessLevel(db, {
        email: 'teacher@orono.k12.mn.us',
        tokenRole: 'teacher',
        level: 'admin',
      }),
    ).resolves.toBe(false);
  });

  it('rejects a caller with no /staff doc at all', async () => {
    const db = fakeDb({});
    await expect(
      callerMeetsAccessLevel(db, {
        email: 'ghost@orono.k12.mn.us',
        tokenRole: undefined,
        level: 'admin',
      }),
    ).resolves.toBe(false);
  });

  it('treats a live staff doc missing the hasAdminAccess field as false (Zod default bypassed by raw reads)', async () => {
    const db = fakeDb({
      'staff/legacy@orono.k12.mn.us': {
        role: 'teacher',
        // hasAdminAccess intentionally omitted, as on a pre-existing doc.
      },
    });
    await expect(
      callerMeetsAccessLevel(db, {
        email: 'legacy@orono.k12.mn.us',
        tokenRole: 'teacher',
        level: 'admin',
      }),
    ).resolves.toBe(false);
  });
});

describe('callerMeetsAccessLevel — special (PE-or-admin) level', () => {
  it('allows a caller whose token role is a special role (e.g. peer-evaluator)', async () => {
    const db = fakeDb({});
    await expect(
      callerMeetsAccessLevel(db, {
        email: 'pe@orono.k12.mn.us',
        tokenRole: 'peer-evaluator',
        level: 'special',
      }),
    ).resolves.toBe(true);
  });

  it('allows a caller whose token role is an admin role', async () => {
    const db = fakeDb({});
    await expect(
      callerMeetsAccessLevel(db, {
        email: 'admin@orono.k12.mn.us',
        tokenRole: 'administrator',
        level: 'special',
      }),
    ).resolves.toBe(true);
  });

  // Regression test for INTEG-AUTHZ: a Teacher-role staff member granted
  // hasAdminAccess: true can reach /admin/staff (RequireAuth gates on the
  // isAdmin claim, which syncMyClaims computes as isAdminRole(role) ||
  // hasAdminAccess) and sees the "Message a group" bulk-email action there.
  // Before this fix, sendBulkManualEmail/sendManualEmail computed
  // hasSpecialAccess from the token's role claim only, so this exact user
  // class got a deterministic permission-denied on Send while "Resend
  // invite" (resendStaffInvite, widened by PR #78) succeeded right next to it.
  it('allows a hasAdminAccess-only caller (non-special role) via the live staff doc', async () => {
    const db = fakeDb({
      'staff/teacher-admin@orono.k12.mn.us': {
        role: 'teacher',
        hasAdminAccess: true,
      },
    });
    await expect(
      callerMeetsAccessLevel(db, {
        email: 'teacher-admin@orono.k12.mn.us',
        tokenRole: 'teacher',
        level: 'special',
      }),
    ).resolves.toBe(true);
  });

  it('rejects a hasAdminAccess-only caller whose live staff doc has since been revoked', async () => {
    const db = fakeDb({
      'staff/revoked@orono.k12.mn.us': {
        role: 'teacher',
        hasAdminAccess: false,
      },
    });
    await expect(
      callerMeetsAccessLevel(db, {
        email: 'revoked@orono.k12.mn.us',
        tokenRole: 'teacher',
        level: 'special',
      }),
    ).resolves.toBe(false);
  });

  it('rejects a plain non-admin, non-PE caller', async () => {
    const db = fakeDb({
      'staff/teacher@orono.k12.mn.us': {
        role: 'teacher',
        hasAdminAccess: false,
      },
    });
    await expect(
      callerMeetsAccessLevel(db, {
        email: 'teacher@orono.k12.mn.us',
        tokenRole: 'teacher',
        level: 'special',
      }),
    ).resolves.toBe(false);
  });

  it('rejects a caller with no /staff doc at all', async () => {
    const db = fakeDb({});
    await expect(
      callerMeetsAccessLevel(db, {
        email: 'ghost@orono.k12.mn.us',
        tokenRole: undefined,
        level: 'special',
      }),
    ).resolves.toBe(false);
  });
});
