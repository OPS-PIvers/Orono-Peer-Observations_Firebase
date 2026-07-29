import { describe, expect, it } from 'vitest';
import type { EmailTemplateHistoryEntry } from '@ops/shared';
import { MAX_TEMPLATE_HISTORY, withHistoryEntry } from './templateHistory';

const editedAt = new Date('2026-05-20T00:00:00Z');

function makeEntry(i: number): EmailTemplateHistoryEntry {
  return {
    subject: `Subject ${String(i)}`,
    bodyHtml: `<p>Body ${String(i)}</p>`,
    editedAt,
    editedBy: 'paul.ivers@orono.k12.mn.us',
  };
}

describe('withHistoryEntry', () => {
  it('prepends a new entry built from the pre-edit content onto empty history', () => {
    const result = withHistoryEntry(
      undefined,
      { subject: 'Old subject', bodyHtml: '<p>Old body</p>' },
      'paul.ivers@orono.k12.mn.us',
      editedAt,
    );
    expect(result).toEqual([
      {
        subject: 'Old subject',
        bodyHtml: '<p>Old body</p>',
        editedAt,
        editedBy: 'paul.ivers@orono.k12.mn.us',
      },
    ]);
  });

  it('prepends onto existing history, most recent first', () => {
    const existing = [makeEntry(1), makeEntry(2)];
    const result = withHistoryEntry(
      existing,
      { subject: 'Newly-old subject', bodyHtml: '<p>Newly-old body</p>' },
      'sarah.johnson@orono.k12.mn.us',
      editedAt,
    );
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({
      subject: 'Newly-old subject',
      bodyHtml: '<p>Newly-old body</p>',
      editedAt,
      editedBy: 'sarah.johnson@orono.k12.mn.us',
    });
    expect(result[1]).toEqual(makeEntry(1));
    expect(result[2]).toEqual(makeEntry(2));
  });

  it('trims to MAX_TEMPLATE_HISTORY entries, dropping the oldest', () => {
    const existing = Array.from({ length: MAX_TEMPLATE_HISTORY }, (_, i) => makeEntry(i));
    const result = withHistoryEntry(
      existing,
      { subject: 'Newest pre-edit subject', bodyHtml: '<p>Newest pre-edit body</p>' },
      'paul.ivers@orono.k12.mn.us',
      editedAt,
    );
    expect(result).toHaveLength(MAX_TEMPLATE_HISTORY);
    expect(result[0]?.subject).toBe('Newest pre-edit subject');
    // The oldest entry (index MAX_TEMPLATE_HISTORY - 1) fell off the end.
    expect(result.some((e) => e.subject === makeEntry(MAX_TEMPLATE_HISTORY - 1).subject)).toBe(
      false,
    );
  });
});
