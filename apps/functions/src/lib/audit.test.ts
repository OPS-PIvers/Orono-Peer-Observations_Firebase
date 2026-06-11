import { describe, expect, it } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { AUDIT_ACTIONS } from '@ops/shared';
import { diffField, writeAuditLog } from './audit.js';

// ---------------------------------------------------------------------------
// diffField
// ---------------------------------------------------------------------------

describe('diffField', () => {
  it('returns null when both sides are undefined (defaults equal)', () => {
    expect(diffField<boolean>(undefined, undefined, false)).toBeNull();
  });

  it('returns null when values are equal', () => {
    expect(diffField<string>('teacher', 'teacher', '')).toBeNull();
  });

  it('returns null when both are absent and default is the same', () => {
    // before=undefined → defaultValue=true, after=undefined → defaultValue=true → no change
    expect(diffField<boolean>(undefined, undefined, true)).toBeNull();
  });

  it('detects a field change from one value to another', () => {
    expect(diffField<string>('teacher', 'peer-evaluator', '')).toEqual({
      from: 'teacher',
      to: 'peer-evaluator',
    });
  });

  it('detects a change from the default when only "after" is provided', () => {
    // before=undefined → default false; after=true → change
    expect(diffField<boolean>(undefined, true, false)).toEqual({ from: false, to: true });
  });

  it('detects a change to the default when only "before" is provided (field removed)', () => {
    // before=true; after=undefined → default false → change
    expect(diffField<boolean>(true, undefined, false)).toEqual({ from: true, to: false });
  });

  it('detects a boolean flip (true → false)', () => {
    expect(diffField<boolean>(true, false, false)).toEqual({ from: true, to: false });
  });

  it('detects a null-to-string role change', () => {
    expect(diffField<string | null>(null, 'administrator', null)).toEqual({
      from: null,
      to: 'administrator',
    });
  });

  it('treats null and undefined both as equivalent to the default for comparison', () => {
    // null role and absent role should both normalize to null default → equal
    expect(diffField<string | null>(null, undefined, null)).toBeNull();
    expect(diffField<string | null>(undefined, null, null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// writeAuditLog
// ---------------------------------------------------------------------------

describe('writeAuditLog', () => {
  function makeDb(): {
    db: Firestore;
    auditWrites: Record<string, unknown>[];
  } {
    const auditWrites: Record<string, unknown>[] = [];
    const db = {
      collection: () => ({
        add: (data: Record<string, unknown>) => {
          auditWrites.push(data);
          return Promise.resolve({ id: 'log-1' });
        },
      }),
    } as unknown as Firestore;
    return { db, auditWrites };
  }

  it('writes to the auditLog collection with the expected shape', async () => {
    const { db, auditWrites } = makeDb();
    await writeAuditLog(db, {
      userEmail: 'admin@orono.k12.mn.us',
      action: AUDIT_ACTIONS.staffPermissionsChanged,
      target: 'staff/teacher@orono.k12.mn.us',
      details: { affectedEmail: 'teacher@orono.k12.mn.us', changes: { role: { from: 'teacher', to: 'peer-evaluator' } } },
    });
    expect(auditWrites).toHaveLength(1);
    expect(auditWrites[0]).toMatchObject({
      userEmail: 'admin@orono.k12.mn.us',
      action: 'staff.permissionsChanged',
      target: 'staff/teacher@orono.k12.mn.us',
      details: {
        affectedEmail: 'teacher@orono.k12.mn.us',
        changes: { role: { from: 'teacher', to: 'peer-evaluator' } },
      },
    });
  });

  it('records a null userEmail when the actor is unknown (trigger path)', async () => {
    const { db, auditWrites } = makeDb();
    await writeAuditLog(db, {
      userEmail: null,
      action: AUDIT_ACTIONS.staffPermissionsChanged,
      target: 'staff/someone@orono.k12.mn.us',
    });
    expect(auditWrites[0]?.['userEmail']).toBeNull();
  });

  it('defaults details to an empty object when omitted', async () => {
    const { db, auditWrites } = makeDb();
    await writeAuditLog(db, {
      userEmail: null,
      action: AUDIT_ACTIONS.signIn,
      target: 'staff/user@orono.k12.mn.us',
    });
    expect(auditWrites[0]?.['details']).toEqual({});
  });

  it('includes a timestamp field in each written entry', async () => {
    // The real FieldValue.serverTimestamp() is a Firestore sentinel. We just
    // verify that writeAuditLog populates the "timestamp" key so consumers can
    // rely on it for ordering. The actual Firestore sentinel value is opaque.
    const { db, auditWrites } = makeDb();
    await writeAuditLog(db, {
      userEmail: null,
      action: AUDIT_ACTIONS.signIn,
      target: 'staff/user@orono.k12.mn.us',
    });
    expect('timestamp' in (auditWrites[0] ?? {})).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Permission-field diffing integration: typical onStaffWritten scenarios
// ---------------------------------------------------------------------------

describe('permission diff scenarios (diffField applied to staff fields)', () => {
  it('detects role, hasAdminAccess, and isActive all changing at once', () => {
    const changes: Record<string, { from: unknown; to: unknown }> = {};

    const roleChange = diffField<string | null>('teacher', 'peer-evaluator', null);
    if (roleChange) changes['role'] = roleChange;

    const adminChange = diffField<boolean>(false, true, false);
    if (adminChange) changes['hasAdminAccess'] = adminChange;

    const activeChange = diffField<boolean>(true, false, true);
    if (activeChange) changes['isActive'] = activeChange;

    expect(changes).toEqual({
      role: { from: 'teacher', to: 'peer-evaluator' },
      hasAdminAccess: { from: false, to: true },
      isActive: { from: true, to: false },
    });
  });

  it('produces no changes when only an untracked field changes', () => {
    // E.g. only "name" changed on the staff doc — diff of tracked fields = empty
    const changes: Record<string, { from: unknown; to: unknown }> = {};

    const roleChange = diffField<string | null>('teacher', 'teacher', null);
    if (roleChange) changes['role'] = roleChange;

    const adminChange = diffField<boolean>(false, false, false);
    if (adminChange) changes['hasAdminAccess'] = adminChange;

    const activeChange = diffField<boolean>(true, true, true);
    if (activeChange) changes['isActive'] = activeChange;

    expect(Object.keys(changes)).toHaveLength(0);
  });

  it('detects an archival (isActive flip) as the only change', () => {
    const changes: Record<string, { from: unknown; to: unknown }> = {};

    const roleChange = diffField<string | null>('peer-evaluator', 'peer-evaluator', null);
    if (roleChange) changes['role'] = roleChange;

    const adminChange = diffField<boolean>(false, false, false);
    if (adminChange) changes['hasAdminAccess'] = adminChange;

    const activeChange = diffField<boolean>(true, false, true);
    if (activeChange) changes['isActive'] = activeChange;

    expect(changes).toEqual({ isActive: { from: true, to: false } });
  });

  it('uses the default isActive=true when before.isActive is absent (legacy docs)', () => {
    // A legacy staff doc without isActive → treated as active (default=true).
    // Setting isActive=false on it should register a change from true to false.
    const activeChange = diffField<boolean>(undefined, false, true);
    expect(activeChange).toEqual({ from: true, to: false });
  });
});
