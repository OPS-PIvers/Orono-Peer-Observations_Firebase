import type { ObservationComponentEntry, RubricComponent, RubricDomain } from '@ops/shared';

/** Per-component draft state, keyed on componentId — mirrors
 *  EditorDraft['observationData'] in ObservationEditorPage.tsx. */
export type ComponentEntries = Record<string, ObservationComponentEntry>;

export interface ActiveComponent {
  domain: RubricDomain;
  component: RubricComponent;
}

/**
 * Assigned components with no proficiency selected yet.
 *
 * Used to build the non-blocking "readiness" warning in FinalizeDialog
 * (OBS-04). Some components are legitimately not observed in a given
 * lesson, so this is informational only — it never gates the Finalize
 * action.
 */
export function computeUnscoredComponents(
  activeComponents: ActiveComponent[],
  observationData: ComponentEntries,
): ActiveComponent[] {
  return activeComponents.filter((ac) => !observationData[ac.component.id]?.proficiency);
}
