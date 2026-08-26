import { z } from 'zod';
import {
  BUILDING_SCHEDULE_SUBCOLLECTIONS,
  COLLECTIONS,
  MODULE_SUBCOLLECTIONS,
  STAFF_SUBCOLLECTIONS,
  WINDOW_SUBCOLLECTIONS,
} from './constants.js';
import { auditLog } from './schema/auditLog.js';
import { building } from './schema/building.js';
import { buildingSchedule, buildingScheduleVersion } from './schema/buildingSchedule.js';
import {
  DASHBOARD_CONFIG_DOC_ID,
  DASHBOARD_QUICK_MATERIALS_DOC_ID,
  dashboardConfig,
  dashboardQuickMaterialsDoc,
} from './schema/dashboard.js';
import { emailTemplate } from './schema/emailTemplate.js';
import { moduleDoc } from './schema/module.js';
import { moduleItem, moduleProgress } from './schema/moduleItem.js';
import { observation } from './schema/observation.js';
import { observationPreference } from './schema/observationPreference.js';
import { observationSlot } from './schema/observationSlot.js';
import { observationWindow } from './schema/observationWindow.js';
import { role } from './schema/role.js';
import { rubric } from './schema/rubric.js';
import { APP_SETTINGS_DOC_ID, appSettings, roleYearMapping } from './schema/settings.js';
import { signupField } from './schema/signupField.js';
import { staff } from './schema/staff.js';
import { transcriptionJob } from './schema/transcriptionJob.js';
import { userCalendarTokens } from './schema/userCalendarTokens.js';
import { workProductQuestion } from './schema/workProductQuestion.js';

/**
 * Firestore read-boundary defaults.
 *
 * The Zod schemas in ./schema are the authoritative shapes, and they lean
 * hard on `.default()` — `yearColors: z.object({...}).partial().default({})`,
 * `scheduling: schedulingSettings.default(...)`, and so on. `z.infer` folds
 * those defaults in, so the TypeScript type says the field is always there.
 * Stored documents disagree: a doc written before the field existed (or by
 * a partial `setDoc({ merge: true })`) simply omits it, and the web app's
 * Firestore hooks hand back the raw snapshot without ever running it through
 * the schema. `settings.yearColors[1]` then reads a property off `undefined`
 * and takes the page down.
 *
 * Rather than making every call site defensive against a type that claims
 * the field exists, `applySchemaDefaults` makes the runtime data match the
 * type: it walks the schema and fills in a default for any key the document
 * is missing. It deliberately does NOT validate — a Firestore `Timestamp`
 * is not a `z.date()`, and rejecting docs at the read boundary would turn a
 * partially-broken page into a blank one. Unknown keys are preserved and
 * present values are never overwritten.
 *
 * Only the public Zod surface is used (`.shape`, `.unwrap()`, `.safeParse`),
 * so this survives Zod point releases.
 */

/** A Zod object schema with any shape — the registry is heterogeneous. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObjectSchema = z.ZodObject<any>;

/**
 * Per-schema, per-key analysis. Computed once per schema object and cached,
 * because `useFirestoreCollection` runs this over every document on every
 * snapshot.
 */
interface SchemaPlan {
  /** Keys whose schema produces a value when handed `undefined`. */
  defaulted: Set<string>;
  /**
   * Required (non-optional, non-defaulted) container keys. A stored document
   * should never be missing one, but when it is, an empty container is the
   * only reading that degrades instead of crashing: every call site treats
   * these as always-present and goes straight to `.map` / `[key]`.
   */
  requiredContainers: Map<string, 'array' | 'object'>;
  /** Keys that wrap a nested object schema, for recursion. */
  objectFields: Map<string, AnyObjectSchema>;
  /** Keys that wrap an array of objects, for per-element recursion. */
  arrayFields: Map<string, AnyObjectSchema>;
}

const planCache = new WeakMap<AnyObjectSchema, SchemaPlan>();

/** Peel `.default()` / `.optional()` / `.nullable()` off a field schema. */
function unwrapField(field: unknown): unknown {
  let current = field;
  // Bounded: guards against a self-referential wrapper chain.
  for (let depth = 0; depth < 10; depth += 1) {
    if (current instanceof z.ZodObject || current instanceof z.ZodArray) return current;
    if (current === null || current === undefined) return current;
    const unwrap = (current as { unwrap?: () => unknown }).unwrap;
    if (typeof unwrap !== 'function') return current;
    current = unwrap.call(current);
  }
  return current;
}

function buildPlan(schema: AnyObjectSchema): SchemaPlan {
  const plan: SchemaPlan = {
    defaulted: new Set(),
    requiredContainers: new Map(),
    objectFields: new Map(),
    arrayFields: new Map(),
  };

  for (const [key, field] of Object.entries(schema.shape as Record<string, unknown>)) {
    // A field "has a default" iff parsing `undefined` yields a value. Plain
    // `.optional()` fields succeed but yield `undefined`, and required fields
    // fail outright — neither contributes a default.
    const probe = (field as z.ZodType).safeParse(undefined);
    if (probe.success && probe.data !== undefined) plan.defaulted.add(key);

    const inner = unwrapField(field);
    if (inner instanceof z.ZodObject) {
      plan.objectFields.set(key, inner as AnyObjectSchema);
      if (!probe.success) plan.requiredContainers.set(key, 'object');
    } else if (inner instanceof z.ZodArray) {
      const element = unwrapField(inner.element);
      if (element instanceof z.ZodObject) plan.arrayFields.set(key, element as AnyObjectSchema);
      if (!probe.success) plan.requiredContainers.set(key, 'array');
    }
  }

  return plan;
}

function planFor(schema: AnyObjectSchema): SchemaPlan {
  const cached = planCache.get(schema);
  if (cached) return cached;
  const plan = buildPlan(schema);
  planCache.set(schema, plan);
  return plan;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  // Firestore hands back Timestamp / GeoPoint / DocumentReference instances;
  // those are values, not shapes to recurse into.
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function fillDefaults(
  schema: AnyObjectSchema,
  raw: Record<string, unknown>,
  path: string,
  onRepair: RepairReporter | undefined,
) {
  const plan = planFor(schema);
  let out = raw;
  /** Copy-on-write so documents that need nothing are returned untouched. */
  const mutable = () => (out === raw ? (out = { ...raw }) : out);
  const at = (key: string) => (path ? `${path}.${key}` : key);

  for (const key of plan.defaulted) {
    if (raw[key] !== undefined) continue;
    // Re-parse rather than caching the default value: `.default({})` can hand
    // back the same object reference every time, and callers mutate what they
    // are given.
    const fieldSchema = (schema.shape as Record<string, z.ZodType | undefined>)[key];
    const produced = fieldSchema?.safeParse(undefined);
    if (produced?.success && produced.data !== undefined) mutable()[key] = produced.data;
  }

  for (const [key, kind] of plan.requiredContainers) {
    if (raw[key] !== undefined) continue;
    mutable()[key] = kind === 'array' ? [] : {};
    onRepair?.(at(key), kind);
  }

  for (const [key, nested] of plan.objectFields) {
    const value = out[key];
    if (!isPlainObject(value)) continue;
    const filled = fillDefaults(nested, value, at(key), onRepair);
    if (filled !== value) mutable()[key] = filled;
  }

  for (const [key, element] of plan.arrayFields) {
    const value = out[key];
    if (!Array.isArray(value)) continue;
    let changed = false;
    const items: unknown[] = [];
    for (const [index, item] of (value as unknown[]).entries()) {
      if (!isPlainObject(item)) {
        items.push(item);
        continue;
      }
      const filled = fillDefaults(element, item, `${at(key)}[${String(index)}]`, onRepair);
      if (filled !== item) changed = true;
      items.push(filled);
    }
    if (changed) mutable()[key] = items;
  }

  return out;
}

/**
 * Called when a *required* container had to be substituted — i.e. the stored
 * document is genuinely malformed, not merely old. Wire this to a dev-only
 * warning so bad data is visible instead of silently rendering as empty.
 */
export type RepairReporter = (fieldPath: string, kind: 'array' | 'object') => void;

/**
 * Fill in schema defaults for every key `raw` is missing, recursively, and
 * substitute an empty container for any required array/object it lacks.
 *
 * Never validates, never throws, never overwrites a value that is present.
 * Returns `raw` unchanged when there is nothing to add (or when `schema` is
 * null, so call sites can pass an unregistered path straight through).
 */

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- T is the caller's assertion about the document shape, mirroring the Firestore hooks' own generics.
export function applySchemaDefaults<T = Record<string, unknown>>(
  schema: AnyObjectSchema | null | undefined,
  raw: unknown,
  onRepair?: RepairReporter,
): T {
  if (!schema || !isPlainObject(raw)) return raw as T;
  try {
    return fillDefaults(schema, raw, '', onRepair) as T;
  } catch {
    // A schema shape this walker doesn't understand must not cost the user
    // their page — fall back to the raw document.
    return raw as T;
  }
}

/**
 * Collection-path → schema. Keyed on the *collection* segments of a path
 * (`observationWindows/abc/slots` keys on `observationWindows/slots`), so
 * subcollections resolve without pattern matching on document ids.
 */
const COLLECTION_SCHEMAS: Record<string, AnyObjectSchema> = {
  [COLLECTIONS.staff]: staff,
  [`${COLLECTIONS.staff}/${STAFF_SUBCOLLECTIONS.moduleProgress}`]: moduleProgress,
  [COLLECTIONS.roles]: role,
  [COLLECTIONS.modules]: moduleDoc,
  [`${COLLECTIONS.modules}/${MODULE_SUBCOLLECTIONS.items}`]: moduleItem,
  [COLLECTIONS.buildings]: building,
  [COLLECTIONS.rubrics]: rubric,
  [COLLECTIONS.roleYearMappings]: roleYearMapping,
  [COLLECTIONS.observations]: observation,
  [COLLECTIONS.workProductQuestions]: workProductQuestion,
  [COLLECTIONS.emailTemplates]: emailTemplate,
  [COLLECTIONS.auditLog]: auditLog,
  [COLLECTIONS.transcriptionJobs]: transcriptionJob,
  [COLLECTIONS.buildingSchedules]: buildingSchedule,
  [`${COLLECTIONS.buildingSchedules}/${BUILDING_SCHEDULE_SUBCOLLECTIONS.versions}`]:
    buildingScheduleVersion,
  [COLLECTIONS.signupFields]: signupField,
  [COLLECTIONS.observationWindows]: observationWindow,
  [`${COLLECTIONS.observationWindows}/${WINDOW_SUBCOLLECTIONS.slots}`]: observationSlot,
  [`${COLLECTIONS.observationWindows}/${WINDOW_SUBCOLLECTIONS.preferences}`]: observationPreference,
  [COLLECTIONS.userCalendarTokens]: userCalendarTokens,
  [COLLECTIONS.dashboardQuickMaterials]: dashboardQuickMaterialsDoc,
};

/**
 * Documents whose schema depends on the document id, not the collection.
 * `/appSettings` is a grab bag: `global` is the app settings doc, `dashboard`
 * is the staff dashboard layout.
 */
const DOC_SCHEMAS: Record<string, AnyObjectSchema> = {
  [`${COLLECTIONS.appSettings}/${APP_SETTINGS_DOC_ID}`]: appSettings,
  [`${COLLECTIONS.appSettings}/${DASHBOARD_CONFIG_DOC_ID}`]: dashboardConfig,
  [`${COLLECTIONS.dashboardQuickMaterials}/${DASHBOARD_QUICK_MATERIALS_DOC_ID}`]:
    dashboardQuickMaterialsDoc,
};

/**
 * Resolve the schema governing a Firestore path — collection or document,
 * top-level or subcollection. Returns null for paths with no registered
 * schema (`/mail`, anything new), which callers treat as "pass through".
 */
export function schemaForPath(path: string): AnyObjectSchema | null {
  const segments = path.split('/').filter(Boolean);
  if (segments.length === 0) return null;

  const docSchema = DOC_SCHEMAS[segments.join('/')];
  if (docSchema) return docSchema;

  // Even indices are collection names, odd ones are document ids.
  const collectionChain = segments.filter((_, i) => i % 2 === 0).join('/');
  return COLLECTION_SCHEMAS[collectionChain] ?? null;
}

/**
 * Convenience wrapper for the read hooks: resolve the schema for `path`,
 * apply its defaults to `raw`, and stamp the document id on.
 */

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- T is the caller's assertion about the document shape, mirroring the Firestore hooks' own generics.
export function hydrateFirestoreDoc<T>(
  path: string,
  raw: unknown,
  id: string,
  onRepair?: RepairReporter,
): T & { id: string } {
  // `path` is a collection path when the caller is iterating a snapshot and
  // already a document path when it is watching one document.
  const isDocPath = path.split('/').filter(Boolean).length % 2 === 0;
  const docPath = isDocPath ? path : `${path}/${id}`;
  const filled = applySchemaDefaults(
    schemaForPath(path),
    raw,
    onRepair &&
      ((field, kind) => {
        onRepair(`${docPath} · ${field}`, kind);
      }),
  );
  return { ...filled, id } as T & { id: string };
}
