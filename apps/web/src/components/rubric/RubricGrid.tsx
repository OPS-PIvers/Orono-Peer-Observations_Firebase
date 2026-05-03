import { useMemo } from 'react';
import {
  PROFICIENCY_LEVELS,
  type DriveFileRef,
  type ObservationComponentEntry,
  type ProficiencyLevel,
  type Rubric,
  type RubricComponent,
  type RubricDomain,
  type TiptapDoc,
} from '@ops/shared';
import { cn } from '@/lib/utils';
import { DomainSection } from './DomainSection';
import { RubricRow } from './RubricRow';

export const PROFICIENCY_LABELS: Record<ProficiencyLevel, string> = {
  developing: 'Developing',
  basic: 'Basic',
  proficient: 'Proficient',
  distinguished: 'Distinguished',
};

/** Shared Tailwind grid layout for the rubric matrix — component col + 4 descriptor cols. */
export const RUBRIC_GRID_COLS = 'grid-cols-[220px_repeat(4,minmax(0,1fr))]';
/** Min-width that keeps all 5 rubric columns legible before horizontal scroll kicks in. */
export const RUBRIC_GRID_MIN_W = 'min-w-[880px]';

export type RubricGridMode =
  | {
      kind: 'view';
      assignedComponentIds: Set<string>;
      showAssignedOnly: boolean;
    }
  | {
      kind: 'edit';
      entries: Record<string, ObservationComponentEntry>;
      notes: Record<string, TiptapDoc>;
      evidenceLinks: Record<string, DriveFileRef[]>;
      observationId: string;
      readOnly: boolean;
      onProficiency: (componentId: string, level: ProficiencyLevel | null) => void;
      onToggleLookFor: (componentId: string, lookForId: string) => void;
      onNotesChange: (componentId: string, doc: TiptapDoc) => void;
    };

export interface RubricGridProps {
  rubric: Rubric;
  mode: RubricGridMode;
  /**
   * Disambiguates per-row UI state stored in `sessionStorage` (look-fors
   * strip expanded/collapsed). Use `view-{rubricId}` for the teacher view
   * and `edit-{observationId}` for the editor so two open tabs don't fight.
   */
  storageScope: string;
  /** Optional CSS class on the outer wrapper. */
  className?: string;
}

/**
 * The keystone rubric primitive. Renders a domain-grouped matrix grid
 * with one row per component and four proficiency descriptor cells side-
 * by-side. A single `mode` discriminator flips between read-only display
 * (teacher view) and clickable editing (PE/admin observation editor).
 *
 * Schema-stable: drives off the same `Rubric` doc shape consumed by the
 * existing observation editor and admin rubric editor; never reads or
 * writes Firestore itself.
 */
export function RubricGrid({ rubric, mode, storageScope, className }: RubricGridProps) {
  const visibleDomains = useMemo<{ domain: RubricDomain; components: RubricComponent[] }[]>(() => {
    return rubric.domains
      .map((domain) => {
        const components =
          mode.kind === 'view' && mode.showAssignedOnly
            ? domain.components.filter((c) => mode.assignedComponentIds.has(c.id))
            : domain.components;
        return { domain, components };
      })
      .filter(({ components }) => components.length > 0);
  }, [rubric, mode]);

  if (visibleDomains.length === 0) {
    return (
      <div className="text-muted-foreground rounded-md border border-dashed p-8 text-center text-sm">
        No rubric components to display.
      </div>
    );
  }

  return (
    <div className={cn('space-y-6', className)}>
      {visibleDomains.map(({ domain, components }) => (
        <DomainSection key={domain.id} domain={domain}>
          {components.map((component) => (
            // Include storageScope in the key so navigating between
            // observations (each with a unique edit-{id} scope) remounts
            // the row and re-reads its sessionStorage-backed expand state
            // — otherwise prior look-fors/notes toggles bleed across
            // observations.
            <RubricRow
              key={`${storageScope}:${component.id}`}
              domain={domain}
              component={component}
              mode={mode}
              storageScope={storageScope}
            />
          ))}
        </DomainSection>
      ))}
    </div>
  );
}

/** Re-exported for use outside the grid (e.g. PDF renderer alignment). */
export { PROFICIENCY_LEVELS };
