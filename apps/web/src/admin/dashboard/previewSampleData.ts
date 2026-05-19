import type { CheckpointWithStatus } from '@/dashboard/deriveCheckpoints';
import type { DashboardCheckpointsConfig, Staff } from '@ops/shared';
import { CHECKPOINT_TYPE_KEYS, type CheckpointTypeKey } from '@ops/shared';
import type { ModuleChip } from '@/dashboard/DashboardView';

/**
 * Synthesized "representative mid-cycle staff member" the admin preview
 * uses. Choosing fake data over the admin's real data means the preview
 * always shows what a typical user sees throughout the year — not just
 * "Sign up for an observation" because the current admin doesn't happen
 * to have any active observations of their own.
 *
 * One sample per checkpoint type so toggling any cycle-steps card in the
 * editor produces a visible change in the preview.
 */

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

interface CheckpointFixture extends Omit<CheckpointWithStatus, 'key'> {
  key: CheckpointTypeKey;
}

const SAMPLE_FIXTURES: Record<CheckpointTypeKey, CheckpointFixture> = {
  signup: {
    id: 'sample-signup',
    key: 'signup',
    type: 'meeting',
    typeLabel: 'Scheduling',
    title: 'Sign up for an observation window',
    desc: 'Pick a window that works for your class. Your peer evaluator confirms within 2 school days.',
    monthLabel: '',
    dateLabel: 'Scheduled',
    dueRelative: '',
    cta: 'Choose a window',
    ctaUrl: '#',
    status: 'done',
    completedLabel: 'Scheduled',
    percent: null,
    percentLabel: '',
  },
  preObs: {
    id: 'sample-preObs',
    key: 'preObs',
    type: 'meeting',
    typeLabel: 'Meeting',
    title: 'Pre-observation conversation',
    desc: '20-minute conversation with your peer evaluator. Lesson plan, focus components, context.',
    monthLabel: 'Oct',
    dateLabel: 'Oct 14',
    dueRelative: '',
    cta: 'View meeting',
    ctaUrl: '#',
    status: 'done',
    completedLabel: 'Oct 14',
    percent: null,
    percentLabel: '',
  },
  workProduct: {
    id: 'sample-workProduct',
    key: 'workProduct',
    type: 'form',
    typeLabel: 'Evidence',
    title: 'Submit work-product responses',
    desc: 'Short prompts about your planning, family communication, and growth. Save and resume any time.',
    monthLabel: '',
    dateLabel: 'In progress',
    dueRelative: '',
    cta: 'Continue answering',
    ctaUrl: '#',
    status: 'inprogress',
    completedLabel: null,
    percent: 60,
    percentLabel: '3 of 5 answered',
  },
  observation: {
    id: 'sample-observation',
    key: 'observation',
    type: 'observation',
    typeLabel: 'Observation',
    title: 'Classroom observation',
    desc: 'Your peer evaluator joins your room during the window you selected.',
    monthLabel: 'Oct',
    dateLabel: 'Oct 21',
    dueRelative: 'Next week',
    cta: 'View details',
    ctaUrl: '#',
    status: 'soon',
    completedLabel: null,
    percent: null,
    percentLabel: '',
  },
  reviewDraft: {
    id: 'sample-reviewDraft',
    key: 'reviewDraft',
    type: 'review',
    typeLabel: 'Review',
    title: 'Review the draft observation',
    desc: 'Your peer evaluator is drafting your observation. You can view and comment now.',
    monthLabel: 'Oct',
    dateLabel: 'Updated Oct 22',
    dueRelative: '',
    cta: 'Open draft',
    ctaUrl: '#',
    status: 'soon',
    completedLabel: null,
    percent: null,
    percentLabel: '',
  },
  postObs: {
    id: 'sample-postObs',
    key: 'postObs',
    type: 'meeting',
    typeLabel: 'Meeting',
    title: 'Post-observation conversation',
    desc: '30 minutes to talk through proficiency ratings and where to focus next.',
    monthLabel: 'Oct',
    dateLabel: 'Oct 28',
    dueRelative: 'In 2 weeks',
    cta: 'View meeting',
    ctaUrl: '#',
    status: 'upcoming',
    completedLabel: null,
    percent: null,
    percentLabel: '',
  },
  acknowledge: {
    id: 'sample-acknowledge',
    key: 'acknowledge',
    type: 'review',
    typeLabel: 'Sign-off',
    title: 'Acknowledge the finalized observation',
    desc: 'Acknowledging stores your sign-off on the finalized observation record.',
    monthLabel: 'Nov',
    dateLabel: 'Nov 4',
    dueRelative: 'Action required',
    cta: 'Acknowledge',
    ctaUrl: '',
    status: 'soon',
    completedLabel: null,
    percent: null,
    percentLabel: '',
  },
  instructionalRound: {
    id: 'sample-instructionalRound',
    key: 'instructionalRound',
    type: 'observation',
    typeLabel: 'Round',
    title: 'Instructional Round',
    desc: 'Reflective responses for this instructional round.',
    monthLabel: 'Feb',
    dateLabel: 'Feb 12',
    dueRelative: '',
    cta: 'View details',
    ctaUrl: '#',
    status: 'upcoming',
    completedLabel: null,
    percent: null,
    percentLabel: '',
  },
};

function pickOverride(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

/**
 * Build the sample checkpoint list, honouring the same enabled / order /
 * label-override semantics as the real `deriveCheckpoints`. That way every
 * tweak the admin makes in the Cycle-Steps tab shows up in the preview.
 */
export function buildSampleCheckpoints(cfg: DashboardCheckpointsConfig): CheckpointWithStatus[] {
  return CHECKPOINT_TYPE_KEYS.map((key) => {
    const typeCfg = cfg[key];
    return {
      key,
      enabled: typeCfg?.enabled ?? true,
      order: typeCfg?.order ?? SAMPLE_FIXTURES[key].id.length, // stable fallback
      typeCfg,
    };
  })
    .filter((e) => e.enabled)
    .sort((a, b) => a.order - b.order)
    .map(({ key, typeCfg }) => {
      const fx = SAMPLE_FIXTURES[key];
      return {
        ...fx,
        typeLabel: pickOverride(typeCfg?.typeLabelOverride, fx.typeLabel),
        title: pickOverride(typeCfg?.titleOverride, fx.title),
        cta: pickOverride(typeCfg?.ctaLabelOverride, fx.cta),
      };
    });
}
