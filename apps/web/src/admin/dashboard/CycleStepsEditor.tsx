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
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';
import {
  DATE_SOURCES,
  DONE_WHEN_OPTIONS,
  IN_PROGRESS_SOURCES,
  SHOW_WHEN_OPTIONS,
  STEP_BUTTON_TARGETS,
  STEP_CHIP_STYLES,
  WATCHED_KINDS,
  dashboardStep,
  type DashboardStep,
} from '@ops/shared';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import {
  BUTTON_TARGET_LABELS,
  CHIP_STYLE_LABELS,
  CS_ADD_STEP,
  CS_BLURB,
  CS_DELETE_STEP,
  CS_EDIT_HIDE,
  CS_EDIT_TOGGLE,
  CS_FIELD_BUTTON,
  CS_FIELD_BUTTON_TARGET,
  CS_FIELD_BUTTON_URL,
  CS_FIELD_CHIP,
  CS_FIELD_CHIP_STYLE,
  CS_FIELD_DATE,
  CS_FIELD_DESC,
  CS_FIELD_DONE,
  CS_FIELD_HIDE_DONE,
  CS_FIELD_PROGRESS,
  CS_FIELD_SHOW,
  CS_FIELD_TITLE,
  CS_FIELD_WATCHES,
  CS_HEADING,
  CS_PLACEHOLDER_DEFAULT,
  CS_SHOW_LABEL,
  DATE_SOURCE_LABELS,
  DONE_WHEN_LABELS,
  IN_PROGRESS_LABELS,
  SHOW_WHEN_LABELS,
  WATCHED_KIND_LABELS,
} from './copyStrings';
import { GripHandle, SortableItem } from './SortableItem';

/**
 * Step builder. Renders the composed `DashboardStep[]` as a drag-reorderable
 * list. Each row toggles enable, shows the title, and expands to edit labels
 * and the logic slots via plain-language dropdowns.
 */

export function CycleStepsEditor({
  value,
  onChange,
}: {
  value: DashboardStep[];
  onChange: (next: DashboardStep[]) => void;
}) {
  const steps = [...value].sort((a, b) => a.order - b.order);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function commit(next: DashboardStep[]) {
    onChange(next.map((s, idx) => ({ ...s, order: idx })));
  }

  function updateStep(id: string, patch: Partial<DashboardStep>) {
    commit(steps.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  function addStep() {
    const id = `step-${String(Date.now())}`;
    const created = dashboardStep.parse({
      id,
      order: steps.length,
      title: 'New step',
      chipLabel: 'Step',
      showWhen: 'always',
      doneWhen: 'never',
      buttonTarget: 'none',
    });
    commit([...steps, created]);
    setExpanded((s) => new Set(s).add(id));
  }

  function deleteStep(id: string) {
    commit(steps.filter((s) => s.id !== id));
  }

  function onDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    const oldIndex = steps.findIndex((s) => s.id === e.active.id);
    const newIndex = steps.findIndex((s) => s.id === e.over!.id); // eslint-disable-line @typescript-eslint/no-non-null-assertion
    if (oldIndex === -1 || newIndex === -1) return;
    commit(arrayMove(steps, oldIndex, newIndex));
  }

  function toggleExpand(id: string) {
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <section>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-foreground mb-1 text-base font-semibold">{CS_HEADING}</h3>
          <p className="text-muted-foreground text-sm">{CS_BLURB}</p>
        </div>
        <button
          type="button"
          onClick={addStep}
          className="bg-ops-blue inline-flex shrink-0 items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium text-white"
        >
          <Plus className="h-4 w-4" />
          {CS_ADD_STEP}
        </button>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={steps.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <ul className="space-y-2">
            {steps.map((step) => {
              const isExpanded = expanded.has(step.id);
              return (
                <SortableItem key={step.id} id={step.id}>
                  {({ dragHandleProps }) => (
                    <li className="border-border bg-background rounded-lg border">
                      <div className="flex items-start gap-2 p-3">
                        <GripHandle dragHandleProps={dragHandleProps} />
                        <div className="min-w-0 flex-1">
                          <span
                            className={cn(
                              'text-sm font-semibold',
                              step.enabled ? 'text-foreground' : 'text-muted-foreground',
                            )}
                          >
                            {step.title || '(untitled step)'}
                          </span>
                          <p className="text-muted-foreground mt-0.5 text-xs">
                            {SHOW_WHEN_LABELS[step.showWhen]} · {DONE_WHEN_LABELS[step.doneWhen]}
                          </p>
                          <button
                            type="button"
                            onClick={() => toggleExpand(step.id)}
                            className="text-ops-blue hover:bg-ops-blue-lighter/40 mt-2 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium"
                          >
                            {isExpanded ? CS_EDIT_HIDE : CS_EDIT_TOGGLE}
                            {isExpanded ? (
                              <ChevronUp className="h-3 w-3" />
                            ) : (
                              <ChevronDown className="h-3 w-3" />
                            )}
                          </button>
                        </div>
                        <ShowSwitch
                          on={step.enabled}
                          onChange={() => updateStep(step.id, { enabled: !step.enabled })}
                        />
                      </div>

                      {isExpanded ? (
                        <div className="bg-muted/30 grid gap-3 px-3 pb-3 md:grid-cols-2">
                          <TextField
                            label={CS_FIELD_TITLE}
                            value={step.title}
                            onChange={(v) => updateStep(step.id, { title: v })}
                          />
                          <TextField
                            label={CS_FIELD_CHIP}
                            value={step.chipLabel}
                            onChange={(v) => updateStep(step.id, { chipLabel: v })}
                          />
                          <TextField
                            label={CS_FIELD_DESC}
                            value={step.description}
                            onChange={(v) => updateStep(step.id, { description: v })}
                          />
                          <TextField
                            label={CS_FIELD_BUTTON}
                            value={step.buttonLabel}
                            onChange={(v) => updateStep(step.id, { buttonLabel: v })}
                          />
                          <SelectField
                            label={CS_FIELD_CHIP_STYLE}
                            value={step.chipStyle}
                            options={STEP_CHIP_STYLES}
                            labels={CHIP_STYLE_LABELS}
                            onChange={(v) =>
                              updateStep(step.id, { chipStyle: v as DashboardStep['chipStyle'] })
                            }
                          />
                          <SelectField
                            label={CS_FIELD_WATCHES}
                            value={step.watchedKind}
                            options={WATCHED_KINDS}
                            labels={WATCHED_KIND_LABELS}
                            onChange={(v) =>
                              updateStep(step.id, {
                                watchedKind: v as DashboardStep['watchedKind'],
                              })
                            }
                          />
                          <SelectField
                            label={CS_FIELD_SHOW}
                            value={step.showWhen}
                            options={SHOW_WHEN_OPTIONS}
                            labels={SHOW_WHEN_LABELS}
                            onChange={(v) =>
                              updateStep(step.id, { showWhen: v as DashboardStep['showWhen'] })
                            }
                          />
                          <SelectField
                            label={CS_FIELD_DONE}
                            value={step.doneWhen}
                            options={DONE_WHEN_OPTIONS}
                            labels={DONE_WHEN_LABELS}
                            onChange={(v) =>
                              updateStep(step.id, { doneWhen: v as DashboardStep['doneWhen'] })
                            }
                          />
                          <SelectField
                            label={CS_FIELD_DATE}
                            value={step.dateFrom}
                            options={DATE_SOURCES}
                            labels={DATE_SOURCE_LABELS}
                            onChange={(v) =>
                              updateStep(step.id, { dateFrom: v as DashboardStep['dateFrom'] })
                            }
                          />
                          <SelectField
                            label={CS_FIELD_PROGRESS}
                            value={step.inProgress}
                            options={IN_PROGRESS_SOURCES}
                            labels={IN_PROGRESS_LABELS}
                            onChange={(v) =>
                              updateStep(step.id, { inProgress: v as DashboardStep['inProgress'] })
                            }
                          />
                          <SelectField
                            label={CS_FIELD_BUTTON_TARGET}
                            value={step.buttonTarget}
                            options={STEP_BUTTON_TARGETS}
                            labels={BUTTON_TARGET_LABELS}
                            onChange={(v) =>
                              updateStep(step.id, {
                                buttonTarget: v as DashboardStep['buttonTarget'],
                              })
                            }
                          />
                          {step.buttonTarget === 'fixedUrl' ? (
                            <TextField
                              label={CS_FIELD_BUTTON_URL}
                              value={step.buttonUrl}
                              onChange={(v) => updateStep(step.id, { buttonUrl: v })}
                            />
                          ) : null}
                          <label className="flex items-center gap-2 text-xs font-medium">
                            <input
                              type="checkbox"
                              checked={step.hideWhenDone}
                              onChange={() =>
                                updateStep(step.id, { hideWhenDone: !step.hideWhenDone })
                              }
                            />
                            {CS_FIELD_HIDE_DONE}
                          </label>
                          <button
                            type="button"
                            onClick={() => deleteStep(step.id)}
                            className="text-ops-red-dark hover:bg-ops-red-lighter/40 inline-flex items-center gap-1 justify-self-start rounded px-1.5 py-0.5 text-xs font-medium"
                          >
                            <Trash2 className="h-3 w-3" />
                            {CS_DELETE_STEP}
                          </button>
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

function TextField({
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

function SelectField({
  label,
  value,
  options,
  labels,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  labels: Record<string, string>;
  onChange: (v: string) => void;
}) {
  return (
    <div className="grid gap-1">
      <Label className="text-xs">{label}</Label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="border-input bg-background h-9 rounded-md border px-2 text-sm"
      >
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {labels[opt] ?? opt}
          </option>
        ))}
      </select>
    </div>
  );
}
