import { describe, it, expect } from 'vitest';
import {
  dashboardQuickMaterial,
  dashboardStep,
  type DashboardQuickMaterial,
  type DashboardStep,
} from '@ops/shared';

/**
 * Validation functions exported for testing.
 * These mirror the validation logic in useDashboardDraft.ts.
 */

function validateSteps(steps: DashboardStep[]): { itemIndex: number; message: string }[] {
  const errors: { itemIndex: number; message: string }[] = [];
  steps.forEach((step, idx) => {
    const result = dashboardStep.safeParse(step);
    if (!result.success) {
      const messages = result.error.issues
        .map((issue: { message: string }) => issue.message)
        .join('; ');
      errors.push({
        itemIndex: idx,
        message: messages,
      });
    }
  });
  return errors;
}

function validateQuickMaterials(
  items: DashboardQuickMaterial[],
): { itemIndex: number; message: string }[] {
  const errors: { itemIndex: number; message: string }[] = [];
  items.forEach((item, idx) => {
    const result = dashboardQuickMaterial.safeParse(item);
    if (!result.success) {
      const messages = result.error.issues
        .map((issue: { message: string }) => issue.message)
        .join('; ');
      errors.push({
        itemIndex: idx,
        message: messages,
      });
    }
  });
  return errors;
}

describe('useDashboardDraft validation', () => {
  describe('validateQuickMaterials', () => {
    it('passes valid quick materials', () => {
      const items: DashboardQuickMaterial[] = [
        {
          label: 'My Rubric',
          sub: 'Domains 2 & 3',
          icon: 'doc',
          url: 'https://drive.google.com/...',
        },
        {
          label: 'Handbook',
          sub: '',
          icon: 'folder',
          url: 'https://handbook.example.com',
        },
      ];
      const errors = validateQuickMaterials(items);
      expect(errors).toHaveLength(0);
    });

    it('rejects empty label', () => {
      const items: DashboardQuickMaterial[] = [
        {
          label: '',
          sub: 'Subtitle',
          icon: 'doc',
          url: 'https://example.com',
        },
      ];
      const errors = validateQuickMaterials(items);
      expect(errors).toHaveLength(1);
      expect(errors[0]?.itemIndex).toBe(0);
      expect(errors[0]?.message).toContain('Too small');
    });

    it('rejects label exceeding max length', () => {
      const items: DashboardQuickMaterial[] = [
        {
          label: 'a'.repeat(121),
          sub: '',
          icon: 'doc',
          url: '',
        },
      ];
      const errors = validateQuickMaterials(items);
      expect(errors).toHaveLength(1);
      expect(errors[0]?.itemIndex).toBe(0);
    });

    it('rejects subtitle exceeding max length', () => {
      const items: DashboardQuickMaterial[] = [
        {
          label: 'Valid',
          sub: 'a'.repeat(201),
          icon: 'doc',
          url: '',
        },
      ];
      const errors = validateQuickMaterials(items);
      expect(errors).toHaveLength(1);
      expect(errors[0]?.itemIndex).toBe(0);
    });

    it('rejects url exceeding max length', () => {
      const items: DashboardQuickMaterial[] = [
        {
          label: 'Valid',
          sub: '',
          icon: 'doc',
          url: 'a'.repeat(2049),
        },
      ];
      const errors = validateQuickMaterials(items);
      expect(errors).toHaveLength(1);
      expect(errors[0]?.itemIndex).toBe(0);
    });

    it('maps multiple errors to correct items', () => {
      const items: DashboardQuickMaterial[] = [
        {
          label: '',
          sub: '',
          icon: 'doc',
          url: '',
        },
        {
          label: 'Valid Item',
          sub: '',
          icon: 'doc',
          url: '',
        },
        {
          label: 'a'.repeat(121),
          sub: '',
          icon: 'doc',
          url: '',
        },
      ];
      const errors = validateQuickMaterials(items);
      expect(errors.length).toBeGreaterThan(0);
      const errorIndices = errors.map((e) => e.itemIndex);
      expect(errorIndices).toContain(0);
      expect(errorIndices).toContain(2);
    });
  });

  describe('validateSteps', () => {
    it('passes valid steps', () => {
      const steps: DashboardStep[] = [
        {
          id: 'step1',
          enabled: true,
          order: 0,
          watchedKind: 'standard',
          chipStyle: 'form',
          chipLabel: 'Step 1',
          title: 'Step Title',
          description: 'Description',
          buttonLabel: 'Button',
          showWhen: 'always',
          doneWhen: 'never',
          dateFrom: 'none',
          inProgress: 'none',
          hideWhenDone: false,
          buttonTarget: 'observation',
          buttonUrl: '',
        },
      ];
      const errors = validateSteps(steps);
      expect(errors).toHaveLength(0);
    });

    it('rejects step with empty id', () => {
      const steps: DashboardStep[] = [
        {
          id: '',
          enabled: true,
          order: 0,
          watchedKind: 'standard',
          chipStyle: 'form',
          chipLabel: 'Step',
          title: 'Title',
          description: '',
          buttonLabel: '',
          showWhen: 'always',
          doneWhen: 'never',
          dateFrom: 'none',
          inProgress: 'none',
          hideWhenDone: false,
          buttonTarget: 'observation',
          buttonUrl: '',
        },
      ];
      const errors = validateSteps(steps);
      expect(errors).toHaveLength(1);
      expect(errors[0]?.itemIndex).toBe(0);
    });

    it('rejects title exceeding max length', () => {
      const steps: DashboardStep[] = [
        {
          id: 'step1',
          enabled: true,
          order: 0,
          watchedKind: 'standard',
          chipStyle: 'form',
          chipLabel: 'Step',
          title: 'a'.repeat(161),
          description: '',
          buttonLabel: '',
          showWhen: 'always',
          doneWhen: 'never',
          dateFrom: 'none',
          inProgress: 'none',
          hideWhenDone: false,
          buttonTarget: 'observation',
          buttonUrl: '',
        },
      ];
      const errors = validateSteps(steps);
      expect(errors).toHaveLength(1);
      expect(errors[0]?.itemIndex).toBe(0);
    });

    it('rejects description exceeding max length', () => {
      const steps: DashboardStep[] = [
        {
          id: 'step1',
          enabled: true,
          order: 0,
          watchedKind: 'standard',
          chipStyle: 'form',
          chipLabel: 'Step',
          title: 'Title',
          description: 'a'.repeat(401),
          buttonLabel: '',
          showWhen: 'always',
          doneWhen: 'never',
          dateFrom: 'none',
          inProgress: 'none',
          hideWhenDone: false,
          buttonTarget: 'observation',
          buttonUrl: '',
        },
      ];
      const errors = validateSteps(steps);
      expect(errors).toHaveLength(1);
      expect(errors[0]?.itemIndex).toBe(0);
    });

    it('rejects buttonUrl exceeding max length', () => {
      const steps: DashboardStep[] = [
        {
          id: 'step1',
          enabled: true,
          order: 0,
          watchedKind: 'standard',
          chipStyle: 'form',
          chipLabel: 'Step',
          title: 'Title',
          description: '',
          buttonLabel: '',
          showWhen: 'always',
          doneWhen: 'never',
          dateFrom: 'none',
          inProgress: 'none',
          hideWhenDone: false,
          buttonTarget: 'fixedUrl',
          buttonUrl: 'a'.repeat(2049),
        },
      ];
      const errors = validateSteps(steps);
      expect(errors).toHaveLength(1);
      expect(errors[0]?.itemIndex).toBe(0);
    });

    it('maps multiple errors to correct step indices', () => {
      const steps: DashboardStep[] = [
        {
          id: '',
          enabled: true,
          order: 0,
          watchedKind: 'standard',
          chipStyle: 'form',
          chipLabel: 'Step',
          title: 'Title',
          description: '',
          buttonLabel: '',
          showWhen: 'always',
          doneWhen: 'never',
          dateFrom: 'none',
          inProgress: 'none',
          hideWhenDone: false,
          buttonTarget: 'observation',
          buttonUrl: '',
        },
        {
          id: 'step2',
          enabled: true,
          order: 1,
          watchedKind: 'standard',
          chipStyle: 'form',
          chipLabel: 'Step',
          title: 'Title',
          description: '',
          buttonLabel: '',
          showWhen: 'always',
          doneWhen: 'never',
          dateFrom: 'none',
          inProgress: 'none',
          hideWhenDone: false,
          buttonTarget: 'observation',
          buttonUrl: '',
        },
        {
          id: 'step3',
          enabled: true,
          order: 2,
          watchedKind: 'standard',
          chipStyle: 'form',
          chipLabel: 'Step',
          title: 'a'.repeat(161),
          description: '',
          buttonLabel: '',
          showWhen: 'always',
          doneWhen: 'never',
          dateFrom: 'none',
          inProgress: 'none',
          hideWhenDone: false,
          buttonTarget: 'observation',
          buttonUrl: '',
        },
      ];
      const errors = validateSteps(steps);
      expect(errors.length).toBeGreaterThan(0);
      const errorIndices = errors.map((e) => e.itemIndex);
      expect(errorIndices).toContain(0);
      expect(errorIndices).toContain(2);
    });
  });
});
