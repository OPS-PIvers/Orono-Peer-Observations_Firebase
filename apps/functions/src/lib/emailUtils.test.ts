import { describe, expect, it } from 'vitest';
import {
  incompleteReminderMailDocId,
  staffInviteMailDocId,
  substituteVariables,
} from './emailUtils.js';

describe('substituteVariables', () => {
  it('substitutes known variables and blanks unknown ones', () => {
    expect(substituteVariables('Hi {{name}} <{{missing}}>', { name: 'Sam' })).toBe('Hi Sam <>');
  });
});

describe('incompleteReminderMailDocId', () => {
  it('produces a stable id within one run date (idempotent on retry)', () => {
    expect(incompleteReminderMailDocId('obs1', '2026-06-08')).toBe(
      incompleteReminderMailDocId('obs1', '2026-06-08'),
    );
  });

  it('produces a distinct id on the next day so the nudge re-sends', () => {
    expect(incompleteReminderMailDocId('obs1', '2026-06-08')).not.toBe(
      incompleteReminderMailDocId('obs1', '2026-06-09'),
    );
  });

  it('embeds the observation id and run date', () => {
    expect(incompleteReminderMailDocId('obs1', '2026-06-08')).toBe('incomplete-obs1-2026-06-08');
  });
});

describe('staffInviteMailDocId', () => {
  it('makes the email safe as a doc id and embeds the timestamp', () => {
    expect(staffInviteMailDocId('jane@orono.k12.mn.us', 1_700_000_000_000)).toBe(
      'invite-jane-at-orono.k12.mn.us-1700000000000',
    );
  });

  it('differs across invites so a re-invite re-sends', () => {
    expect(staffInviteMailDocId('jane@orono.k12.mn.us', 1)).not.toBe(
      staffInviteMailDocId('jane@orono.k12.mn.us', 2),
    );
  });
});
