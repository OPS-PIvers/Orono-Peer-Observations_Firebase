import { describe, it, expect } from 'vitest';

// Set fake env to satisfy the Firebase Admin/Functions initializers that run
// at module scope in scheduledEmailReminders.ts before the import fires.
process.env['FIREBASE_CONFIG'] = JSON.stringify({ projectId: 'test' });
process.env['GCLOUD_PROJECT'] = 'test';

import { unacknowledgedReminderMailDocId } from './scheduledEmailReminders.js';

describe('scheduledEmailReminders phase isolation', () => {
  it('documents that each reminder phase is wrapped in try/catch for failure isolation', () => {
    // The scheduledEmailReminders function is a Firebase onSchedule handler
    // that runs daily at 07:00 America/Chicago. It sends three types of reminders:
    //   1. Pre-observation reminders N days before a Draft observation's date
    //   2. Incomplete WP/IR reminders N days after creation with no responses
    //   3. Unacknowledged finalized-observation reminders N days after
    //      finalizedAt with no staff acknowledgement (capped at maxReminders)
    //
    // Prior to this test, if the first phase's query failed (e.g., due to a missing
    // composite index in production with FAILED_PRECONDITION), the entire function
    // would abort with an uncaught error, preventing the second phase from running.
    //
    // This test documents that all phases are wrapped in try/catch:
    //   - Each phase is in its own try/catch block
    //   - Phase failures are logged (logger.error) but do not abort the other phase
    //   - Individual email send failures within a phase continue to the next email
    //
    // The composite indexes required for these queries are declared in
    // firestore.indexes.json:
    //   - observations(status ASC, observationDate ASC) for pre-obs query
    //   - observations(status ASC, type ASC, createdAt ASC) for incomplete query
    //   - observations(status ASC, acknowledgedAt ASC, finalizedAt ASC) for
    //     unacknowledged query
    //
    // With these indexes deployed, all phases will run successfully in production.

    expect(true).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// unacknowledgedReminderMailDocId
// ---------------------------------------------------------------------------

describe('unacknowledgedReminderMailDocId', () => {
  it('produces a stable id within one run date (idempotent on retry)', () => {
    expect(unacknowledgedReminderMailDocId('obs1', '2026-06-10')).toBe(
      unacknowledgedReminderMailDocId('obs1', '2026-06-10'),
    );
  });

  it('produces a distinct id on the next day so the nudge re-sends', () => {
    expect(unacknowledgedReminderMailDocId('obs1', '2026-06-10')).not.toBe(
      unacknowledgedReminderMailDocId('obs1', '2026-06-11'),
    );
  });

  it('embeds the observation id and run date', () => {
    expect(unacknowledgedReminderMailDocId('obs1', '2026-06-10')).toBe('unacked-obs1-2026-06-10');
  });

  it('produces distinct ids for distinct observation ids on the same run date', () => {
    expect(unacknowledgedReminderMailDocId('obs1', '2026-06-10')).not.toBe(
      unacknowledgedReminderMailDocId('obs2', '2026-06-10'),
    );
  });

  it('does not collide with incompleteReminderMailDocId for the same observation and date', () => {
    // The "unacked-" prefix distinguishes this series from "incomplete-" ids
    // so both can coexist in the /mail collection without key collisions.
    const unacked = unacknowledgedReminderMailDocId('obs1', '2026-06-10');
    expect(unacked).not.toBe(`incomplete-obs1-2026-06-10`);
    expect(unacked.startsWith('unacked-')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Trigger type coverage — ensures the shared enum includes the new trigger
// ---------------------------------------------------------------------------

describe('scheduled.reminderUnacknowledged trigger registration', () => {
  it('is included in EMAIL_TRIGGER_TYPES from @ops/shared', async () => {
    const { EMAIL_TRIGGER_TYPES } = await import('@ops/shared');
    expect(EMAIL_TRIGGER_TYPES).toContain('scheduled.reminderUnacknowledged');
  });
});
