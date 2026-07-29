import { Timestamp } from 'firebase/firestore';
import { describe, expect, it } from 'vitest';
import type { EmailTemplateHistoryEntry } from '@ops/shared';
import {
  MAX_TEMPLATE_HISTORY,
  fitHistoryToByteBudget,
  historyEntryKey,
  withHistoryEntry,
  type HistoryEntryLike,
} from './templateHistory';

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

describe('fitHistoryToByteBudget', () => {
  const liveFields = { subject: 'Subject', bodyHtml: '<p>Body</p>' };

  it('leaves a normal-sized history untouched (invisible in normal use)', () => {
    const history = [makeEntry(1), makeEntry(2), makeEntry(3)];
    const result = fitHistoryToByteBudget(liveFields, history);
    expect(result).toEqual(history);
  });

  it('caps at MAX_TEMPLATE_HISTORY entries even when every entry is tiny', () => {
    const history = Array.from({ length: MAX_TEMPLATE_HISTORY + 3 }, (_, i) => makeEntry(i));
    const result = fitHistoryToByteBudget(liveFields, history);
    expect(result).toHaveLength(MAX_TEMPLATE_HISTORY);
  });

  it('drops the OLDEST entries first when the doc would exceed the byte budget', () => {
    // One huge entry (the oldest, at the end of the newest-first array) and
    // two small, recent ones. A small budget should force the huge, oldest
    // entry out while keeping the small, recent ones.
    const hugeOldEntry: EmailTemplateHistoryEntry = {
      subject: 'Huge old one',
      bodyHtml: '<p>' + 'x'.repeat(5000) + '</p>',
      editedAt: new Date('2026-01-01T00:00:00Z'),
      editedBy: 'paul.ivers@orono.k12.mn.us',
    };
    const history = [makeEntry(1), makeEntry(2), hugeOldEntry];
    const result = fitHistoryToByteBudget(liveFields, history, 1000);
    expect(result).toEqual([makeEntry(1), makeEntry(2)]);
  });

  it('still saves the live content (empty history) in the degenerate oversized-body case', () => {
    // Even the live fields alone exceed the budget — trimming every history
    // entry away still isn't enough. Must not throw; must return [] so the
    // caller can still write the live content.
    const massiveLiveFields = { subject: 'Subject', bodyHtml: 'x'.repeat(2000) };
    const history = [makeEntry(1), makeEntry(2)];
    const result = fitHistoryToByteBudget(massiveLiveFields, history, 1000);
    expect(result).toEqual([]);
  });
});

describe('historyEntryKey', () => {
  it('is stable for the same entry regardless of array position', () => {
    const entry = makeEntry(1);
    expect(historyEntryKey(entry)).toBe(historyEntryKey(entry));
  });

  it('produces the same key for a Timestamp and the equivalent Date', () => {
    const date = new Date('2026-03-01T12:00:00Z');
    const dateEntry: EmailTemplateHistoryEntry = {
      subject: 'Same version',
      bodyHtml: '<p>x</p>',
      editedAt: date,
      editedBy: 'paul.ivers@orono.k12.mn.us',
    };
    const timestampEntry: HistoryEntryLike = {
      ...dateEntry,
      editedAt: Timestamp.fromDate(date),
    };
    expect(historyEntryKey(timestampEntry)).toBe(historyEntryKey(dateEntry));
  });

  it('differs for entries with different subjects saved at the same instant', () => {
    const editedAt = new Date('2026-03-01T12:00:00Z');
    const a: EmailTemplateHistoryEntry = {
      subject: 'A',
      bodyHtml: '<p>a</p>',
      editedAt,
      editedBy: 'paul.ivers@orono.k12.mn.us',
    };
    const b: EmailTemplateHistoryEntry = { ...a, subject: 'B' };
    expect(historyEntryKey(a)).not.toBe(historyEntryKey(b));
  });
});
