import { useId, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, Users } from 'lucide-react';
import {
  emptyAudience,
  hasStaleAudienceChips,
  isEveryoneAudience,
  type DashboardMaterialAudience,
  type StaleAudienceChips,
} from '@ops/shared';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { FilterChip } from '@/admin/_shared/FilterChip';
import { cn } from '@/lib/utils';
import {
  CYCLE_STATUS_LABELS,
  CYCLE_STATUS_OPTIONS,
  YEAR_OPTIONS,
  audienceYearLabel,
  audienceYearShort,
  moduleLabel,
  roleLabel,
  summarizeAudience,
  toggleIn,
  type AudienceOptions,
} from './audienceOptions';
import {
  AUD_CLEAR,
  AUD_COLLAPSE,
  AUD_DIM_BUILDINGS,
  AUD_DIM_MODULES,
  AUD_DIM_ROLES,
  AUD_DIM_STATUSES,
  AUD_DIM_YEARS,
  AUD_EXPAND,
  AUD_HELP,
  AUD_MATCH_LOADING,
  AUD_MATCH_NONE,
  AUD_PREFIX,
  AUD_STALE,
  audMatchCount,
} from './copyStrings';

/**
 * The "Visible to" control on a quick-material card.
 *
 * At rest it is one line — `Visible to: Everyone` or
 * `Visible to: Year 1, Year 2 · OMS` — so a card with a rule is no taller
 * than one without. Clicking the line opens the picker in place: five
 * chip dropdowns (one per dimension, built from the same FilterChip the
 * staff list uses), a live `Matches N of M staff` readout, and a warning
 * listing any chips that name something that no longer exists.
 */

export interface MatchCount {
  matched: number;
  total: number;
}

export interface AudiencePickerProps {
  value: DashboardMaterialAudience;
  onChange: (next: DashboardMaterialAudience) => void;
  options: AudienceOptions;
  /** `null` while the roster is still loading. */
  matchCount: MatchCount | null;
  stale: StaleAudienceChips;
}

export function AudiencePicker({
  value,
  onChange,
  options,
  matchCount,
  stale,
}: AudiencePickerProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const summary = summarizeAudience(value, options);
  const isStale = hasStaleAudienceChips(stale);
  const everyone = isEveryoneAudience(value);

  const set = <K extends keyof DashboardMaterialAudience>(
    key: K,
    next: DashboardMaterialAudience[K],
  ) => onChange({ ...value, [key]: next });

  return (
    <div className="grid gap-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        title={open ? AUD_COLLAPSE : AUD_EXPAND}
        className={cn(
          'flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-sm transition-colors',
          'hover:bg-muted focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-hidden',
        )}
      >
        <Users className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
        <span className="text-muted-foreground shrink-0">{AUD_PREFIX}</span>
        <span
          className={cn('min-w-0 truncate font-medium', !everyone && 'text-ops-blue')}
          title={summary}
        >
          {summary}
        </span>
        {isStale ? (
          <AlertTriangle
            className="h-3.5 w-3.5 shrink-0 text-amber-600"
            aria-label="Some choices no longer exist"
          />
        ) : null}
        {open ? (
          <ChevronUp className="text-muted-foreground ml-auto h-3.5 w-3.5 shrink-0" />
        ) : (
          <ChevronDown className="text-muted-foreground ml-auto h-3.5 w-3.5 shrink-0" />
        )}
      </button>

      {open ? (
        <div
          id={panelId}
          data-testid="audience-picker"
          className="border-border bg-muted/30 grid gap-3 rounded-md border p-3"
        >
          <p className="text-muted-foreground text-xs">{AUD_HELP}</p>

          <div className="flex flex-wrap items-center gap-2">
            <DimensionChip
              label={AUD_DIM_YEARS}
              selected={value.years.map(String)}
              summary={
                value.years.length > 0
                  ? [...value.years]
                      .sort((a, b) => a - b)
                      .map(audienceYearShort)
                      .join(', ')
                  : null
              }
              choices={YEAR_OPTIONS.map((y) => ({ id: String(y), label: audienceYearLabel(y) }))}
              onToggle={(id) => {
                const year = YEAR_OPTIONS.find((y) => String(y) === id);
                if (year !== undefined) set('years', toggleIn(value.years, year));
              }}
            />
            <DimensionChip
              label={AUD_DIM_STATUSES}
              selected={value.cycleStatuses}
              summary={
                value.cycleStatuses.length > 0
                  ? value.cycleStatuses.map((s) => CYCLE_STATUS_LABELS[s]).join(', ')
                  : null
              }
              choices={CYCLE_STATUS_OPTIONS.map((s) => ({ id: s, label: CYCLE_STATUS_LABELS[s] }))}
              onToggle={(id) => {
                const status = CYCLE_STATUS_OPTIONS.find((s) => s === id);
                if (status) set('cycleStatuses', toggleIn(value.cycleStatuses, status));
              }}
            />
            <DimensionChip
              label={AUD_DIM_BUILDINGS}
              selected={value.buildings}
              summary={value.buildings.length > 0 ? value.buildings.join(', ') : null}
              choices={options.buildings.map((b) => ({ id: b.displayName, label: b.displayName }))}
              onToggle={(id) => set('buildings', toggleIn(value.buildings, id))}
              emptyText="No buildings configured."
            />
            <DimensionChip
              label={AUD_DIM_ROLES}
              selected={value.roles}
              summary={
                value.roles.length > 0
                  ? value.roles.map((r) => roleLabel(options, r)).join(', ')
                  : null
              }
              choices={options.roles.map((r) => ({ id: r.roleId, label: r.displayName }))}
              onToggle={(id) => set('roles', toggleIn(value.roles, id))}
              emptyText="No roles configured."
            />
            <DimensionChip
              label={AUD_DIM_MODULES}
              selected={value.modules}
              summary={
                value.modules.length > 0
                  ? value.modules.map((m) => moduleLabel(options, m)).join(', ')
                  : null
              }
              choices={options.modules.map((m) => ({ id: m.moduleId, label: m.displayName }))}
              onToggle={(id) => set('modules', toggleIn(value.modules, id))}
              emptyText="No modules configured."
            />
          </div>

          {isStale ? (
            <p
              role="status"
              className="inline-flex flex-wrap items-center gap-1 text-xs font-medium text-amber-700"
            >
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              {AUD_STALE}{' '}
              <span className="font-mono">
                {[...stale.buildings, ...stale.roles, ...stale.modules].join(', ')}
              </span>
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <span
              className={cn(
                'text-xs font-medium',
                matchCount && !everyone && matchCount.matched === 0
                  ? 'text-ops-red-dark'
                  : 'text-muted-foreground',
              )}
              data-testid="audience-match-count"
            >
              {matchCount === null
                ? AUD_MATCH_LOADING
                : !everyone && matchCount.matched === 0
                  ? AUD_MATCH_NONE
                  : audMatchCount(matchCount.matched, matchCount.total)}
            </span>
            <div className="ml-auto flex items-center gap-2">
              {!everyone ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onChange(emptyAudience())}
                >
                  {AUD_CLEAR}
                </Button>
              ) : null}
              <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
                {AUD_COLLAPSE}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

interface Choice {
  id: string;
  label: string;
}

function DimensionChip({
  label,
  selected,
  summary,
  choices,
  onToggle,
  emptyText,
}: {
  label: string;
  selected: readonly string[];
  summary: string | null;
  choices: readonly Choice[];
  onToggle: (id: string) => void;
  emptyText?: string | undefined;
}) {
  // A stored value with no matching choice (renamed building, deleted role)
  // still shows as a checked row so the admin can see and un-tick it.
  const stale = selected.filter((s) => !choices.some((c) => c.id === s));
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <FilterChip label={label} count={selected.length} activeSummary={summary} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {choices.map((c) => (
          <DropdownMenuCheckboxItem
            key={c.id}
            checked={selected.includes(c.id)}
            onCheckedChange={() => onToggle(c.id)}
            onSelect={(e) => e.preventDefault()}
          >
            {c.label}
          </DropdownMenuCheckboxItem>
        ))}
        {stale.map((s) => (
          <DropdownMenuCheckboxItem
            key={`stale-${s}`}
            checked
            onCheckedChange={() => onToggle(s)}
            onSelect={(e) => e.preventDefault()}
            className="text-amber-700"
          >
            {s} (no longer exists)
          </DropdownMenuCheckboxItem>
        ))}
        {choices.length === 0 && stale.length === 0 ? (
          <div className="text-muted-foreground px-2 py-1.5 text-sm">
            {emptyText ?? 'Nothing to choose.'}
          </div>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
