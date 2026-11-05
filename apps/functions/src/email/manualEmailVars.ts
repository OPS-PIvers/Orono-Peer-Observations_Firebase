import type { Firestore } from 'firebase-admin/firestore';
import {
  APP_SETTINGS_DOC_ID,
  COLLECTIONS,
  KNOWN_TEMPLATE_VARIABLES,
  displayYear,
} from '@ops/shared';
import { APP_URL, type TemplateVars } from '../lib/emailUtils.js';
import { resolveRole } from '../observations/roleLookup.js';

/**
 * Template variables the server always owns for manual sends. They are set
 * last, so nothing a caller passes can replace them — `signupLink` and
 * `signInLink` render as button hrefs, and `appName` as the subject suffix.
 */
export const SERVER_OWNED_VARS = ['appName', 'signupLink', 'signInLink'] as const;

/** Variables about the sender, derived from the caller's own /staff doc. */
const OBSERVER_VARS = ['observerName', 'observerFirstName', 'observerEmail'] as const;

/** Variables about the recipient, derived from the recipient's /staff doc. */
const RECIPIENT_VARS = [
  'observedName',
  'observedFirstName',
  'observedEmail',
  'observedRole',
  'observedYear',
  'staffName',
  'staffFirstName',
  'staffEmail',
  'staffRole',
] as const;

/**
 * Keys a console admin may pass in `vars` — the Email Templates page's
 * "Send Test…" fills every known variable with sample values so a test
 * renders fully. Server-owned keys are never accepted, even from a console
 * admin. Callers below the console tier get no client vars at all: every
 * variable a peer evaluator's send needs is derived on the server.
 */
const CONSOLE_CLIENT_VARS: ReadonlySet<string> = new Set(
  KNOWN_TEMPLATE_VARIABLES.filter((key) => !(SERVER_OWNED_VARS as readonly string[]).includes(key)),
);

/** The /staff fields a manual send reads, as a raw Admin SDK read returns them. */
export interface ManualEmailPerson {
  email: string;
  name?: string | undefined;
  role?: string | undefined;
  year?: number | undefined;
}

/** A person's stored name, or their email's local part when it is blank. */
function displayNameOf(person: ManualEmailPerson): string {
  const name = person.name?.trim() ?? '';
  return name.length > 0 ? name : (person.email.split('@')[0] ?? '');
}

/**
 * Keep only the client `vars` a caller may set: none below the console tier,
 * and known non-server-owned keys with string values for a console admin.
 */
export function allowedClientVars(raw: unknown, isConsoleCaller: boolean): TemplateVars {
  if (!isConsoleCaller || typeof raw !== 'object' || raw === null) return {};
  const out: TemplateVars = {};
  for (const [key, value] of Object.entries(raw)) {
    if (CONSOLE_CLIENT_VARS.has(key) && typeof value === 'string') out[key] = value;
  }
  return out;
}

/** {{appName}}, {{signupLink}} and {{signInLink}} from /appSettings and APP_URL. */
export async function loadServerAppVars(
  db: Firestore,
): Promise<Record<(typeof SERVER_OWNED_VARS)[number], string>> {
  const appSnap = await db.doc(`${COLLECTIONS.appSettings}/${APP_SETTINGS_DOC_ID}`).get();
  const appData = appSnap.data() as
    { branding?: { appName?: string }; signupLink?: string } | undefined;
  return {
    appName: appData?.branding?.appName ?? 'Orono Peer Observations',
    signupLink: appData?.signupLink ?? '',
    signInLink: APP_URL,
  };
}

/** Read one /staff doc (ids are the lowercased email), or null when missing. */
export async function loadStaffPerson(
  db: Firestore,
  email: string,
): Promise<(ManualEmailPerson & { isActive: boolean }) | null> {
  const snap = await db.collection(COLLECTIONS.staff).doc(email.toLowerCase()).get();
  if (!snap.exists) return null;
  const data = snap.data() as
    { name?: unknown; role?: unknown; year?: unknown; isActive?: unknown } | undefined;
  return {
    email: email.toLowerCase(),
    name: typeof data?.name === 'string' ? data.name : undefined,
    role: typeof data?.role === 'string' ? data.role : undefined,
    year: typeof data?.year === 'number' ? data.year : undefined,
    // Raw reads bypass the Zod default of true; a legacy doc without the
    // field is active (matches firestoreStaffRosterLookup).
    isActive: data?.isActive !== false,
  };
}

/**
 * Display labels for a set of stored role values (slug, or a legacy display
 * name), resolved through /roles. Best-effort, like the client's
 * roleDisplayName: an unknown role, or one that isn't a valid doc id (a
 * legacy label such as "Coach/TOSA" makes `.doc()` throw), falls back to its
 * raw value rather than failing the send.
 */
export async function loadRoleLabels(
  db: Firestore,
  roles: Iterable<string | undefined>,
): Promise<Map<string, string>> {
  const unique = [...new Set([...roles].filter((r): r is string => !!r))];
  const resolved = await Promise.all(
    unique.map(async (r) => {
      try {
        return (await resolveRole(db, r))?.displayName ?? r;
      } catch {
        return r;
      }
    }),
  );
  return new Map(unique.map((r, i) => [r, resolved[i] ?? r]));
}

/**
 * Build the substitution bag for one manual email. Precedence, lowest first:
 * allowed client vars, then the server-derived sender and recipient
 * variables, then the server-owned app variables. A server-derived group
 * replaces the whole matching client group, so a sample `observedFirstName`
 * can't sit next to a real `observedName`.
 *
 * `recipient` is null only on a console admin's test send to an address with
 * no /staff doc; the recipient variables then come from the sample values.
 */
export function buildManualEmailVars(args: {
  app: Record<(typeof SERVER_OWNED_VARS)[number], string>;
  caller: ManualEmailPerson;
  recipient: ManualEmailPerson | null;
  roleLabels: ReadonlyMap<string, string>;
  clientVars: TemplateVars;
}): TemplateVars {
  const { app, caller, recipient, roleLabels, clientVars } = args;
  const dropped = new Set<string>(OBSERVER_VARS);
  if (recipient) for (const key of RECIPIENT_VARS) dropped.add(key);
  const base: TemplateVars = {};
  for (const [key, value] of Object.entries(clientVars)) {
    if (!dropped.has(key)) base[key] = value;
  }

  const observer: TemplateVars = {
    observerName: displayNameOf(caller),
    observerEmail: caller.email,
  };

  let observed: TemplateVars = {};
  if (recipient) {
    const name = displayNameOf(recipient);
    const role = recipient.role ? (roleLabels.get(recipient.role) ?? recipient.role) : '';
    const year = recipient.year !== undefined ? String(displayYear(recipient.year)) : '';
    observed = {
      observedName: name,
      observedEmail: recipient.email,
      observedRole: role,
      observedYear: year,
      staffName: name,
      staffEmail: recipient.email,
      staffRole: role,
    };
  }

  return { ...base, ...observer, ...observed, ...app };
}
