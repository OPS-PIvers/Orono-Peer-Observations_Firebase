import { describe, expect, it } from 'vitest';
import { postQuestionsUnlocked, workProductQuestion } from './workProductQuestion.js';

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

describe('postQuestionsUnlocked', () => {
  it('stays closed on the day of the observation', () => {
    expect(
      postQuestionsUnlocked(new Date('2026-09-10T08:00:00'), new Date('2026-09-10T23:59:00')),
    ).toBe(false);
  });
  it('opens the following calendar day', () => {
    expect(
      postQuestionsUnlocked(new Date('2026-09-10T08:00:00'), new Date('2026-09-11T00:01:00')),
    ).toBe(true);
  });
  it('stays closed before the observation', () => {
    expect(postQuestionsUnlocked(new Date('2026-09-10T08:00:00'), new Date('2026-09-01'))).toBe(
      false,
    );
  });
  it('stays closed when no date has been recorded', () => {
    expect(postQuestionsUnlocked(null, new Date('2026-09-11'))).toBe(false);
  });
});
