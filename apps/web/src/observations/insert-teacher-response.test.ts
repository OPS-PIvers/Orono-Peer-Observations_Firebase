import { describe, expect, it } from 'vitest';
import { buildTeacherResponseNodes } from './insert-teacher-response';

describe('buildTeacherResponseNodes', () => {
  it('emits an italic attribution paragraph followed by the captured text', () => {
    const nodes = buildTeacherResponseNodes(
      '  I group students by readiness.  ',
      'planning',
      'How will you differentiate?',
    );
    expect(nodes).toHaveLength(2);
    expect(nodes[0]?.content[0]?.marks).toEqual([{ type: 'italic' }]);
    expect(nodes[0]?.content[0]?.text).toBe(
      "Teacher's Planning response — “How will you differentiate?”",
    );
    expect(nodes[1]).toEqual({
      type: 'paragraph',
      content: [{ type: 'text', text: 'I group students by readiness.' }],
    });
  });

  it('drops the question quote when there is no question text', () => {
    const nodes = buildTeacherResponseNodes('x', 'reflection', '   ');
    expect(nodes[0]?.content[0]?.text).toBe("Teacher's Reflection response");
  });
});
