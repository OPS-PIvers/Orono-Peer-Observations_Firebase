import {
  type CycleCloseMonthDay,
  type DashboardSectionsConfig,
  cycleCloseMonthDay,
} from '@ops/shared';
import { cn } from '@/lib/utils';
import {
  CYCLE_DATE_BLURB,
  CYCLE_DATE_HEADING,
  SECTION_COPY,
  ST_BLURB,
  ST_HEADING,
  ST_ON,
} from './copyStrings';

/**
 * Section toggle list — one row per top-level area of the staff dashboard,
 * with a switch on the right. Picked over a tile grid because the 1/3
 * editor column doesn't have room for cards without ugly title wrapping.
 *
 * The whole row is clickable (large click target). The switch is the
 * visual primary state indicator; row background shifts subtly when on.
 *
 * Also hosts the Cycle close date input, which lives on the same Layout tab
 * so admins can configure the stat-bar deadline next to the section toggles.
 */

export function SectionTilesEditor({
  value,
  onChange,
  cycleCloseDate,
  onCycleCloseDateChange,
}: {
  value: DashboardSectionsConfig;
  onChange: (next: DashboardSectionsConfig) => void;
  cycleCloseDate: CycleCloseMonthDay;
  onCycleCloseDateChange: (next: CycleCloseMonthDay) => void;
}) {
  const keys = Object.keys(SECTION_COPY) as (keyof DashboardSectionsConfig)[];

  function toggle(k: keyof DashboardSectionsConfig) {
    onChange({ ...value, [k]: !value[k] });
  }

  /** Validate and commit a free-typed MM-DD value; ignore invalid input. */
  function handleCycleDateChange(raw: string) {
    const result = cycleCloseMonthDay.safeParse(raw);
    if (result.success) {
      onCycleCloseDateChange(result.data);
    }
  }

  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-foreground mb-1 text-base font-semibold">{ST_HEADING}</h3>
        <p className="text-muted-foreground mb-4 text-sm">{ST_BLURB}</p>
        <ul className="border-border bg-background divide-border divide-y overflow-hidden rounded-lg border">
          {keys.map((k) => {
            const on = value[k];
            const copy = SECTION_COPY[k];
            return (
              <li key={k}>
                <button
                  type="button"
                  onClick={() => toggle(k)}
                  aria-pressed={on}
                  aria-label={`${copy.title} — ${on ? 'on' : 'off'}`}
                  className={cn(
                    'flex w-full items-center gap-4 px-4 py-3 text-left transition-colors',
                    on ? 'bg-ops-blue-lighter/30' : 'hover:bg-muted/40',
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div
                      className={cn(
                        'text-sm font-semibold',
                        on ? 'text-ops-blue-dark' : 'text-foreground',
                      )}
                    >
                      {copy.title}
                    </div>
                    <div className="text-muted-foreground mt-0.5 text-xs leading-snug">
                      {copy.description}
                    </div>
                  </div>
                  <Switch on={on} label={ST_ON} />
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {/* ── Cycle close date ──────────────────────────────────────────── */}
      <section>
        <h3 className="text-foreground mb-1 text-base font-semibold">{CYCLE_DATE_HEADING}</h3>
        <p className="text-muted-foreground mb-3 text-sm">{CYCLE_DATE_BLURB}</p>
        <label className="block">
          <span className="text-foreground mb-1 block text-sm font-medium">Cycle close date</span>
          {/* The date input expects YYYY-MM-DD; we store only MM-DD so we
              anchor it to a fixed leap-year (2000) for display purposes.
              Any year that allows Feb 29 works; the year is discarded on
              change. */}
          <input
            type="date"
            aria-label="Cycle close date"
            value={`2000-${cycleCloseDate}`}
            onChange={(e) => {
              // e.target.value is YYYY-MM-DD or '' (cleared)
              const mmdd = e.target.value.slice(5); // strip "YYYY-"
              handleCycleDateChange(mmdd);
            }}
            className="border-input bg-background text-foreground focus:ring-ops-blue rounded-md border px-3 py-1.5 text-sm focus:ring-2 focus:outline-none"
          />
        </label>
      </section>
    </div>
  );
}

/** iOS-style switch — same visual primitive as CycleStepsEditor.ShowSwitch.
 *  Used here as a non-interactive indicator (parent button handles clicks). */
function Switch({ on, label }: { on: boolean; label: string }) {
  return (
    <span
      role="presentation"
      aria-hidden="true"
      title={label}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
        on ? 'bg-ops-blue' : 'bg-gray-300',
      )}
    >
      <span
        className={cn(
          'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
          on ? 'translate-x-5' : 'translate-x-0.5',
        )}
      />
    </span>
  );
}
