import { useState } from 'react';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { ChevronDown, ChevronUp } from 'lucide-react';
import {
  CHECKPOINT_TYPE_KEYS,
  type CheckpointTypeKey,
  type DashboardCheckpointConfig,
  type DashboardCheckpointsConfig,
} from '@ops/shared';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import {
  CHECKPOINT_COPY,
  CS_BLURB,
  CS_CUSTOMIZE_HIDE,
  CS_CUSTOMIZE_TOGGLE,
  CS_HEADING,
  CS_LABEL_CHIP,
  CS_LABEL_CTA,
  CS_LABEL_TITLE,
  CS_PLACEHOLDER_DEFAULT,
  CS_SHOW_LABEL,
} from './copyStrings';
import { GripHandle, SortableItem } from './SortableItem';

/**
 * Cycle-steps editor. Renders the 8 checkpoint types as a vertical,
 * drag-reorderable list. Each row has:
 *   - drag handle
 *   - phase chip (Schedule / Visit / Reflect / Sign-off)
 *   - plain-English title + description
 *   - a visual "Show this step to staff" switch
 *   - collapsed-by-default "Rename" expander revealing 3 label-override
 *     fields
 */

interface Row extends DashboardCheckpointConfig {
  key: CheckpointTypeKey;
}

function configToRows(cfg: DashboardCheckpointsConfig | undefined): Row[] {
  const safe = cfg ?? {};
  return CHECKPOINT_TYPE_KEYS.map((key, idx) => {
    const c = safe[key];
    return {
      key,
      enabled: c?.enabled ?? true,
      order: c?.order ?? idx,
      typeLabelOverride: c?.typeLabelOverride ?? '',
      titleOverride: c?.titleOverride ?? '',
      ctaLabelOverride: c?.ctaLabelOverride ?? '',
    };
  }).sort((a, b) => a.order - b.order);
}

function rowsToConfig(rows: Row[]): DashboardCheckpointsConfig {
  const out: DashboardCheckpointsConfig = {};
  rows.forEach((r, idx) => {
    out[r.key] = {
      enabled: r.enabled,
      order: idx,
      typeLabelOverride: r.typeLabelOverride.trim(),
      titleOverride: r.titleOverride.trim(),
      ctaLabelOverride: r.ctaLabelOverride.trim(),
    };
  });
  return out;
}

export function CycleStepsEditor({
  value,
  onChange,
}: {
  value: DashboardCheckpointsConfig;
  onChange: (next: DashboardCheckpointsConfig) => void;
}) {
  const rows = configToRows(value);
  const [expanded, setExpanded] = useState<Set<CheckpointTypeKey>>(new Set());
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function commit(next: Row[]) {
    onChange(rowsToConfig(next));
  }

  function updateRow(key: CheckpointTypeKey, patch: Partial<Row>) {
    commit(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function onDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    const oldIndex = rows.findIndex((r) => r.key === e.active.id);
    const newIndex = rows.findIndex((r) => r.key === e.over!.id); // eslint-disable-line @typescript-eslint/no-non-null-assertion
    if (oldIndex === -1 || newIndex === -1) return;
    commit(arrayMove(rows, oldIndex, newIndex));
  }

  function toggleExpand(key: CheckpointTypeKey) {
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <section>
      <h3 className="text-foreground mb-1 text-base font-semibold">{CS_HEADING}</h3>
      <p className="text-muted-foreground mb-4 text-sm">{CS_BLURB}</p>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={rows.map((r) => r.key)} strategy={verticalListSortingStrategy}>
          <ul className="space-y-2">
            {rows.map((r) => {
              const copy = CHECKPOINT_COPY[r.key];
              const isExpanded = expanded.has(r.key);
              return (
                <SortableItem key={r.key} id={r.key}>
                  {({ dragHandleProps }) => (
                    <li className="border-border bg-background rounded-lg border">
                      <div className="flex items-start gap-2 p-3">
                        <GripHandle dragHandleProps={dragHandleProps} />
                        <div className="min-w-0 flex-1">
                          <div className="mb-1 flex items-center gap-2">
                            <PhaseChip phase={copy.phase} />
                            <span
                              className={cn(
                                'text-sm font-semibold',
                                r.enabled ? 'text-foreground' : 'text-muted-foreground',
                              )}
                            >
                              {copy.title}
                            </span>
                          </div>
                          <p className="text-muted-foreground text-xs leading-relaxed">
                            <strong className="text-foreground font-medium">When it shows:</strong>{' '}
                            {copy.whenItShows}
                          </p>
                          <p className="text-muted-foreground text-xs leading-relaxed">
                            <strong className="text-foreground font-medium">What staff see:</strong>{' '}
                            {copy.whatItDoes}
                          </p>
                          <button
                            type="button"
                            onClick={() => toggleExpand(r.key)}
                            className="text-ops-blue hover:bg-ops-blue-lighter/40 mt-2 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium"
                          >
                            {isExpanded ? CS_CUSTOMIZE_HIDE : CS_CUSTOMIZE_TOGGLE}
                            {isExpanded ? (
                              <ChevronUp className="h-3 w-3" />
                            ) : (
                              <ChevronDown className="h-3 w-3" />
                            )}
                          </button>
                        </div>
                        <ShowSwitch
                          on={r.enabled}
                          onChange={() => updateRow(r.key, { enabled: !r.enabled })}
                        />
                      </div>
                      {isExpanded ? (
                        <div className="bg-muted/30 grid gap-3 px-3 pb-3 md:grid-cols-3">
                          <LabelField
                            label={CS_LABEL_CHIP}
                            value={r.typeLabelOverride}
                            onChange={(v) => updateRow(r.key, { typeLabelOverride: v })}
                          />
                          <LabelField
                            label={CS_LABEL_TITLE}
                            value={r.titleOverride}
                            onChange={(v) => updateRow(r.key, { titleOverride: v })}
                          />
                          <LabelField
                            label={CS_LABEL_CTA}
                            value={r.ctaLabelOverride}
                            onChange={(v) => updateRow(r.key, { ctaLabelOverride: v })}
                          />
                        </div>
                      ) : null}
                    </li>
                  )}
                </SortableItem>
              );
            })}
          </ul>
        </SortableContext>
      </DndContext>
    </section>
  );
}

function PhaseChip({ phase }: { phase: 'Schedule' | 'Visit' | 'Reflect' | 'Sign-off' }) {
  const palette: Record<typeof phase, string> = {
    Schedule: 'bg-blue-100 text-blue-800',
    Visit: 'bg-emerald-100 text-emerald-800',
    Reflect: 'bg-amber-100 text-amber-800',
    'Sign-off': 'bg-red-100 text-red-800',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide uppercase',
        palette[phase],
      )}
    >
      {phase}
    </span>
  );
}

function ShowSwitch({ on, onChange }: { on: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={CS_SHOW_LABEL}
      onClick={onChange}
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
    </button>
  );
}

function LabelField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="grid gap-1">
      <Label className="text-xs">{label}</Label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={CS_PLACEHOLDER_DEFAULT}
      />
    </div>
  );
}
