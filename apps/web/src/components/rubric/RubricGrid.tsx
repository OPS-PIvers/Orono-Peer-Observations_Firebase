import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
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
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { cn } from '@/lib/utils';
import { DomainSection } from './DomainSection';
import { MobileComponentBody, RubricRow } from './RubricRow';

export const PROFICIENCY_LABELS: Record<ProficiencyLevel, string> = {
  developing: 'Developing',
  basic: 'Basic',
  proficient: 'Proficient',
  distinguished: 'Distinguished',
};

/** Shared Tailwind grid layout for the rubric matrix — component col + 4 descriptor cols. */
export const RUBRIC_GRID_COLS = 'grid-cols-[280px_repeat(4,minmax(0,1fr))]';
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
      /**
       * Live script document — used by the per-component notes panel to
       * derive a read-only "Script tags" view alongside the manual notes.
       * Changes propagate automatically through React props; no separate
       * callback needed.
       */
      scriptDoc?: TiptapDoc;
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
 * by-side on desktop. On mobile it switches to a per-domain card with a
 * horizontal tab strip of component IDs and the active component's body
 * (Ratings / Look-fors / Notes / Evidence) below.
 *
 * Schema-stable: drives off the same `Rubric` doc shape consumed by the
 * existing observation editor and admin rubric editor; never reads or
 * writes Firestore itself.
 */
export function RubricGrid({ rubric, mode, storageScope, className }: RubricGridProps) {
  const isDesktop = useIsDesktop();

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

  if (!isDesktop) {
    return (
      <div
        className={cn(
          // Collapsed domain cards stack flush against each other so
          // the rubric reads as one cohesive table rather than four
          // disconnected blocks. NB: no `overflow-hidden` on this
          // wrapper — that would clip sticky descendants (the tab
          // strip + domain header pinning under page chrome).
          'divide-y divide-white/10',
          className,
        )}
      >
        {visibleDomains.map(({ domain, components }) => (
          <MobileDomainCard
            key={domain.id}
            domain={domain}
            components={components}
            mode={mode}
            storageScope={storageScope}
          />
        ))}
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

// ─── MobileDomainCard ─────────────────────────────────────────────────────────

/**
 * One domain rendered as a mobile card. Lays out as:
 *   [sticky domain title bar — tap to collapse]
 *   [sticky tab strip of component IDs (1a, 1b, ...)]
 *   [active component title strip + Assigned/saved-rating badge]
 *   [MobileComponentBody — the Ratings/Look-fors/Notes/Evidence sections]
 *
 * Switching tabs remounts MobileComponentBody (key=component.id) so its
 * accordion state resets when you move between components.
 */
function MobileDomainCard({
  domain,
  components,
  mode,
  storageScope,
}: {
  domain: RubricDomain;
  components: RubricComponent[];
  mode: RubricGridMode;
  storageScope: string;
}) {
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(components[0]?.id ?? null);

  // If the visible component list changes (e.g. user toggles "Assigned
  // only" and the active id is filtered out), fall back to the first
  // visible component instead of showing an empty body.
  useEffect(() => {
    if (!activeId || !components.some((c) => c.id === activeId)) {
      setActiveId(components[0]?.id ?? null);
    }
  }, [components, activeId]);

  const headingId = `domain-title-${domain.id}`;
  const active = components.find((c) => c.id === activeId) ?? components[0];
  const isAssigned =
    active && mode.kind === 'view' ? mode.assignedComponentIds.has(active.id) : true;

  return (
    <section
      id={`domain-${domain.id}`}
      aria-labelledby={headingId}
      className="scroll-mt-[calc(var(--page-chrome-h,0px)+8px)]"
    >
      <div className="bg-ops-blue-dark sticky top-[var(--page-chrome-h,0px)] z-[5]">
        <button
          type="button"
          onClick={() => setOpen((p) => !p)}
          aria-expanded={open}
          className="hover:bg-ops-blue/10 flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors"
        >
          <ChevronDown
            className={cn(
              'h-4 w-4 shrink-0 text-white/70 transition-transform',
              !open && '-rotate-90',
            )}
            aria-hidden="true"
          />
          <span
            aria-hidden="true"
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/15 text-sm font-semibold text-white"
          >
            {domain.id}
          </span>
          <h2 id={headingId} className="font-heading text-base font-semibold text-white">
            Domain {domain.id}: {domain.name}
          </h2>
        </button>
      </div>

      {open && active ? (
        <>
          {/* Tab strip — same brand-red treatment as the desktop
              proficiency column-header row. Active tab gets a darker
              red fill + 2px white underline (matches the DomainNav
              `tabs` variant pattern). Horizontal scroll if there are
              more components than fit. */}
          <div
            role="tablist"
            aria-label={`Components in domain ${domain.id}`}
            className={cn(
              'sticky top-[calc(var(--page-chrome-h,0px)+44px)] z-[4]',
              'bg-ops-red-light flex w-full',
            )}
          >
            {components.map((c) => {
              const isActive = c.id === active.id;
              const cAssigned = mode.kind === 'view' ? mode.assignedComponentIds.has(c.id) : false;
              const cSelected =
                mode.kind === 'edit' ? (mode.entries[c.id]?.proficiency ?? null) : null;
              const dotted = mode.kind === 'view' ? cAssigned : Boolean(cSelected);
              return (
                <button
                  key={c.id}
                  role="tab"
                  type="button"
                  aria-selected={isActive}
                  data-component-tab={c.id}
                  onClick={() => setActiveId(c.id)}
                  className={cn(
                    'relative min-w-0 flex-1 px-2 py-2',
                    'border-r border-white/20 last:border-r-0',
                    isActive
                      ? 'bg-ops-red-dark text-white'
                      : 'hover:bg-ops-red-dark/70 text-white/85 hover:text-white',
                    'font-heading text-[11px] font-semibold tracking-widest uppercase',
                    'transition-colors',
                  )}
                >
                  {c.id}
                  {dotted ? (
                    <span
                      className="absolute top-1 right-1.5 h-1.5 w-1.5 rounded-full bg-white"
                      aria-hidden="true"
                    />
                  ) : null}
                </button>
              );
            })}
          </div>

          {/* Active component title strip — id + title (selected
              proficiency badge lives in the Ratings section, not
              here). Assigned badge stays in view mode. */}
          <div className="border-b border-gray-200 bg-white px-4 py-3">
            <div className="mb-1 flex items-center gap-2">
              <span className="font-mono text-[11px] font-semibold text-gray-400">{active.id}</span>
              {mode.kind === 'view' && isAssigned ? (
                <span className="text-ops-red inline-flex items-center gap-1 text-[10px] font-medium uppercase">
                  <Check className="h-3 w-3" aria-hidden="true" />
                  Assigned
                </span>
              ) : null}
            </div>
            <p className="text-ops-blue-dark text-sm leading-snug font-semibold">{active.title}</p>
          </div>

          <MobileComponentBody
            key={active.id}
            component={active}
            mode={mode}
            storageScope={storageScope}
          />
        </>
      ) : null}
    </section>
  );
}

/** Re-exported for use outside the grid (e.g. PDF renderer alignment). */
export { PROFICIENCY_LEVELS };
