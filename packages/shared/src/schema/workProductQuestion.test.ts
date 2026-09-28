import { describe, expect, it } from 'vitest';
import {
  postQuestionsUnlocked,
  resolveReflectionUnlock,
  workProductQuestion,
} from './workProductQuestion.js';

const base = {
  questionId: 'q-1',
  text: 'What were you hoping students would take away?',
  order: 0,
  createdAt: new Date('2026-08-01'),
  updatedAt: new Date('2026-08-01'),
};

describe('workProductQuestion.phase', () => {
  it('defaults to pre so questions written before the split keep working', () => {
    expect(workProductQuestion.parse(base).phase).toBe('pre');
  });
  it('round-trips an explicit post phase', () => {
    expect(workProductQuestion.parse({ ...base, phase: 'post' }).phase).toBe('post');
  });
});

describe('postQuestionsUnlocked (after-observation)', () => {
  it('stays closed on the day of the observation', () => {
    expect(
      postQuestionsUnlocked(
        new Date('2026-09-10T08:00:00'),
        new Date('2026-09-10T23:59:00'),
        'after-observation',
      ),
    ).toBe(false);
  });
  it('opens the following calendar day', () => {
    expect(
      postQuestionsUnlocked(
        new Date('2026-09-10T08:00:00'),
        new Date('2026-09-11T00:01:00'),
        'after-observation',
      ),
    ).toBe(true);
  });
  it('stays closed before the observation', () => {
    expect(
      postQuestionsUnlocked(
        new Date('2026-09-10T08:00:00'),
        new Date('2026-09-01'),
        'after-observation',
      ),
    ).toBe(false);
  });
  it('stays closed when no date has been recorded', () => {
    expect(postQuestionsUnlocked(null, new Date('2026-09-11'), 'after-observation')).toBe(false);
  });
});

describe('postQuestionsUnlocked (always)', () => {
  it('is open before the observation and with no date at all', () => {
    expect(postQuestionsUnlocked(new Date('2026-09-10'), new Date('2026-09-01'), 'always')).toBe(
      true,
    );
    expect(postQuestionsUnlocked(null, new Date('2026-09-01'), 'always')).toBe(true);
  });
});

describe('resolveReflectionUnlock', () => {
  it('keeps a valid stored mode', () => {
    expect(resolveReflectionUnlock('after-observation')).toBe('after-observation');
  });
  it('falls back to always for missing or unknown values', () => {
    expect(resolveReflectionUnlock(undefined)).toBe('always');
    expect(resolveReflectionUnlock('sometimes')).toBe('always');
  });
});
