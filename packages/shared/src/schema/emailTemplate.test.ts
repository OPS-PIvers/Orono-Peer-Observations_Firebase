import { describe, expect, it } from 'vitest';
import { EMAIL_TRIGGER_TYPES, KNOWN_TEMPLATE_VARIABLES, emailTemplate } from './emailTemplate.js';

describe('EMAIL_TRIGGER_TYPES', () => {
  it('includes scheduled.reminderUnacknowledged', () => {
    expect(EMAIL_TRIGGER_TYPES).toContain('scheduled.reminderUnacknowledged');
  });

  it('includes both scheduled reminder types', () => {
    expect(EMAIL_TRIGGER_TYPES).toContain('scheduled.reminderIncomplete');
    expect(EMAIL_TRIGGER_TYPES).toContain('scheduled.reminderUnacknowledged');
  });
});

describe('KNOWN_TEMPLATE_VARIABLES', () => {
  it('includes staffYear', () => {
    expect(KNOWN_TEMPLATE_VARIABLES).toContain('staffYear');
  });

  it('includes all expected participant and metadata vars', () => {
    const required = [
      'observerName',
      'observedName',
      'staffName',
      'staffEmail',
      'staffRole',
      'staffYear',
      'assignedDomainList',
      'assignedComponentCount',
    ] as const;
    for (const v of required) {
      expect(KNOWN_TEMPLATE_VARIABLES).toContain(v);
    }
  });
});

describe('emailTemplate schema — variables field', () => {
  it('accepts staffYear in the variables array', () => {
    const base = {
      templateId: 'test-tpl',
      name: 'Test',
      description: '',
      subject: 'Hi',
      bodyHtml: '<p>Hello {{staffYear}}</p>',
      variables: ['staffYear'],
      triggerType: 'staff.created',
      recipient: 'observed',
      scheduledDays: 3,
      isActive: true,
      isSystem: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const result = emailTemplate.safeParse(base);
    expect(result.success).toBe(true);
  });

  it('rejects unknown variables in the variables array', () => {
    const base = {
      templateId: 'test-tpl',
      name: 'Test',
      description: '',
      subject: 'Hi',
      bodyHtml: '<p>Hello</p>',
      variables: ['unknownVar'],
      triggerType: 'staff.created',
      recipient: 'observed',
      scheduledDays: 3,
      isActive: true,
      isSystem: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const result = emailTemplate.safeParse(base);
    expect(result.success).toBe(false);
  });
});
