import { describe, expect, it } from 'vitest';
import {
  isoYearWeek,
  phaseReminderMailDocId,
  unansweredQuestionIds,
} from './scheduledEmailReminders.js';

/**
 * Unit tests for the ISO-year-week helper backing the overdue-finalize
 * reminder's weekly cadence (OBS-08). The reminder's `/mail` doc id is
 * `overdue-<obsId>-<isoYearWeek>`, so idempotency-per-week hinges entirely on
 * this function returning a stable label within a calendar week and a new one
 * the following week — including across ISO year boundaries, where the last
 * days of December (or first days of January) can belong to the *other*
 * calendar year's week numbering.
 */
describe('isoYearWeek', () => {
  it('returns the same label for two days in the same ISO week (Mon and Wed)', () => {
    // 2026-07-27 is a Monday, 2026-07-29 a Wednesday — same ISO week.
    expect(isoYearWeek(new Date('2026-07-27T17:00:00Z'))).toBe('2026-W31');
    expect(isoYearWeek(new Date('2026-07-29T17:00:00Z'))).toBe('2026-W31');
  });

  it('advances to the next label the following Monday', () => {
    expect(isoYearWeek(new Date('2026-08-03T17:00:00Z'))).toBe('2026-W32');
  });

  it('handles a year that starts on an ISO Thursday (week 1 starts Jan 1)', () => {
    expect(isoYearWeek(new Date('2026-01-01T17:00:00Z'))).toBe('2026-W01');
  });

  it('assigns late-December dates to the following ISO year when their week belongs there', () => {
    // 2025-12-31 is a Wednesday whose ISO week's Thursday (2026-01-01) falls
    // in 2026, so this date is ISO week 1 of 2026, not week-53-of-2025.
    expect(isoYearWeek(new Date('2025-12-31T17:00:00Z'))).toBe('2026-W01');
  });

  it('assigns early-January dates to the prior ISO year when their week belongs there', () => {
    // 2027-01-01 is a Friday whose ISO week's Thursday (2026-12-31) falls in
    // 2026, so this date is ISO week 53 of 2026, not week 1 of 2027.
    expect(isoYearWeek(new Date('2027-01-01T17:00:00Z'))).toBe('2026-W53');
  });
});

describe('unansweredQuestionIds', () => {
  const bank = [
    { questionId: 's-pre-1', type: 'standard' as const, phase: 'pre' as const },
    { questionId: 's-pre-2', type: 'standard' as const, phase: 'pre' as const },
    { questionId: 's-post-1', type: 'standard' as const, phase: 'post' as const },
    { questionId: 'wp-1', type: 'work-product' as const, phase: 'pre' as const },
    // Written before `phase` / `type` existed: work-product, Planning.
    { questionId: 'legacy' } as { questionId: string; type: 'work-product'; phase: 'pre' },
  ];

  it('lists only the phase questions of the observation type that lack text', () => {
    const answers = [
      { questionId: 's-pre-1', answer: 'done' },
      { questionId: 's-pre-2', answer: '' },
      { questionId: 's-post-1', answer: { type: 'doc', content: [{ type: 'paragraph' }] } },
    ];
    expect(unansweredQuestionIds(bank, answers, 'Standard', 'pre')).toEqual(['s-pre-2']);
    expect(unansweredQuestionIds(bank, answers, 'Standard', 'post')).toEqual(['s-post-1']);
    expect(unansweredQuestionIds(bank, answers, 'Work Product', 'pre')).toEqual(['wp-1', 'legacy']);
  });

  it('is empty when everything is answered, and for an unknown type', () => {
    const answers = [
      { questionId: 's-pre-1', answer: 'a' },
      { questionId: 's-pre-2', answer: 'b' },
    ];
    expect(unansweredQuestionIds(bank, answers, 'Standard', 'pre')).toEqual([]);
    expect(unansweredQuestionIds(bank, answers, 'Mystery', 'pre')).toEqual([]);
  });

  it('tolerates malformed answer arrays from raw Firestore data', () => {
    expect(unansweredQuestionIds(bank, undefined, 'Standard', 'post')).toEqual(['s-post-1']);
    expect(unansweredQuestionIds(bank, [null, 'junk', {}], 'Standard', 'post')).toEqual([
      's-post-1',
    ]);
  });
});

describe('phaseReminderMailDocId', () => {
  it('is keyed by phase, observation and ISO week so it repeats weekly', () => {
    expect(phaseReminderMailDocId('pre', 'obs1', '2026-W31')).toBe(
      'incomplete-planning-obs1-2026-W31',
    );
    expect(phaseReminderMailDocId('post', 'obs1', '2026-W32')).toBe(
      'incomplete-reflection-obs1-2026-W32',
    );
  });
});
