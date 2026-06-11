import { z } from 'zod';
import { email, isoDate } from './common.js';
import { staffYear } from './staff.js';
import { componentId } from './rubric.js';
import { pillColor } from './pillColor.js';

/**
 * /settings/roleYearMappings/{roleId}_{year} — which components a given
 * (role, year) combination is responsible for in their rubric.
 *
 * This replaces the GAS Settings sheet's 4-row-per-role block layout with
 * a flat document keyed on the role+year pair. The admin matrix UI (Phase 3)
 * edits these directly.
 *
 * Empty assignedComponentIds means "no components active for this role-year"
 * — used to hide the rubric viewer entirely for staff in non-evaluation
 * cycles.
 */

export const roleYearMapping = z.object({
  roleId: z.string().min(1),
  year: staffYear,
  assignedComponentIds: z.array(componentId).default([]),
  updatedAt: isoDate,
});
export type RoleYearMapping = z.infer<typeof roleYearMapping>;

export const roleYearMappingInput = roleYearMapping.omit({ updatedAt: true });
export type RoleYearMappingInput = z.infer<typeof roleYearMappingInput>;

/** Document ID convention: `${roleId}_${year}` */
export function roleYearMappingDocId(roleId: string, year: number): string {
  return `${roleId}_${year.toString()}`;
}

/**
 * /appSettings/global — single document holding system-wide tunables.
 * Admin-editable through the Settings UI.
 */
export const rateLimits = z.object({
  observationSavesPerMinute: z.number().int().positive().default(60),
  audioUploadsPerHour: z.number().int().positive().default(20),
  transcriptionRequestsPerDay: z.number().int().positive().default(50),
});
export type RateLimits = z.infer<typeof rateLimits>;

/**
 * 6-digit hex color (e.g. "#2d3f89") — the only shape branding.primaryColor
 * accepts. Exported so the web client can validate the Branding admin form
 * at save time and sanitize raw Firestore reads (which bypass Zod) without
 * re-deriving the pattern.
 */
export const PRIMARY_COLOR_HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;

export const branding = z.object({
  appName: z.string().trim().min(1).max(80).default('Orono Peer Observations'),
  primaryColor: z
    .string()
    .regex(PRIMARY_COLOR_HEX_PATTERN, 'Must be a 6-digit hex color')
    .default('#2d3f89'),
  /**
   * Public URL of the uploaded primary (horizontal) logo — used in the top
   * nav, sign-in screen, and email header. Null = use packaged default.
   */
  logoUrl: z.url().nullable().default(null),
  /**
   * Public URL of the uploaded square icon/mark — used in compact spots and
   * as a favicon-style mark. Null = use packaged default.
   */
  iconUrl: z.url().nullable().default(null),
});
export type Branding = z.infer<typeof branding>;

/**
 * Gemini API models we expose in the admin UI. The `id` is the exact
 * string passed to `generativelanguage.googleapis.com/v1beta/models/{id}`.
 * Keep the list ordered with the recommended default (3.1 Flash-Lite) first.
 */
export const GEMINI_MODEL_OPTIONS = [
  {
    id: 'gemini-3.1-flash-lite-preview',
    label: 'Gemini 3.1 Flash-Lite (preview)',
    note: 'Cheapest, fastest. Default.',
  },
  {
    id: 'gemini-3-flash-preview',
    label: 'Gemini 3 Flash (preview)',
    note: 'Stronger reasoning at higher cost.',
  },
  {
    id: 'gemini-3.1-pro-preview',
    label: 'Gemini 3.1 Pro (preview)',
    note: 'Highest quality 3.x; slower, most expensive.',
  },
  {
    id: 'gemini-2.5-flash-lite',
    label: 'Gemini 2.5 Flash-Lite',
    note: 'GA 2.5 alternative to the 3.x preview.',
  },
  {
    id: 'gemini-2.5-flash',
    label: 'Gemini 2.5 Flash',
    note: 'GA 2.5 mid-tier.',
  },
  {
    id: 'gemini-2.5-pro',
    label: 'Gemini 2.5 Pro',
    note: 'GA 2.5 top-tier.',
  },
] as const;

export type GeminiModelId = (typeof GEMINI_MODEL_OPTIONS)[number]['id'];

export const DEFAULT_GEMINI_MODEL: GeminiModelId = 'gemini-3.1-flash-lite-preview';

export const geminiFeature = z.object({
  enabled: z.boolean().default(true),
  /**
   * Free-form string so admins can paste a newer model id we haven't yet
   * added to GEMINI_MODEL_OPTIONS without us having to ship a release.
   * Must look like a Gemini model id; the API will reject anything else.
   */
  model: z
    .string()
    .regex(/^gemini-[a-z0-9.-]+$/, 'Model must look like "gemini-…"')
    .default(DEFAULT_GEMINI_MODEL),
});
export type GeminiFeature = z.infer<typeof geminiFeature>;

export const geminiFeatures = z.object({
  audioTranscription: geminiFeature.default({
    enabled: true,
    model: DEFAULT_GEMINI_MODEL,
  }),
  scriptAutoTag: geminiFeature.default({
    enabled: true,
    model: DEFAULT_GEMINI_MODEL,
  }),
});
export type GeminiFeatures = z.infer<typeof geminiFeatures>;

/**
 * Scheduling behavior knobs. Per-window the PE can override mode/buffer/caps/
 * event text within the bounds these settings establish.
 */
export const BOOKING_MODES = ['direct', 'day-preference'] as const;
export type BookingMode = (typeof BOOKING_MODES)[number];

export const schedulingSettings = z.object({
  /** Minutes the PE needs between observations (travel between buildings). */
  travelBufferMinutes: z.number().int().min(0).max(240).default(15),
  /** Which booking modes PEs may choose from when creating a window. */
  allowedBookingModes: z.array(z.enum(BOOKING_MODES)).min(1).default(['direct', 'day-preference']),
  defaultBookingMode: z.enum(BOOKING_MODES).default('direct'),
  /** Mode B: default max bookings per day (null = uncapped). */
  defaultPerDayCap: z.number().int().positive().nullable().default(null),
  /** Staff cannot book within this many hours of a slot's start. */
  bookingLeadTimeHours: z.number().int().min(0).max(720).default(0),
  /** Default weekdays a window covers (0=Sun … 6=Sat). */
  defaultWeekdays: z.array(z.number().int().min(0).max(6)).default([1, 2, 3, 4, 5]),
  defaultEarliestMinute: z.number().int().min(0).max(1439).default(0),
  defaultLatestMinute: z.number().int().min(0).max(1439).default(1439),
  /** Whether Google should send its own native calendar invites. */
  gcalSendUpdates: z.enum(['none', 'all']).default('none'),
  /** Block booking until the staff member connects Google Calendar. */
  requireCalendarConnect: z.boolean().default(false),
  /**
   * When on, the evaluator's connected Google Calendar free/busy is consulted
   * during slot generation so periods overlapping a real meeting / PTO / other
   * district event are blocked (`observer-busy`) and never offered to staff.
   * Requires the evaluator to have connected Calendar with the freebusy scope;
   * connections made before this scope existed are skipped until reconnected.
   */
  checkObserverCalendar: z.boolean().default(false),
  inviteEmailEnabled: z.boolean().default(true),
  confirmationEmailEnabled: z.boolean().default(true),
  cancellationEmailEnabled: z.boolean().default(true),
});
export type SchedulingSettings = z.infer<typeof schedulingSettings>;

export const DEFAULT_SCHEDULING_SETTINGS: SchedulingSettings = schedulingSettings.parse({});

export const appSettings = z.object({
  sessionDurationHours: z.number().int().positive().max(168).default(24),
  auditLogRetentionDays: z.number().int().positive().max(3650).default(365),
  rateLimits: rateLimits.default({
    observationSavesPerMinute: 60,
    audioUploadsPerHour: 20,
    transcriptionRequestsPerDay: 50,
  }),
  branding: branding.default({
    appName: 'Orono Peer Observations',
    primaryColor: '#2d3f89',
    logoUrl: null,
    iconUrl: null,
  }),
  /** Per-feature Gemini config: enable/disable + model selection. */
  gemini: geminiFeatures.default({
    audioTranscription: { enabled: true, model: DEFAULT_GEMINI_MODEL },
    scriptAutoTag: { enabled: true, model: DEFAULT_GEMINI_MODEL },
  }),
  /** Where security alerts go. */
  securityAdminEmail: email,
  /** Send-as address for finalized observation notification emails. */
  outboundEmailAddress: email.default('observations@orono.k12.mn.us'),
  /** Display banner at top of all pages. Empty = no banner. */
  globalBannerText: z.string().trim().max(280).default(''),
  /** When set, blocks new observation creation in the GAS-cutover window. */
  newObservationsDisabled: z.boolean().default(false),
  /** URL used in the observation signup request email template. Point to
   *  a Calendly link, Google Form, or any scheduling URL. */
  signupLink: z.url().nullable().default(null),
  /** Observation scheduling / booking behavior. */
  scheduling: schedulingSettings.default(DEFAULT_SCHEDULING_SETTINGS),
  /** Pill colors for the Year column in the Staff table (display years 1-3).
   *  Unset entries fall back to built-in defaults. Set on the Role/Year page. */
  yearColors: z.object({ 1: pillColor, 2: pillColor, 3: pillColor }).partial().default({}),
  updatedAt: isoDate,
  updatedBy: email.optional(),
});
export type AppSettings = z.infer<typeof appSettings>;

export const APP_SETTINGS_DOC_ID = 'global';
