import type { Observation } from './schema/observation.js';
import type { RubricDomain } from './schema/rubric.js';

/** The per-component fields of an observation that hold evaluator work. */
export type ReportComponentSource = Partial<
  Pick<
    Observation,
    'observationData' | 'componentNotes' | 'evidenceLinks' | 'scriptDoc' | 'componentTags'
  >
>;

/**
 * Component ids the evaluator actually put something against: a proficiency,
 * a look-for, scratch notes, rich-text notes, evidence, or a script tag.
 * Accepts raw Firestore data, so every field is read defensively.
 */
export function componentIdsWithEvaluatorContent(obs: ReportComponentSource): Set<string> {
  const ids = new Set<string>();
  for (const [id, raw] of Object.entries(obs.observationData ?? {})) {
    // Legacy docs can lack the defaulted fields.
    const entry = raw as Partial<typeof raw>;
    if (
      entry.proficiency != null ||
      (entry.selectedLookForIds?.length ?? 0) > 0 ||
      (entry.scratchNotes ?? '').trim() !== ''
    ) {
      ids.add(id);
    }
  }
  for (const [id, doc] of Object.entries(obs.componentNotes ?? {})) {
    if (nodeHasText(doc)) ids.add(id);
  }
  for (const [id, refs] of Object.entries(obs.evidenceLinks ?? {})) {
    if (refs.length > 0) ids.add(id);
  }
  for (const tag of obs.componentTags ?? []) ids.add(tag.componentId);
  collectScriptTagIds(obs.scriptDoc, ids);
  return ids;
}

/**
 * The rubric domains a finalized report shows: every component assigned for
 * the observed role/year, plus any other component the evaluator rated,
 * noted, tagged, or attached evidence to. Administrators may observe against
 * the whole rubric, so their work outside the assignment belongs in the
 * record; a peer evaluator who stays inside it gets the assigned set.
 *
 * Rubric order is kept and empty domains are dropped. An empty
 * `assignedComponentIds` means no mapping narrows the rubric and every
 * component is shown, as does a selection that would come out empty, so a
 * report never renders without a rubric.
 */
export function resolveReportDomains(
  domains: RubricDomain[],
  assignedComponentIds: readonly string[],
  obs: ReportComponentSource,
): RubricDomain[] {
  if (assignedComponentIds.length === 0) return domains;
  const allow = componentIdsWithEvaluatorContent(obs);
  for (const id of assignedComponentIds) allow.add(id);
  const filtered = domains
    .map((d) => ({ ...d, components: d.components.filter((c) => allow.has(c.id)) }))
    .filter((d) => d.components.length > 0);
  return filtered.length > 0 ? filtered : domains;
}

function nodeHasText(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false;
  const n = node as { type?: unknown; text?: unknown; content?: unknown };
  if (n.type === 'text' && typeof n.text === 'string' && n.text.trim() !== '') return true;
  return Array.isArray(n.content) && n.content.some(nodeHasText);
}

function collectScriptTagIds(node: unknown, ids: Set<string>): void {
  if (!node || typeof node !== 'object') return;
  const n = node as { marks?: unknown; content?: unknown };
  if (Array.isArray(n.marks)) {
    for (const mark of n.marks as { type?: unknown; attrs?: { componentId?: unknown } }[]) {
      const id = mark.attrs?.componentId;
      if (mark.type === 'componentTag' && typeof id === 'string' && id) ids.add(id);
    }
  }
  if (Array.isArray(n.content)) for (const child of n.content) collectScriptTagIds(child, ids);
}
