import { describe, expect, it } from 'vitest';
import {
  EMAIL_TRIGGER_TYPES,
  FIXED_RECIPIENT_DESCRIPTION,
  FIXED_RECIPIENT_TRIGGER_TYPES,
  MAX_TEMPLATE_HISTORY_ENTRIES,
  emailTemplate,
  emailTemplateHistoryEntry,
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

const now = new Date('2026-05-20T00:00:00Z');

function baseTemplate() {
  return {
    templateId: 'welcome',
    name: 'Welcome',
    subject: 'Welcome!',
    bodyHtml: '<p>Hi</p>',
    createdAt: now,
    updatedAt: now,
  };
}

describe('emailTemplateHistoryEntry', () => {
  it('parses a full entry', () => {
    const entry = emailTemplateHistoryEntry.parse({
      subject: 'Old subject',
      bodyHtml: '<p>Old body</p>',
      editedAt: now,
      editedBy: 'paul.ivers@orono.k12.mn.us',
    });
    expect(entry.subject).toBe('Old subject');
    expect(entry.editedBy).toBe('paul.ivers@orono.k12.mn.us');
  });

  it('rejects an invalid editedBy address', () => {
    expect(() =>
      emailTemplateHistoryEntry.parse({
        subject: 'Old subject',
        bodyHtml: '<p>Old body</p>',
        editedAt: now,
        editedBy: 'not-an-email',
      }),
    ).toThrow();
  });
});

describe('emailTemplate.history', () => {
  it('defaults to an empty array', () => {
    const parsed = emailTemplate.parse(baseTemplate());
    expect(parsed.history).toEqual([]);
  });

  it('accepts up to MAX_TEMPLATE_HISTORY_ENTRIES entries', () => {
    const history = Array.from({ length: MAX_TEMPLATE_HISTORY_ENTRIES }, (_, i) => ({
      subject: `Subject ${String(i)}`,
      bodyHtml: `<p>Body ${String(i)}</p>`,
      editedAt: now,
      editedBy: 'paul.ivers@orono.k12.mn.us',
    }));
    const parsed = emailTemplate.parse({ ...baseTemplate(), history });
    expect(parsed.history).toHaveLength(MAX_TEMPLATE_HISTORY_ENTRIES);
  });

  it('rejects more than MAX_TEMPLATE_HISTORY_ENTRIES entries', () => {
    const history = Array.from({ length: MAX_TEMPLATE_HISTORY_ENTRIES + 1 }, (_, i) => ({
      subject: `Subject ${String(i)}`,
      bodyHtml: `<p>Body ${String(i)}</p>`,
      editedAt: now,
      editedBy: 'paul.ivers@orono.k12.mn.us',
    }));
    expect(() => emailTemplate.parse({ ...baseTemplate(), history })).toThrow();
  });
});
