import { describe, expect, it } from 'vitest';

/**
 * Unit tests for the importedAt invite-suppression logic introduced in
 * onStaffWritten, and for the resendStaffInvite callable's input guard helpers.
 *
 * We extract the pure decision logic into helpers here rather than spinning up
 * a full Firebase Admin environment, following the pattern used in
 * sendManualEmail.test.ts.
 */

// ---------------------------------------------------------------------------
// Import suppression logic (mirrored from onStaffWritten.ts)
// ---------------------------------------------------------------------------

/**
 * Whether a staff-created invite should be suppressed for this doc.
 * Mirrors the condition in onStaffWritten.ts.
 *
 * `isNewStaff` — true when before=null and after exists (doc creation only)
 * `isActive`   — after.isActive
 * `importedAt` — after.importedAt (presence suppresses the send)
 */
function shouldSendInvite(args: {
  isNewStaff: boolean;
  isActive: boolean;
  importedAt: unknown;
}): boolean {
  const isImported = args.importedAt !== undefined && args.importedAt !== null;
  return args.isNewStaff && args.isActive && !isImported;
}

describe('onStaffWritten — invite suppression', () => {
  it('sends invite for new active staff with no importedAt', () => {
    expect(shouldSendInvite({ isNewStaff: true, isActive: true, importedAt: undefined })).toBe(
      true,
    );
  });

  it('suppresses invite when importedAt is a timestamp (bulk import)', () => {
    expect(shouldSendInvite({ isNewStaff: true, isActive: true, importedAt: new Date() })).toBe(
      false,
    );
  });

  it('suppresses invite when importedAt is a FieldValue sentinel (server timestamp)', () => {
    // FieldValue objects are opaque — any truthy importedAt suppresses the send
    expect(
      shouldSendInvite({
        isNewStaff: true,
        isActive: true,
        importedAt: { _methodName: 'serverTimestamp' },
      }),
    ).toBe(false);
  });

  it('does not send invite when staff is inactive', () => {
    expect(shouldSendInvite({ isNewStaff: true, isActive: false, importedAt: undefined })).toBe(
      false,
    );
  });

  it('does not send invite on an update (not new staff)', () => {
    expect(shouldSendInvite({ isNewStaff: false, isActive: true, importedAt: undefined })).toBe(
      false,
    );
  });

  it('does not send invite on update even if importedAt is absent', () => {
    expect(shouldSendInvite({ isNewStaff: false, isActive: true, importedAt: undefined })).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// resendStaffInvite — input validation helpers (extracted for unit testing)
// ---------------------------------------------------------------------------

/** Mirror of the email validation in resendStaffInvite.ts */
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

describe('resendStaffInvite — email validation', () => {
  it('accepts a valid email address', () => {
    expect(isValidEmail('teacher@orono.k12.mn.us')).toBe(true);
  });

  it('rejects an email missing @', () => {
    expect(isValidEmail('notanemail')).toBe(false);
  });

  it('rejects a blank string', () => {
    expect(isValidEmail('')).toBe(false);
  });

  it('rejects a string with only spaces', () => {
    expect(isValidEmail('   ')).toBe(false);
  });

  it('rejects an email with no domain part', () => {
    expect(isValidEmail('teacher@')).toBe(false);
  });
});
