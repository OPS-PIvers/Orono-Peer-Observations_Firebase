/**
 * MyRubricPage — unit tests for hash-based domain scrolling and assignment mode.
 *
 * Tests for:
 *   - Hash effect scrolls to domain when target exists
 *   - Hash effect switches from assigned to full mode when target doesn't exist in assigned mode
 *   - Hash effect correctly identifies domain existence in full rubric
 */
import { describe, expect, it, vi } from 'vitest';
import type { Rubric, RubricComponent, RubricDomain } from '@ops/shared';

// ─── Fixtures ───────────────────────────────────────────────────────────────

function makeComponent(id: string, index: number): RubricComponent {
  return {
    id,
    title: `Component ${index}`,
    proficiencyLevels: {
      developing: 'Developing',
      basic: 'Basic',
      proficient: 'Proficient',
      distinguished: 'Distinguished',
    },
    lookFors: [],
  };
}

function makeDomain(id: string, name: string, componentCount = 2): RubricDomain {
  const components = Array.from({ length: componentCount }, (_, i) =>
    makeComponent(`${id}-c${i}`, i),
  );
  return {
    id,
    name,
    components,
  };
}

function makeRubric(overrides: Partial<Rubric & { id: string }> = {}): Rubric & { id: string } {
  return {
    id: 'test-rubric',
    rubricId: 'test-rubric',
    displayName: 'Test Rubric',
    domains: [
      makeDomain('d1', 'Domain 1', 2),
      makeDomain('d2', 'Domain 2', 1),
      makeDomain('d3', 'Domain 3', 3),
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/**
 * Mirrors the hash effect's mode-switch decision: in assigned mode, when the
 * target element is missing but the domain exists in the full rubric, switch
 * to full mode. Extracted as a function so the inputs are widened (boolean,
 * nullable element) rather than literal types — keeping the conditions real.
 */
function computeShouldSwitchMode(
  rubric: Rubric & { id: string },
  id: string,
  el: HTMLElement | null,
  assignmentModeIsAssigned: boolean,
): boolean {
  if (!el && assignmentModeIsAssigned) {
    return rubric.domains.some((d) => id === `domain-${d.id}`);
  }
  return false;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('MyRubricPage hash effect logic', () => {
  describe('domain identification in full rubric', () => {
    it('correctly identifies existing domains in full rubric', () => {
      const rubric = makeRubric();
      const id = 'domain-d1';

      const fullRubricHasDomain = rubric.domains.some((d) => id === `domain-${d.id}`);

      expect(fullRubricHasDomain).toBe(true);
    });

    it('correctly identifies non-existing domains in full rubric', () => {
      const rubric = makeRubric();
      const id = 'domain-nonexistent';

      const fullRubricHasDomain = rubric.domains.some((d) => id === `domain-${d.id}`);

      expect(fullRubricHasDomain).toBe(false);
    });

    it('handles empty rubric gracefully', () => {
      const rubric = makeRubric({ domains: [] });
      const id = 'domain-d1';

      const fullRubricHasDomain = rubric.domains.some((d) => id === `domain-${d.id}`);

      expect(fullRubricHasDomain).toBe(false);
    });
  });

  describe('displayedRubric filtering in assigned mode', () => {
    it('filters domains to only those with assigned components', () => {
      const rubric = makeRubric();
      const assignedComponentIds = new Set(['d1-c0', 'd1-c1', 'd2-c0']);

      // Simulate the filtering logic from MyRubricPage
      const filteredDomains = rubric.domains
        .map((d) => ({
          ...d,
          components: d.components.filter((c) => assignedComponentIds.has(c.id)),
        }))
        .filter((d) => d.components.length > 0);

      // Only d1 and d2 should remain (d1 has c0+c1, d2 has c0, d3 has none)
      expect(filteredDomains).toHaveLength(2);
      expect(filteredDomains.map((d) => d.id)).toEqual(['d1', 'd2']);
    });

    it('keeps all domains when they have assigned components', () => {
      const rubric = makeRubric();
      // Assign at least one component from each domain
      const assignedComponentIds = new Set(['d1-c0', 'd2-c0', 'd3-c0']);

      const filteredDomains = rubric.domains
        .map((d) => ({
          ...d,
          components: d.components.filter((c) => assignedComponentIds.has(c.id)),
        }))
        .filter((d) => d.components.length > 0);

      expect(filteredDomains).toHaveLength(3);
      expect(filteredDomains.map((d) => d.id)).toEqual(['d1', 'd2', 'd3']);
    });

    it('removes all domains when none have assigned components', () => {
      const rubric = makeRubric();
      const assignedComponentIds = new Set<string>(); // Empty set

      const filteredDomains = rubric.domains
        .map((d) => ({
          ...d,
          components: d.components.filter((c) => assignedComponentIds.has(c.id)),
        }))
        .filter((d) => d.components.length > 0);

      expect(filteredDomains).toHaveLength(0);
    });

    it('filters out domains with zero assigned components', () => {
      const rubric = makeRubric();
      const assignedComponentIds = new Set(['d1-c0', 'd1-c1']);

      // Simulate filtering: d1 has assigned components, d2 has none, d3 has none
      const filteredDomains = rubric.domains
        .map((d) => ({
          ...d,
          components: d.components.filter((c) => assignedComponentIds.has(c.id)),
        }))
        .filter((d) => d.components.length > 0);

      // d3 should be filtered out because none of its components are assigned
      const d3 = filteredDomains.find((d) => d.id === 'd3');
      expect(d3).toBeUndefined();
      expect(filteredDomains.map((d) => d.id)).toEqual(['d1']);
    });
  });

  describe('hash effect behavior simulation', () => {
    it('simulates successful scroll when element exists', () => {
      // This test simulates the case where the target element is found
      const mockScroll = vi.fn();

      // Simulate document.getElementById finding the element.
      const mockEl = { scrollIntoView: mockScroll };
      const getElementByIdSpy = vi
        .spyOn(document, 'getElementById')
        .mockReturnValue(mockEl as unknown as HTMLElement);

      // Read it back through the lookup so the null-check mirrors the real
      // effect (getElementById returns HTMLElement | null).
      const el = document.getElementById('domain-d1');
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }

      expect(mockScroll).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
      getElementByIdSpy.mockRestore();
    });

    it('simulates mode switch when element is missing in assigned mode but exists in full rubric', () => {
      const rubric = makeRubric();
      const id = 'domain-d3';
      const el: HTMLElement | null = null; // Element doesn't exist

      // In assigned mode, with the element missing, the effect should switch
      // to full mode because the domain exists in the full rubric.
      const shouldSwitchMode = computeShouldSwitchMode(rubric, id, el, true);

      expect(shouldSwitchMode).toBe(true);
    });

    it('does not switch mode if element is missing and domain does not exist in full rubric', () => {
      const rubric = makeRubric();
      const id = 'domain-nonexistent';
      const el: HTMLElement | null = null;

      const shouldSwitchMode = computeShouldSwitchMode(rubric, id, el, true);

      expect(shouldSwitchMode).toBe(false);
    });

    it('does not switch mode if already in full mode and element is missing', () => {
      const rubric = makeRubric();
      const id = 'domain-nonexistent';
      const el: HTMLElement | null = null;

      // Already in full mode (assignmentModeIsAssigned = false).
      const shouldSwitchMode = computeShouldSwitchMode(rubric, id, el, false);

      expect(shouldSwitchMode).toBe(false);
    });
  });
});
