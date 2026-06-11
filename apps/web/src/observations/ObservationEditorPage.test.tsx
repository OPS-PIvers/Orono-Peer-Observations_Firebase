/**
 * ObservationEditorPage — admin edit & finalize authorization tests, plus
 * pre-finalize completeness derivation tests.
 *
 * Tests that admins can edit and finalize observations they didn't create,
 * with the 'editing as admin' banner shown when applicable.
 *
 * Tests that computeCompleteness correctly summarizes rubric + WP/IR answer
 * completeness so the FinalizeDialog can surface incomplete-observation warnings.
 */
import { describe, expect, it, vi } from 'vitest';
import { OBSERVATION_STATUS, OBSERVATION_TYPES } from '@ops/shared';

// ─── Module-level mocks so ObservationEditorPage.tsx can be imported ─────────
// The page has top-level Firebase calls (httpsCallable) — mock the SDK
// modules before the import so they don't throw in the test environment.

vi.mock('@/lib/firebase', () => ({
  db: {},
  functions: {},
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: () => vi.fn(),
  getFunctions: () => ({}),
  connectFunctionsEmulator: () => undefined,
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  setDoc: vi.fn(),
  serverTimestamp: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  collection: vi.fn(),
  query: vi.fn(),
  getFirestore: vi.fn(),
  connectFirestoreEmulator: vi.fn(),
}));

vi.mock('@/hooks/useFirestoreDoc', () => ({
  useFirestoreDoc: () => ({ data: null, loading: false, error: null }),
}));

vi.mock('@/hooks/useFirestoreCollection', () => ({
  useFirestoreCollection: () => ({ data: [], loading: false, error: null }),
}));

vi.mock('@/hooks/useHydratedDraft', () => ({
  useHydratedDraft: () => undefined,
}));

vi.mock('@/hooks/useSidebarWidth', () => ({
  useSidebarWidth: () => 0,
}));

vi.mock('@/hooks/usePublishChromeHeight', () => ({
  usePublishChromeHeight: () => undefined,
}));

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: { email: 'pe@orono.k12.mn.us' },
    claims: { isAdmin: false },
  }),
}));

vi.mock('react-router-dom', async (importOriginal: () => Promise<Record<string, unknown>>) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useParams: () => ({ observationId: 'obs-1' }),
    useNavigate: () => vi.fn(),
  };
});

// Import computeCompleteness AFTER mocks are registered.
import { computeCompleteness } from './ObservationEditorPage';

// ─── Permission logic tests (no mocking required) ───────────────────────────

/**
 * Replicate the ObservationEditorPage's permission logic in isolation
 * so we can unit test the authorization rules.
 */
interface PermissionContext {
  observation: { status: string; observerEmail: string } | null;
  userEmail: string | null;
  isAdmin: boolean;
}

function computePermissions(ctx: PermissionContext) {
  if (!ctx.observation || !ctx.userEmail) {
    return {
      isReadOnly: false,
      isObserver: false,
      canEdit: false,
      showFinalize: false,
      editingAsAdmin: false,
    };
  }

  const isReadOnly = ctx.observation.status === OBSERVATION_STATUS.finalized;
  const isObserver = ctx.observation.observerEmail === ctx.userEmail.toLowerCase();
  const canEdit = !isReadOnly && (isObserver || ctx.isAdmin);
  const showFinalize = canEdit && ctx.observation.status === OBSERVATION_STATUS.draft;
  const editingAsAdmin = ctx.isAdmin && !isObserver;

  return { isReadOnly, isObserver, canEdit, showFinalize, editingAsAdmin };
}

describe('ObservationEditorPage permissions', () => {
  describe('Draft observations', () => {
    it('allows the observer to edit and finalize', () => {
      const ctx = {
        observation: { status: OBSERVATION_STATUS.draft, observerEmail: 'pe@orono.k12.mn.us' },
        userEmail: 'pe@orono.k12.mn.us',
        isAdmin: false,
      };
      const perms = computePermissions(ctx);
      expect(perms.canEdit).toBe(true);
      expect(perms.showFinalize).toBe(true);
      expect(perms.editingAsAdmin).toBe(false);
    });

    it('allows admin to edit and finalize even if not the observer', () => {
      const ctx = {
        observation: {
          status: OBSERVATION_STATUS.draft,
          observerEmail: 'other-pe@orono.k12.mn.us',
        },
        userEmail: 'admin@orono.k12.mn.us',
        isAdmin: true,
      };
      const perms = computePermissions(ctx);
      expect(perms.canEdit).toBe(true);
      expect(perms.showFinalize).toBe(true);
      expect(perms.editingAsAdmin).toBe(true);
    });

    it('prevents non-observer non-admin from editing', () => {
      const ctx = {
        observation: {
          status: OBSERVATION_STATUS.draft,
          observerEmail: 'other-pe@orono.k12.mn.us',
        },
        userEmail: 'pe@orono.k12.mn.us',
        isAdmin: false,
      };
      const perms = computePermissions(ctx);
      expect(perms.canEdit).toBe(false);
      expect(perms.showFinalize).toBe(false);
      expect(perms.editingAsAdmin).toBe(false);
    });

    it('shows admin banner when admin edits as non-observer', () => {
      const ctx = {
        observation: {
          status: OBSERVATION_STATUS.draft,
          observerEmail: 'other-pe@orono.k12.mn.us',
        },
        userEmail: 'admin@orono.k12.mn.us',
        isAdmin: true,
      };
      const perms = computePermissions(ctx);
      expect(perms.editingAsAdmin).toBe(true);
    });

    it('does not show admin banner when admin is also the observer', () => {
      const ctx = {
        observation: { status: OBSERVATION_STATUS.draft, observerEmail: 'admin@orono.k12.mn.us' },
        userEmail: 'admin@orono.k12.mn.us',
        isAdmin: true,
      };
      const perms = computePermissions(ctx);
      expect(perms.editingAsAdmin).toBe(false);
    });
  });

  describe('Finalized observations', () => {
    it('prevents observer from editing when finalized', () => {
      const ctx = {
        observation: { status: OBSERVATION_STATUS.finalized, observerEmail: 'pe@orono.k12.mn.us' },
        userEmail: 'pe@orono.k12.mn.us',
        isAdmin: false,
      };
      const perms = computePermissions(ctx);
      expect(perms.isReadOnly).toBe(true);
      expect(perms.canEdit).toBe(false);
      expect(perms.showFinalize).toBe(false);
    });

    it('prevents admin from editing when finalized (no UI edit button)', () => {
      const ctx = {
        observation: {
          status: OBSERVATION_STATUS.finalized,
          observerEmail: 'other-pe@orono.k12.mn.us',
        },
        userEmail: 'admin@orono.k12.mn.us',
        isAdmin: true,
      };
      const perms = computePermissions(ctx);
      // Finalized observations are read-only; admins cannot edit them in the UI
      // (they can only delete via staff person page)
      expect(perms.isReadOnly).toBe(true);
      expect(perms.canEdit).toBe(false);
      expect(perms.showFinalize).toBe(false);
    });
  });

  describe('Email case normalization', () => {
    it('handles uppercase email when checking observer', () => {
      const ctx = {
        observation: { status: OBSERVATION_STATUS.draft, observerEmail: 'pe@orono.k12.mn.us' },
        userEmail: 'PE@ORONO.K12.MN.US', // uppercase input from Firebase Auth
        isAdmin: false,
      };
      const perms = computePermissions(ctx);
      expect(perms.isObserver).toBe(true);
      expect(perms.canEdit).toBe(true);
    });
  });
});

// ─── computeCompleteness tests ───────────────────────────────────────────────

describe('computeCompleteness', () => {
  const componentA = 'comp-a';
  const componentB = 'comp-b';
  const componentC = 'comp-c';
  const assignedIds = new Set([componentA, componentB, componentC]);

  describe('Standard observation', () => {
    it('reports 0 of N scored when observationData is empty', () => {
      const result = computeCompleteness({}, assignedIds, OBSERVATION_TYPES.standard, undefined);
      expect(result.scoredCount).toBe(0);
      expect(result.totalAssigned).toBe(3);
      expect(result.allScored).toBe(false);
      expect(result.isWpOrIr).toBe(false);
      expect(result.noAnswers).toBe(false);
    });

    it('reports all scored when every assigned component has a non-null proficiency', () => {
      const observationData = {
        [componentA]: {
          proficiency: 'proficient' as const,
          selectedLookForIds: [],
          scratchNotes: '',
        },
        [componentB]: { proficiency: 'basic' as const, selectedLookForIds: [], scratchNotes: '' },
        [componentC]: {
          proficiency: 'distinguished' as const,
          selectedLookForIds: [],
          scratchNotes: '',
        },
      };
      const result = computeCompleteness(
        observationData,
        assignedIds,
        OBSERVATION_TYPES.standard,
        undefined,
      );
      expect(result.scoredCount).toBe(3);
      expect(result.allScored).toBe(true);
    });

    it('only counts assigned components, not unassigned ones', () => {
      // comp-d is scored but not assigned — should not inflate scoredCount.
      const observationData = {
        [componentA]: {
          proficiency: 'proficient' as const,
          selectedLookForIds: [],
          scratchNotes: '',
        },
        'comp-d': { proficiency: 'basic' as const, selectedLookForIds: [], scratchNotes: '' },
      };
      const result = computeCompleteness(
        observationData,
        assignedIds,
        OBSERVATION_TYPES.standard,
        undefined,
      );
      expect(result.scoredCount).toBe(1);
      expect(result.totalAssigned).toBe(3);
    });

    it('treats null proficiency as unscored', () => {
      const observationData = {
        [componentA]: { proficiency: null, selectedLookForIds: [], scratchNotes: '' },
      };
      const result = computeCompleteness(
        observationData,
        assignedIds,
        OBSERVATION_TYPES.standard,
        undefined,
      );
      expect(result.scoredCount).toBe(0);
    });

    it('returns allScored=false and totalAssigned=0 when assignedIds is empty', () => {
      const result = computeCompleteness({}, new Set(), OBSERVATION_TYPES.standard, undefined);
      expect(result.totalAssigned).toBe(0);
      expect(result.allScored).toBe(false);
    });
  });

  describe('Work Product observation', () => {
    it('marks isWpOrIr=true', () => {
      const result = computeCompleteness({}, assignedIds, OBSERVATION_TYPES.workProduct, undefined);
      expect(result.isWpOrIr).toBe(true);
    });

    it('reports noAnswers=true when workProductAnswers is empty/undefined', () => {
      const result = computeCompleteness({}, assignedIds, OBSERVATION_TYPES.workProduct, []);
      expect(result.noAnswers).toBe(true);
      expect(result.wpAnswerCount).toBe(0);
    });

    it('reports noAnswers=true when all answers are blank strings', () => {
      const answers = [
        { questionId: 'q1', answer: '   ', updatedAt: new Date() },
        { questionId: 'q2', answer: '', updatedAt: new Date() },
      ];
      const result = computeCompleteness({}, assignedIds, OBSERVATION_TYPES.workProduct, answers);
      expect(result.noAnswers).toBe(true);
      expect(result.wpAnswerCount).toBe(0);
    });

    it('counts only non-empty answers', () => {
      const answers = [
        { questionId: 'q1', answer: 'Some answer', updatedAt: new Date() },
        { questionId: 'q2', answer: '', updatedAt: new Date() },
        { questionId: 'q3', answer: 'Another answer', updatedAt: new Date() },
      ];
      const result = computeCompleteness({}, assignedIds, OBSERVATION_TYPES.workProduct, answers);
      expect(result.wpAnswerCount).toBe(2);
      expect(result.noAnswers).toBe(false);
    });
  });

  describe('Instructional Round observation', () => {
    it('marks isWpOrIr=true', () => {
      const result = computeCompleteness(
        {},
        assignedIds,
        OBSERVATION_TYPES.instructionalRound,
        undefined,
      );
      expect(result.isWpOrIr).toBe(true);
      expect(result.noAnswers).toBe(true);
    });

    it('counts non-empty IR answers', () => {
      const answers = [{ questionId: 'q1', answer: 'Response here', updatedAt: new Date() }];
      const result = computeCompleteness(
        {},
        assignedIds,
        OBSERVATION_TYPES.instructionalRound,
        answers,
      );
      expect(result.wpAnswerCount).toBe(1);
      expect(result.noAnswers).toBe(false);
    });
  });
});
