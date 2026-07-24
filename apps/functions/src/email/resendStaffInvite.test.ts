import { describe, expect, it } from 'vitest';

/**
 * Unit tests for the new-staff invite-suppression logic in onStaffWritten,
 * and for the resendStaffInvite callable's input guard helpers.
 *
 * We extract the pure decision logic into helpers here rather than spinning up
 * a full Firebase Admin environment, following the pattern used in
 * sendManualEmail.test.ts.
 */

// ---------------------------------------------------------------------------
// Invite-send logic (mirrored from onStaffWritten.ts)
// ---------------------------------------------------------------------------

/**
 * Whether a staff-created invite should be sent for this doc write.
 * Mirrors the condition in onStaffWritten.ts.
 *
 * `isNewStaff` — true when before=null and after exists (doc creation only)
 * `isActive`   — after.isActive
 *
 * Note: the real handler has no `importedAt` bulk-import suppression — every
 * newly-created active staff doc triggers an invite email regardless of how
 * the doc was written (manual entry or bulk import).
 */
function shouldSendInvite(args: { isNewStaff: boolean; isActive: boolean }): boolean {
  return args.isNewStaff && args.isActive;
}

describe('onStaffWritten — invite suppression', () => {
  it('sends invite for new active staff', () => {
    expect(shouldSendInvite({ isNewStaff: true, isActive: true })).toBe(true);
  });

  it('does not send invite when staff is inactive', () => {
    expect(shouldSendInvite({ isNewStaff: true, isActive: false })).toBe(false);
  });

  it('does not send invite on an update (not new staff)', () => {
    expect(shouldSendInvite({ isNewStaff: false, isActive: true })).toBe(false);
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
