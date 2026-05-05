import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  isAdminRole,
  type ComponentColor,
  type Observation,
  type Role,
  type Rubric,
  type RubricComponent,
  type TiptapDoc,
} from '@ops/shared';

if (getApps().length === 0) initializeApp();

interface BackfillResponse {
  observationsScanned: number;
  observationsUpdated: number;
  spansUpdated: number;
  observationsSkipped: number;
}

/**
 * One-shot migration: walk every observation's `scriptDoc`, find any
 * `componentTag` marks missing `bg`/`fg` attributes, and back-fill them
 * from the rubric's per-component color (or the deterministic palette
 * fallback). Idempotent — safe to re-run.
 *
 * Without this, scripts written before the per-component-color release
 * keep the legacy single-color CSS fallback in the editor and PDF. After
 * running, every tagged span renders in its component's actual color.
 */
export const backfillScriptTagColors = onCall(
  { region: 'us-central1', memory: '512MiB', timeoutSeconds: 540 },
  async (request): Promise<BackfillResponse> => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required');
    const callerRole = request.auth.token['role'] as string | undefined;
    if (!isAdminRole(callerRole ?? null)) {
      throw new HttpsError('permission-denied', 'Admins only');
    }

    const db = getFirestore();

    const [rolesSnap, rubricsSnap] = await Promise.all([
      db.collection(COLLECTIONS.roles).get(),
      db.collection(COLLECTIONS.rubrics).get(),
    ]);
    const roles = rolesSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Role & { id: string });
    const rubricsById = new Map<string, Rubric>(
      rubricsSnap.docs.map((d) => [
        d.id,
        { id: d.id, ...d.data() } as unknown as Rubric & { id: string },
      ]),
    );

    function lookupRubric(observedRole: string): Rubric | null {
      const role =
        roles.find((r) => r.roleId === observedRole) ??
        roles.find((r) => r.displayName === observedRole);
      if (!role) return null;
      return rubricsById.get(role.rubricId) ?? null;
    }

    const obsSnap = await db.collection(COLLECTIONS.observations).get();

    let observationsScanned = 0;
    let observationsUpdated = 0;
    let observationsSkipped = 0;
    let spansUpdated = 0;

    for (const docSnap of obsSnap.docs) {
      observationsScanned += 1;
      const obs = docSnap.data() as Observation;
      const scriptDoc = obs.scriptDoc;
      if (!scriptDoc) continue;

      const rubric = lookupRubric(obs.observedRole);
      if (!rubric) {
        observationsSkipped += 1;
        continue;
      }

      const componentColors = new Map<string, ComponentColor>();
      for (const domain of rubric.domains) {
        for (const component of domain.components) {
          componentColors.set(component.id, colorFor(component));
        }
      }

      const result = backfillMarksInDoc(scriptDoc, componentColors);
      if (result.spansUpdated === 0) continue;

      await docSnap.ref.update({
        scriptDoc: result.doc,
        lastModifiedAt: FieldValue.serverTimestamp(),
      });
      observationsUpdated += 1;
      spansUpdated += result.spansUpdated;
    }

    logger.info('backfillScriptTagColors complete', {
      observationsScanned,
      observationsUpdated,
      spansUpdated,
      observationsSkipped,
    });

    return { observationsScanned, observationsUpdated, spansUpdated, observationsSkipped };
  },
);

interface MaybeNode {
  type?: string;
  text?: string;
  marks?: { type?: string; attrs?: Record<string, unknown> }[];
  content?: unknown[];
}

function backfillMarksInDoc(
  doc: TiptapDoc,
  componentColors: Map<string, ComponentColor>,
): { doc: TiptapDoc; spansUpdated: number } {
  let spansUpdated = 0;

  function visit(input: unknown): unknown {
    if (!input || typeof input !== 'object') return input;
    const node = input as MaybeNode;

    let nextMarks = node.marks;
    if (Array.isArray(node.marks)) {
      nextMarks = node.marks.map((m) => {
        if (m.type !== 'componentTag') return m;
        const attrs = (m.attrs ?? {}) as { componentId?: unknown; bg?: unknown; fg?: unknown };
        const componentId = typeof attrs.componentId === 'string' ? attrs.componentId : null;
        if (!componentId) return m;
        const hasBg = typeof attrs.bg === 'string' && attrs.bg.length > 0;
        const hasFg = typeof attrs.fg === 'string' && attrs.fg.length > 0;
        if (hasBg && hasFg) return m;
        const color = componentColors.get(componentId);
        if (!color) return m;
        spansUpdated += 1;
        return {
          ...m,
          attrs: {
            ...attrs,
            bg: hasBg ? attrs.bg : color.bg,
            fg: hasFg ? attrs.fg : color.fg,
          },
        };
      });
    }

    let nextContent = node.content;
    if (Array.isArray(node.content)) {
      nextContent = node.content.map((c) => visit(c));
    }

    if (nextMarks === node.marks && nextContent === node.content) return node;
    return {
      ...node,
      ...(nextMarks ? { marks: nextMarks } : {}),
      ...(nextContent ? { content: nextContent } : {}),
    };
  }

  const out = visit(doc) as TiptapDoc;
  return { doc: out, spansUpdated };
}

// ─── Color helper (mirror of apps/web/src/observations/component-colors.ts) ──

const DEFAULT_COLOR: ComponentColor = { bg: '#eaecf5', fg: '#1d2a5d' };
const FALLBACK_PALETTE: readonly ComponentColor[] = [
  { bg: '#dbeafe', fg: '#1e3a8a' },
  { bg: '#fef3c7', fg: '#78350f' },
  { bg: '#dcfce7', fg: '#14532d' },
  { bg: '#fce7f3', fg: '#831843' },
  { bg: '#ede9fe', fg: '#4c1d95' },
  { bg: '#ffedd5', fg: '#7c2d12' },
  { bg: '#cffafe', fg: '#164e63' },
  { bg: '#fee2e2', fg: '#7f1d1d' },
  { bg: '#e0e7ff', fg: '#312e81' },
  { bg: '#f3e8ff', fg: '#581c87' },
  { bg: '#ccfbf1', fg: '#134e4a' },
  { bg: '#fef9c3', fg: '#713f12' },
];

function hashStringToInt(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i++) {
    h = (h * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function colorFor(component: RubricComponent): ComponentColor {
  if (component.color) return component.color;
  const idx = hashStringToInt(component.id) % FALLBACK_PALETTE.length;
  return FALLBACK_PALETTE[idx] ?? DEFAULT_COLOR;
}
