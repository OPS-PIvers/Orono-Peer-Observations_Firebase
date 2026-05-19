import { useEffect, useState } from 'react';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { ExternalLink, Plus, Trash2 } from 'lucide-react';
import { type DashboardQuickMaterial, type MaterialIcon } from '@ops/shared';
import { DashboardIcon } from '@/dashboard/DashboardIcon';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { GripHandle, SortableItem } from './SortableItem';
import { IconPicker } from './IconPicker';
import {
  QM_ADD,
  QM_BLURB,
  QM_EMPTY,
  QM_FIELD_SUBTITLE,
  QM_FIELD_TITLE,
  QM_FIELD_URL,
  QM_HEADING,
  QM_ICON_PICKER,
  QM_REMOVE,
} from './copyStrings';

/**
 * Quick materials editor — drag-reorderable list of cards, each showing
 * a full preview of the rendered chip a staff member sees, alongside the
 * input fields. The icon picker is visual (see IconPicker.tsx).
 *
 * Items are tracked by their array index; cards carry a stable
 * client-side id so dnd-kit and React reconcilation behave correctly
 * during reorder. (The id is local to this component — it never goes to
 * Firestore; the persisted list is an array, position = order.)
 */

interface Item extends DashboardQuickMaterial {
  /** Local-only stable id for sortable + key, derived once on mount. */
  _id: string;
}

function makeId(): string {
  // Called only inside event handlers / state initialisers — never during render.
  return `m-${String(Date.now())}-${String(Math.random())}`;
}

function initIds(items: DashboardQuickMaterial[]): string[] {
  return items.map(() => makeId());
}

function stripIds(items: Item[]): DashboardQuickMaterial[] {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return items.map(({ _id, ...rest }) => rest);
}

export function QuickMaterialsEditor({
  value,
  onChange,
}: {
  value: DashboardQuickMaterial[];
  onChange: (next: DashboardQuickMaterial[]) => void;
}) {
  /**
   * Stable client-side ids — one per item in `value`. Stored in state so
   * they can be read safely during render (no react-hooks/refs violation).
   * The lazy initialiser runs once and assigns a random id to every item
   * currently in `value`.
   *
   * Ids are mutated synchronously inside event handlers (add, remove,
   * onDragEnd) by calling setIds. Because all of these are triggered from
   * user interactions, React batches the setIds call with the onChange call
   * so only one re-render occurs.
   */
  const [ids, setIds] = useState<string[]>(() => initIds(value));

  // Keep ids array length in sync with value length when the parent adds or
  // removes items outside of this component's own handlers (e.g. initial
  // load or a reset from above). A mismatch means we grew or shrank — extend
  // or truncate to match. We use an effect so we never mutate state during
  // render.
  useEffect(() => {
    setIds((prev) => {
      if (prev.length === value.length) return prev;
      const next: string[] = [];
      for (let i = 0; i < value.length; i++) {
        next[i] = prev[i] ?? makeId();
      }
      return next;
    });
  }, [value.length]);

  const items: Item[] = value.map((m, i) => ({ ...m, _id: ids[i] ?? `placeholder-${String(i)}` }));

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function commit(next: Item[]) {
    setIds(next.map((m) => m._id));
    onChange(stripIds(next));
  }
  function update(idx: number, patch: Partial<DashboardQuickMaterial>) {
    commit(items.map((m, i) => (i === idx ? { ...m, ...patch } : m)));
  }
  function add() {
    const newId = makeId();
    commit([...items, { _id: newId, label: '', sub: '', icon: 'doc', url: '' }]);
  }
  function remove(idx: number) {
    commit(items.filter((_, i) => i !== idx));
  }
  function onDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    const overId = e.over.id;
    const oldIndex = items.findIndex((m) => m._id === e.active.id);
    const newIndex = items.findIndex((m) => m._id === overId);
    if (oldIndex === -1 || newIndex === -1) return;
    commit(arrayMove(items, oldIndex, newIndex));
  }

  return (
    <section>
      <h3 className="text-foreground mb-1 text-base font-semibold">{QM_HEADING}</h3>
      <p className="text-muted-foreground mb-4 text-sm">{QM_BLURB}</p>

      {items.length === 0 ? (
        <p className="text-muted-foreground border-border rounded-lg border border-dashed p-8 text-center text-sm">
          {QM_EMPTY}
        </p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={items.map((m) => m._id)} strategy={verticalListSortingStrategy}>
            <ul className="space-y-3">
              {items.map((m, idx) => (
                <SortableItem key={m._id} id={m._id}>
                  {({ dragHandleProps }) => (
                    <li className="border-border bg-background rounded-lg border p-3">
                      <div className="flex items-start gap-2">
                        <GripHandle dragHandleProps={dragHandleProps} />
                        <div className="min-w-0 flex-1 space-y-3">
                          <div className="grid gap-3 md:grid-cols-[140px_1fr_1fr]">
                            <div className="grid gap-1">
                              <Label className="text-xs">{QM_ICON_PICKER}</Label>
                              <IconPicker
                                value={m.icon}
                                onChange={(icon: MaterialIcon) => update(idx, { icon })}
                              />
                            </div>
                            <div className="grid gap-1">
                              <Label className="text-xs">{QM_FIELD_TITLE}</Label>
                              <Input
                                value={m.label}
                                onChange={(e) => update(idx, { label: e.target.value })}
                                placeholder="My rubric"
                              />
                            </div>
                            <div className="grid gap-1">
                              <Label className="text-xs">{QM_FIELD_SUBTITLE}</Label>
                              <Input
                                value={m.sub}
                                onChange={(e) => update(idx, { sub: e.target.value })}
                                placeholder="Domains 2 & 3 · 14 components"
                              />
                            </div>
                          </div>
                          <div className="grid gap-1">
                            <Label className="text-xs">{QM_FIELD_URL}</Label>
                            <Input
                              value={m.url}
                              onChange={(e) => update(idx, { url: e.target.value })}
                              placeholder="https://drive.google.com/…"
                            />
                          </div>
                          <ChipPreview item={m} />
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={QM_REMOVE}
                          onClick={() => remove(idx)}
                        >
                          <Trash2 className="text-destructive h-4 w-4" />
                        </Button>
                      </div>
                    </li>
                  )}
                </SortableItem>
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      <Button type="button" variant="outline" onClick={add} className="mt-3">
        <Plus className="mr-1.5 h-4 w-4" />
        {QM_ADD}
      </Button>
    </section>
  );
}

function ChipPreview({ item }: { item: DashboardQuickMaterial }) {
  const empty = !item.label && !item.url;
  return (
    <div
      className={cn(
        'border-border bg-muted/30 grid grid-cols-[32px_1fr_auto] items-center gap-3 rounded-md border-l-2 px-3 py-2',
        'border-l-ops-blue',
      )}
    >
      <div className="bg-ops-blue-lighter text-ops-blue flex h-8 w-8 items-center justify-center rounded">
        <DashboardIcon name={item.icon} size={16} />
      </div>
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">
          {empty ? 'Card preview' : item.label || '(no title)'}
        </div>
        {item.sub ? <div className="text-muted-foreground truncate text-xs">{item.sub}</div> : null}
      </div>
      {item.url ? <ExternalLink className="text-muted-foreground h-4 w-4" /> : null}
    </div>
  );
}
