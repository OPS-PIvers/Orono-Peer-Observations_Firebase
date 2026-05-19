import { Check, X } from 'lucide-react';
import type { DashboardSectionsConfig } from '@ops/shared';
import { cn } from '@/lib/utils';
import { SECTION_COPY, ST_BLURB, ST_HEADING, ST_OFF, ST_ON } from './copyStrings';

/**
 * Visual section toggles — five tiles, one per top-level area of the
 * staff dashboard. Click a tile to flip it. The on/off state is
 * communicated by tile color + a small Check/X badge in the corner.
 */

export function SectionTilesEditor({
  value,
  onChange,
}: {
  value: DashboardSectionsConfig;
  onChange: (next: DashboardSectionsConfig) => void;
}) {
  const keys = Object.keys(SECTION_COPY) as (keyof DashboardSectionsConfig)[];

  function toggle(k: keyof DashboardSectionsConfig) {
    onChange({ ...value, [k]: !value[k] });
  }

  return (
    <section>
      <h3 className="text-foreground mb-1 text-base font-semibold">{ST_HEADING}</h3>
      <p className="text-muted-foreground mb-4 text-sm">{ST_BLURB}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {keys.map((k) => {
          const on = value[k];
          const copy = SECTION_COPY[k];
          return (
            <button
              key={k}
              type="button"
              onClick={() => toggle(k)}
              aria-pressed={on}
              className={cn(
                'group relative flex flex-col items-start gap-1 rounded-lg border p-4 text-left transition-all',
                on
                  ? 'border-ops-blue bg-ops-blue-lighter/40'
                  : 'border-border bg-background hover:border-ops-blue/40',
              )}
            >
              <span
                className={cn(
                  'absolute top-3 right-3 inline-flex h-6 items-center gap-1 rounded-full px-2 text-[11px] font-semibold',
                  on ? 'bg-ops-blue text-white' : 'bg-muted text-muted-foreground',
                )}
              >
                {on ? (
                  <>
                    <Check className="h-3 w-3" /> {ST_ON}
                  </>
                ) : (
                  <>
                    <X className="h-3 w-3" /> {ST_OFF}
                  </>
                )}
              </span>
              <span
                className={cn(
                  'pr-12 text-sm font-semibold',
                  on ? 'text-ops-blue-dark' : 'text-foreground',
                )}
              >
                {copy.title}
              </span>
              <span className="text-muted-foreground pr-12 text-xs leading-snug">
                {copy.description}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
