import type { DashboardSectionsConfig } from '@ops/shared';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  SECTION_COPY,
  ST_BLURB,
  ST_HEADING,
  ST_ON,
  ST_CYCLE_CLOSE_LABEL,
  ST_CYCLE_CLOSE_BLURB,
  ST_CYCLE_CLOSE_PLACEHOLDER,
} from './copyStrings';

/**
 * Section toggle list — one row per top-level area of the staff dashboard,
 * with a switch on the right. Picked over a tile grid because the 1/3
 * editor column doesn't have room for cards without ugly title wrapping.
 *
 * The whole row is clickable (large click target). The switch is the
 * visual primary state indicator; row background shifts subtly when on.
 */

export function SectionTilesEditor({
  value,
  onChange,
  cycleCloseLabel,
  onCycleCloseLabelChange,
}: {
  value: DashboardSectionsConfig;
  onChange: (next: DashboardSectionsConfig) => void;
  cycleCloseLabel: string;
  onCycleCloseLabelChange: (next: string) => void;
}) {
  const keys = Object.keys(SECTION_COPY) as (keyof DashboardSectionsConfig)[];

  function toggle(k: keyof DashboardSectionsConfig) {
    onChange({ ...value, [k]: !value[k] });
  }

  return (
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

      {/* Cycle close date input */}
      <div className="mt-6 space-y-2">
        <Label htmlFor="cycleCloseLabel" className="text-sm font-semibold">
          {ST_CYCLE_CLOSE_LABEL}
        </Label>
        <p className="text-muted-foreground text-xs">{ST_CYCLE_CLOSE_BLURB}</p>
        <Input
          id="cycleCloseLabel"
          type="text"
          value={cycleCloseLabel}
          onChange={(e) => onCycleCloseLabelChange(e.target.value)}
          placeholder={ST_CYCLE_CLOSE_PLACEHOLDER}
          maxLength={50}
          className="mt-1"
        />
      </div>
    </section>
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
