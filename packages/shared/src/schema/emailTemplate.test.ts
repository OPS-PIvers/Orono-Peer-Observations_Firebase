import { describe, expect, it } from 'vitest';
import {
  EMAIL_TRIGGER_TYPES,
  FIXED_RECIPIENT_DESCRIPTION,
  FIXED_RECIPIENT_TRIGGER_TYPES,
  hasFixedRecipient,
} from './emailTemplate.js';

/**
 * Regression coverage for the "inert admin control" finding: the admin
 * Email Templates UI must not present the Recipient selector as editable
 * for trigger types whose send path (scheduledEmailReminders.ts) ignores
 * `template.recipient` entirely. Without this helper the UI has no way to
 * know which triggers those are, so it silently offered a control that did
 * nothing.
 */
describe('FIXED_RECIPIENT_TRIGGER_TYPES / hasFixedRecipient', () => {
  it('flags scheduled.reminderOverdueFinalize as fixed-recipient', () => {
    expect(hasFixedRecipient('scheduled.reminderOverdueFinalize')).toBe(true);
  });

  it('flags scheduled.reminderIncomplete as fixed-recipient', () => {
    // scheduledEmailReminders.ts block 2 hardcodes `to: obs.observedEmail`
    // and never reads incompleteTemplate.recipient — same disconnect as
    // the overdue-finalize block.
    expect(hasFixedRecipient('scheduled.reminderIncomplete')).toBe(true);
  });

  it('does not flag scheduled.preObservation, which does branch on recipient', () => {
    expect(hasFixedRecipient('scheduled.preObservation')).toBe(false);
  });

  it('does not flag any non-scheduled trigger type', () => {
    for (const tt of EMAIL_TRIGGER_TYPES) {
      if (tt.startsWith('scheduled.')) continue;
      expect(hasFixedRecipient(tt)).toBe(false);
    }
  });

  it('every fixed-recipient trigger has a human-readable description', () => {
    for (const tt of FIXED_RECIPIENT_TRIGGER_TYPES) {
      expect(FIXED_RECIPIENT_DESCRIPTION[tt]).toBeTruthy();
    }
  });
});
