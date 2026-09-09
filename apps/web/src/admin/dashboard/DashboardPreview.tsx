import { useEffect, useMemo, useRef, useState } from 'react';
import {
  cycleStatus,
  effectiveModulesFor,
  staffMatchesAudience,
  type AudienceContext,
  type DashboardQuickMaterial,
  type DashboardSectionsConfig,
  type DashboardStep,
  type Staff,
  type StaffYear,
} from '@ops/shared';
import { DashboardView, type ModuleChip } from '@/dashboard/DashboardView';
import { Eye, UserCog } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import {
  SAMPLE_FIRST_NAME,
  SAMPLE_PEER_EVALUATOR,
  SAMPLE_STAFF,
  buildSampleCheckpoints,
} from './previewSampleData';
import {
  CYCLE_STATUS_LABELS,
  EMPTY_AUDIENCE_OPTIONS,
  YEAR_OPTIONS,
  audienceYearLabel,
  roleLabel,
  toggleIn,
  type AudienceOptions,
} from './audienceOptions';
import {
  PV_BLURB,
  PV_BUILDINGS,
  PV_MODULES,
  PV_PHASE,
  PV_PREVIEW_AS,
  PV_RESET,
  PV_ROLE,
  PV_SUMMATIVE,
  PV_YEAR,
} from './copyStrings';

/**
 * Right-column live preview. Renders <DashboardView> with the admin's
 * *draft* sections/checkpoints/quick-materials plus a synthesized sample
 * staff member so the preview always reflects what a typical user sees
 * throughout the year — independent of whether the current admin has any
 * active observations of their own.
 *
 * "Preview as" (header popover) edits the sample staff member's year,
 * summative flag, role, buildings and manual modules, and the quick
 * materials are filtered through the same `staffMatchesAudience` the
 * staff dashboard uses, so an admin can see exactly which cards a given
 * group gets. Cycle phase is derived from year + summative, as it is on
 * real staff docs, so it is shown rather than set.
 *
 * Read-only: no Acknowledge action, no outbound links.
 */

export interface DashboardPreviewProps {
  sections: DashboardSectionsConfig;
  steps: DashboardStep[];
  quickMaterials: DashboardQuickMaterial[];
  cycleCloseLabel: string;
  audienceOptions?: AudienceOptions | undefined;
}

/** The five things "Preview as" can change on the sample staff member. */
export interface PreviewPersona {
  year: StaffYear;
  summativeYear: boolean;
  role: string;
  buildings: string[];
  modules: string[];
}

export const DEFAULT_PERSONA: PreviewPersona = {
  year: SAMPLE_STAFF.year,
  summativeYear: SAMPLE_STAFF.summativeYear,
  role: SAMPLE_STAFF.role,
  buildings: SAMPLE_STAFF.buildings,
  modules: SAMPLE_STAFF.modules,
};

function yearTierLabel(year: number): string {
  return year >= 4 ? `Probationary Y${String(year - 3)}` : `Year ${String(year)}`;
}

export function DashboardPreview({
  sections,
  steps,
  quickMaterials,
  cycleCloseLabel,
  audienceOptions = EMPTY_AUDIENCE_OPTIONS,
}: DashboardPreviewProps) {
  const tasks = useMemo(() => buildSampleCheckpoints(steps), [steps]);
  const [persona, setPersona] = useState<PreviewPersona>(DEFAULT_PERSONA);

  const sampleStaff = useMemo<Staff>(() => ({ ...SAMPLE_STAFF, ...persona }), [persona]);

  const ctx = useMemo<AudienceContext>(
    () => ({
      modules: audienceOptions.modules,
      knownBuildings: audienceOptions.buildings.map((b) => b.displayName),
      knownRoles: audienceOptions.roles.map((r) => r.roleId),
    }),
    [audienceOptions],
  );

  const visibleMaterials = useMemo(
    () => quickMaterials.filter((m) => staffMatchesAudience(sampleStaff, m.audience, ctx)),
    [quickMaterials, sampleStaff, ctx],
  );

  const moduleChips = useMemo<ModuleChip[]>(() => {
    const known = effectiveModulesFor(sampleStaff, audienceOptions.modules).map((m) => ({
      moduleId: m.moduleId,
      displayName: m.displayName,
      color: m.color,
    }));
    // Manual ids with no module doc (an empty admin environment) still show
    // as chips so the preview reflects the persona the admin set.
    const missing = sampleStaff.modules
      .filter((id) => !known.some((k) => k.moduleId === id))
      .map((id) => ({ moduleId: id, displayName: id, color: 'indigo' as const }));
    return [...known, ...missing];
  }, [sampleStaff, audienceOptions.modules]);

  return (
    <PreviewFrame
      controls={
        <PreviewAsPopover
          persona={persona}
          onChange={setPersona}
          options={audienceOptions}
          hidden={visibleMaterials.length < quickMaterials.length}
        />
      }
    >
      <DashboardView
        staff={sampleStaff}
        firstName={SAMPLE_FIRST_NAME}
        yearTierLabel={yearTierLabel(sampleStaff.year)}
        cycleYearLabel="2025 — 2026"
        cycleCloseLabel={cycleCloseLabel}
        sections={sections}
        tasks={tasks}
        quickMaterials={visibleMaterials}
        peerEvaluator={SAMPLE_PEER_EVALUATOR}
        readOnly
        roleDisplayName={roleLabel(audienceOptions, sampleStaff.role)}
        buildingNames={sampleStaff.buildings}
        moduleChips={moduleChips}
      />
    </PreviewFrame>
  );
}

function PreviewAsPopover({
  persona,
  onChange,
  options,
  hidden,
}: {
  persona: PreviewPersona;
  onChange: (next: PreviewPersona) => void;
  options: AudienceOptions;
  /** True when at least one material is filtered out for this persona. */
  hidden: boolean;
}) {
  const yearId = 'preview-as-year';
  const roleId = 'preview-as-role';
  const isDefault = JSON.stringify(persona) === JSON.stringify(DEFAULT_PERSONA);
  const phase = CYCLE_STATUS_LABELS[cycleStatus(persona.year, persona.summativeYear)];
  const set = <K extends keyof PreviewPersona>(key: K, value: PreviewPersona[K]) =>
    onChange({ ...persona, [key]: value });

  // Offer the persona's current role even if it isn't in the active list
  // (the sample's default 'teacher' may not exist in a fresh environment).
  const roleChoices = options.roles.some((r) => r.roleId === persona.role)
    ? options.roles
    : [{ roleId: persona.role, displayName: roleLabel(options, persona.role) }, ...options.roles];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn('h-7 gap-1 px-2 text-xs font-medium', !isDefault && 'text-ops-blue')}
          aria-label={PV_PREVIEW_AS}
        >
          <UserCog className="h-3.5 w-3.5" />
          {PV_PREVIEW_AS}
          {!isDefault ? (
            <span className="bg-ops-blue-lighter text-ops-blue rounded-full px-1.5 text-[10px]">
              {hidden ? 'filtered' : 'custom'}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-3" data-testid="preview-as-popover">
        <div className="grid gap-3 text-sm">
          <p className="text-muted-foreground text-xs">{PV_BLURB}</p>

          <div className="grid gap-1.5">
            <Label htmlFor={yearId} className="text-xs font-medium">
              {PV_YEAR}
            </Label>
            <select
              id={yearId}
              value={persona.year}
              onChange={(e) => {
                const y = YEAR_OPTIONS.find((v) => String(v) === e.target.value);
                if (y !== undefined) set('year', y);
              }}
              className="border-input bg-background h-8 rounded-md border px-2 text-sm"
            >
              {YEAR_OPTIONS.map((y) => (
                <option key={y} value={y}>
                  {audienceYearLabel(y)}
                </option>
              ))}
            </select>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={persona.summativeYear}
              onChange={(e) => set('summativeYear', e.target.checked)}
            />
            {PV_SUMMATIVE}
          </label>
          <p className="text-muted-foreground -mt-1 text-xs">
            {PV_PHASE}: <span className="text-foreground font-medium">{phase}</span>
          </p>

          <div className="grid gap-1.5">
            <Label htmlFor={roleId} className="text-xs font-medium">
              {PV_ROLE}
            </Label>
            <select
              id={roleId}
              value={persona.role}
              onChange={(e) => set('role', e.target.value)}
              className="border-input bg-background h-8 rounded-md border px-2 text-sm"
            >
              {roleChoices.map((r) => (
                <option key={r.roleId} value={r.roleId}>
                  {r.displayName}
                </option>
              ))}
            </select>
          </div>

          <CheckList
            title={PV_BUILDINGS}
            choices={options.buildings.map((b) => ({ id: b.displayName, label: b.displayName }))}
            selected={persona.buildings}
            onToggle={(id) => set('buildings', toggleIn(persona.buildings, id))}
          />
          <CheckList
            title={PV_MODULES}
            choices={options.modules.map((m) => ({ id: m.moduleId, label: m.displayName }))}
            selected={persona.modules}
            onToggle={(id) => set('modules', toggleIn(persona.modules, id))}
          />

          {!isDefault ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onChange(DEFAULT_PERSONA)}
            >
              {PV_RESET}
            </Button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function CheckList({
  title,
  choices,
  selected,
  onToggle,
}: {
  title: string;
  choices: { id: string; label: string }[];
  selected: readonly string[];
  onToggle: (id: string) => void;
}) {
  // Selected values with no matching choice (the sample's default building
  // in an environment that hasn't configured it) still render so they can
  // be un-ticked.
  const extra = selected.filter((s) => !choices.some((c) => c.id === s));
  const all = [...choices, ...extra.map((id) => ({ id, label: id }))];
  return (
    <fieldset className="grid gap-1">
      <legend className="mb-1 text-xs font-medium">{title}</legend>
      {all.length === 0 ? (
        <p className="text-muted-foreground text-xs">None configured.</p>
      ) : (
        <div className="grid max-h-32 gap-1 overflow-y-auto">
          {all.map((c) => (
            <label key={c.id} className="flex items-center gap-2 text-sm">
              <Checkbox checked={selected.includes(c.id)} onChange={() => onToggle(c.id)} />
              <span className="truncate">{c.label}</span>
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}

/**
 * Chrome around the live preview: header banner + zoomable viewport.
 *
 * The inner dashboard is locked to its natural 1240px design width so the
 * staff layout doesn't trigger its single-column responsive media query
 * inside this small column. CSS `zoom` (rather than `transform: scale`)
 * shrinks both the visual and the box, so the wrapping container reports
 * the correct height to the scroll container and no horizontal ghost
 * area lingers.
 *
 * Scale is computed from the wrapper's actual rendered width via
 * ResizeObserver so the preview tracks the column as the viewport resizes.
 * `scrollbar-gutter: stable` reserves the scrollbar's column so toggling
 * sections doesn't change the wrapper width and trigger a zoom feedback
 * loop.
 */
const NATURAL_WIDTH = 1240;

function PreviewFrame({
  children,
  controls,
}: {
  children: React.ReactNode;
  controls?: React.ReactNode;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.6);

  useEffect(() => {
    if (!wrapperRef.current) return;
    const target = wrapperRef.current;
    const applyWidth = (w: number) => {
      if (w <= 0) return;
      setScale(Math.max(0.3, Math.min(1, w / NATURAL_WIDTH)));
    };
    applyWidth(target.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      applyWidth(entry.contentRect.width);
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="border-border bg-background flex h-full flex-col overflow-hidden rounded-lg border">
      <div className="bg-ops-blue-lighter/50 border-border flex items-center gap-2 border-b px-3 py-1.5 text-xs font-semibold">
        <Eye className="text-ops-blue h-4 w-4" />
        <span className="text-ops-blue-dark">Preview — what staff see</span>
        <span className="text-muted-foreground ml-auto font-normal">Sample data</span>
        {controls}
      </div>
      <div
        ref={wrapperRef}
        className="flex-1 overflow-x-hidden overflow-y-auto"
        style={{ scrollbarGutter: 'stable' }}
      >
        <div style={{ zoom: scale, width: `${String(NATURAL_WIDTH)}px` }}>{children}</div>
      </div>
    </div>
  );
}
