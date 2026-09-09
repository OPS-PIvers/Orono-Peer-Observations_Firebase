import { describe, expect, it } from 'vitest';
import type { WorkProductQuestion } from '@ops/shared';
import {
  answerEditability,
  answerProgress,
  answeredAfterFinalize,
  splitQuestionsByPhase,
} from './questionAnswers';

type Q = WorkProductQuestion & { id: string };

function question(id: string, phase?: 'pre' | 'post'): Q {
  const base = {
    id,
    questionId: id,
    text: `Question ${id}`,
    order: 0,
    isActive: true,
    type: 'standard' as const,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  // Questions written before the phase split arrive without `phase` at all;
  // build such a doc deliberately rather than stubbing the field to undefined.
  return (phase ? { ...base, phase } : base) as Q;
}

const RICH = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }],
};
const EMPTY = { type: 'doc', content: [{ type: 'paragraph' }] };

describe('splitQuestionsByPhase', () => {
  it('files questions by phase, keeping order within each', () => {
    const result = splitQuestionsByPhase([
      question('a', 'post'),
      question('b', 'pre'),
      question('c', 'post'),
    ]);
    expect(result.pre.map((q) => q.id)).toEqual(['b']);
    expect(result.post.map((q) => q.id)).toEqual(['a', 'c']);
  });

  it('treats a legacy question without a phase as Planning', () => {
    expect(splitQuestionsByPhase([question('legacy')]).pre).toHaveLength(1);
  });

  it('handles a bank that has not loaded yet', () => {
    expect(splitQuestionsByPhase(null)).toEqual({ pre: [], post: [] });
  });
});

describe('answerProgress', () => {
  const bank = [question('a'), question('b'), question('c')];

  it('counts only answers with text, against the given questions', () => {
    expect(answerProgress(bank, { a: RICH, b: EMPTY, c: 'legacy string', zzz: RICH })).toEqual({
      answered: 2,
      total: 3,
    });
  });

  it('accepts a Map of answers', () => {
    expect(answerProgress(bank, new Map([['a', RICH]]))).toEqual({ answered: 1, total: 3 });
  });

  it('is 0 of 0 for an empty bank', () => {
    expect(answerProgress([], {})).toEqual({ answered: 0, total: 0 });
  });
});

describe('answerEditability', () => {
  const obsDate = new Date(2026, 9, 3); // Oct 3
  const dayAfter = new Date(2026, 9, 4, 0, 0, 1);
  const sameDay = new Date(2026, 9, 3, 23, 59);

  it('lets the observed teacher answer Planning on a Draft', () => {
    expect(
      answerEditability({
        phase: 'pre',
        status: 'Draft',
        isObservedStaff: true,
        observationDate: obsDate,
        now: sameDay,
      }),
    ).toBe('editable');
  });

  it('locks Planning once finalized, even for the teacher', () => {
    expect(
      answerEditability({
        phase: 'pre',
        status: 'Finalized',
        isObservedStaff: true,
        observationDate: obsDate,
        now: dayAfter,
      }),
    ).toBe('finalized');
  });

  it('keeps Reflection editable after finalize', () => {
    expect(
      answerEditability({
        phase: 'post',
        status: 'Finalized',
        isObservedStaff: true,
        observationDate: obsDate,
        now: dayAfter,
      }),
    ).toBe('editable');
  });

  it('locks Reflection until the day after the observation, for everyone', () => {
    for (const isObservedStaff of [true, false]) {
      expect(
        answerEditability({
          phase: 'post',
          status: 'Draft',
          isObservedStaff,
          observationDate: obsDate,
          now: sameDay,
        }),
      ).toBe('locked-until-after');
    }
  });

  it('locks Reflection when no observation date is set', () => {
    expect(
      answerEditability({
        phase: 'post',
        status: 'Draft',
        isObservedStaff: true,
        observationDate: null,
        now: dayAfter,
      }),
    ).toBe('locked-until-after');
  });

  it('is read-only for anyone who is not the observed teacher', () => {
    expect(
      answerEditability({
        phase: 'pre',
        status: 'Draft',
        isObservedStaff: false,
        observationDate: obsDate,
        now: sameDay,
      }),
    ).toBe('not-answerer');
    expect(
      answerEditability({
        phase: 'post',
        status: 'Draft',
        isObservedStaff: false,
        observationDate: obsDate,
        now: dayAfter,
      }),
    ).toBe('not-answerer');
  });
});

describe('answeredAfterFinalize', () => {
  const finalizedAt = new Date('2026-10-10T12:00:00Z');

  it('flags an answer saved after finalize', () => {
    expect(
      answeredAfterFinalize({ updatedAt: new Date('2026-10-11T08:00:00Z') }, finalizedAt),
    ).toBe(true);
  });

  it('does not flag an answer saved before finalize', () => {
    expect(
      answeredAfterFinalize({ updatedAt: new Date('2026-10-09T08:00:00Z') }, finalizedAt),
    ).toBe(false);
  });

  it('is false while the observation is still a draft or the answer is missing', () => {
    expect(answeredAfterFinalize({ updatedAt: new Date() }, null)).toBe(false);
    expect(answeredAfterFinalize(undefined, finalizedAt)).toBe(false);
  });

  it('accepts raw Firestore Timestamp-shaped values', () => {
    const ts = (d: Date) => ({ toDate: () => d });
    expect(
      answeredAfterFinalize(
        { updatedAt: ts(new Date('2026-10-11T08:00:00Z')) as unknown as Date },
        ts(finalizedAt),
      ),
    ).toBe(true);
  });
});
