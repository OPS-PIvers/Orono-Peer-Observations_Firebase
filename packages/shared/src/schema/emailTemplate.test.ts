import { describe, expect, it } from 'vitest';
import { emailTemplate, emailTemplateHistoryEntry } from './emailTemplate.js';

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

  it('accepts up to 5 entries', () => {
    const history = Array.from({ length: 5 }, (_, i) => ({
      subject: `Subject ${String(i)}`,
      bodyHtml: `<p>Body ${String(i)}</p>`,
      editedAt: now,
      editedBy: 'paul.ivers@orono.k12.mn.us',
    }));
    const parsed = emailTemplate.parse({ ...baseTemplate(), history });
    expect(parsed.history).toHaveLength(5);
  });

  it('rejects more than 5 entries', () => {
    const history = Array.from({ length: 6 }, (_, i) => ({
      subject: `Subject ${String(i)}`,
      bodyHtml: `<p>Body ${String(i)}</p>`,
      editedAt: now,
      editedBy: 'paul.ivers@orono.k12.mn.us',
    }));
    expect(() => emailTemplate.parse({ ...baseTemplate(), history })).toThrow();
  });
});
