import type { CheckpointTypeKey, DashboardSectionsConfig } from '@ops/shared';

/**
 * Single source for every human-facing string on the admin Dashboard
 * page. Edit here, not in component bodies. Anything technical (e.g.
 * "observation.preObsDate") stays out of this file — these are the
 * sentences a peer evaluator or teacher would read.
 */

export const PAGE_TITLE = 'Dashboard';
export const PAGE_SUBTITLE =
  'Decide what staff see when they sign in. Toggle pieces on or off, drag steps into order, and post a few helpful links — staff dates and progress come from the system automatically.';

export const SAVE_BUTTON_DEFAULT = 'Saved';
export const SAVE_BUTTON_DIRTY = 'Save changes';
export const SAVE_BUTTON_SAVING = 'Saving…';
export const UNSAVED_PILL = 'Unsaved changes';

export const TABS = {
  layout: 'Layout',
  steps: 'Cycle steps',
  materials: 'Quick materials',
} as const;

export type TabKey = keyof typeof TABS;

// ── Section tiles ───────────────────────────────────────────────────────────

interface SectionCopy {
  title: string;
  description: string;
}

export const SECTION_COPY: Record<keyof DashboardSectionsConfig, SectionCopy> = {
  hero: {
    title: 'Welcome banner',
    description: "Big greeting, progress ring, and the staff member's year/tier.",
  },
  roleChip: {
    title: 'Role + module chips',
    description:
      "Compact chip row under the greeting showing the staff member's role, building(s), and any modules they're part of.",
  },
  progressSummary: {
    title: 'Progress summary line',
    description:
      'Plain-English sentence in the welcome banner: "X of Y checkpoints done. Next up: …".',
  },
  timeline: {
    title: 'Year-at-a-glance bar',
    description: 'Horizontal track from fall to spring showing where they are in the cycle.',
  },
  filterBar: {
    title: 'Filter chips',
    description: 'Quick tabs: All · Active now · Upcoming · Completed.',
  },
  quickMaterials: {
    title: 'Side panel — Quick materials',
    description: 'Right-hand column of evergreen links you set up below.',
  },
  peerEvaluatorCard: {
    title: 'Side panel — Peer evaluator card',
    description: "Contact card for the staff member's assigned peer evaluator.",
  },
};

// ── Cycle steps (checkpoints) ───────────────────────────────────────────────

interface CheckpointCopy {
  phase: 'Schedule' | 'Visit' | 'Reflect' | 'Sign-off';
  title: string;
  whenItShows: string;
  whatItDoes: string;
}

export const CHECKPOINT_COPY: Record<CheckpointTypeKey, CheckpointCopy> = {
  signup: {
    phase: 'Schedule',
    title: 'Sign up for an observation window',
    whenItShows: 'Always shown until staff have a peer-evaluator-created observation.',
    whatItDoes:
      "Links to the scheduling form you set under Settings → Sign-up link. Marks done once a peer evaluator creates the staff member's observation.",
  },
  preObs: {
    phase: 'Schedule',
    title: 'Pre-observation conversation',
    whenItShows: 'Appears once the observation is finalized.',
    whatItDoes:
      'Shows the meeting date staff had with their peer evaluator before the observation.',
  },
  workProduct: {
    phase: 'Schedule',
    title: 'Work-product responses',
    whenItShows: 'Only when the staff member has an active Work Product observation.',
    whatItDoes:
      'Progress bar showing how many of the work-product questions the staff member has answered.',
  },
  observation: {
    phase: 'Visit',
    title: 'Classroom observation',
    whenItShows: 'Appears once the observation is finalized.',
    whatItDoes: 'Shows the date the peer evaluator visited the classroom.',
  },
  instructionalRound: {
    phase: 'Visit',
    title: 'Instructional round',
    whenItShows: 'Only when the staff member has an active Instructional Round.',
    whatItDoes: 'Progress bar tied to the instructional-round response form.',
  },
  reviewDraft: {
    phase: 'Reflect',
    title: 'Review the draft observation',
    whenItShows: 'While a Work Product or Instructional Round draft is open.',
    whatItDoes: 'Lets staff jump into the in-progress observation to read and comment.',
  },
  postObs: {
    phase: 'Reflect',
    title: 'Post-observation conversation',
    whenItShows: 'Appears once the observation is finalized.',
    whatItDoes: 'Shows the meeting date staff had with their peer evaluator after the observation.',
  },
  acknowledge: {
    phase: 'Sign-off',
    title: 'Acknowledge the finalized observation',
    whenItShows: 'Once the observation is finalized.',
    whatItDoes: 'Adds an Acknowledge button staff click to sign off on their record.',
  },
};

export const PHASE_ORDER = ['Schedule', 'Visit', 'Reflect', 'Sign-off'] as const;
export type PhaseKey = (typeof PHASE_ORDER)[number];

export const PHASE_DESCRIPTION: Record<PhaseKey, string> = {
  Schedule: 'Before the observation.',
  Visit: 'The observation itself.',
  Reflect: 'Right after the visit.',
  'Sign-off': 'Closing out the cycle.',
};

// ── Quick materials editor ──────────────────────────────────────────────────

export const QM_HEADING = 'Quick materials sidebar';
export const QM_BLURB =
  'Evergreen links shown in the right side panel of every staff dashboard — paste in a Drive share URL, your rubric link, the district handbook, etc. Drag a card to reorder.';
export const QM_EMPTY = "No materials yet. Use 'Add link' to create the first one.";
export const QM_ADD = 'Add link';
export const QM_FIELD_TITLE = 'Title';
export const QM_FIELD_SUBTITLE = 'Subtitle (optional)';
export const QM_FIELD_URL = 'URL';
export const QM_ICON_PICKER = 'Icon';
export const QM_REMOVE = 'Remove material';

// ── Cycle step editor row ───────────────────────────────────────────────────

export const CS_SHOW_LABEL = 'Show this step to staff';
export const CS_CUSTOMIZE_TOGGLE = 'Rename';
export const CS_CUSTOMIZE_HIDE = 'Hide rename';
export const CS_LABEL_CHIP = 'Chip text';
export const CS_LABEL_TITLE = 'Card title';
export const CS_LABEL_CTA = 'Button text';
export const CS_PLACEHOLDER_DEFAULT = '(use default)';

// ── Section tiles ───────────────────────────────────────────────────────────

export const ST_HEADING = 'Page layout';
export const ST_BLURB =
  'Pick which pieces of the staff dashboard render. Click a tile to switch it on or off.';
export const ST_ON = 'On';
export const ST_OFF = 'Off';

// ── Cycle steps section ─────────────────────────────────────────────────────

export const CS_HEADING = 'Cycle steps';
export const CS_BLURB =
  'Each step shows up only when it applies to a staff member — work-product appears only if they have an active work-product observation, and so on. Toggle a step off to hide it for everyone. Drag to reorder within the list.';
