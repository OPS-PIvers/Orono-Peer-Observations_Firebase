import {
  DEFAULT_EMAIL_PREFERENCES,
  type DashboardStep,
  type Observation,
  type Staff,
} from '@ops/shared';
import { deriveCheckpoints, type CheckpointWithStatus } from '@/dashboard/deriveCheckpoints';
import type { DeriveContext } from '@/dashboard/dashboardEvents';
import type { ModuleChip } from '@/dashboard/DashboardView';

/**
 * Synthesized "representative mid-cycle staff member" used by the admin
 * preview. The preview runs the REAL interpreter against this fixed context
 * so any step config (built-in or custom) renders exactly as staff would see
 * it. The sample exercises every watched kind and a spread of states.
 */

const PREVIEW_NOW = new Date('2026-03-15T00:00:00Z');
const PAST = new Date('2026-02-10T00:00:00Z');
const SOON = new Date('2026-03-20T00:00:00Z');
/** Within the urgency threshold so the preview shows the "closes soon"
 *  styling on the booking checkpoint by default. */
const BOOKING_CLOSES_SOON = new Date('2026-03-17T00:00:00Z');

export const SAMPLE_STAFF: Staff = {
  email: 'jane.doe@orono.k12.mn.us',
  name: 'Jane Doe',
  role: 'teacher',
  year: 2,
  buildings: ['High School'],
  modules: ['mentor'],
  summativeYear: false,
  isActive: true,
  hasAdminAccess: false,
  emailPreferences: DEFAULT_EMAIL_PREFERENCES,
  createdAt: new Date(),
  updatedAt: new Date(),
};

export const SAMPLE_FIRST_NAME = 'Jane';
export const SAMPLE_YEAR_TIER_LABEL = 'Year 2';
export const SAMPLE_ROLE_DISPLAY_NAME = 'Teacher';
export const SAMPLE_BUILDING_NAMES = ['High School'];
export const SAMPLE_MODULE_CHIPS: ModuleChip[] = [
  { moduleId: 'mentor', displayName: 'Mentor', color: 'indigo' },
];

export const SAMPLE_PEER_EVALUATOR = {
  name: 'Sam Lee',
  email: 'sam.lee@orono.k12.mn.us',
  role: 'Peer Evaluator',
};

function sampleObs(partial: Partial<Observation>): Observation {
  return {
    observationId: 'sample-obs',
    status: 'Draft',
    createdAt: PAST,
    lastModifiedAt: PAST,
    finalizedAt: null,
    acknowledgedAt: null,
    ...partial,
  } as unknown as Observation;
}

/** Mid-cycle: pre-obs already happened, observation coming up, a partially
 *  answered work-product draft, and an active instructional round. */
const SAMPLE_CONTEXT: DeriveContext = {
  finalizedStandard: [],
  standardDraft: sampleObs({
    observationId: 'sample-standard',
    preObsDate: PAST,
    observationDate: SOON,
  }),
  workProductDraft: sampleObs({
    observationId: 'sample-wp',
    workProductAnswers: [
      { answer: 'done' },
      { answer: 'done' },
      { answer: 'done' },
      { answer: '' },
      { answer: '' },
    ] as unknown as Observation['workProductAnswers'],
  }),
  instructionalRoundDraft: sampleObs({ observationId: 'sample-ir' }),
  finalizedWorkProduct: null,
  finalizedInstructionalRound: null,
  workProductQuestionsCount: 5,
  instructionalRoundQuestionsCount: 5,
  appSettings: { signupLink: 'https://example.com/signup' } as never,
  openBooking: {
    windowId: 'sample-window',
    token: 'sample-token',
    endDate: BOOKING_CLOSES_SOON,
  },
  hasBookedSlot: false,
  hasWorkProduct: true,
  hasInstructionalRound: true,
};

export function buildSampleCheckpoints(steps: DashboardStep[]): CheckpointWithStatus[] {
  return deriveCheckpoints(steps, SAMPLE_CONTEXT, PREVIEW_NOW);
}
