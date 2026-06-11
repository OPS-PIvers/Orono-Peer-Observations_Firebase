import type { DashboardSectionsConfig } from '@ops/shared';

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
  statBar: {
    title: 'Stat row',
    description:
      'Year/tier, completed count, and cycle-close date shown as stat tiles in the welcome banner.',
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

// ── Cycle close date ────────────────────────────────────────────────────────

export const CYCLE_DATE_HEADING = 'Cycle close date';
export const CYCLE_DATE_BLURB =
  "The deadline shown in every staff member's welcome banner stat row. Defaults to May 15 — change it here if your district uses a different date.";

// ── Section tiles ───────────────────────────────────────────────────────────

export const ST_HEADING = 'Page layout';
export const ST_BLURB =
  'Pick which pieces of the staff dashboard render. Click a tile to switch it on or off.';
export const ST_ON = 'On';
export const ST_OFF = 'Off';

// ── Step builder ─────────────────────────────────────────────────────────────

export const CS_HEADING = 'Dashboard steps';
export const CS_BLURB =
  'Each card on the staff dashboard is a step. A step appears when its "Show" event happens, turns complete when its "Done" event happens, and shows the date you choose. Drag to reorder; add or remove steps as your process changes.';
export const CS_ADD_STEP = 'Add step';
export const CS_DELETE_STEP = 'Delete step';
export const CS_SHOW_LABEL = 'Show this step to staff';
export const CS_EDIT_TOGGLE = 'Edit';
export const CS_EDIT_HIDE = 'Done editing';

export const CS_FIELD_CHIP_STYLE = 'Tag color';
export const CS_FIELD_CHIP = 'Tag text';
export const CS_FIELD_TITLE = 'Title';
export const CS_FIELD_DESC = 'Description';
export const CS_FIELD_BUTTON = 'Button text';
export const CS_FIELD_WATCHES = 'Watches which observation';
export const CS_FIELD_SHOW = 'Show this step';
export const CS_FIELD_DONE = 'Mark it done';
export const CS_FIELD_DATE = 'Show date from';
export const CS_FIELD_PROGRESS = 'Progress bar';
export const CS_FIELD_BUTTON_TARGET = 'Button goes to';
export const CS_FIELD_BUTTON_URL = 'Link address';
export const CS_FIELD_HIDE_DONE = 'Hide once done';

export const CS_PLACEHOLDER_DEFAULT = '(optional)';

export const WATCHED_KIND_LABELS: Record<string, string> = {
  standard: 'Standard observation',
  workProduct: 'Work Product',
  instructionalRound: 'Instructional Round',
  any: 'Any observation',
  anyDraft: 'Any active draft (skip finalized)',
};

export const SHOW_WHEN_LABELS: Record<string, string> = {
  always: 'Always',
  previousStepDone: 'After the previous step is done',
  observationCreated: 'When the observation is created',
  signupWindowOpened: 'When a sign-up window opens',
  signupSlotBooked: 'When the staff member books a slot',
  preObsDateSet: 'When the pre-observation date is set',
  preObsDatePassed: 'When the pre-observation date passes',
  observationDateSet: 'When the observation date is set',
  observationDatePassed: 'When the observation date passes',
  postObsDateSet: 'When the post-observation date is set',
  postObsDatePassed: 'When the post-observation date passes',
  finalized: 'When the observation is finalized',
  acknowledged: 'When the staff member acknowledges',
};

export const DONE_WHEN_LABELS: Record<string, string> = {
  never: 'Never (info only)',
  observationCreated: 'When the observation is created',
  signupWindowOpened: 'When a sign-up window opens',
  signupSlotBooked: 'When the staff member books a slot',
  preObsDateSet: 'When the pre-observation date is set',
  preObsDatePassed: 'When the pre-observation date passes',
  observationDateSet: 'When the observation date is set',
  observationDatePassed: 'When the observation date passes',
  postObsDateSet: 'When the post-observation date is set',
  postObsDatePassed: 'When the post-observation date passes',
  finalized: 'When the observation is finalized',
  acknowledged: 'When the staff member acknowledges',
};

export const DATE_SOURCE_LABELS: Record<string, string> = {
  none: 'No date',
  preObsDate: 'Pre-observation date',
  observationDate: 'Observation date',
  postObsDate: 'Post-observation date',
  finalizedAt: 'Finalized date',
  createdAt: 'Created date',
  lastModifiedAt: 'Last updated date',
};

export const IN_PROGRESS_LABELS: Record<string, string> = {
  none: 'No progress bar',
  responseProgress: 'Response form progress (answered ÷ total)',
};

export const BUTTON_TARGET_LABELS: Record<string, string> = {
  observation: 'The observation page',
  booking: 'The sign-up / booking page',
  acknowledge: 'The Acknowledge action',
  fixedUrl: 'A fixed link',
  none: 'No button',
};

export const CHIP_STYLE_LABELS: Record<string, string> = {
  form: 'Form (blue)',
  meeting: 'Meeting (blue)',
  observation: 'Observation (green)',
  review: 'Review (amber)',
};
